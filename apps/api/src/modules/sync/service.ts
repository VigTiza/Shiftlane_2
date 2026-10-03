import type { FastifyBaseLogger } from 'fastify';

import type { Database, DbContext, DbTransaction } from '../../lib/db.ts';
import { withDbContext } from '../../lib/db.ts';
import { AppError } from '../../lib/errors.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { DriverTripsService } from '../trips/driver-service.ts';
import { SYNC_DATA, SYNC_EVENT_TYPES } from './schemas.ts';
import type { SyncEvent, SyncEventType } from './schemas.ts';

/** Diferencias menores se deben a la latencia de la red, no al reloj del celular. */
const CLOCK_NOISE_MS = 2_000;
/** Acciones que necesitan el viaje iniciado: si el inicio no ha llegado, se reintentan. */
const NEEDS_START: readonly SyncEventType[] = ['stop_arrived', 'scan', 'gate', 'finish'];

type Status = 'applied' | 'duplicate' | 'rejected' | 'retry';

export interface SyncSession {
  tenantId: string;
  driverId: string;
  deviceId: string;
}

interface Outcome {
  id: string;
  type: string;
  status: Status;
  message: string | null;
  result: unknown;
}

/** Orden en que ocurrieron: el contador del celular y, sin él, la hora. */
function byDeviceOrder(
  a: { event: SyncEvent; index: number },
  b: { event: SyncEvent; index: number },
) {
  const sa = a.event.sequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.event.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  const ta = a.event.occurredAt.getTime();
  const tb = b.event.occurredAt.getTime();
  return ta !== tb ? ta - tb : a.index - b.index;
}

function zodMessage(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join(' ');
}

/**
 * Sincronización de lo que el celular guardó sin señal. Procesa en el orden del celular, cada
 * evento en su propia transacción (un evento malo no detiene a los demás), ignora duplicados
 * con la bitácora device_sync_events y corrige la hora con el desfase del reloj del celular.
 */
