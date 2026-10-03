import { todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { withDbContext } from '../../../lib/db.ts';

const PASSWORD = 'Transporte2026';
const TODAY = todayIn('America/Ciudad_Juarez');

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// Paradas reales de Ciudad Juárez rumbo al Parque Industrial Antonio J. Bermúdez.
const STOPS = [
  {
    name: 'Plaza de la Mexicanidad',
    location: { lat: 31.7445, lng: -106.4605 },
    times: [{ time: '05:00' }, { weekdays: [6], time: '06:30' }],
  },
  {
    name: 'Av. de las Torres y Tecnológico',
    location: { lat: 31.6952, lng: -106.4239 },
    times: [{ time: '05:20' }],
  },
  {
    name: 'Waterfill y Ejército Nacional',
    location: { lat: 31.7101, lng: -106.4081 },
    times: [{ time: '05:35' }],
  },
];

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let plantId: string;
let clientOrgId: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

function createRoute(
  overrides: Record<string, unknown> = {},
  version: Record<string, unknown> = {},
) {
  return request(app.server)
    .post('/routes')
    .set('authorization', ownerAuth)
    .send({
      plantId,
      code: `R-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Ruta Centro',
      direction: 'inbound',
      version: { validFrom: TODAY, stops: STOPS, ...version },
      ...overrides,
    });
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  ownerAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
  );
  const created = await fx.clientOrgWithPlant({ tenantId });
  plantId = created.plant.id;
  clientOrgId = created.org.id;
});

afterAll(async () => {
  await app.close();
});

describe('alta de rutas', () => {
  it('crea la ruta con paradas, horarios y trazo; calcula la distancia', async () => {
    const response = await createRoute().expect(201);
    expect(response.body).toMatchObject({
      direction: 'inbound',
      active: true,
      current: { number: 1, validFrom: TODAY, stopsCount: 3 },
    });
    expect(response.body.current.distanceKm).toBeGreaterThan(5);
    expect(response.body.current.distanceKm).toBeLessThan(15);

    const versionId = response.body.current.id as string;
    const detail = await request(app.server)
      .get(`/routes/${response.body.id as string}/versions/${versionId}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.stops).toHaveLength(3);
    expect(detail.body.stops[0]).toMatchObject({
      sequence: 1,
      name: 'Plaza de la Mexicanidad',
      location: { lat: 31.7445, lng: -106.4605 },
      radiusMeters: 80,
      times: [
        { weekdays: [], time: '05:00' },
        { weekdays: [6], time: '06:30' },
      ],
    });
    expect(detail.body.path).toHaveLength(3);
  });

  it('los horarios deben ir en orden a lo largo de la ruta', async () => {
    const response = await createRoute(
      {},
      {
        stops: [
          { name: 'Primera', location: { lat: 31.74, lng: -106.46 }, times: [{ time: '05:30' }] },
          { name: 'Segunda', location: { lat: 31.73, lng: -106.45 }, times: [{ time: '05:10' }] },
        ],
      },
    ).expect(400);
    expect(response.body.error.details[0].message).toBe(
      'La parada 2 tiene un horario anterior a la parada previa.',
    );
  });

  it('no permite claves repetidas ni plantas sin acuerdo', async () => {
    await createRoute({ code: 'R-REP' }).expect(201);
    const repeated = await createRoute({ code: 'R-REP' }).expect(409);
    expect(repeated.body.error.message).toBe('Ya existe una ruta con esa clave.');

    const otherTenant = await fx.tenant();
    const { plant } = await fx.clientOrgWithPlant({ tenantId: otherTenant.id });
    const foreign = await createRoute({ plantId: plant.id }).expect(400);
    expect(foreign.body.error.message).toBe(
      'La planta no tiene un acuerdo de servicio activo con tu empresa.',
    );
  });
});

