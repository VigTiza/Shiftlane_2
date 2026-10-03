import { addDays, mexicanOfficialHolidays, todayIn, zonedDateTime } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { ensureTripHorizon } from '../../../jobs/trip-horizon.ts';
import { generateTrips } from '../generator.ts';

const PASSWORD = 'Transporte2026';
const TZ = 'America/Ciudad_Juarez';
const TODAY = todayIn(TZ);

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Primer lunes posterior a una fecha. */
function mondayAfter(date: string) {
  let day = addDays(date, 1);
  while (weekday(day) !== 1) day = addDays(day, 1);
  return day;
}

// Semana de lunes a viernes dentro del horizonte de 14 días.
const MON = mondayAfter(TODAY);
const TUE = addDays(MON, 1);
const WED = addDays(MON, 2);
const THU = addDays(MON, 3);
const FRI = addDays(MON, 4);
const SUN = addDays(MON, 6);
const WEEK = [MON, TUE, WED, THU, FRI];

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

interface Trip {
  id: string;
  plantId: string;
  routeId: string;
  routeVersionId: string;
  temporaryChangeId: string | null;
  status: string;
  serviceDate: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  isHoliday: boolean;
  cancelReason: string | null;
}

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let plantId: string;
let clientOrgId: string;
let shiftId: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

async function newShift(input: {
  plantId: string;
  startsAt: string;
  endsAt: string;
  weekdays?: number[];
}) {
  const response = await request(app.server)
    .post('/shifts')
    .set('authorization', ownerAuth)
    .send({ name: `Turno ${Math.random().toString(36).slice(2, 7)}`, ...input })
    .expect(201);
  return response.body.id as string;
}

