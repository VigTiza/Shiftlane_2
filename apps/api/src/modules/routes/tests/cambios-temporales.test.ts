import { todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';
const TODAY = todayIn('America/Ciudad_Juarez');

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const STOPS = [
  {
    name: 'Plaza de la Mexicanidad',
    location: { lat: 31.7445, lng: -106.4605 },
    times: [{ time: '05:00' }],
  },
  {
    name: 'Av. Tecnológico',
    location: { lat: 31.7166, lng: -106.4233 },
    times: [{ time: '05:15' }],
  },
  { name: 'Waterfill', location: { lat: 31.7101, lng: -106.4081 }, times: [{ time: '05:30' }] },
];

interface Stop {
  stopKey: string;
  name: string;
  location: { lat: number; lng: number };
  times: { weekdays: number[]; time: string }[];
}

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

async function newRoute() {
  const created = await request(app.server)
    .post('/routes')
    .set('authorization', ownerAuth)
    .send({
      plantId,
      code: `T-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Ruta con cambios',
      direction: 'inbound',
      version: { validFrom: TODAY, stops: STOPS },
    })
    .expect(201);
  const id = created.body.id as string;
  const version = await request(app.server)
    .get(`/routes/${id}/versions/${created.body.current.id as string}`)
    .set('authorization', ownerAuth)
    .expect(200);
  return { id, stops: version.body.stops as Stop[] };
}

function effective(routeId: string, date: string) {
  return request(app.server)
    .get(`/routes/${routeId}/effective`)
    .query({ date })
    .set('authorization', ownerAuth)
    .expect(200);
}

function asInput(stops: Stop[]) {
  return stops.map((stop) => ({
    stopKey: stop.stopKey,
    name: stop.name,
    location: stop.location,
    times: stop.times,
  }));
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

describe('cambios temporales que se aplican y revierten solos', () => {
  it('cambia paradas y horarios entre dos fechas y luego vuelve la versión normal', async () => {
    const route = await newRoute();
    const detour = asInput(route.stops).filter((s) => s.name !== 'Av. Tecnológico');
    const change = await request(app.server)
      .post(`/routes/${route.id}/temporary-changes`)
      .set('authorization', ownerAuth)
      .send({
        startsOn: addDays(TODAY, 2),
        endsOn: addDays(TODAY, 4),
        reason: 'Obra en Av. Tecnológico',
        version: { stops: detour },
      })
      .expect(201);
    expect(change.body).toMatchObject({ suspendsService: false, cancelled: false });

    expect((await effective(route.id, addDays(TODAY, 1))).body).toMatchObject({
      temporaryChangeId: null,
      version: { kind: 'regular', stopsCount: 3 },
    });
    expect((await effective(route.id, addDays(TODAY, 2))).body).toMatchObject({
      temporaryChangeId: change.body.id,
      version: { kind: 'temporary', stopsCount: 2 },
    });
    expect((await effective(route.id, addDays(TODAY, 4))).body.version.kind).toBe('temporary');
    expect((await effective(route.id, addDays(TODAY, 5))).body).toMatchObject({
      temporaryChangeId: null,
      version: { kind: 'regular' },
    });

    // La versión normal sigue siendo la vigente en el historial.
    const detail = await request(app.server)
      .get(`/routes/${route.id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.current.kind).toBe('regular');
    expect(detail.body.temporaryChanges).toHaveLength(1);
  });

  it('suspende el servicio entre dos fechas', async () => {
    const route = await newRoute();
    await request(app.server)
      .post(`/routes/${route.id}/temporary-changes`)
      .set('authorization', ownerAuth)
      .send({
        startsOn: addDays(TODAY, 7),
        endsOn: addDays(TODAY, 8),
        reason: 'Paro técnico de la planta',
        suspendService: true,
      })
      .expect(201);
    expect((await effective(route.id, addDays(TODAY, 7))).body).toMatchObject({
      suspended: true,
      version: null,
    });
    expect((await effective(route.id, addDays(TODAY, 9))).body).toMatchObject({
      suspended: false,
      version: { kind: 'regular' },
    });
  });

  it('valida fechas, traslapes y contenido', async () => {
    const route = await newRoute();
    const post = (body: object) =>
      request(app.server)
        .post(`/routes/${route.id}/temporary-changes`)
        .set('authorization', ownerAuth)
        .send(body);

    const past = await post({
      startsOn: addDays(TODAY, -1),
      endsOn: TODAY,
      reason: 'Fecha pasada',
      suspendService: true,
    }).expect(400);
    expect(past.body.error.message).toBe('Un cambio temporal no puede empezar en el pasado.');
    const tooLong = await post({
      startsOn: TODAY,
      endsOn: addDays(TODAY, 200),
      reason: 'Muy largo',
      suspendService: true,
    }).expect(400);
    expect(tooLong.body.error.message).toMatch(/dura como máximo 180 días/);
    const empty = await post({
      startsOn: TODAY,
      endsOn: addDays(TODAY, 1),
      reason: 'Sin contenido',
    }).expect(400);
    expect(empty.body.error.message).toMatch(/Indica las paradas y horarios/);

    await post({
      startsOn: addDays(TODAY, 10),
      endsOn: addDays(TODAY, 12),
      reason: 'Primero',
      suspendService: true,
    }).expect(201);
    const overlap = await post({
      startsOn: addDays(TODAY, 12),
      endsOn: addDays(TODAY, 14),
      reason: 'Traslapado',
      suspendService: true,
    }).expect(409);
    expect(overlap.body.error.message).toMatch(/Ya hay un cambio temporal/);
  });

  it('cancelar un cambio devuelve la versión normal; uno terminado no se cancela', async () => {
    const route = await newRoute();
    const change = await request(app.server)
      .post(`/routes/${route.id}/temporary-changes`)
      .set('authorization', ownerAuth)
      .send({
        startsOn: addDays(TODAY, 3),
        endsOn: addDays(TODAY, 5),
        reason: 'Evento en la ciudad',
        suspendService: true,
      })
      .expect(201);
    await request(app.server)
      .post(`/temporary-changes/${change.body.id as string}/cancel`)
      .set('authorization', ownerAuth)
      .expect(204);
    expect((await effective(route.id, addDays(TODAY, 4))).body.suspended).toBe(false);

    const finished = await app.db.system.temporaryChange.create({
      data: {
        tenantId,
        routeId: route.id,
        suspendsService: true,
        startsOn: new Date(`${addDays(TODAY, -5)}T00:00:00Z`),
        endsOn: new Date(`${addDays(TODAY, -3)}T00:00:00Z`),
        reason: 'Ya pasó',
      },
    });
    await request(app.server)
      .post(`/temporary-changes/${finished.id}/cancel`)
      .set('authorization', ownerAuth)
      .expect(409);
  });
});

