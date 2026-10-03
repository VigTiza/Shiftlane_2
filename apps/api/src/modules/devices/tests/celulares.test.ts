import { randomUUID } from 'node:crypto';

import { todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { ensurePositionPartitions, utcDays } from '../../../jobs/position-partitions.ts';
import type { DomainEvent } from '../../../lib/domain-events.ts';

const PASSWORD = 'Transporte2026';
const TODAY = todayIn('America/Ciudad_Juarez');
const MINUTE = 60_000;
const SPOT = { lat: 31.7652, lng: -106.5021 };

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let plantId: string;

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
  return { id: driver.id, deviceId: device.id, auth: `Bearer ${token}` };
}

async function newTrip(
  driverId: string,
  startedMinutesAgo = 30,
  status: 'in_progress' | 'completed' = 'in_progress',
) {
  const now = Date.now();
  return app.db.system.trip.create({
    data: {
      tenantId,
      plantId,
      kind: 'extra',
      extraReason: 'other',
      direction: 'inbound',
      status,
      serviceDate: new Date(`${TODAY}T00:00:00Z`),
      scheduledStartAt: new Date(now - startedMinutesAgo * MINUTE),
      scheduledEndAt: new Date(now + 30 * MINUTE),
      actualStartAt: new Date(now - startedMinutesAgo * MINUTE),
      actualEndAt: status === 'completed' ? new Date(now - 5 * MINUTE) : null,
      driverId,
      assignmentSource: 'manual',
    },
  });
}

async function storePositions(
  tripId: string,
  points: { minutesAgo: number; lat: number; lng: number }[],
) {
  const now = Date.now();
  const rows = points.map((p) => ({ ...p, at: new Date(now - p.minutesAgo * MINUTE) }));
  await ensurePositionPartitions(app.db.system, utcDays(rows.map((r) => r.at)));
  for (const row of rows) {
    await app.db.system.$executeRaw`
      INSERT INTO telemetry.trip_positions (tenant_id, trip_id, recorded_at, lat, lng)
      VALUES (${tenantId}::uuid, ${tripId}::uuid, ${row.at}, ${row.lat}, ${row.lng})`;
  }
}

function report(auth: string, reports: Record<string, unknown>[], sentAt = new Date()) {
  return request(app.server)
    .post('/driver/health')
    .set('authorization', auth)
    .send({ sentAt: sentAt.toISOString(), reports });
}

const HEALTHY = {
  batteryPct: 85,
  charging: false,
  networkType: 'cellular',
  signalLevel: 3,
  locationPermission: 'always',
  gpsEnabled: true,
  backgroundAllowed: true,
  batteryOptimizationIgnored: true,
  cameraPermission: true,
  appVersion: '1.2.0',
  platform: 'android',
  deviceModel: 'Moto G54',
};

beforeAll(async () => {
  app = await buildTestApp({ env: { MIN_DRIVER_APP_VERSION: '1.2.0' } });
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  ownerAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
  );
  plantId = (await fx.clientOrgWithPlant({ tenantId })).plant.id;
});

afterAll(async () => {
  await app.close();
});

describe('reportes de salud del celular', () => {
  it('dice qué impide iniciar, avisa al panel cuando cambia y guarda el historial', async () => {
    const driver = await newDriver();
    const seen: DomainEvent[] = [];
    const unsubscribe = app.events.subscribe((event) => seen.push(event));
    try {
      const ok = await report(driver.auth, [
        { ...HEALTHY, recordedAt: new Date().toISOString() },
      ]).expect(200);
      expect(ok.body).toMatchObject({ accepted: 1, status: 'ok', issues: [], canStartTrip: true });

      const bad = await report(driver.auth, [
        {
          ...HEALTHY,
          recordedAt: new Date().toISOString(),
          locationPermission: 'while_in_use',
          appVersion: '1.1.9',
        },
      ]).expect(200);
      expect(bad.body).toMatchObject({ status: 'problem', canStartTrip: false });
      expect(bad.body.issues.map((i: { code: string }) => i.code)).toEqual([
        'location_permission',
        'outdated_app',
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const changes = seen.flatMap((e) => (e.type === 'device.health_changed' ? [e.device] : []));
      expect(changes.map((device) => device.status)).toEqual(['ok', 'problem']);
    } finally {
      unsubscribe();
    }

    const inventory = await request(app.server)
      .get('/devices/health')
      .set('authorization', ownerAuth)
      .expect(200);
    expect(inventory.body.find((d: { id: string }) => d.id === driver.deviceId)).toMatchObject({
      platform: 'android',
      model: 'Moto G54',
      appVersion: '1.1.9',
      driver: { id: driver.id },
      health: { status: 'problem', locationPermission: 'while_in_use' },
    });
    const history = await request(app.server)
      .get(`/devices/${driver.deviceId}/health`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(history.body.map((r: { status: string }) => r.status)).toEqual(['problem', 'ok']);
  });

  it('corrige la hora del celular y avisa del desfase', async () => {
    const driver = await newDriver();
    // El celular va 5 minutos adelantado.
    const ahead = new Date(Date.now() + 5 * MINUTE);
    const response = await report(
      driver.auth,
      [{ ...HEALTHY, recordedAt: ahead.toISOString() }],
      ahead,
    ).expect(200);
    expect(response.body.status).toBe('warning');
    expect(response.body.issues[0].code).toBe('clock_skew');
    const [saved] = await app.db.system.deviceHealthReport.findMany({
      where: { deviceId: driver.deviceId },
    });
    expect(Math.abs(saved!.recordedAt.getTime() - Date.now())).toBeLessThan(5_000);
    expect(Math.abs(saved!.clockOffsetMs! + 5 * MINUTE)).toBeLessThan(2_000);
  });

  it('otra empresa no ve los celulares ni el diagnóstico', async () => {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    await report(driver.auth, [{ ...HEALTHY, recordedAt: new Date().toISOString() }]).expect(200);
    const rival = (await fx.tenant()).id;
    const rivalAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: rival, password: PASSWORD, roles: ['owner'] })).email,
    );
    const list = await request(app.server)
      .get('/devices/health')
      .set('authorization', rivalAuth)
      .expect(200);
    expect(list.body.map((d: { id: string }) => d.id)).not.toContain(driver.deviceId);
    await request(app.server)
      .get(`/devices/${driver.deviceId}/health`)
      .set('authorization', rivalAuth)
      .expect(404);
    await request(app.server)
      .get(`/trips/${trip.id}/diagnosis`)
      .set('authorization', rivalAuth)
      .expect(404);
  });
});

