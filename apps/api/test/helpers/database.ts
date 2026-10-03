import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

export const POSTGIS_IMAGE = 'postgis/postgis:16-3.5';

export interface TestDatabase {
  url: string;
  stop: () => Promise<void>;
}

const apiRoot = path.resolve(import.meta.dirname, '../..');

/** Aplica las migraciones de Prisma (incluye roles, funciones y seguridad por filas). */
export function migrate(url: string): void {
  const prismaCli = path.join(
    path.dirname(createRequire(import.meta.url).resolve('prisma/package.json')),
    'build/index.js',
  );
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Crea una base temporal en un PostgreSQL existente. TEST_DATABASE_URL debe apuntar a un
 * usuario con permiso para crear bases (por ejemplo, la base "postgres" del servidor local).
 */
async function createTemporaryDatabase(adminUrl: string): Promise<TestDatabase> {
  const name = `shiftlane_test_${randomBytes(6).toString('hex')}`;
  await withClient(adminUrl, (client) => client.query(`CREATE DATABASE ${name}`));
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await withClient(url.toString(), (client) =>
    client.query('CREATE EXTENSION IF NOT EXISTS postgis'),
  );
  return {
    url: url.toString(),
    stop: async () => {
      await withClient(adminUrl, (client) =>
        client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
      );
    },
  };
}

async function startContainer(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGIS_IMAGE).start();
  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * PostgreSQL real y migrado para las pruebas: base temporal si hay TEST_DATABASE_URL; si no,
 * Testcontainers.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  const database = adminUrl ? await createTemporaryDatabase(adminUrl) : await startContainer();
  try {
    migrate(database.url);
  } catch (error) {
    await database.stop();
    throw error;
  }
  return database;
}
