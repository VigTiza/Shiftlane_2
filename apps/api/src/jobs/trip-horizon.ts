import { addDays, todayIn } from '@shiftlane/shared';
import type { FastifyBaseLogger } from 'fastify';

import type { DbClient } from '../lib/db.ts';
import { generateTrips } from '../modules/schedule/generator.ts';
import type { GenerationResult } from '../modules/schedule/generator.ts';

const CHECK_EVERY_MS = 15 * 60_000;
const STARTUP_DELAY_MS = 5_000;

export interface TripHorizonRun extends GenerationResult {
  from: string;
  to: string;
  tenants: number;
  skipped: number;
  failed: number;
}

/**
 * Asegura los próximos días de viajes de todas las transportistas activas. Cada transportista
 * va en su propia transacción con un candado de PostgreSQL: si hay varias copias de la API,
 * solo una la procesa a la vez, y un error en una no detiene a las demás.
 */
export async function ensureTripHorizon(
  db: DbClient,
  options: {
    horizonDays: number;
    timeZone: string;
    log?: FastifyBaseLogger;
    /** Limita la corrida a estas transportistas (soporte y pruebas). */
    tenantIds?: string[];
  },
): Promise<TripHorizonRun> {
  const today = todayIn(options.timeZone);
  // Desde ayer: el generador recorta a "hoy" de cada planta (zonas horarias distintas).
  const from = addDays(today, -1);
  const to = addDays(today, options.horizonDays - 1);
  // Las suspendidas también: la operación de viajes nunca se interrumpe por cobro.
  const tenants = await db.tenant.findMany({
    where: {
      status: { not: 'cancelled' },
      deletedAt: null,
      ...(options.tenantIds ? { id: { in: options.tenantIds } } : {}),
    },
    select: { id: true },
  });
  const run: TripHorizonRun = {
    from: today,
    to,
    tenants: tenants.length,
    skipped: 0,
    failed: 0,
    created: 0,
    updated: 0,
    cancelled: 0,
    unchanged: 0,
  };
  for (const tenant of tenants) {
    try {
      const result = await db.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${`trip-horizon:${tenant.id}`})) AS locked`;
          if (!lock?.locked) return null;
          return generateTrips(tx, { tenantId: tenant.id, from, to });
        },
        { timeout: 120_000 },
      );
      if (!result) {
        run.skipped += 1;
        continue;
      }
      run.created += result.created;
      run.updated += result.updated;
      run.cancelled += result.cancelled;
      run.unchanged += result.unchanged;
    } catch (error) {
      run.failed += 1;
      options.log?.error({ err: error, tenantId: tenant.id }, 'No se pudieron generar los viajes');
    }
  }
  return run;
}

/**
 * Tarea diaria dentro de la API: corre al arrancar y después una vez al día a partir de la
 * hora configurada. Es idempotente, así que repetirla no duplica viajes.
 */
export function createTripHorizonJob(options: {
  db: DbClient;
  log: FastifyBaseLogger;
  horizonDays: number;
  timeZone: string;
  hour: number;
}) {
  let timer: NodeJS.Timeout | undefined;
  let lastRunDate: string | null = null;
  let running: Promise<void> | null = null;

  function localHour() {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: options.timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
  }

  async function run() {
    const date = todayIn(options.timeZone);
    lastRunDate = date;
    const started = Date.now();
    const result = await ensureTripHorizon(options.db, options);
    options.log.info(
      { job: 'trip-horizon', ms: Date.now() - started, ...result },
      'Viajes generados por adelantado',
    );
  }

  function tick(force = false) {
    if (running) return;
    const due = force || (todayIn(options.timeZone) !== lastRunDate && localHour() >= options.hour);
    if (!due) return;
    running = run()
      .catch((error: unknown) =>
        options.log.error({ err: error, job: 'trip-horizon' }, 'Falló la tarea diaria'),
      )
      .finally(() => {
        running = null;
      });
  }

  return {
    start() {
      timer = setTimeout(() => {
        tick(true);
        timer = setInterval(() => tick(), CHECK_EVERY_MS);
        timer.unref();
      }, STARTUP_DELAY_MS);
      timer.unref();
    },
    async stop() {
      clearTimeout(timer);
      clearInterval(timer);
      await running;
    },
  };
}
