import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { App } from '../src/app.ts';
import { NotFoundError } from '../src/lib/errors.ts';
import { z } from '../src/lib/zod.ts';
import { buildTestApp } from './helpers/app.ts';

describe('comportamiento común de la API', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildTestApp({
      env: { CORS_ORIGINS: 'https://app.shiftlane.mx' },
      beforeReady: (instance) => {
        instance.get('/prueba/no-encontrado', () => {
          throw new NotFoundError('No se encontró la unidad.');
        });
        instance.get('/prueba/falla', () => {
          throw new Error('detalle interno que no debe salir');
        });
        instance.post(
          '/prueba/validacion',
          { schema: { body: z.object({ placas: z.string().min(5), capacidad: z.number() }) } },
          () => ({ ok: true }),
        );
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 404 en español para rutas inexistentes', async () => {
    const response = await request(app.server).get('/no-existe').expect(404);
    expect(response.body).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: 'No existe la ruta solicitada.' },
      requestId: expect.any(String),
    });
  });

  it('respeta el código y mensaje de los errores de negocio', async () => {
    const response = await request(app.server).get('/prueba/no-encontrado').expect(404);
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'No se encontró la unidad.',
    });
  });

  it('oculta los detalles de los errores inesperados', async () => {
    const response = await request(app.server).get('/prueba/falla').expect(500);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno. Intenta de nuevo más tarde.',
    });
    expect(JSON.stringify(response.body)).not.toContain('detalle interno');
  });

  it('valida la entrada con Zod y explica cada campo en español', async () => {
    const response = await request(app.server)
      .post('/prueba/validacion')
      .send({ placas: 'AB', capacidad: 'muchos' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Los datos enviados no son válidos.');
    const details = response.body.error.details as { path: string; message: string }[];
    expect(details.map((detail) => detail.path)).toEqual(
      expect.arrayContaining(['body.placas', 'body.capacidad']),
    );
    const capacidad = details.find((detail) => detail.path === 'body.capacidad');
    expect(capacidad?.message).toBe('Entrada inválida: se esperaba número, recibido texto');
  });

  it('responde en español a un JSON mal formado', async () => {
    const response = await request(app.server)
      .post('/prueba/validacion')
      .set('content-type', 'application/json')
      .send('{"placas":')
      .expect(400);
    expect(response.body.error.message).toBe('El cuerpo de la petición no es un JSON válido.');
  });

  it('agrega encabezados de seguridad, CORS e identificador de petición', async () => {
    const response = await request(app.server)
      .get('/health')
      .set('origin', 'https://app.shiftlane.mx')
      .expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['access-control-allow-origin']).toBe('https://app.shiftlane.mx');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('no permite CORS desde orígenes desconocidos', async () => {
    const response = await request(app.server)
      .get('/health')
      .set('origin', 'https://otro-sitio.com')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('publica la documentación OpenAPI', async () => {
    const response = await request(app.server).get('/docs/json').expect(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(Object.keys(response.body.paths)).toEqual(expect.arrayContaining(['/health', '/ready']));
  });
});

describe('límite de peticiones', () => {
  it('responde 429 en español al superar el límite', async () => {
    const app = await buildTestApp({
      env: { RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' },
      beforeReady: (instance) => {
        instance.get('/prueba/limitada', () => ({ ok: true }));
      },
    });
    try {
      await request(app.server).get('/prueba/limitada').expect(200);
      await request(app.server).get('/prueba/limitada').expect(200);
      const response = await request(app.server).get('/prueba/limitada').expect(429);
      expect(response.body.error.code).toBe('RATE_LIMITED');
      expect(response.body.error.message).toMatch(
        /^Demasiadas peticiones\. Intenta de nuevo en \d+ segundos\.$/,
      );
      // /health no cuenta para el límite: los monitores no deben bloquearse.
      await request(app.server).get('/health').expect(200);
    } finally {
      await app.close();
    }
  });
});
