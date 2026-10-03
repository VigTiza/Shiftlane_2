import { randomUUID } from 'node:crypto';

import { todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';
const TODAY = todayIn('America/Ciudad_Juarez');
const MINUTE = 60_000;

const STOPS = [
  {
    name: 'Plaza de la Mexicanidad',
    location: { lat: 31.7445, lng: -106.4605 },
    times: [{ time: '05:00' }],
  },
  { name: 'Waterfill', location: { lat: 31.7101, lng: -106.4081 }, times: [{ time: '05:30' }] },
];
const ALL_OK = ['tires', 'brakes', 'lights', 'cleanliness', 'extinguisher', 'first_aid'].map(
  (key) => ({ key, ok: true }),
);

interface Result {
  id: string;
  type: string;
  status: 'applied' | 'duplicate' | 'rejected' | 'retry';
  message: string | null;
  result: Record<string, unknown> | null;
}

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let plantId: string;
let clientOrgId: string;
let routeId: string;
let versionId: string;
let stopIds: string[];
let gateCode: string;
let employee: string;

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
  return { id: driver.id, deviceId: device.id, auth: `Bearer ${token}` };
}

async function newTrip(driverId: string, minutesFromNow = 30) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const vehicle = await app.db.system.vehicle.create({
    data: {
      tenantId,
      economicNumber: `S-${suffix}`,
      plates: `PS-${suffix}`,
      model: 'Sprinter',
      year: 2024,
      capacity: 120,
    },
  });
  const start = new Date(Date.now() + minutesFromNow * MINUTE);
  return app.db.system.trip.create({
    data: {
      tenantId,
      plantId,
      routeId,
      routeVersionId: versionId,
      kind: 'extra',
      extraReason: 'other',
      direction: 'inbound',
      serviceDate: new Date(`${TODAY}T00:00:00Z`),
      scheduledStartAt: start,
      scheduledEndAt: new Date(start.getTime() + 60 * MINUTE),
      driverId,
      vehicleId: vehicle.id,
      assignmentSource: 'manual',
    },
  });
}

/** Evento del celular con su hora local (posiblemente desfasada). */
function event(
  type: string,
  input: { tripId?: string; at: Date; sequence?: number; data?: Record<string, unknown> },
) {
  return {
    id: randomUUID(),
    type,
    tripId: input.tripId,
    sequence: input.sequence,
    occurredAt: input.at.toISOString(),
    data: input.data ?? {},
  };
}

