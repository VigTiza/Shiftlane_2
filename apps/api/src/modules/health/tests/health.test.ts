import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import type { App } from '../../../app.ts';

describe('salud de la API', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responde que el proceso está vivo', async () => {
    const response = await request(app.server).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', uptimeSeconds: expect.any(Number) });
  });

  it('GET /ready confirma la conexión a PostgreSQL', async () => {
    const response = await request(app.server).get('/ready').expect(200);
    expect(response.body).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });
});

describe('salud sin base de datos', () => {
  it('GET /ready responde 503 si PostgreSQL no está disponible', async () => {
    const app = await buildTestApp({
      env: { DATABASE_URL: 'postgresql://nadie:nada@127.0.0.1:1/inexistente' },
    });
    try {
      const response = await request(app.server).get('/ready').expect(503);
      expect(response.body).toEqual({ status: 'not_ready', checks: { database: 'error' } });
      await request(app.server).get('/health').expect(200);
    } finally {
      await app.close();
    }
  });
});
