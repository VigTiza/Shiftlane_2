import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import { PrismaClient } from '../generated/prisma/client.ts';
import { withAfterCommit } from './after-commit.ts';
import type { Prisma } from '../generated/prisma/client.ts';

/** Rol de PostgreSQL con el que corre la API; está sujeto a la seguridad por filas. */
export const APP_DB_ROLE = 'shiftlane_app';

export type DbClient = PrismaClient;
export type DbTransaction = Prisma.TransactionClient;

/** Quién hace la petición. La base de datos solo muestra filas de este contexto. */
export interface DbContext {
  tenantId?: string | null;
  clientOrgId?: string | null;
  userId?: string | null;
  /** Para la bitácora: quién hace el cambio (user, driver, passenger o system). */
  actorType?: 'user' | 'driver' | 'passenger' | 'system';
  actorId?: string | null;
  requestId?: string | null;
  ip?: string | null;
}

export interface Database {
  /** Cliente sujeto a la seguridad por filas. Usarlo siempre dentro de withDbContext. */
  app: DbClient;
  /**
   * Cliente que se salta la seguridad por filas. Solo para procesos que no pertenecen a una
   * empresa: inicio de sesión, tareas programadas y consola de plataforma.
   */
  system: DbClient;
  /** Pool del rol de la API, para consultas SQL directas (PostGIS) y chequeos de salud. */
  pool: pg.Pool;
  close: () => Promise<void>;
}

function createPool(connectionString: string, role?: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // El rol se fija al abrir la conexión: si algo olvida el contexto, no ve ninguna fila.
    ...(role ? { options: `-c role=${role}` } : {}),
  });
}

export function createDatabase(connectionString: string): Database {
  const pool = createPool(connectionString, APP_DB_ROLE);
  const systemPool = createPool(connectionString);
  const app = new PrismaClient({ adapter: new PrismaPg(pool) });
  const system = new PrismaClient({ adapter: new PrismaPg(systemPool) });
  return {
    app,
    system,
    pool,
    close: async () => {
      await Promise.all([app.$disconnect(), system.$disconnect()]);
      await Promise.all([pool.end(), systemPool.end()]);
    },
  };
}

/**
 * Ejecuta `fn` en una transacción con el contexto fijado con set_config(..., true), que
 * equivale a SET LOCAL: al terminar la transacción la conexión vuelve a no ver nada. Los
 * eventos publicados dentro solo se entregan si la transacción se confirma.
 */
export async function withDbContext<T>(
  db: DbClient,
  context: DbContext,
  fn: (tx: DbTransaction) => Promise<T>,
  options?: { timeout?: number },
): Promise<T> {
  return withAfterCommit(() =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`
        SELECT set_config('app.tenant_id', ${context.tenantId ?? ''}, true),
               set_config('app.client_org_id', ${context.clientOrgId ?? ''}, true),
               set_config('app.user_id', ${context.userId ?? ''}, true),
               set_config('app.actor_type', ${context.actorType ?? 'system'}, true),
               set_config('app.actor_id', ${context.actorId ?? context.userId ?? ''}, true),
               set_config('app.request_id', ${context.requestId ?? ''}, true),
               set_config('app.ip', ${context.ip ?? ''}, true)`;
        return fn(tx);
      },
      { timeout: options?.timeout ?? 10_000 },
    ),
  );
}

/** Comprueba que la base de datos responde. Nunca lanza: devuelve false si falla. */
export async function isDatabaseReachable(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
