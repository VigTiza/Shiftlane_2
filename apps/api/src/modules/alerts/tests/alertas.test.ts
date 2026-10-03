import { randomUUID } from 'node:crypto';

import { todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { ensurePositionPartitions, utcDays } from '../../../jobs/position-partitions.ts';
import type { Alert } from '../../../generated/prisma/client.ts';

const PASSWORD = 'Transporte2026';
const TODAY = todayIn('America/Ciudad_Juarez');
const MINUTE = 60_000;
const STOP_1 = { lat: 31.7445, lng: -106.4605 };
const STOP_2 = { lat: 31.7101, lng: -106.4081 };
const PLANT = { lat: 31.6904, lng: -106.3712 };
/** Lejos de la ruta, de las paradas y de la planta. */
const FAR_AWAY = { lat: 31.78, lng: -106.52 };
const ALL_OK = ['tires', 'brakes', 'lights', 'cleanliness', 'extinguisher', 'first_aid'].map(
  (key) => ({ key, ok: true }),
);

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let plantAuth: string;
let plantId: string;
let clientOrgId: string;
let routeId: string;
let versionId: string;

async function tokenFor(email: string) {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

async function newDriver() {
  const driver = await app.db.system.driver.create({
    data: {
      tenantId,
      fullName: `Chofer ${Math.random().toString(36).slice(2, 7)}`,
      licenseType: 'Federal B',
      documents: { create: [{ type: 'license', expiresOn: null }] },
    },
  });
  const device = await app.db.system.device.create({ data: { tenantId, secretHash: 'x' } });
  const token = await app.tokens.signAccess({
    kind: 'driver',
    sub: driver.id,
    sid: randomUUID(),
    tenantId,
    deviceId: device.id,
  });
  return { id: driver.id, fullName: driver.fullName, auth: `Bearer ${token}` };
}

async function newVehicle(capacity = 19) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return app.db.system.vehicle.create({
    data: {
      tenantId,
      economicNumber: `A-${suffix}`,
      plates: `PA-${suffix}`,
      model: 'Sprinter',
      year: 2024,
      capacity,
      documents: {
        create: [{ type: 'insurance', expiresOn: new Date('2030-01-01T00:00:00Z') }],
      },
    },
  });
}

async function newTrip(input: {
  driverId: string;
  status?: 'scheduled' | 'in_progress';
  startOffsetMinutes?: number;
  startedMinutesAgo?: number;
  endOffsetMinutes?: number;
  vehicleId?: string;
}) {
  const now = Date.now();
  const start = new Date(now + (input.startOffsetMinutes ?? 30) * MINUTE);
  const status = input.status ?? 'scheduled';
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
      scheduledStartAt: start,
      scheduledEndAt: new Date(now + (input.endOffsetMinutes ?? 90) * MINUTE),
      actualStartAt:
        status === 'in_progress' ? new Date(now - (input.startedMinutesAgo ?? 5) * MINUTE) : null,
      driverId: input.driverId,
      vehicleId: input.vehicleId ?? (await newVehicle()).id,
      assignmentSource: 'manual',
    },
  });
}

/** Simula la posición en vivo que dejaría la ingesta GPS y avisa al motor. */
async function livePosition(
  trip: { id: string; plantId: string; routeId: string | null; driverId: string | null },
  input: { lat: number; lng: number; speedKmh?: number; delayMinutes?: number | null },
) {
  await app.liveStore.setTripPosition({
    tripId: trip.id,
    tenantId,
    plantId: trip.plantId,
    routeId: trip.routeId,
    driverId: trip.driverId!,
    vehicleId: null,
    lat: input.lat,
    lng: input.lng,
    speedKmh: input.speedKmh ?? 40,
    heading: 90,
    recordedAt: new Date().toISOString(),
    eta:
      input.delayMinutes === undefined || input.delayMinutes === null
        ? null
        : {
            stops: [],
            destination: {
              eta: new Date(Date.now() + 20 * MINUTE).toISOString(),
              distanceMeters: 8000,
            },
            delayMinutes: input.delayMinutes,
          },
  });
  app.events.publish({ type: 'trip.position', tripId: trip.id, autoArrivals: [] });
  await app.alerts.idle();
}