describe('pasajeros por parada', () => {
  it('asigna pasajeros de la planta a paradas y valida', async () => {
    const route = await newRoute();
    const [a, b] = await Promise.all([
      fx.passenger({ clientOrgId, plantId, employeeNumber: `RP-${Date.now()}-1` }),
      fx.passenger({ clientOrgId, plantId, employeeNumber: `RP-${Date.now()}-2` }),
    ]);
    const assigned = await request(app.server)
      .put(`/routes/${route.id}/passengers`)
      .set('authorization', ownerAuth)
      .send({
        assignments: [
          { passengerId: a.id, stopKey: route.stops[0]!.stopKey },
          { passengerId: b.id, stopKey: route.stops[1]!.stopKey },
        ],
      })
      .expect(200);
    expect(assigned.body.map((p: { stopName: string }) => p.stopName).sort()).toEqual([
      'Av. Tecnológico',
      'Plaza de la Mexicanidad',
    ]);

    const badStop = await request(app.server)
      .put(`/routes/${route.id}/passengers`)
      .set('authorization', ownerAuth)
      .send({
        assignments: [{ passengerId: a.id, stopKey: '00000000-0000-4000-8000-000000000999' }],
      })
      .expect(400);
    expect(badStop.body.error.message).toMatch(/no existe en la ruta/);

    const other = await fx.clientOrgWithPlant({ tenantId });
    const foreign = await fx.passenger({ clientOrgId: other.org.id, plantId: other.plant.id });
    await request(app.server)
      .put(`/routes/${route.id}/passengers`)
      .set('authorization', ownerAuth)
      .send({ assignments: [{ passengerId: foreign.id, stopKey: route.stops[0]!.stopKey }] })
      .expect(400);
  });
});

