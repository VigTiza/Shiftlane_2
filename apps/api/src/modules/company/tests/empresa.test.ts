import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let dispatcherAuth: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant('Transportes Riberas')).id;
  ownerAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
  );
  dispatcherAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['dispatcher'] })).email,
  );
});

afterAll(async () => {
  await app.close();
});

describe('datos de la empresa', () => {
  it('nombre, razón social y RFC; el despachador solo los ve', async () => {
    const before = await request(app.server)
      .get('/company')
      .set('authorization', dispatcherAuth)
      .expect(200);
    expect(before.body).toMatchObject({
      name: 'Transportes Riberas',
      legalName: null,
      hasLogo: false,
    });

    const invalid = await request(app.server)
      .put('/company')
      .set('authorization', ownerAuth)
      .send({ rfc: 'NO-ES-RFC' })
      .expect(400);
    expect(JSON.stringify(invalid.body)).toContain('El RFC no tiene un formato válido.');

    const saved = await request(app.server)
      .put('/company')
      .set('authorization', ownerAuth)
      .send({ legalName: 'Transportes Riberas SA de CV', rfc: 'tri010203ab1' })
      .expect(200);
    expect(saved.body).toMatchObject({
      legalName: 'Transportes Riberas SA de CV',
      rfc: 'TRI010203AB1',
    });

    await request(app.server)
      .put('/company')
      .set('authorization', dispatcherAuth)
      .send({ name: 'Otro nombre' })
      .expect(403);
  });

  it('logo: subir, ver y quitar', async () => {
    await request(app.server)
      .post('/company/logo')
      .set('authorization', ownerAuth)
      .attach('file', PNG, 'logo.png')
      .expect(204);
    const company = await request(app.server)
      .get('/company')
      .set('authorization', ownerAuth)
      .expect(200);
    expect(company.body.hasLogo).toBe(true);
    const logo = await request(app.server)
      .get('/company/logo')
      .set('authorization', dispatcherAuth)
      .expect(200);
    expect(logo.headers['content-type']).toBe('image/png');

    await request(app.server).delete('/company/logo').set('authorization', ownerAuth).expect(204);
    await request(app.server).get('/company/logo').set('authorization', ownerAuth).expect(404);
  });

  it('cada empresa ve solo sus datos', async () => {
    const otherTenant = (await fx.tenant('Autobuses del Norte')).id;
    const otherAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: otherTenant, password: PASSWORD, roles: ['owner'] })).email,
    );
    const other = await request(app.server)
      .get('/company')
      .set('authorization', otherAuth)
      .expect(200);
    expect(other.body.name).toBe('Autobuses del Norte');
    expect(other.body.rfc).toBeNull();
  });
});

describe('asistente de configuración inicial', () => {
  it('el avance sale de los datos de la cuenta y se puede marcar a mano', async () => {
    const newTenant = (await fx.tenant('Transportes Nuevos')).id;
    const auth = await tokenFor(
      (await fx.carrierUser({ tenantId: newTenant, password: PASSWORD, roles: ['owner'] })).email,
    );
    const start = await request(app.server)
      .get('/onboarding')
      .set('authorization', auth)
      .expect(200);
    expect(start.body).toMatchObject({ completed: 0, total: 8, dismissed: false });
    expect(start.body.steps.map((s: { key: string }) => s.key)).toEqual([
      'company',
      'operation',
      'fleet',
      'clients',
      'routes',
      'plant_invite',
      'devices',
      'test_trip',
    ]);

    // Unidad y chofer: la flota queda lista.
    await fx.driver({ tenantId: newTenant });
    await app.db.system.vehicle.create({
      data: {
        tenantId: newTenant,
        economicNumber: 'U-001',
        plates: 'ABC1234',
        model: 'Sprinter',
        year: 2024,
        capacity: 19,
      },
    });
    await request(app.server)
      .put('/company')
      .set('authorization', auth)
      .send({ legalName: 'Transportes Nuevos SA', rfc: 'TNU010203AB1' })
      .expect(200);
    const progress = await request(app.server)
      .get('/onboarding')
      .set('authorization', auth)
      .expect(200);
    const byKey = Object.fromEntries(
      (progress.body.steps as { key: string; done: boolean; count: number }[]).map((s) => [
        s.key,
        s,
      ]),
    );
    expect(byKey.fleet).toMatchObject({ done: true, count: 2 });
    expect(byKey.company).toMatchObject({ done: true });
    expect(progress.body.completed).toBe(2);

    const marked = await request(app.server)
      .put('/onboarding/steps/test_trip')
      .set('authorization', auth)
      .send({ done: true })
      .expect(200);
    expect(marked.body.completed).toBe(3);
    expect(
      (marked.body.steps as { key: string; markedManually: boolean }[]).find(
        (s) => s.key === 'test_trip',
      ),
    ).toMatchObject({ done: true, markedManually: true });

    const dismissed = await request(app.server)
      .put('/onboarding/dismissed')
      .set('authorization', auth)
      .send({ dismissed: true })
      .expect(200);
    expect(dismissed.body.dismissed).toBe(true);

    await request(app.server)
      .put('/onboarding/steps/no_existe')
      .set('authorization', auth)
      .send({ done: true })
      .expect(400);
  });
});
