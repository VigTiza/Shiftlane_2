import { randomBytes } from 'node:crypto';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

export const POSTGIS_IMAGE = 'postgis/postgis:16-3.5';

export interface TestDatabase {
  url: string;
  stop: () => Promise<void>;
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

/** PostgreSQL real para las pruebas: base temporal si hay TEST_DATABASE_URL; si no, Testcontainers. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  return adminUrl ? createTemporaryDatabase(adminUrl) : startContainer();
}
