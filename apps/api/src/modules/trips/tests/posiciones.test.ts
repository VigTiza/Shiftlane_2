import { randomUUID } from 'node:crypto';

import { todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { ensureUpcomingPartitions } from '../../../jobs/position-partitions.ts';
import { APP_DB_ROLE } from '../../../lib/db.ts';

const PASSWORD = 'Transporte2026';
const TODAY = todayIn('America/Ciudad_Juarez');
const MINUTE = 60_000;

const STOP_1 = { lat: 31.7445, lng: -106.4605 };
const STOP_2 = { lat: 31.7101, lng: -106.4081 };
const PLANT = { lat: 31.6904, lng: -106.3712 };
const STOPS = [
  { name: 'Plaza de la Mexicanidad', location: STOP_1, times: [{ time: '05:00' }] },
  { name: 'Waterfill', location: STOP_2, times: [{ time: '05:30' }] },
];

interface Point {
  tripId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  speedKmh?: number;
}

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let plantAuth: string;
let plantId: string;
let routeId: string;
let versionId: string;
let stopIds: string[];

async function tokenFor(email: string) {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

async function newDriver() {
  const driver = await app.db.system.driver.create({
    data: { tenantId, fullName: `Chofer ${Math.random().toString(36).slice(2, 7)}` },
  });
  const device = await app.db.system.device.create({ data: { tenantId, secretHash: 'x' } });
  const token = await app.tokens.signAccess({
    kind: 'driver',
    sub: driver.id,
    sid: randomUUID(),
    tenantId,
    deviceId: device.id,
  });
  return { id: driver.id, auth: `Bearer ${token}` };
}

/** Viaje que empezó hace un rato (o que ya terminó, o que no ha empezado). */
async function newTrip(
  driverId: string,
  input: { startedMinutesAgo?: number | null; endedMinutesAgo?: number } = {},
) {
  const startedAgo = input.startedMinutesAgo === undefined ? 20 : input.startedMinutesAgo;
  const now = Date.now();
  const status =
    startedAgo === null
      ? 'scheduled'
      : input.endedMinutesAgo !== undefined
        ? 'completed'
        : 'in_progress';
  return app.db.system.trip.create({
    data: {
      tenantId,
      plantId,
      routeId,
      routeVersionId: versionId,
      kind: 'extra',
      extraReason: 'other',
      direction: 'inbound',
      status,
      serviceDate: new Date(`${TODAY}T00:00:00Z`),
      scheduledStartAt: new Date(now - 30 * MINUTE),
      scheduledEndAt: new Date(now + 15 * MINUTE),
      actualStartAt: startedAgo === null ? null : new Date(now - startedAgo * MINUTE),
      actualEndAt:
        input.endedMinutesAgo === undefined ? null : new Date(now - input.endedMinutesAgo * MINUTE),
      driverId,
      assignmentSource: 'manual',
    },
  });
}

function send(auth: string, points: Point[], sentAt = new Date()) {
  return request(app.server)
    .post('/driver/positions')
    .set('authorization', auth)
    .send({ sentAt: sentAt.toISOString(), points });
}

function at(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * MINUTE).toISOString();
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
  await app.db.system.$executeRaw`
    UPDATE plants SET location = ST_SetSRID(ST_MakePoint(${PLANT.lng}, ${PLANT.lat}), 4326)::geography
    WHERE id = ${plantId}::uuid`;
  plantAuth = await tokenFor(
    (
      await fx.plantUser({
        clientOrgId: created.org.id,
        password: PASSWORD,
        roles: ['plant_logistics'],
      })
    ).email,
  );
  const route = await request(app.server)
    .post('/routes')
    .set('authorization', ownerAuth)
    .send({
      plantId,
      code: 'GPS-01',
      name: 'Ruta con GPS',
      direction: 'inbound',
      version: { validFrom: TODAY, stops: STOPS },
    })
    .expect(201);
  routeId = route.body.id as string;
  versionId = route.body.current.id as string;
  const version = await request(app.server)
    .get(`/routes/${routeId}/versions/${versionId}`)
    .set('authorization', ownerAuth)
    .expect(200);
  stopIds = (version.body.stops as { id: string }[]).map((s) => s.id);
});

afterAll(async () => {
  await app.close();
});

