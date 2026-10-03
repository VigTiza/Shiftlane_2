import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';

describe('tubería de pruebas', () => {
  it('corre en Node.js 24 o superior', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(24);
  });

  it('tiene un PostgreSQL real con PostGIS', async () => {
    const client = new pg.Client({ connectionString: inject('databaseUrl') });
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