describe('diagnóstico de una unidad que deja de reportar', () => {
  async function silentTrip(reports: Record<string, unknown>[]) {
    const driver = await newDriver();
    const trip = await newTrip(driver.id);
    // Posiciones hasta hace 8 minutos y luego nada.
    await storePositions(trip.id, [
      { minutesAgo: 12, lat: SPOT.lat - 0.004, lng: SPOT.lng },
      { minutesAgo: 8, ...SPOT },
    ]);
    if (reports.length > 0) await report(driver.auth, reports).expect(200);
    return trip;
  }

  function diagnosis(tripId: string) {
    return request(app.server)
      .get(`/trips/${tripId}/diagnosis`)
      .set('authorization', ownerAuth)
      .expect(200);
  }

  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * MINUTE).toISOString();

  it('batería baja', async () => {
    const trip = await silentTrip([{ ...HEALTHY, batteryPct: 5, recordedAt: at(9) }]);
    const response = await diagnosis(trip.id);
    expect(response.body).toMatchObject({ cause: 'low_battery', lastPosition: SPOT });
  });

  it('permiso revocado', async () => {
    const trip = await silentTrip([{ ...HEALTHY, gpsEnabled: false, recordedAt: at(9) }]);
    expect((await diagnosis(trip.id)).body.cause).toBe('permission_revoked');
  });

  it('sin datos', async () => {
    const trip = await silentTrip([
      { ...HEALTHY, networkType: 'none', signalLevel: 0, recordedAt: at(9) },
    ]);
    expect((await diagnosis(trip.id)).body.cause).toBe('no_data');
  });

  it('app cerrada', async () => {
    const trip = await silentTrip([
      { ...HEALTHY, batteryOptimizationIgnored: false, recordedAt: at(9) },
    ]);
    expect((await diagnosis(trip.id)).body).toMatchObject({
      cause: 'app_closed',
      message: 'El sistema cerró la app por el ahorro de batería.',
    });
  });

  it('zona sin señal conocida por los huecos de otras unidades en el mismo lugar', async () => {
    // Dos viajes anteriores perdieron la señal (más de 3 min sin posiciones) en ese punto.
    for (let i = 0; i < 2; i += 1) {
      const past = await newTrip((await newDriver()).id, 120 + i * 60, 'completed');
      await storePositions(past.id, [
        { minutesAgo: 110 + i * 60, lat: SPOT.lat + 0.0005, lng: SPOT.lng },
        { minutesAgo: 100 + i * 60, lat: SPOT.lat + 0.02, lng: SPOT.lng },
      ]);
    }
    const trip = await silentTrip([{ ...HEALTHY, networkType: 'none', recordedAt: at(9) }]);
    expect((await diagnosis(trip.id)).body).toMatchObject({
      cause: 'known_dead_zone',
      evidence: expect.objectContaining({ deadZoneHits: 2 }),
    });
  });

  it('la alerta de unidad sin reportar incluye la causa probable', async () => {
    const trip = await silentTrip([{ ...HEALTHY, batteryPct: 4, recordedAt: at(9) }]);
    await app.alerts.runMinute(new Date(), { tenantIds: [tenantId] });
    const alert = await app.db.system.alert.findFirstOrThrow({
      where: { tripId: trip.id, type: 'device_silent' },
    });
    expect(alert.cause).toMatch(
      /no envía su ubicación desde hace 8 min\. Causa probable: El último reporte tenía 4 % de batería sin cargar: probablemente se apagó\.$/,
    );
    expect(alert.suggestedAction).toBe(
      'Pide al chofer que conecte el celular al cargador de la unidad.',
    );
    expect(alert).toMatchObject({ lat: SPOT.lat, lng: SPOT.lng });
  });
});