describe('versiones con vigencia', () => {
  it('una versión futura aplica desde su fecha; la de hoy sigue vigente mientras', async () => {
    const route = await createRoute().expect(201);
    const id = route.body.id as string;
    const v2 = await request(app.server)
      .post(`/routes/${id}/versions`)
      .set('authorization', ownerAuth)
      .send({ validFrom: addDays(TODAY, 10), stops: STOPS.slice(0, 2) })
      .expect(201);
    expect(v2.body).toMatchObject({ number: 2, current: false, stopsCount: 2 });

    const detail = await request(app.server)
      .get(`/routes/${id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.current.number).toBe(1);

    const effective = (date: string) =>
      request(app.server)
        .get(`/routes/${id}/effective`)
        .query({ date })
        .set('authorization', ownerAuth)
        .expect(200);
    expect((await effective(addDays(TODAY, 9))).body.version.number).toBe(1);
    expect((await effective(addDays(TODAY, 10))).body.version.number).toBe(2);
    expect((await effective(addDays(TODAY, -1))).body.version).toBeNull();
  });

  it('no se crean versiones en el pasado ni dos el mismo día', async () => {
    const route = await createRoute().expect(201);
    const id = route.body.id as string;
    const past = await request(app.server)
      .post(`/routes/${id}/versions`)
      .set('authorization', ownerAuth)
      .send({ validFrom: addDays(TODAY, -1), stops: STOPS })
      .expect(400);
    expect(past.body.error.message).toBe('Una versión nueva no puede empezar en el pasado.');
    const sameDay = await request(app.server)
      .post(`/routes/${id}/versions`)
      .set('authorization', ownerAuth)
      .send({ validFrom: TODAY, stops: STOPS })
      .expect(409);
    expect(sameDay.body.error.message).toMatch(/Ya hay una versión que empieza/);
  });

  it('se elimina una versión futura, nunca la vigente', async () => {
    const route = await createRoute().expect(201);
    const id = route.body.id as string;
    const future = await request(app.server)
      .post(`/routes/${id}/versions`)
      .set('authorization', ownerAuth)
      .send({ validFrom: addDays(TODAY, 3), stops: STOPS })
      .expect(201);
    await request(app.server)
      .delete(`/routes/${id}/versions/${future.body.id as string}`)
      .set('authorization', ownerAuth)
      .expect(204);
    await request(app.server)
      .delete(`/routes/${id}/versions/${route.body.current.id as string}`)
      .set('authorization', ownerAuth)
      .expect(409);
  });

  it('restaura una versión anterior conservando la identidad de las paradas', async () => {
    const route = await createRoute().expect(201);
    const id = route.body.id as string;
    const v1 = await request(app.server)
      .get(`/routes/${id}/versions/${route.body.current.id as string}`)
      .set('authorization', ownerAuth);
    await request(app.server)
      .post(`/routes/${id}/versions`)
      .set('authorization', ownerAuth)
      .send({ validFrom: addDays(TODAY, 5), stops: [STOPS[2]] })
      .expect(201);

    const restored = await request(app.server)
      .post(`/routes/${id}/versions/${route.body.current.id as string}/restore`)
      .set('authorization', ownerAuth)
      .send({ validFrom: addDays(TODAY, 15) })
      .expect(201);
    expect(restored.body).toMatchObject({
      number: 3,
      basedOnId: route.body.current.id,
      stopsCount: 3,
    });
    expect(restored.body.stops.map((s: { stopKey: string }) => s.stopKey)).toEqual(
      v1.body.stops.map((s: { stopKey: string }) => s.stopKey),
    );

    const history = await request(app.server)
      .get(`/routes/${id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(history.body.versions.map((v: { number: number }) => v.number)).toEqual([3, 2, 1]);
  });

  it('un cambio temporal aplica entre sus fechas y luego vuelve la versión normal', async () => {
    const route = await createRoute().expect(201);
    const id = route.body.id as string;
    const routeRow = await app.db.system.route.findUniqueOrThrow({ where: { id } });
    const temporary = await app.db.system.routeVersion.create({
      data: {
        tenantId,
        routeId: id,
        number: 99,
        kind: 'temporary',
        validFrom: new Date(`${addDays(TODAY, 2)}T00:00:00Z`),
      },
    });
    const change = await app.db.system.temporaryChange.create({
      data: {
        tenantId: routeRow.tenantId,
        routeId: id,
        routeVersionId: temporary.id,
        startsOn: new Date(`${addDays(TODAY, 2)}T00:00:00Z`),
        endsOn: new Date(`${addDays(TODAY, 4)}T00:00:00Z`),
        reason: 'Obra en Av. Tecnológico',
      },
    });
    const effective = (date: string) =>
      request(app.server)
        .get(`/routes/${id}/effective`)
        .query({ date })
        .set('authorization', ownerAuth)
        .expect(200);
    expect((await effective(addDays(TODAY, 3))).body).toMatchObject({
      temporaryChangeId: change.id,
      version: { kind: 'temporary' },
    });
    expect((await effective(addDays(TODAY, 5))).body).toMatchObject({
      temporaryChangeId: null,
      version: { number: 1 },
    });
  });
});

describe('turnos', () => {
  it('crea turnos y valida que pertenezcan a la planta de la ruta', async () => {
    const shift = await request(app.server)
      .post('/shifts')
      .set('authorization', ownerAuth)
      .send({ plantId, name: 'Primer turno', startsAt: '06:00', endsAt: '14:00' })
      .expect(201);
    const route = await createRoute({ shiftId: shift.body.id }).expect(201);
    expect(route.body.shiftId).toBe(shift.body.id);

    const otherPlant = await fx.clientOrgWithPlant({ tenantId });
    const otherShift = await request(app.server)
      .post('/shifts')
      .set('authorization', ownerAuth)
      .send({
        plantId: otherPlant.plant.id,
        name: 'Turno ajeno',
        startsAt: '06:00',
        endsAt: '14:00',
      })
      .expect(201);
    const mismatch = await createRoute({ shiftId: otherShift.body.id }).expect(400);
    expect(mismatch.body.error.message).toBe('El turno no pertenece a la planta de la ruta.');
  });
});

describe('aislamiento de rutas', () => {
  it('otra transportista en la misma planta no ve las rutas; la planta sí', async () => {
    const route = await createRoute({ code: 'R-PRIV' }).expect(201);

    // Una segunda transportista atiende la misma planta.
    const rival = await fx.tenant();
    await app.db.system.serviceAgreement.create({
      data: { tenantId: rival.id, plantId, clientOrgId },
    });
    const rivalAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: rival.id, password: PASSWORD, roles: ['owner'] })).email,
    );
    await request(app.server)
      .get(`/routes/${route.body.id as string}`)
      .set('authorization', rivalAuth)
      .expect(404);
    const rivalList = await request(app.server)
      .get('/routes')
      .query({ plantId })
      .set('authorization', rivalAuth)
      .expect(200);
    expect(rivalList.body).toEqual([]);

    const plantSees = await withDbContext(app.db.app, { clientOrgId }, (tx) =>
      tx.route.findMany({ where: { id: route.body.id as string } }),
    );
    expect(plantSees).toHaveLength(1);
    const plantStops = await withDbContext(app.db.app, { clientOrgId }, (tx) =>
      tx.stop.count({ where: { routeVersionId: route.body.current.id as string } }),
    );
    expect(plantStops).toBe(3);
  });

  it('el despachador consulta rutas pero no las crea', async () => {
    const dispatcher = await tokenFor(
      (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['dispatcher'] })).email,
    );
    await request(app.server).get('/routes').set('authorization', dispatcher).expect(200);
    await request(app.server).post('/routes').set('authorization', dispatcher).send({}).expect(403);
  });
});
