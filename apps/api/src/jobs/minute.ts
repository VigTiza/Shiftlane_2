import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';

const EVERY_MS = 60_000;

/**
 * Tarea que corre cada minuto. Un candado de PostgreSQL por sesión evita que varias copias de
 * la API la ejecuten al mismo tiempo; si una corrida tarda más de un minuto, la siguiente
 * espera.
 */
export function createMinuteJob(options: {
  name: string;
  pool: pg.Pool;
  log: FastifyBaseLogger;
  run: () => Promise<Record<string, unknown>>;
}) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | null = null;

  async function tick() {
    const client = await options.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [options.name],
      );
      if (!rows[0]?.locked) return;
      try {
        const result = await options.run();
        options.log.debug({ job: options.name, ...result }, 'Tarea por minuto');
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [options.name]);
      }
    } finally {
      client.release();
    }
  }

  return {
    start() {
      timer = setInterval(() => {
        if (running) return;
        running = tick()
          .catch((error: unknown) =>
            options.log.error({ err: error, job: options.name }, 'Falló una tarea por minuto'),
          )
          .finally(() => {
            running = null;
          });
      }, EVERY_MS);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