async function alertsOf(tripId: string, type?: Alert['type']) {
  return app.db.system.alert.findMany({
    where: { tripId, ...(type ? { type } : {}) },
    orderBy: { openedAt: 'asc' },
  });
}

/** Espera la alerta que dispara un evento de una petición (se evalúa al responder). */
async function waitForAlert(where: { tripId?: string; type: Alert['type'] }) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    await app.alerts.idle();
    const found = await app.db.system.alert.findFirst({ where: { tenantId, ...where } });
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`No se abrió la alerta ${where.type}`);
}

async function storePositions(tripId: string, points: { at: Date; lat: number; lng: number }[]) {
  await ensurePositionPartitions(app.db.system, utcDays(points.map((p) => p.at)));
  for (const point of points) {
    await app.db.system.$executeRaw`
      INSERT INTO telemetry.trip_positions (tenant_id, trip_id, recorded_at, lat, lng, speed_kmh)
      VALUES (${tenantId}::uuid, ${tripId}::uuid, ${point.at}, ${point.lat}, ${point.lng}, 0)`;
  }
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
  await app.db.system.$executeRaw`
    UPDATE plants SET location = ST_SetSRID(ST_MakePoint(${PLANT.lng}, ${PLANT.lat}), 4326)::geography
    WHERE id = ${plantId}::uuid`;
  plantAuth = await tokenFor(
    (await fx.plantUser({ clientOrgId, password: PASSWORD, roles: ['plant_logistics'] })).email,
  );
  const route = await request(app.server)
    .post('/routes')
    .set('authorization', ownerAuth)
    .send({
      plantId,
      code: 'ALR-01',
      name: 'Ruta vigilada',
      direction: 'inbound',
      version: {
        validFrom: TODAY,
        stops: [
          { name: 'Plaza de la Mexicanidad', location: STOP_1, times: [{ time: '05:00' }] },
          { name: 'Waterfill', location: STOP_2, times: [{ time: '05:30' }] },
        ],
      },
    })
    .expect(201);
  routeId = route.body.id as string;
  versionId = route.body.current.id as string;
});

afterAll(async () => {
  await app.close();
});