describe('ingesta de posiciones GPS', () => {
  it('guarda el recorrido, detecta la llegada por geocerca y calcula la hora de llegada', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    const points: Point[] = [
      { tripId: trip.id, recordedAt: at(15), lat: 31.76, lng: -106.48, speedKmh: 35 },
      // A unos 20 metros de la primera parada (radio de 80 m).
      {
        tripId: trip.id,
        recordedAt: at(10),
        lat: STOP_1.lat + 0.0002,
        lng: STOP_1.lng,
        speedKmh: 5,
      },
      { tripId: trip.id, recordedAt: at(5), lat: 31.727, lng: -106.434, speedKmh: 40 },
    ];
    const response = await send(driver.auth, points).expect(200);
    expect(response.body).toMatchObject({
      accepted: 3,
      duplicates: 0,
      rejected: { trip_not_found: 0, outside_trip: 0 },
    });
    const [summary] = response.body.trips;
    expect(summary.autoArrivals).toEqual([
      expect.objectContaining({ stopId: stopIds[0], stopName: 'Plaza de la Mexicanidad' }),
    ]);
    // Falta Waterfill y luego la planta.
    expect(summary.eta.stops.map((s: { stopId: string }) => s.stopId)).toEqual([stopIds[1]]);
    expect(summary.eta.destination.distanceMeters).toBeGreaterThan(
      summary.eta.stops[0].distanceMeters,
    );
    expect(new Date(summary.eta.destination.eta).getTime()).toBeGreaterThan(
      new Date(summary.eta.stops[0].eta).getTime(),
    );
    expect(typeof summary.eta.delayMinutes).toBe('number');

    const history = await request(app.server)
      .get(`/trips/${trip.id}/positions`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(history.body.map((p: { lat: number }) => p.lat)).toEqual(points.map((p) => p.lat));

    const live = await request(app.server)
      .get(`/trips/${trip.id}/live`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(live.body).toMatchObject({ tripId: trip.id, lat: 31.727, speedKmh: 40 });
    expect(live.body.eta.stops).toHaveLength(1);

    const arrival = await app.db.system.tripEvent.findFirstOrThrow({
      where: { tripId: trip.id, type: 'stop_arrived' },
    });
    expect(arrival).toMatchObject({
      actorType: 'system',
      data: expect.objectContaining({ auto: true }),
    });
    expect(arrival.occurredAt.toISOString()).toBe(points[1]!.recordedAt);

    // Un reenvío no duplica puntos ni llegadas.
    const resent = await send(driver.auth, points).expect(200);
    expect(resent.body).toMatchObject({ accepted: 0, duplicates: 3 });
    expect(resent.body.trips[0].autoArrivals).toEqual([]);
    expect(
      await app.db.system.tripEvent.count({ where: { tripId: trip.id, type: 'stop_arrived' } }),
    ).toBe(1);

    // La planta ve el recorrido y la posición en vivo de sus viajes.
    await request(app.server)
      .get(`/trips/${trip.id}/positions`)
      .set('authorization', plantAuth)
      .expect(200);
    const plantLive = await request(app.server)
      .get(`/trips/${trip.id}/live`)
      .set('authorization', plantAuth)
      .expect(200);
    expect(plantLive.body.tripId).toBe(trip.id);
  });

  it('solo guarda la ubicación durante el viaje', async () => {
    const driver = await newDriver();
    const inProgress = await newTrip(driver.id, { startedMinutesAgo: 10 });
    const notStarted = await newTrip(driver.id, { startedMinutesAgo: null });
    const finished = await newTrip(driver.id, { startedMinutesAgo: 40, endedMinutesAgo: 20 });
    const other = await newDriver();
    const foreign = await newTrip(other.id);
    const response = await send(driver.auth, [
      { tripId: inProgress.id, recordedAt: at(15), lat: 31.7, lng: -106.4 },
      { tripId: inProgress.id, recordedAt: at(5), lat: 31.7, lng: -106.4 },
      { tripId: notStarted.id, recordedAt: at(1), lat: 31.7, lng: -106.4 },
      { tripId: finished.id, recordedAt: at(10), lat: 31.7, lng: -106.4 },
      // Llega tarde pero ocurrió durante el viaje: sí se guarda.
      { tripId: finished.id, recordedAt: at(30), lat: 31.7, lng: -106.4 },
      { tripId: foreign.id, recordedAt: at(5), lat: 31.7, lng: -106.4 },
    ]).expect(200);
    expect(response.body).toMatchObject({
      accepted: 2,
      rejected: { trip_not_found: 1, outside_trip: 3 },
    });
    // Un viaje terminado no vuelve a mostrarse en vivo.
    const live = await request(app.server)
      .get(`/trips/${finished.id}/live`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(live.body).toBeNull();
  });

  it('corrige el reloj del celular', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    // El celular va 10 minutos atrasado: su "hace 12 minutos" es hace 2 minutos.
    const behind = (minutesAgo: number) => new Date(Date.now() - (minutesAgo + 10) * MINUTE);
    const response = await send(
      driver.auth,
      [{ tripId: trip.id, recordedAt: behind(2).toISOString(), lat: 31.7, lng: -106.4 }],
      behind(0),
    ).expect(200);
    expect(Math.abs(response.body.clockOffsetMs - 10 * MINUTE)).toBeLessThan(2_000);
    const [row] = await app.db.system.$queryRaw<{ recorded_at: Date }[]>`
      SELECT recorded_at FROM telemetry.trip_positions WHERE trip_id = ${trip.id}::uuid`;
    expect(Math.abs(row!.recorded_at.getTime() - (Date.now() - 2 * MINUTE))).toBeLessThan(5_000);
  });

  it('crea las particiones por día automáticamente', async () => {
    const driver = await newDriver();
    // Un viaje de hace tres días cuyos datos llegan hasta hoy.
    const trip = await newTrip(driver.id, {
      startedMinutesAgo: 3 * 24 * 60 + 30,
      endedMinutesAgo: 3 * 24 * 60,
    });
    const recorded = new Date(Date.now() - (3 * 24 * 60 + 10) * MINUTE);
    const day = recorded.toISOString().slice(0, 10).replaceAll('-', '');
    await send(driver.auth, [
      { tripId: trip.id, recordedAt: recorded.toISOString(), lat: 31.7, lng: -106.4 },
    ]).expect(200);
    const exists = async (name: string) =>
      (
        await app.db.system.$queryRaw<{ found: boolean }[]>`
        SELECT to_regclass(${`telemetry.${name}`}) IS NOT NULL AS found`
      )[0]!.found;
    expect(await exists(`trip_positions_p${day}`)).toBe(true);

    const result = await ensureUpcomingPartitions(app.db.system, 7);
    expect(result.days).toBe(9);
    const lastDay = result.to.replaceAll('-', '');
    expect(await exists(`trip_positions_p${lastDay}`)).toBe(true);
  });

  it('al terminar el viaje se borra la posición en vivo', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    await send(driver.auth, [
      { tripId: trip.id, recordedAt: at(1), lat: 31.7, lng: -106.4 },
    ]).expect(200);
    const listed = await request(app.server)
      .get('/live/positions')
      .set('authorization', ownerAuth)
      .expect(200);
    expect(listed.body.map((p: { tripId: string }) => p.tripId)).toContain(trip.id);

    await request(app.server)
      .post(`/driver/trips/${trip.id}/finish`)
      .set('authorization', driver.auth)
      .send({})
      .expect(200);
    const live = await request(app.server)
      .get(`/trips/${trip.id}/live`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(live.body).toBeNull();
  });

  it('aguanta varios choferes enviando lotes a la vez', { timeout: 120_000 }, async () => {
    const drivers = await Promise.all(Array.from({ length: 5 }, () => newDriver()));
    const trips: { id: string }[] = [];
    for (const driver of drivers) trips.push(await newTrip(driver.id, { startedMinutesAgo: 30 }));
    const started = Date.now();
    const responses = await Promise.all(
      drivers.map((driver, d) =>
        send(
          driver.auth,
          Array.from({ length: 400 }, (_, i) => ({
            tripId: trips[d]!.id,
            recordedAt: new Date(Date.now() - 25 * MINUTE + i * 3000).toISOString(),
            lat: 31.75 - i * 0.0001,
            lng: -106.47 + i * 0.0001,
            speedKmh: 35,
          })),
        ),
      ),
    );
    const elapsed = Date.now() - started;
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(responses.reduce((sum, r) => sum + (r.body.accepted as number), 0)).toBe(2000);
    expect(elapsed).toBeLessThan(30_000);
    const [row] = await app.db.system.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM telemetry.trip_positions
      WHERE trip_id = ANY(${trips.map((t) => t.id)}::uuid[])`;
    expect(row!.total).toBe(2000);
  });

  it('otra empresa no ve el recorrido ni la posición', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    await send(driver.auth, [
      { tripId: trip.id, recordedAt: at(1), lat: 31.7, lng: -106.4 },
    ]).expect(200);
    const rival = (await fx.tenant()).id;
    const rivalAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: rival, password: PASSWORD, roles: ['owner'] })).email,
    );
    await request(app.server)
      .get(`/trips/${trip.id}/positions`)
      .set('authorization', rivalAuth)
      .expect(404);
    await request(app.server)
      .get(`/trips/${trip.id}/live`)
      .set('authorization', rivalAuth)
      .expect(404);
    const rivalLive = await request(app.server)
      .get('/live/positions')
      .set('authorization', rivalAuth)
      .expect(200);
    expect(rivalLive.body).toEqual([]);
    // Aun con SQL directo, la seguridad por filas no deja ver puntos de otra empresa.
    const rows = await app.db.app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${rival}, true)`;
      return tx.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM telemetry.trip_positions WHERE trip_id = ${trip.id}::uuid`;
    });
    expect(rows[0]!.total).toBe(0);
  });

  it('las particiones no se pueden leer directo, solo por la tabla principal', async () => {
    await ensureUpcomingPartitions(app.db.system, 1);
    const [partition] = await app.db.system.$queryRaw<{ name: string; rls: boolean }[]>`
      SELECT c.relname AS name, c.relrowsecurity AS rls
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'telemetry.trip_positions'::regclass LIMIT 1`;
    expect(partition!.rls).toBe(true);
    const [privilege] = await app.db.system.$queryRaw<{ allowed: boolean }[]>`
      SELECT has_table_privilege(${APP_DB_ROLE}, ${`telemetry.${partition!.name}`}, 'SELECT') AS allowed`;
    expect(privilege!.allowed).toBe(false);
    const [parent] = await app.db.system.$queryRaw<{ rls: boolean; update: boolean }[]>`
      SELECT c.relrowsecurity AS rls,
             has_table_privilege(${APP_DB_ROLE}, 'telemetry.trip_positions', 'UPDATE') AS update
      FROM pg_class c WHERE c.oid = 'telemetry.trip_positions'::regclass`;
    expect(parent).toEqual({ rls: true, update: false });
  });
});
