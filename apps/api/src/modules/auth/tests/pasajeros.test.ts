import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { cookieValue, fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { REFRESH_COOKIE } from '../routes.ts';

let app: App;
let fx: ReturnType<typeof fixtures>;
let plant: { id: string; passengerActivationCode: string | null };
let clientOrgId: string;

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  const tenant = await fx.tenant();
  const created = await fx.clientOrgWithPlant({ tenantId: tenant.id, activationCode: 'ALFA2026' });
  plant = created.plant;
  clientOrgId = created.org.id;
});

afterAll(async () => {
  await app.close();
});

function activate(employeeNumber: string, plantCode = 'alfa-2026') {
  return request(app.server).post('/auth/passenger/activate').send({ plantCode, employeeNumber });
}

describe('activación del pasajero con número de empleado', () => {
  it('activa con el código de la planta y el número de la lista', async () => {
    const passenger = await fx.passenger({
      clientOrgId,
      plantId: plant.id,
      employeeNumber: 'E-1001',
    });
    const response = await activate('E-1001').expect(200);
    expect(response.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: 900,
      passenger: { id: passenger.id, fullName: passenger.fullName },
    });
    expect(cookieValue(response.headers['set-cookie'], REFRESH_COOKIE)).toBeTruthy();

    const me = await request(app.server)
      .get('/auth/me')
      .set('authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ kind: 'passenger', id: passenger.id, plantId: plant.id });

    const stored = await app.db.system.passenger.findUniqueOrThrow({ where: { id: passenger.id } });
    expect(stored.activatedAt).not.toBeNull();
  });

  it('rechaza números que no están en la lista, códigos de planta falsos y bajas', async () => {
    await fx.passenger({
      clientOrgId,
      plantId: plant.id,
      employeeNumber: 'E-2002',
      status: 'inactive',
    });
    const unknown = await activate('E-9999').expect(401);
    expect(unknown.body.error.message).toMatch(/No encontramos tu número de empleado/);
    await activate('E-2002').expect(401);
    await fx.passenger({ clientOrgId, plantId: plant.id, employeeNumber: 'E-3003' });
    await activate('E-3003', 'NOEXISTE').expect(401);
  });

  it('activar en otro celular cierra la sesión del anterior', async () => {
    await fx.passenger({ clientOrgId, plantId: plant.id, employeeNumber: 'E-4004' });
    const first = cookieValue(
      (await activate('E-4004').expect(200)).headers['set-cookie'],
      REFRESH_COOKIE,
    );
    const second = cookieValue(
      (await activate('E-4004').expect(200)).headers['set-cookie'],
      REFRESH_COOKIE,
    );
    await request(app.server)
      .post('/auth/refresh')
      .set('cookie', `${REFRESH_COOKIE}=${first}`)
      .expect(401);
    await request(app.server)
      .post('/auth/refresh')
      .set('cookie', `${REFRESH_COOKIE}=${second}`)
      .expect(200);
  });

  it('un pasajero no puede usar rutas de usuarios web', async () => {
    await fx.passenger({ clientOrgId, plantId: plant.id, employeeNumber: 'E-5005' });
    const { accessToken } = (await activate('E-5005').expect(200)).body as { accessToken: string };
    await request(app.server)
      .get('/auth/sessions')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(403);
  });
});