async function newRoute(
  input: {
    plantId?: string;
    shiftId?: string | null;
    direction?: 'inbound' | 'outbound';
    stops?: typeof STOPS;
    auth?: string;
  } = {},
) {
  const created = await request(app.server)
    .post('/routes')
    .set('authorization', input.auth ?? ownerAuth)
    .send({
      plantId: input.plantId ?? plantId,
      shiftId: input.shiftId === undefined ? shiftId : input.shiftId,
      code: `G-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Ruta programada',
      direction: input.direction ?? 'inbound',
      version: { validFrom: TODAY, stops: input.stops ?? STOPS },
    })
    .expect(201);
  return created.body as { id: string; current: { id: string } };
}

async function tripsOf(routeId: string, from = MON, to = SUN): Promise<Map<string, Trip>> {
  const response = await request(app.server)
    .get('/trips')
    .query({ routeId, from, to, pageSize: 500 })
    .set('authorization', ownerAuth)
    .expect(200);
  return new Map((response.body.items as Trip[]).map((trip) => [trip.serviceDate, trip]));
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
  shiftId = await newShift({ plantId, startsAt: '06:00', endsAt: '14:00' });
});

afterAll(async () => {
  await app.close();
});

describe('generador de viajes', () => {
  it('al crear la ruta programa los próximos 14 días, de lunes a viernes, con la hora de la planta', async () => {
    const route = await newRoute();
    const trips = await tripsOf(route.id, TODAY, addDays(TODAY, 13));
    const expected = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i)).filter(
      (date) => weekday(date) >= 1 && weekday(date) <= 5,
    );
    expect([...trips.keys()].sort()).toEqual(expected);
    const monday = trips.get(MON)!;
    expect(monday).toMatchObject({
      status: 'scheduled',
      routeVersionId: route.current.id,
      isHoliday: false,
    });
    // Sale de la primera parada y llega a la planta a la hora de entrada del turno.
    expect(monday.scheduledStartAt).toBe(zonedDateTime(MON, '05:00', TZ).toISOString());
    expect(monday.scheduledEndAt).toBe(zonedDateTime(MON, '06:00', TZ).toISOString());
  });

  it('es idempotente: correrlo dos veces no duplica viajes', async () => {
    const route = await newRoute();
    // Una semana fuera del horizonte, todavía sin viajes.
    const from = mondayAfter(addDays(TODAY, 20));
    const to = addDays(from, 6);
    const first = await request(app.server)
      .post('/schedule/generate')
      .set('authorization', ownerAuth)
      .send({ from, to })
      .expect(200);
    expect(first.body.created).toBeGreaterThanOrEqual(5);
    const second = await request(app.server)
      .post('/schedule/generate')
      .set('authorization', ownerAuth)
      .send({ from, to })
      .expect(200);
    expect(second.body).toMatchObject({ created: 0, updated: 0, cancelled: 0 });
    expect(second.body.unchanged).toBe(first.body.created);
    const count = await app.db.system.trip.count({
      where: {
        routeId: route.id,
        serviceDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
    });
    expect(count).toBe(5);
  });

  it('valida el rango de fechas y los permisos', async () => {
    const tooLong = await request(app.server)
      .post('/schedule/generate')
      .set('authorization', ownerAuth)
      .send({ from: TODAY, to: addDays(TODAY, 70) })
      .expect(400);
    expect(tooLong.body.error.message).toMatch(/62 días/);
    await request(app.server)
      .post('/schedule/generate')
      .set('authorization', ownerAuth)
      .send({ from: addDays(TODAY, 3), to: TODAY })
      .expect(400);
    const plantUser = await fx.plantUser({
      clientOrgId,
      password: PASSWORD,
      roles: ['plant_logistics'],
    });
    const plantAuth = await tokenFor(plantUser.email);
    await request(app.server)
      .post('/schedule/generate')
      .set('authorization', plantAuth)
      .send({ from: TODAY, to: TODAY })
      .expect(403);
  });

  it('respeta los días del turno y se ajusta cuando cambian', async () => {
    const mixed = await newShift({
      plantId,
      startsAt: '07:00',
      endsAt: '15:00',
      weekdays: [5, 1, 3, 3],
    });
    const route = await newRoute({ shiftId: mixed });
    expect([...(await tripsOf(route.id)).keys()].sort()).toEqual([MON, WED, FRI]);

    const updated = await request(app.server)
      .patch(`/shifts/${mixed}`)
      .set('authorization', ownerAuth)
      .send({ weekdays: [1, 2, 3, 4, 5] })
      .expect(200);
    expect(updated.body.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect([...(await tripsOf(route.id)).keys()].sort()).toEqual(WEEK);

    await request(app.server)
      .patch(`/shifts/${mixed}`)
      .set('authorization', ownerAuth)
      .send({ weekdays: [1] })
      .expect(200);
    const trips = await tripsOf(route.id);
    expect(trips.get(MON)!.status).toBe('scheduled');
    expect(trips.get(TUE)).toMatchObject({
      status: 'cancelled',
      cancelReason: '[Automático] Sin turno ese día',
    });

    const empty = await request(app.server)
      .patch(`/shifts/${mixed}`)
      .set('authorization', ownerAuth)
      .send({ weekdays: [] })
      .expect(400);
    expect(JSON.stringify(empty.body)).toMatch(/Elige al menos un día/);
  });

  it('calcula horarios de salida y turnos que cruzan la medianoche', async () => {
    const outbound = await newRoute({
      direction: 'outbound',
      stops: [
        { ...STOPS[0]!, times: [{ time: '14:20' }] },
        { ...STOPS[1]!, times: [{ time: '14:50' }] },
      ],
    });
    const out = (await tripsOf(outbound.id)).get(MON)!;
    // Sale de la planta al terminar el turno y llega a la última parada.
    expect(out.scheduledStartAt).toBe(zonedDateTime(MON, '14:00', TZ).toISOString());
    expect(out.scheduledEndAt).toBe(zonedDateTime(MON, '14:50', TZ).toISOString());

    const night = await newShift({ plantId, startsAt: '00:30', endsAt: '08:30' });
    const nightRoute = await newRoute({
      shiftId: night,
      stops: [
        { ...STOPS[0]!, times: [{ time: '23:40' }] },
        { ...STOPS[1]!, times: [{ time: '23:55' }] },
      ],
    });
    const trip = (await tripsOf(nightRoute.id)).get(MON)!;
    expect(trip.scheduledStartAt).toBe(zonedDateTime(MON, '23:40', TZ).toISOString());
    expect(trip.scheduledEndAt).toBe(zonedDateTime(TUE, '00:30', TZ).toISOString());
  });

  it('usa la hora local con y sin horario de verano', async () => {
    const route = await newRoute();
    const year = Number(TODAY.slice(0, 4)) + 1;
    const july = mondayAfter(`${year}-06-30`);
    const december = mondayAfter(`${year}-11-30`);
    await generateTrips(app.db.system, { tenantId, from: july, to: july, routeIds: [route.id] });
    await generateTrips(app.db.system, {
      tenantId,
      from: december,
      to: december,
      routeIds: [route.id],
    });
    const summer = (await tripsOf(route.id, july, july)).get(july)!;
    const winter = (await tripsOf(route.id, december, december)).get(december)!;
    // 05:00 en Ciudad Juárez: UTC-6 en verano y UTC-7 en invierno.
    expect(summer.scheduledStartAt).toBe(`${july}T11:00:00.000Z`);
    expect(winter.scheduledStartAt).toBe(`${december}T12:00:00.000Z`);
  });
});

describe('días festivos', () => {
  it('un festivo sin servicio cancela el viaje; con servicio lo marca; al borrarlo vuelve a la normalidad', async () => {
    // Planta propia para no afectar las demás pruebas.
    const other = await fx.clientOrgWithPlant({ tenantId });
    const otherShift = await newShift({
      plantId: other.plant.id,
      startsAt: '06:00',
      endsAt: '14:00',
    });
    const route = await newRoute({ plantId: other.plant.id, shiftId: otherShift });
    const neighbor = await newRoute();

    const holiday = await request(app.server)
      .post('/holidays')
      .set('authorization', ownerAuth)
      .send({
        date: WED,
        name: 'Aniversario de la planta',
        plantId: other.plant.id,
        serviceRuns: false,
      })
      .expect(201);
    let trips = await tripsOf(route.id);
    expect(trips.get(WED)).toMatchObject({
      status: 'cancelled',
      cancelReason: '[Automático] Día festivo: Aniversario de la planta',
    });
    expect(trips.get(TUE)!.status).toBe('scheduled');
    // El festivo de una planta no afecta a otras.
    expect((await tripsOf(neighbor.id)).get(WED)!.status).toBe('scheduled');

    await request(app.server)
      .post('/holidays')
      .set('authorization', ownerAuth)
      .send({ date: WED, name: 'Repetido', plantId: other.plant.id })
      .expect(409);

    await request(app.server)
      .patch(`/holidays/${holiday.body.id as string}`)
      .set('authorization', ownerAuth)
      .send({ serviceRuns: true })
      .expect(200);
    trips = await tripsOf(route.id);
    expect(trips.get(WED)).toMatchObject({
      status: 'scheduled',
      isHoliday: true,
      cancelReason: null,
    });

    const listed = await request(app.server)
      .get('/holidays')
      .query({ plantId: other.plant.id, year: Number(WED.slice(0, 4)) })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(listed.body).toContainEqual(expect.objectContaining({ date: WED, serviceRuns: true }));

    await request(app.server)
      .delete(`/holidays/${holiday.body.id as string}`)
      .set('authorization', ownerAuth)
      .expect(204);
    expect((await tripsOf(route.id)).get(WED)).toMatchObject({
      status: 'scheduled',
      isHoliday: false,
    });
  });

  it('agrega los días de descanso obligatorio de la LFT sin repetirlos', async () => {
    const otherTenant = (await fx.tenant()).id;
    const auth = await tokenFor(
      (await fx.carrierUser({ tenantId: otherTenant, password: PASSWORD, roles: ['owner'] })).email,
    );
    const year = Number(TODAY.slice(0, 4)) + 1;
    const expected = mexicanOfficialHolidays(year);
    const first = await request(app.server)
      .post('/holidays/official')
      .set('authorization', auth)
      .send({ year })
      .expect(200);
    expect(first.body.created).toBe(expected.length);
    expect(first.body.holidays.map((h: { date: string }) => h.date)).toEqual(
      expected.map((h) => h.date),
    );
    const again = await request(app.server)
      .post('/holidays/official')
      .set('authorization', auth)
      .send({ year })
      .expect(200);
    expect(again.body).toMatchObject({ created: 0, skipped: expected.length });
    // Un solo festivo general por día.
    await request(app.server)
      .post('/holidays')
      .set('authorization', auth)
      .send({ date: expected[0]!.date, name: 'Duplicado' })
      .expect(409);
  });
});

describe('cambios de ruta reflejados en los viajes', () => {
  it('un cambio temporal que suspende el servicio cancela esos días y al cancelarlo vuelven', async () => {
    const route = await newRoute();
    const change = await request(app.server)
      .post(`/routes/${route.id}/temporary-changes`)
      .set('authorization', ownerAuth)
      .send({
        startsOn: TUE,
        endsOn: WED,
        reason: 'Paro técnico de la planta',
        suspendService: true,
      })
      .expect(201);
    let trips = await tripsOf(route.id);
    expect(trips.get(MON)!.status).toBe('scheduled');
    expect(trips.get(TUE)).toMatchObject({
      status: 'cancelled',
      cancelReason: '[Automático] Servicio suspendido: Paro técnico de la planta',
    });
    expect(trips.get(WED)!.status).toBe('cancelled');
    expect(trips.get(THU)!.status).toBe('scheduled');

    await request(app.server)
      .post(`/temporary-changes/${change.body.id as string}/cancel`)
      .set('authorization', ownerAuth)
      .expect(204);
    trips = await tripsOf(route.id);
    expect(trips.get(TUE)).toMatchObject({
      status: 'scheduled',
      temporaryChangeId: null,
      cancelReason: null,
    });
  });

  it('un cambio temporal de horario y una versión nueva actualizan solo sus días', async () => {
    const route = await newRoute();
    const earlier = STOPS.map((stop, i) => ({
      ...stop,
      times: [{ time: ['04:40', '04:50', '04:58'][i]! }],
    }));
    const change = await request(app.server)
      .post(`/routes/${route.id}/temporary-changes`)
      .set('authorization', ownerAuth)
      .send({ startsOn: THU, endsOn: THU, reason: 'Inventario', version: { stops: earlier } })
      .expect(201);
    let trips = await tripsOf(route.id);
    expect(trips.get(THU)).toMatchObject({
      temporaryChangeId: change.body.id,
      routeVersionId: change.body.versionId,
      scheduledStartAt: zonedDateTime(THU, '04:40', TZ).toISOString(),
    });
    expect(trips.get(WED)!.scheduledStartAt).toBe(zonedDateTime(WED, '05:00', TZ).toISOString());

    const later = STOPS.map((stop) => ({ ...stop, times: [{ time: '05:10' }] }));
    const version = await request(app.server)
      .post(`/routes/${route.id}/versions`)
      .set('authorization', ownerAuth)
      .send({ validFrom: FRI, stops: later })
      .expect(201);
    trips = await tripsOf(route.id);
    expect(trips.get(FRI)).toMatchObject({
      routeVersionId: version.body.id,
      scheduledStartAt: zonedDateTime(FRI, '05:10', TZ).toISOString(),
    });
    expect(trips.get(MON)!.routeVersionId).toBe(route.current.id);
    // El cambio temporal sigue ganando su día.
    expect(trips.get(THU)!.temporaryChangeId).toBe(change.body.id);
  });

  it('no toca viajes iniciados ni reactiva cancelaciones manuales', async () => {
    const route = await newRoute();
    const trips = await tripsOf(route.id);
    await app.db.system.trip.update({
      where: { id: trips.get(MON)!.id },
      data: { status: 'in_progress' },
    });
    await app.db.system.trip.update({
      where: { id: trips.get(TUE)!.id },
      data: { status: 'cancelled', cancelReason: 'La planta no trabaja' },
    });

    await request(app.server)
      .patch(`/routes/${route.id}`)
      .set('authorization', ownerAuth)
      .send({ active: false })
      .expect(200);
    let after = await tripsOf(route.id);
    expect(after.get(MON)!.status).toBe('in_progress');
    expect(after.get(WED)).toMatchObject({
      status: 'cancelled',
      cancelReason: '[Automático] Ruta inactiva',
    });

    await request(app.server)
      .patch(`/routes/${route.id}`)
      .set('authorization', ownerAuth)
      .send({ active: true })
      .expect(200);
    after = await tripsOf(route.id);
    expect(after.get(MON)!.status).toBe('in_progress');
    expect(after.get(TUE)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'La planta no trabaja',
    });
    expect(after.get(WED)).toMatchObject({ status: 'scheduled', cancelReason: null });

    await request(app.server)
      .delete(`/routes/${route.id}`)
      .set('authorization', ownerAuth)
      .expect(204);
    after = await tripsOf(route.id);
    expect(after.get(THU)).toMatchObject({
      status: 'cancelled',
      cancelReason: '[Automático] Ruta eliminada',
    });
  });

  it('la simulación de un cambio muestra los viajes programados que afecta', async () => {
    const route = await newRoute();
    const simulation = await request(app.server)
      .post(`/routes/${route.id}/simulate`)
      .set('authorization', ownerAuth)
      .send({ kind: 'temporary', startsOn: MON, endsOn: WED, suspendService: true })
      .expect(200);
    expect(simulation.body.trips.map((t: { date: string }) => t.date)).toEqual([MON, TUE, WED]);
  });
});

describe('tarea diaria y visibilidad', () => {
  it('la tarea diaria repone los 14 días y es idempotente', async () => {
    const route = await newRoute();
    await app.db.system.trip.deleteMany({ where: { routeId: route.id } });
    const first = await ensureTripHorizon(app.db.system, {
      horizonDays: 14,
      timeZone: TZ,
      tenantIds: [tenantId],
    });
    expect(first).toMatchObject({ tenants: 1, failed: 0 });
    const filled = await tripsOf(route.id, TODAY, addDays(TODAY, 13));
    // Catorce días seguidos siempre tienen diez días hábiles.
    expect(filled.size).toBe(10);
    const second = await ensureTripHorizon(app.db.system, {
      horizonDays: 14,
      timeZone: TZ,
      tenantIds: [tenantId],
    });
    expect(second.created).toBe(0);
    expect((await tripsOf(route.id, TODAY, addDays(TODAY, 13))).size).toBe(filled.size);
  });

  it('la planta ve los viajes de sus transportistas; otra transportista no los ve', async () => {
    const route = await newRoute();
    const plantUser = await fx.plantUser({ clientOrgId, password: PASSWORD, roles: ['plant_hr'] });
    const plantAuth = await tokenFor(plantUser.email);
    const plantView = await request(app.server)
      .get('/trips')
      .query({ from: MON, to: SUN, pageSize: 500 })
      .set('authorization', plantAuth)
      .expect(200);
    const items = plantView.body.items as Trip[];
    expect(items.some((trip) => trip.routeId === route.id)).toBe(true);
    expect(items.every((trip) => trip.plantId === plantId)).toBe(true);

    // Transportista rival que atiende la misma planta.
    const rival = (await fx.tenant()).id;
    await app.db.system.serviceAgreement.create({
      data: { tenantId: rival, plantId, clientOrgId },
    });
    const rivalAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: rival, password: PASSWORD, roles: ['owner'] })).email,
    );
    const rivalView = await request(app.server)
      .get('/trips')
      .query({ from: MON, to: SUN, plantId })
      .set('authorization', rivalAuth)
      .expect(200);
    expect(rivalView.body.total).toBe(0);
    await request(app.server)
      .get('/holidays')
      .set('authorization', rivalAuth)
      .expect(200)
      .expect((res) => expect(res.body).toEqual([]));

    // Otra planta sin acuerdo no ve nada.
    const stranger = await fx.clientOrgWithPlant({ tenantId: rival });
    const strangerUser = await fx.plantUser({
      clientOrgId: stranger.org.id,
      password: PASSWORD,
      roles: ['plant_hr'],
    });
    const strangerAuth = await tokenFor(strangerUser.email);
    const strangerView = await request(app.server)
      .get('/trips')
      .query({ from: MON, to: SUN })
      .set('authorization', strangerAuth)
      .expect(200);
    expect(strangerView.body.total).toBe(0);
  });
});