describe('reglas de alertas con datos simulados', () => {
  it('viaje no iniciado: se abre pasada la tolerancia, no se duplica y se cierra al iniciar', async () => {
    const driver = await newDriver();
    const late = await newTrip({ driverId: driver.id, startOffsetMinutes: -12 });
    const onTime = await newTrip({ driverId: driver.id, startOffsetMinutes: -2 });
    await app.alerts.runMinute();
    await app.alerts.runMinute();
    const [alert, ...rest] = await alertsOf(late.id, 'trip_not_started');
    expect(rest).toEqual([]);
    expect(alert).toMatchObject({ status: 'open', severity: 'warning', plantId });
    expect(alert!.cause).toMatch(
      /^El viaje ALR-01 debía iniciar a las \d{2}:\d{2} y Chofer \w+ no lo ha iniciado \(1[12] min\)\.$/,
    );
    expect(alert!.suggestedAction).toBe('Llama al chofer o envía una unidad de respaldo.');
    // Ubicación: la primera parada.
    expect(alert!.lat).toBeCloseTo(STOP_1.lat, 4);
    expect(await alertsOf(onTime.id)).toEqual([]);

    await app.db.system.trip.update({
      where: { id: late.id },
      data: { status: 'in_progress', actualStartAt: new Date() },
    });
    app.events.publish({ type: 'trip.status_changed', tripId: late.id });
    await app.alerts.idle();
    const [resolved] = await alertsOf(late.id, 'trip_not_started');
    expect(resolved).toMatchObject({
      status: 'resolved',
      autoResolved: true,
      resolution: 'El chofer inició el viaje.',
    });
  });

  it('retraso: se abre con la hora estimada y se cierra al recuperar el horario', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id, status: 'in_progress' });
    await livePosition(trip, { ...STOP_1, delayMinutes: 18 });
    const [alert] = await alertsOf(trip.id, 'delay');
    expect(alert!.cause).toMatch(
      /^La llegada estimada de el viaje ALR-01 es a las \d{2}:\d{2}, 18 min después de lo programado\.$/,
    );
    expect(alert!.suggestedAction).toBe('Avisa a la planta del retraso o envía apoyo.');
    await livePosition(trip, { ...STOP_1, delayMinutes: 4 });
    expect((await alertsOf(trip.id, 'delay'))[0]).toMatchObject({
      status: 'resolved',
      autoResolved: true,
    });
  });

  it('desvío: se abre lejos del trazado y se cierra al volver a la ruta', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id, status: 'in_progress' });
    await livePosition(trip, FAR_AWAY);
    const [alert] = await alertsOf(trip.id, 'off_route');
    expect(alert).toMatchObject({ status: 'open', lat: FAR_AWAY.lat, lng: FAR_AWAY.lng });
    expect(alert!.cause).toMatch(/está a \d+ m del trazado de la ruta\.$/);
    await livePosition(trip, STOP_2);
    expect((await alertsOf(trip.id, 'off_route'))[0]!.status).toBe('resolved');
  });

  it('exceso de velocidad con el límite de la regla (configurable)', async () => {
    const driver = await newDriver();
    const fast = await newTrip({ driverId: driver.id, status: 'in_progress' });
    await livePosition(fast, { ...STOP_1, speedKmh: 95 });
    const [alert] = await alertsOf(fast.id, 'speeding');
    expect(alert!.cause).toMatch(/va a 95 km\/h en el viaje ALR-01 \(límite 80 km\/h\)\.$/);

    await request(app.server)
      .put('/alert-rules/speeding')
      .set('authorization', ownerAuth)
      .send({ params: { limitKmh: 100 } })
      .expect(200);
    try {
      const other = await newTrip({ driverId: (await newDriver()).id, status: 'in_progress' });
      await livePosition(other, { ...STOP_1, speedKmh: 95 });
      expect(await alertsOf(other.id, 'speeding')).toEqual([]);
    } finally {
      await app.db.system.alertRule.deleteMany({ where: { tenantId, type: 'speeding' } });
    }
  });

  it('parada no programada: detenida fuera de las paradas, no cerca de una parada', async () => {
    const now = Date.now();
    const stuck = await newTrip({
      driverId: (await newDriver()).id,
      status: 'in_progress',
      startedMinutesAgo: 20,
    });
    const atStop = await newTrip({
      driverId: (await newDriver()).id,
      status: 'in_progress',
      startedMinutesAgo: 20,
    });
    const moving = await newTrip({
      driverId: (await newDriver()).id,
      status: 'in_progress',
      startedMinutesAgo: 20,
    });
    const minutesAgo = [9, 7, 5, 3, 1].map((m) => new Date(now - m * MINUTE));
    await storePositions(
      stuck.id,
      minutesAgo.map((at) => ({ at, ...FAR_AWAY })),
    );
    await storePositions(
      atStop.id,
      minutesAgo.map((at) => ({ at, lat: STOP_1.lat + 0.0001, lng: STOP_1.lng })),
    );
    await storePositions(
      moving.id,
      minutesAgo.map((at, i) => ({ at, lat: FAR_AWAY.lat - i * 0.01, lng: FAR_AWAY.lng })),
    );
    await app.alerts.runMinute(new Date(now));
    const [alert] = await alertsOf(stuck.id, 'unscheduled_stop');
    expect(alert!.cause).toMatch(/lleva 9 min detenida fuera de una parada\.$/);
    expect(alert).toMatchObject({ lat: FAR_AWAY.lat, lng: FAR_AWAY.lng });
    expect(await alertsOf(atStop.id, 'unscheduled_stop')).toEqual([]);
    expect(await alertsOf(moving.id, 'unscheduled_stop')).toEqual([]);
  });

  it('sobrecupo al abordar más pasajeros que asientos', async () => {
    const driver = await newDriver();
    const trip = await newTrip({
      driverId: driver.id,
      status: 'in_progress',
      vehicleId: (await newVehicle(2)).id,
    });
    app.events.publish({
      type: 'boarding.created',
      tripId: trip.id,
      boarding: { result: 'ok', passenger: null, stop: null, onboard: 3, overCapacity: true },
    });
    await app.alerts.idle();
    const [alert] = await alertsOf(trip.id, 'overcapacity');
    expect(alert!.cause).toMatch(/^Hay 3 pasajeros a bordo y la unidad A-\w+ tiene 2 asientos\.$/);
  });

  it('pánico: crítica; al atenderla también se atiende el pánico', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id, status: 'in_progress' });
    const panic = await request(app.server)
      .post('/driver/panic')
      .set('authorization', driver.auth)
      .send({ tripId: trip.id, lat: 31.72, lng: -106.43 })
      .expect(201);
    const alert = await waitForAlert({ tripId: trip.id, type: 'panic' });
    expect(alert).toMatchObject({ severity: 'critical', lat: 31.72, lng: -106.43 });
    expect(alert.cause).toBe(
      `${driver.fullName} presionó el botón de pánico durante el viaje ALR-01.`,
    );
    await request(app.server)
      .post(`/alerts/${alert.id}/acknowledge`)
      .set('authorization', ownerAuth)
      .send({ note: 'Ya le marqué, todo bien' })
      .expect(200);
    const saved = await app.db.system.panicEvent.findUniqueOrThrow({
      where: { id: panic.body.id as string },
    });
    expect(saved.acknowledgedAt).not.toBeNull();
  });

  it('falla de checklist con los puntos no aprobados', async () => {
    const driver = await newDriver();
    const vehicle = await newVehicle();
    const trip = await newTrip({ driverId: driver.id, vehicleId: vehicle.id });
    await request(app.server)
      .post(`/driver/trips/${trip.id}/checklist`)
      .set('authorization', driver.auth)
      .send({ items: ALL_OK.map((i) => (i.key === 'lights' ? { ...i, ok: false } : i)) })
      .expect(200);
    const alert = await waitForAlert({ tripId: trip.id, type: 'checklist_failed' });
    expect(alert.cause).toBe(
      `El checklist de la unidad ${vehicle.economicNumber} tiene puntos sin aprobar: Luces.`,
    );
  });

  it('unidad sin reportar: se abre sin posiciones y se cierra al volver a reportar', async () => {
    const driver = await newDriver();
    const trip = await newTrip({
      driverId: driver.id,
      status: 'in_progress',
      startedMinutesAgo: 9,
    });
    await app.alerts.runMinute();
    const [alert] = await alertsOf(trip.id, 'device_silent');
    expect(alert!.cause).toMatch(
      /no ha enviado su ubicación desde que inició el viaje \(9 min\)\. Causa probable: No hay reportes de salud de este celular\.$/,
    );
    expect(alert!.suggestedAction).toBe(
      'Llama al chofer y revisa la batería y los datos del celular.',
    );
    await livePosition(trip, STOP_1);
    expect((await alertsOf(trip.id, 'device_silent'))[0]).toMatchObject({
      status: 'resolved',
      resolution: 'La unidad volvió a reportar su ubicación.',
    });
  });

  it('documento vencido al asignar (asignación confirmada con force)', async () => {
    const vehicle = await newVehicle();
    await app.db.system.vehicleDocument.updateMany({
      where: { vehicleId: vehicle.id },
      data: { expiresOn: new Date('2020-01-01T00:00:00Z') },
    });
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id });
    await request(app.server)
      .put(`/trips/${trip.id}/assignment`)
      .set('authorization', ownerAuth)
      .send({ vehicleId: vehicle.id, force: true })
      .expect(200);
    const alert = await waitForAlert({ tripId: trip.id, type: 'expired_documents_on_assign' });
    expect(alert.cause).toMatch(/Seguro de la unidad .* venció el 2020-01-01\./);
  });

  it('se cierran solas al terminar o cancelar el viaje', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id, status: 'in_progress' });
    await livePosition(trip, { ...FAR_AWAY, delayMinutes: 30 });
    expect((await alertsOf(trip.id)).map((a) => a.type).sort()).toEqual(['delay', 'off_route']);
    await app.db.system.trip.update({ where: { id: trip.id }, data: { status: 'cancelled' } });
    app.events.publish({ type: 'trip.cancelled', tripId: trip.id, reason: 'Prueba' });
    await app.alerts.idle();
    expect((await alertsOf(trip.id)).every((a) => a.status === 'resolved' && a.autoResolved)).toBe(
      true,
    );
  });
});