function sync(auth: string, events: unknown[], sentAt = new Date()) {
  return request(app.server)
    .post('/sync/batch')
    .set('authorization', auth)
    .send({ sentAt: sentAt.toISOString(), events });
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  const owner = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
  const login = await request(app.server)
    .post('/auth/login')
    .send({ email: owner.email, password: PASSWORD })
    .expect(200);
  const ownerAuth = `Bearer ${login.body.accessToken as string}`;
  const created = await fx.clientOrgWithPlant({ tenantId });
  plantId = created.plant.id;
  clientOrgId = created.org.id;
  const route = await request(app.server)
    .post('/routes')
    .set('authorization', ownerAuth)
    .send({
      plantId,
      code: 'SYN-01',
      name: 'Ruta sin señal',
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
  const passenger = await fx.passenger({ clientOrgId, plantId });
  employee = passenger.employeeNumber;
  gateCode = `SG${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  await app.db.system.plantGate.create({
    data: { clientOrgId, plantId, name: 'Puerta norte', qrCode: gateCode },
  });
});

afterAll(async () => {
  await app.close();
});

describe('sincronización sin señal', () => {
  it('aplica un viaje completo y corrige el reloj atrasado del celular', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    // El reloj del celular va 10 minutos atrasado.
    const skew = -10 * MINUTE;
    const deviceNow = (offset: number) => new Date(Date.now() + skew + offset * MINUTE);
    const events = [
      event('checklist', {
        tripId: trip.id,
        sequence: 1,
        at: deviceNow(-30),
        data: { items: ALL_OK },
      }),
      event('start', {
        tripId: trip.id,
        sequence: 2,
        at: deviceNow(-25),
        data: { lat: 31.75, lng: -106.47 },
      }),
      event('stop_arrived', {
        tripId: trip.id,
        sequence: 3,
        at: deviceNow(-20),
        data: { stopId: stopIds[0] },
      }),
      event('scan', {
        tripId: trip.id,
        sequence: 4,
        at: deviceNow(-19),
        data: { employeeNumber: employee },
      }),
      event('gate', {
        tripId: trip.id,
        sequence: 5,
        at: deviceNow(-5),
        data: { code: `shiftlane-puerta://${gateCode}` },
      }),
      event('finish', { tripId: trip.id, sequence: 6, at: deviceNow(-4) }),
    ];
    const response = await sync(driver.auth, events, deviceNow(0)).expect(200);
    expect(response.body.summary).toEqual({ applied: 6, duplicate: 0, rejected: 0, retry: 0 });
    expect(Math.abs(response.body.clockOffsetMs - 10 * MINUTE)).toBeLessThan(2_000);

    const saved = await app.db.system.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(saved.status).toBe('completed');
    // El inicio quedó con la hora real (hace 25 minutos), no con la del celular.
    const expectedStart = new Date(events[1]!.occurredAt).getTime() + response.body.clockOffsetMs;
    expect(Math.abs(saved.actualStartAt!.getTime() - expectedStart)).toBeLessThan(1_000);
    expect(Math.abs(saved.actualStartAt!.getTime() - (Date.now() - 25 * MINUTE))).toBeLessThan(
      5_000,
    );
    const device = await app.db.system.device.findUniqueOrThrow({ where: { id: driver.deviceId } });
    expect(device.clockOffsetMs).toBe(response.body.clockOffsetMs);
    expect(device.lastSyncAt).not.toBeNull();

    // Un lote repetido no cambia nada.
    const repeated = await sync(driver.auth, events, deviceNow(1)).expect(200);
    expect(repeated.body.summary).toEqual({ applied: 0, duplicate: 6, rejected: 0, retry: 0 });
    expect(repeated.body.results[3].result).toMatchObject({ result: 'other_route' });
    expect(await app.db.system.tripEvent.count({ where: { tripId: trip.id } })).toBe(6);
    expect(await app.db.system.boarding.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it('procesa en el orden del celular aunque el lote llegue desordenado', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    const now = Date.now();
    const at = (minutes: number) => new Date(now + minutes * MINUTE);
    const ordered = [
      event('checklist', { tripId: trip.id, sequence: 10, at: at(-10), data: { items: ALL_OK } }),
      event('start', { tripId: trip.id, sequence: 11, at: at(-9) }),
      event('scan', {
        tripId: trip.id,
        sequence: 12,
        at: at(-8),
        data: { employeeNumber: employee },
      }),
      event('finish', { tripId: trip.id, sequence: 13, at: at(-1) }),
    ];
    const shuffled = [ordered[3], ordered[2], ordered[0], ordered[1]];
    const response = await sync(driver.auth, shuffled).expect(200);
    expect((response.body.results as Result[]).map((r) => r.status)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
    ]);
    // Los resultados vuelven en el orden en que se enviaron.
    expect((response.body.results as Result[]).map((r) => r.type)).toEqual([
      'finish',
      'scan',
      'checklist',
      'start',
    ]);

    // Sin contador, el orden lo da la hora.
    const other = await newDriver();
    const second = await newTrip(other.id);
    const byTime = [
      event('start', { tripId: second.id, at: at(-5) }),
      event('checklist', { tripId: second.id, at: at(-6), data: { items: ALL_OK } }),
    ];
    const timed = await sync(other.auth, byTime).expect(200);
    expect(timed.body.summary.applied).toBe(2);
  });

  it('acepta eventos que llegan tarde si ocurrieron antes de terminar el viaje', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    const now = Date.now();
    const at = (minutes: number) => new Date(now + minutes * MINUTE);
    await sync(driver.auth, [
      event('checklist', { tripId: trip.id, sequence: 1, at: at(-40), data: { items: ALL_OK } }),
      event('start', { tripId: trip.id, sequence: 2, at: at(-30) }),
      event('finish', { tripId: trip.id, sequence: 9, at: at(-5) }),
    ]).expect(200);

    const late = await sync(driver.auth, [
      event('stop_arrived', {
        tripId: trip.id,
        sequence: 3,
        at: at(-20),
        data: { stopId: stopIds[1] },
      }),
      event('scan', {
        tripId: trip.id,
        sequence: 4,
        at: at(-19),
        data: { employeeNumber: employee },
      }),
      event('incident', { tripId: trip.id, sequence: 5, at: at(-15), data: { type: 'traffic' } }),
      event('scan', { tripId: trip.id, sequence: 10, at: at(-2), data: { code: 'TARDE-1' } }),
    ]).expect(200);
    const results = late.body.results as Result[];
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'rejected']);
    expect(results[3]!.message).toBe('El viaje ya terminó.');
    expect(await app.db.system.boarding.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it('pide reintentar lo que llega antes del inicio del viaje', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    const now = Date.now();
    const scan = event('scan', {
      tripId: trip.id,
      sequence: 3,
      at: new Date(now - MINUTE),
      data: { employeeNumber: employee },
    });
    const early = await sync(driver.auth, [scan]).expect(200);
    expect(early.body.results[0]).toMatchObject({
      status: 'retry',
      message: 'Todavía no se recibe el inicio del viaje; se reintentará.',
    });
    expect(await app.db.system.deviceSyncEvent.count({ where: { eventId: scan.id } })).toBe(0);

    const later = await sync(driver.auth, [
      event('checklist', {
        tripId: trip.id,
        sequence: 1,
        at: new Date(now - 5 * MINUTE),
        data: { items: ALL_OK },
      }),
      event('start', { tripId: trip.id, sequence: 2, at: new Date(now - 4 * MINUTE) }),
      scan,
    ]).expect(200);
    expect(later.body.summary).toEqual({ applied: 3, duplicate: 0, rejected: 0, retry: 0 });
  });

  it('un lote parcial aplica lo válido y rechaza lo demás con su motivo', async () => {
    const driver = await newDriver();
    const intruder = await newDriver();
    const trip = await newTrip(driver.id);
    const foreignTrip = await newTrip(intruder.id);
    const now = new Date();
    const events = [
      event('checklist', { tripId: trip.id, sequence: 1, at: now, data: { items: ALL_OK } }),
      event('teleport', { tripId: trip.id, sequence: 2, at: now }),
      event('stop_arrived', { tripId: trip.id, sequence: 3, at: now, data: {} }),
      event('start', { tripId: foreignTrip.id, sequence: 4, at: now }),
      event('start', { sequence: 5, at: now }),
      event('panic', { sequence: 6, at: now, data: { lat: 31.7, lng: -106.4 } }),
    ];
    const response = await sync(driver.auth, events).expect(200);
    const results = response.body.results as Result[];
    expect(results.map((r) => r.status)).toEqual([
      'applied',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'applied',
    ]);
    expect(results[1]!.message).toBe('Tipo de evento desconocido: teleport.');
    expect(results[2]!.message).toMatch(/^Datos inválidos: stopId/);
    expect(results[3]!.message).toBe('No se encontró el viaje.');
    expect(results[4]!.message).toBe('El evento no indica el viaje.');

    // Reenviar lo rechazado devuelve el mismo motivo sin volver a procesarlo.
    const resent = await sync(driver.auth, events.slice(1, 4)).expect(200);
    expect((resent.body.results as Result[]).map((r) => [r.status, r.message])).toEqual([
      ['duplicate', 'Tipo de evento desconocido: teleport.'],
      ['duplicate', results[2]!.message],
      ['duplicate', 'No se encontró el viaje.'],
    ]);
  });

  it('un evento repetido dentro del lote o desde otro celular se aplica una sola vez', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    const now = Date.now();
    const checklist = event('checklist', {
      tripId: trip.id,
      sequence: 1,
      at: new Date(now - 2 * MINUTE),
      data: { items: ALL_OK },
    });
    const start = event('start', { tripId: trip.id, sequence: 2, at: new Date(now - MINUTE) });
    const response = await sync(driver.auth, [checklist, start, start]).expect(200);
    expect((response.body.results as Result[]).map((r) => r.status)).toEqual([
      'applied',
      'applied',
      'duplicate',
    ]);
    expect(response.body.summary).toEqual({ applied: 2, duplicate: 1, rejected: 0, retry: 0 });

    // El mismo chofer en otro celular reenvía el mismo evento: no se duplica.
    const device = await app.db.system.device.create({ data: { tenantId, secretHash: 'y' } });
    const otherPhone = await app.tokens.signAccess({
      kind: 'driver',
      sub: driver.id,
      sid: randomUUID(),
      tenantId,
      deviceId: device.id,
    });
    const fromOtherPhone = await sync(`Bearer ${otherPhone}`, [start]).expect(200);
    expect(fromOtherPhone.body.results[0].status).toBe('duplicate');
    expect(
      await app.db.system.tripEvent.count({ where: { tripId: trip.id, type: 'started' } }),
    ).toBe(1);
  });

  it(
    'procesa lotes muy grandes y rechaza los que pasan el límite',
    { timeout: 180_000 },
    async () => {
      const driver = await newDriver();
      const trip = await newTrip(driver.id);
      const total = 250;
      const numbers = Array.from({ length: total }, (_, i) => `G${Date.now()}-${i}`);
      await app.db.system.passenger.createMany({
        data: numbers.map((employeeNumber) => ({
          clientOrgId,
          plantId,
          employeeNumber,
          fullName: 'Pasajero de Lote',
        })),
      });
      const now = Date.now();
      const events = [
        event('checklist', {
          tripId: trip.id,
          sequence: 0,
          at: new Date(now - 60 * MINUTE),
          data: { items: ALL_OK },
        }),
        event('start', { tripId: trip.id, sequence: 1, at: new Date(now - 59 * MINUTE) }),
        ...numbers.map((employeeNumber, i) =>
          event('scan', {
            tripId: trip.id,
            sequence: i + 2,
            at: new Date(now - 58 * MINUTE + i * 1000),
            data: { employeeNumber },
          }),
        ),
      ];
      const response = await sync(driver.auth, events).expect(200);
      expect(response.body.summary).toEqual({
        applied: total + 2,
        duplicate: 0,
        rejected: 0,
        retry: 0,
      });
      expect(await app.db.system.boarding.count({ where: { tripId: trip.id } })).toBe(total);

      const tooMany = Array.from({ length: 1001 }, () => event('panic', { at: new Date() }));
      const refused = await sync(driver.auth, tooMany).expect(400);
      expect(JSON.stringify(refused.body)).toMatch(/como máximo 1000 eventos/);
    },
  );

  it('solo el chofer puede sincronizar', async () => {
    const owner = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
    const login = await request(app.server)
      .post('/auth/login')
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
    await sync(`Bearer ${login.body.accessToken as string}`, [
      event('panic', { at: new Date() }),
    ]).expect(403);
    await sync('Bearer nada', [event('panic', { at: new Date() })]).expect(401);
  });
});