describe('simulación sin guardar', () => {
  it('muestra paradas quitadas, movidas y con otro horario, y a los pasajeros afectados', async () => {
    const route = await newRoute();
    const [atFirst, atSecond, atThird] = await Promise.all(
      [0, 1, 2].map((i) =>
        fx.passenger({ clientOrgId, plantId, employeeNumber: `SIM-${Date.now()}-${i}` }),
      ),
    );
    await request(app.server)
      .put(`/routes/${route.id}/passengers`)
      .set('authorization', ownerAuth)
      .send({
        assignments: [
          { passengerId: atFirst!.id, stopKey: route.stops[0]!.stopKey },
          { passengerId: atSecond!.id, stopKey: route.stops[1]!.stopKey },
          { passengerId: atThird!.id, stopKey: route.stops[2]!.stopKey },
        ],
      })
      .expect(200);

    const [first, second, third] = asInput(route.stops);
    const proposal = [
      { ...first!, times: [{ time: '04:50' }] }, // otro horario
      { ...third!, location: { lat: 31.712, lng: -106.4081 } }, // ~210 m al norte
      { name: 'Parada nueva', location: { lat: 31.7, lng: -106.4 }, times: [{ time: '05:45' }] },
    ];
    void second;
    const versionsBefore = await app.db.system.routeVersion.count({ where: { routeId: route.id } });

    const simulation = await request(app.server)
      .post(`/routes/${route.id}/simulate`)
      .set('authorization', ownerAuth)
      .send({
        kind: 'temporary',
        startsOn: addDays(TODAY, 2),
        endsOn: addDays(TODAY, 6),
        version: { stops: proposal },
      })
      .expect(200);
    expect(simulation.body.period).toEqual({
      from: addDays(TODAY, 2),
      to: addDays(TODAY, 6),
      days: 5,
    });
    expect(simulation.body.stops.added).toEqual([{ name: 'Parada nueva' }]);
    expect(simulation.body.stops.removed.map((s: { name: string }) => s.name)).toEqual([
      'Av. Tecnológico',
    ]);
    expect(simulation.body.stops.moved[0]).toMatchObject({ name: 'Waterfill' });
    expect(simulation.body.stops.moved[0].distanceMeters).toBeGreaterThan(150);
    expect(simulation.body.stops.retimed[0]).toMatchObject({
      name: 'Plaza de la Mexicanidad',
      from: '05:00',
      to: '04:50',
    });

    const reasons = Object.fromEntries(
      (simulation.body.passengers as { id: string; reason: string }[]).map((p) => [p.id, p.reason]),
    );
    expect(reasons).toEqual({
      [atFirst!.id]: 'time_changed',
      [atSecond!.id]: 'stop_removed',
      [atThird!.id]: 'stop_moved',
    });

    // No se guardó nada.
    expect(await app.db.system.routeVersion.count({ where: { routeId: route.id } })).toBe(
      versionsBefore,
    );
    expect(await app.db.system.temporaryChange.count({ where: { routeId: route.id } })).toBe(0);
  });

  it('una suspensión afecta a todos los pasajeros asignados', async () => {
    const route = await newRoute();
    const passenger = await fx.passenger({
      clientOrgId,
      plantId,
      employeeNumber: `SUS-${Date.now()}`,
    });
    await request(app.server)
      .put(`/routes/${route.id}/passengers`)
      .set('authorization', ownerAuth)
      .send({ assignments: [{ passengerId: passenger.id, stopKey: route.stops[2]!.stopKey }] })
      .expect(200);
    const simulation = await request(app.server)
      .post(`/routes/${route.id}/simulate`)
      .set('authorization', ownerAuth)
      .send({
        kind: 'temporary',
        startsOn: addDays(TODAY, 1),
        endsOn: addDays(TODAY, 1),
        suspendService: true,
      })
      .expect(200);
    expect(simulation.body).toMatchObject({ suspended: true, period: { days: 1 } });
    expect(simulation.body.passengers).toEqual([
      expect.objectContaining({
        id: passenger.id,
        reason: 'service_suspended',
        stopName: 'Waterfill',
      }),
    ]);
  });

  it('una versión nueva aplica hasta la siguiente versión', async () => {
    const route = await newRoute();
    const open = await request(app.server)
      .post(`/routes/${route.id}/simulate`)
      .set('authorization', ownerAuth)
      .send({
        kind: 'version',
        validFrom: addDays(TODAY, 3),
        version: { stops: asInput(route.stops) },
      })
      .expect(200);
    expect(open.body.period).toEqual({ from: addDays(TODAY, 3), to: null, days: null });
    expect(open.body.stops).toEqual({ added: [], removed: [], moved: [], retimed: [] });

    await request(app.server)
      .post(`/routes/${route.id}/versions`)
      .set('authorization', ownerAuth)
      .send({ validFrom: addDays(TODAY, 10), stops: asInput(route.stops) })
      .expect(201);
    const bounded = await request(app.server)
      .post(`/routes/${route.id}/simulate`)
      .set('authorization', ownerAuth)
      .send({
        kind: 'version',
        validFrom: addDays(TODAY, 3),
        version: { stops: asInput(route.stops) },
      })
      .expect(200);
    expect(bounded.body.period).toEqual({
      from: addDays(TODAY, 3),
      to: addDays(TODAY, 9),
      days: 7,
    });
  });
});
