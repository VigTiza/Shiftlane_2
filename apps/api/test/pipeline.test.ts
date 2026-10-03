import pg from 'pg';
import { describe, expect, it } from 'vitest';

describe('tubería de pruebas', () => {
  it('corre en Node.js 24 o superior', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(24);
  });
});

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL (requiere DATABASE_URL)', () => {
  it('responde y tiene PostGIS instalado', async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ version: string }>(
        'SELECT postgis_lib_version() AS version',
      );
      expect(rows[0]?.version).toMatch(/^3\./);
    } finally {
      await client.end();
    }
  });
});
