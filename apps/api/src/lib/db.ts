import pg from 'pg';

export type DbPool = pg.Pool;

export function createPool(connectionString: string): DbPool {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

/** Comprueba que la base de datos responde. Nunca lanza: devuelve false si falla. */
export async function isDatabaseReachable(pool: DbPool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