export function createSyncService(deps: {
  db: Database;
  driver: DriverTripsService;
  log: FastifyBaseLogger;
}) {
  const { driver } = deps;

  async function apply(
    tx: DbTransaction,
    session: SyncSession,
    type: SyncEventType,
    event: SyncEvent,
    data: Record<string, unknown>,
    occurredAt: Date,
  ): Promise<unknown> {
    const driverSession = { tenantId: session.tenantId, driverId: session.driverId };
    const common = { occurredAt, clientEventId: event.id };
    const late = { allowLate: true };
    const tripId = event.tripId!;
    switch (type) {
      case 'checklist':
        return driver.submitChecklist(tx, driverSession, tripId, {
          ...common,
          ...(data as unknown as Parameters<DriverTripsService['submitChecklist']>[3]),
        });
      case 'start':
        return driver.start(tx, driverSession, tripId, { ...common, ...data });
      case 'stop_arrived':
        return driver.arriveStop(
          tx,
          driverSession,
          tripId,
          { ...common, ...(data as { stopId: string }) },
          late,
        );
      case 'scan':
        return driver.scan(tx, driverSession, tripId, { ...data, ...common }, late);
      case 'incident':
        return driver.reportIncident(
          tx,
          driverSession,
          tripId,
          {
            ...common,
            ...(data as unknown as Parameters<DriverTripsService['reportIncident']>[3]),
          },
          late,
        );
      case 'panic':
        return driver.panic(tx, driverSession, { ...common, ...data, tripId: event.tripId });
      case 'gate':
        return driver.gate(
          tx,
          driverSession,
          tripId,
          { ...common, ...(data as { code: string }) },
          late,
        );
      case 'finish':
        return driver.finish(tx, driverSession, tripId, { ...common, ...data });
    }
  }

  async function writeLedger(
    tx: DbTransaction,
    session: SyncSession,
    event: SyncEvent,
    occurredAt: Date,
    outcome: { status: 'applied' | 'rejected'; message: string | null; result: unknown },
  ) {
    await tx.deviceSyncEvent.create({
      data: {
        tenantId: session.tenantId,
        deviceId: session.deviceId,
        driverId: session.driverId,
        eventId: event.id,
        type: event.type,
        sequence: event.sequence ?? null,
        tripId: event.tripId ?? null,
        deviceOccurredAt: event.occurredAt,
        occurredAt,
        status: outcome.status,
        message: outcome.message,
        result: outcome.result ?? undefined,
      },
    });
  }

  async function processEvent(
    context: DbContext,
    session: SyncSession,
    event: SyncEvent,
    occurredAt: Date,
  ): Promise<Outcome> {
    const base = { id: event.id, type: event.type };
    const previous = await withDbContext(deps.db.app, context, (tx) =>
      tx.deviceSyncEvent.findFirst({ where: { deviceId: session.deviceId, eventId: event.id } }),
    );
    if (previous) {
      return { ...base, status: 'duplicate', message: previous.message, result: previous.result };
    }

    const reject = async (message: string): Promise<Outcome> => {
      try {
        await withDbContext(deps.db.app, context, (tx) =>
          writeLedger(tx, session, event, occurredAt, {
            status: 'rejected',
            message,
            result: null,
          }),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return { ...base, status: 'duplicate', message, result: null };
      }
      return { ...base, status: 'rejected', message, result: null };
    };

    if (!(SYNC_EVENT_TYPES as readonly string[]).includes(event.type)) {
      return reject(`Tipo de evento desconocido: ${event.type}.`);
    }
    const type = event.type as SyncEventType;
    if (type !== 'panic' && !event.tripId) return reject('El evento no indica el viaje.');
    const parsed = SYNC_DATA[type].safeParse(event.data);
    if (!parsed.success) return reject(`Datos inválidos: ${zodMessage(parsed.error)}`);

    try {
      return await withDbContext(
        deps.db.app,
        context,
        async (tx): Promise<Outcome> => {
          if (NEEDS_START.includes(type)) {
            const trip = await tx.trip.findFirst({
              where: { id: event.tripId!, driverId: session.driverId },
              select: { status: true },
            });
            if (trip?.status === 'scheduled') {
              // El inicio del viaje todavía no llega: el celular debe reenviar este evento.
              return {
                ...base,
                status: 'retry',
                message: 'Todavía no se recibe el inicio del viaje; se reintentará.',
                result: null,
              };
            }
          }
          const result = await apply(tx, session, type, event, parsed.data, occurredAt);
          const duplicate = (result as { duplicate?: boolean } | null)?.duplicate === true;
          await writeLedger(tx, session, event, occurredAt, {
            status: 'applied',
            message: null,
            result,
          });
          return { ...base, status: duplicate ? 'duplicate' : 'applied', message: null, result };
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Otro envío del mismo lote ganó la carrera: ya quedó registrado.
        return { ...base, status: 'duplicate', message: null, result: null };
      }
      if (error instanceof AppError && error.statusCode < 500) return reject(error.message);
      deps.log.error({ err: error, eventId: event.id }, 'No se pudo sincronizar un evento');
      return { ...base, status: 'retry', message: 'Error temporal; se reintentará.', result: null };
    }
  }

  return {
    async processBatch(
      context: DbContext,
      session: SyncSession,
      body: { sentAt: Date; events: SyncEvent[] },
    ) {
      const receivedAt = new Date();
      const rawOffset = receivedAt.getTime() - body.sentAt.getTime();
      const clockOffsetMs = Math.abs(rawOffset) < CLOCK_NOISE_MS ? 0 : rawOffset;

      // Un evento repetido dentro del mismo lote se procesa una sola vez.
      const seen = new Map<string, number>();
      const ordered = body.events
        .map((event, index) => ({ event, index }))
        .filter(({ event, index }) => {
          if (seen.has(event.id)) return false;
          seen.set(event.id, index);
          return true;
        })
        .sort(byDeviceOrder);

      const outcomes = new Map<string, Outcome>();
      for (const { event } of ordered) {
        const corrected = new Date(event.occurredAt.getTime() + clockOffsetMs);
        // Nada puede haber ocurrido después de que llegó al servidor.
        const occurredAt = corrected > receivedAt ? receivedAt : corrected;
        outcomes.set(event.id, await processEvent(context, session, event, occurredAt));
      }

      await withDbContext(deps.db.app, context, (tx) =>
        tx.device.update({
          where: { id: session.deviceId },
          data: { lastSyncAt: receivedAt, lastSeenAt: receivedAt, clockOffsetMs },
        }),
      );

      // Resultados en el orden en que llegaron (los repetidos repiten el resultado).
      const results = body.events.map((event) => {
        const outcome = outcomes.get(event.id)!;
        return { ...outcome, result: outcome.result ?? null };
      });
      const summary = { applied: 0, duplicate: 0, rejected: 0, retry: 0 };
      for (const [index, event] of body.events.entries()) {
        const status = seen.get(event.id) === index ? outcomes.get(event.id)!.status : 'duplicate';
        summary[status] += 1;
        if (status === 'duplicate' && seen.get(event.id) !== index)
          results[index]!.status = 'duplicate';
      }
      return { receivedAt, clockOffsetMs, summary, results };
    },
  };
}