describe('atención, escalamiento y configuración', () => {
  it('registra quién la atendió, cuánto tardó y su historial', async () => {
    const trip = await newTrip({ driverId: (await newDriver()).id, status: 'in_progress' });
    await livePosition(trip, { ...STOP_1, speedKmh: 120 });
    const [alert] = await alertsOf(trip.id, 'speeding');
    await app.db.system.alert.update({
      where: { id: alert!.id },
      data: { openedAt: new Date(Date.now() - 7 * MINUTE) },
    });
    const acknowledged = await request(app.server)
      .post(`/alerts/${alert!.id}/acknowledge`)
      .set('authorization', ownerAuth)
      .send({})
      .expect(200);
    expect(acknowledged.body).toMatchObject({ status: 'acknowledged', minutesToAcknowledge: 7 });
    await request(app.server)
      .post(`/alerts/${alert!.id}/acknowledge`)
      .set('authorization', ownerAuth)
      .send({})
      .expect(409);
    await request(app.server)
      .post(`/alerts/${alert!.id}/notes`)
      .set('authorization', ownerAuth)
      .send({ note: 'El chofer dice que ya bajó la velocidad' })
      .expect(200);
    const resolved = await request(app.server)
      .post(`/alerts/${alert!.id}/resolve`)
      .set('authorization', ownerAuth)
      .send({ resolution: 'Se habló con el chofer' })
      .expect(200);
    expect(resolved.body).toMatchObject({
      status: 'resolved',
      resolution: 'Se habló con el chofer',
    });
    expect(resolved.body.minutesToResolve).toBeGreaterThanOrEqual(7);
    await request(app.server)
      .post(`/alerts/${alert!.id}/resolve`)
      .set('authorization', ownerAuth)
      .send({ resolution: 'Otra vez' })
      .expect(409);
    const detail = await request(app.server)
      .get(`/alerts/${alert!.id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.actions.map((a: { action: string }) => a.action)).toEqual([
      'created',
      'acknowledged',
      'note',
      'resolved',
    ]);
  });

  it('escala al gerente si nadie la atiende a tiempo', async () => {
    const trip = await newTrip({ driverId: (await newDriver()).id, status: 'in_progress' });
    await livePosition(trip, { ...STOP_1, delayMinutes: 25 });
    const other = await newTrip({ driverId: (await newDriver()).id, status: 'in_progress' });
    await livePosition(other, { ...STOP_1, delayMinutes: 25 });
    const [taken] = await alertsOf(other.id, 'delay');
    await request(app.server)
      .post(`/alerts/${taken!.id}/acknowledge`)
      .set('authorization', ownerAuth)
      .send({})
      .expect(200);

    // Todavía no: el retraso escala a los 15 minutos.
    await app.alerts.runMinute(new Date(Date.now() + 5 * MINUTE));
    expect((await alertsOf(trip.id, 'delay'))[0]!.escalatedAt).toBeNull();
    await app.alerts.runMinute(new Date(Date.now() + 16 * MINUTE));
    const [escalated] = await alertsOf(trip.id, 'delay');
    expect(escalated!.escalatedAt).not.toBeNull();
    const actions = await app.db.system.alertAction.findMany({ where: { alertId: escalated!.id } });
    expect(actions.map((a) => a.note)).toContain(
      'Se escaló al gerente: nadie la atendió en 15 min.',
    );
    // La que ya se estaba atendiendo no se escala.
    expect((await alertsOf(other.id, 'delay'))[0]!.escalatedAt).toBeNull();
  });

  it('las reglas se configuran por empresa y la planta ve solo lo que se le comparte', async () => {
    const rules = await request(app.server)
      .get('/alert-rules')
      .set('authorization', ownerAuth)
      .expect(200);
    expect(rules.body).toHaveLength(10);
    expect(rules.body.find((r: { type: string }) => r.type === 'panic')).toMatchObject({
      severity: 'critical',
      escalateAfterMinutes: 2,
      custom: false,
    });
    await request(app.server)
      .put('/alert-rules/off_route')
      .set('authorization', ownerAuth)
      .send({ params: { thresholdMeters: 5 } })
      .expect(400);
    await request(app.server)
      .put('/alert-rules/trip_not_started')
      .set('authorization', ownerAuth)
      .send({ enabled: false })
      .expect(200);
    await request(app.server)
      .put('/alert-rules/overcapacity')
      .set('authorization', ownerAuth)
      .send({ notifyPlant: true })
      .expect(200);
    try {
      const driver = await newDriver();
      const late = await newTrip({ driverId: driver.id, startOffsetMinutes: -20 });
      await app.alerts.runMinute();
      expect(await alertsOf(late.id, 'trip_not_started')).toEqual([]);

      const full = await newTrip({
        driverId: driver.id,
        status: 'in_progress',
        vehicleId: (await newVehicle(1)).id,
      });
      app.events.publish({
        type: 'boarding.created',
        tripId: full.id,
        boarding: { result: 'ok', passenger: null, stop: null, onboard: 2, overCapacity: true },
      });
      await app.alerts.idle();
      const plantView = await request(app.server)
        .get('/alerts')
        .query({ tripId: full.id })
        .set('authorization', plantAuth)
        .expect(200);
      expect(plantView.body.map((a: { type: string }) => a.type)).toEqual(['overcapacity']);
      // La planta no ve las que no se le comparten.
      const hidden = await request(app.server)
        .get('/alerts')
        .query({ type: 'speeding' })
        .set('authorization', plantAuth)
        .expect(200);
      expect(hidden.body).toEqual([]);

      // Otra empresa no ve nada.
      const rival = (await fx.tenant()).id;
      const rivalAuth = await tokenFor(
        (await fx.carrierUser({ tenantId: rival, password: PASSWORD, roles: ['owner'] })).email,
      );
      const rivalView = await request(app.server)
        .get('/alerts')
        .set('authorization', rivalAuth)
        .expect(200);
      expect(rivalView.body).toEqual([]);
      const plantUserCannot = await request(app.server)
        .post(`/alerts/${randomUUID()}/acknowledge`)
        .set('authorization', plantAuth)
        .send({});
      expect(plantUserCannot.status).toBe(403);
    } finally {
      await app.db.system.alertRule.deleteMany({ where: { tenantId } });
    }
  });

  it('una posición real del celular dispara la evaluación', async () => {
    const driver = await newDriver();
    const trip = await newTrip({
      driverId: driver.id,
      status: 'in_progress',
      startedMinutesAgo: 10,
    });
    await request(app.server)
      .post('/driver/positions')
      .set('authorization', driver.auth)
      .send({
        sentAt: new Date().toISOString(),
        points: [
          { tripId: trip.id, recordedAt: new Date().toISOString(), ...STOP_1, speedKmh: 130 },
        ],
      })
      .expect(200);
    const alert = await waitForAlert({ tripId: trip.id, type: 'speeding' });
    expect(alert.cause).toMatch(/va a 130 km\/h/);
  });
});
