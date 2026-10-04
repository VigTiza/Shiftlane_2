import { createHash, randomUUID } from 'node:crypto';

import { todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';
const TZ = 'America/Ciudad_Juarez';
const TODAY = todayIn(TZ);
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

const STOPS = [
  {
    name: 'Plaza de la Mexicanidad',
    location: { lat: 31.7445, lng: -106.4605 },
    times: [{ time: '05:00' }],
  },
  { name: 'Waterfill', location: { lat: 31.7101, lng: -106.4081 }, times: [{ time: '05:30' }] },
];

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let plantAuth: string;
let plantId: string;
let clientOrgId: string;
let routeId: string;
let versionId: string;
let stops: { id: string; name: string; location: { lat: number; lng: number } }[];
let gateCode: string;
let assigned: { id: string; employeeNumber: string; fullName: string };
let stranger: { id: string; employeeNumber: string };

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

async function newDriver(forTenantId = tenantId) {
  const driver = await app.db.system.driver.create({
    data: {
      tenantId: forTenantId,
      fullName: `Chofer ${Math.random().toString(36).slice(2, 7)}`,
      documents: { create: [{ type: 'license', expiresOn: null }] },
    },
  });
  const device = await app.db.system.device.create({
    data: { tenantId: forTenantId, secretHash: 'x' },
  });
  const token = await app.tokens.signAccess({
    kind: 'driver',
    sub: driver.id,
    sid: randomUUID(),
    tenantId: forTenantId,
    deviceId: device.id,
  });
  return { id: driver.id, auth: `Bearer ${token}` };
}

async function newVehicle(capacity = 15) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return app.db.system.vehicle.create({
    data: {
      tenantId,
      economicNumber: `V-${suffix}`,
      plates: `P-${suffix}`,
      model: 'Sprinter',
      year: 2024,
      capacity,
    },
  });
}

/** Viaje de hoy que empieza en unos minutos (dentro de la ventana para iniciar). */
async function newTrip(input: {
  driverId: string;
  vehicleId?: string | null;
  minutesFromNow?: number;
}) {
  const start = new Date(Date.now() + (input.minutesFromNow ?? 30) * 60_000);
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
      scheduledEndAt: new Date(start.getTime() + 60 * 60_000),
      driverId: input.driverId,
      vehicleId: input.vehicleId === undefined ? (await newVehicle()).id : input.vehicleId,
      assignmentSource: 'manual',
    },
  });
}

function post(path: string, auth: string, body: Record<string, unknown> = {}) {
  return request(app.server).post(path).set('authorization', auth).send(body);
}

const ALL_OK = ['tires', 'brakes', 'lights', 'cleanliness', 'extinguisher', 'first_aid'].map(
  (key) => ({ key, ok: true }),
);

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
  plantAuth = await tokenFor(
    (await fx.plantUser({ clientOrgId, password: PASSWORD, roles: ['plant_logistics'] })).email,
  );
  const route = await request(app.server)
    .post('/routes')
    .set('authorization', ownerAuth)
    .send({
      plantId,
      code: 'CIC-01',
      name: 'Ruta del ciclo',
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
  stops = version.body.stops as typeof stops;

  const p1 = await fx.passenger({ clientOrgId, plantId });
  await app.db.system.passenger.update({ where: { id: p1.id }, data: { fullName: 'Ana Torres' } });
  await app.db.system.routePassenger.create({
    data: {
      tenantId,
      routeId,
      passengerId: p1.id,
      stopKey: (version.body.stops as { stopKey: string }[])[0]!.stopKey,
    },
  });
  assigned = { id: p1.id, employeeNumber: p1.employeeNumber, fullName: 'Ana Torres' };
  const p2 = await fx.passenger({ clientOrgId, plantId });
  stranger = { id: p2.id, employeeNumber: p2.employeeNumber };
  await app.db.system.passengerCredential.create({
    data: { clientOrgId, passengerId: p2.id, kind: 'badge_barcode', value: 'GAF-0002' },
  });

  gateCode = `GATE${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  await app.db.system.plantGate.create({
    data: { clientOrgId, plantId, name: 'Puerta 1', qrCode: gateCode },
  });
});

afterAll(async () => {
  await app.close();
});

describe('ciclo de vida del viaje desde la app del chofer', () => {
  it('checklist, inicio, paradas, escaneos, incidente, llegada por puerta y fin', async () => {
    const driver = await newDriver();
    const vehicle = await newVehicle(2);
    const trip = await newTrip({ driverId: driver.id, vehicleId: vehicle.id });
    const base = `/driver/trips/${trip.id}`;

    const today = await request(app.server)
      .get('/driver/trips')
      .set('authorization', driver.auth)
      .expect(200);
    const listed = (today.body.trips as { id: string }[]).find((t) => t.id === trip.id);
    expect(listed).toMatchObject({
      status: 'scheduled',
      route: { code: 'CIC-01' },
      vehicle: { capacity: 2 },
      expectedPassengers: 1,
      stopsArrived: [],
      checklist: { done: false },
    });
    expect((listed as unknown as { stops: unknown[] }).stops).toHaveLength(2);

    const early = await post(`${base}/start`, driver.auth).expect(409);
    expect(early.body.error.message).toBe(
      'Haz el checklist de la unidad antes de iniciar el viaje.',
    );

    const photo = await request(app.server)
      .post(`${base}/photos`)
      .query({ kind: 'checklist' })
      .set('authorization', driver.auth)
      .attach('file', PNG, 'llanta.png')
      .expect(201);
    const checklist = await post(`${base}/checklist`, driver.auth, {
      items: ALL_OK.map((i) => (i.key === 'tires' ? { ...i, photoId: photo.body.id } : i)),
    }).expect(200);
    expect(checklist.body).toMatchObject({ passed: true, failed: [], canStart: true });

    const started = await post(`${base}/start`, driver.auth, { lat: 31.75, lng: -106.47 }).expect(
      200,
    );
    expect(started.body).toMatchObject({ status: 'in_progress', onboard: 0, capacity: 2 });
    expect(started.body.actualStartAt).not.toBeNull();

    const arrived = await post(`${base}/stops`, driver.auth, { stopId: stops[0]!.id }).expect(200);
    expect(arrived.body.stopsArrived).toEqual([stops[0]!.id]);
    const again = await post(`${base}/stops`, driver.auth, { stopId: stops[0]!.id }).expect(200);
    expect(again.body.duplicate).toBe(true);
    await post(`${base}/stops`, driver.auth, { stopId: randomUUID() }).expect(400);
    // Si el celular se reinicia a mitad del viaje, la lista trae las paradas ya visitadas.
    const midTrip = await request(app.server)
      .get('/driver/trips')
      .set('authorization', driver.auth)
      .expect(200);
    expect((midTrip.body.trips as { id: string }[]).find((t) => t.id === trip.id)).toMatchObject({
      status: 'in_progress',
      stopsArrived: [stops[0]!.id],
    });

    // Pasajero de la ruta, escaneado junto a la primera parada.
    const near = { lat: stops[0]!.location.lat + 0.0002, lng: stops[0]!.location.lng };
    const ok = await post(`${base}/scan`, driver.auth, {
      employeeNumber: assigned.employeeNumber,
      ...near,
    }).expect(200);
    expect(ok.body).toMatchObject({
      result: 'ok',
      message: 'Bienvenido, Ana.',
      passenger: { id: assigned.id },
      stop: { id: stops[0]!.id, name: stops[0]!.name },
      onboard: 1,
      overCapacity: false,
    });
    const repeated = await post(`${base}/scan`, driver.auth, {
      employeeNumber: assigned.employeeNumber,
    }).expect(200);
    expect(repeated.body).toMatchObject({ result: 'already_scanned', onboard: 1 });

    // Gafete registrado de un empleado que no es de esta ruta.
    const other = await post(`${base}/scan`, driver.auth, { code: 'GAF-0002' }).expect(200);
    expect(other.body).toMatchObject({
      result: 'other_route',
      message: 'Pasajero de otra ruta o turno.',
      passenger: { id: stranger.id },
      onboard: 2,
    });

    // Gafete desconocido: queda provisional y hay sobrecupo (3 a bordo, 2 asientos).
    const unknown = await post(`${base}/scan`, driver.auth, { code: 'NUEVO-777' }).expect(200);
    expect(unknown.body).toMatchObject({ result: 'unregistered', onboard: 3, overCapacity: true });
    expect(unknown.body.message).toMatch(/Sobrecupo/);
    expect(unknown.body.provisionalBadgeId).not.toBeNull();

    const rejected = await post(`${base}/scan`, driver.auth, {
      employeeNumber: 'NO-EXISTE',
    }).expect(200);
    expect(rejected.body).toMatchObject({
      result: 'rejected',
      message: 'No se encontró el número de empleado en esta planta.',
    });
    await post(`${base}/scan`, driver.auth, {}).expect(400);

    const incidentPhoto = await request(app.server)
      .post(`${base}/photos`)
      .query({ kind: 'incident' })
      .set('authorization', driver.auth)
      .attach('file', PNG, 'trafico.png')
      .expect(201);
    const incident = await post(`${base}/incidents`, driver.auth, {
      type: 'traffic',
      description: 'Choque en el Periférico',
      photoIds: [incidentPhoto.body.id],
    }).expect(201);
    expect(incident.body).toMatchObject({ status: 'open', duplicate: false });

    const gate = await post(`${base}/gate`, driver.auth, {
      code: `shiftlane-puerta://${gateCode}`,
    }).expect(200);
    expect(gate.body.arrivedAt).not.toBeNull();

    const finished = await post(`${base}/finish`, driver.auth).expect(200);
    expect(finished.body).toMatchObject({ status: 'completed', onboard: 3 });
    await post(`${base}/scan`, driver.auth, { code: 'NUEVO-778' })
      .expect(409)
      .expect((res) => expect(res.body.error.message).toBe('El viaje ya terminó.'));

    // El panel ve la evidencia completa.
    const detail = await request(app.server)
      .get(`/trips/${trip.id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual([
      'checklist_submitted',
      'started',
      'stop_arrived',
      'passenger_scanned',
      'passenger_scanned',
      'passenger_scanned',
      'passenger_scanned',
      'passenger_scanned',
      'incident_reported',
      'gate_arrived',
      'finished',
    ]);
    expect(detail.body).toMatchObject({
      status: 'completed',
      arrivalGate: { name: 'Puerta 1' },
      checklist: { passed: true },
    });
    expect(detail.body.boardings.map((b: { result: string }) => b.result)).toEqual([
      'ok',
      'other_route',
      'unregistered',
    ]);
    expect(detail.body.photos).toHaveLength(2);
    expect(detail.body.incidents[0]).toMatchObject({ type: 'traffic', status: 'open' });

    // La planta también ve la evidencia y las fotos.
    const plantView = await request(app.server)
      .get(`/trips/${trip.id}`)
      .set('authorization', plantAuth)
      .expect(200);
    expect(plantView.body.boardings).toHaveLength(3);
    const image = await request(app.server)
      .get(`/trips/${trip.id}/photos/${photo.body.id as string}`)
      .set('authorization', plantAuth)
      .expect(200);
    expect(image.headers['content-type']).toBe('image/png');
  });

  it('rechaza las acciones fuera de orden', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id });
    const base = `/driver/trips/${trip.id}`;
    for (const action of ['finish', 'gate']) {
      const response = await post(`${base}/${action}`, driver.auth, { code: gateCode }).expect(409);
      expect(response.body.error.message).toBe('Primero inicia el viaje.');
    }
    await post(`${base}/scan`, driver.auth, { code: 'X-1' }).expect(409);
    await post(`${base}/checklist`, driver.auth, { items: ALL_OK }).expect(200);
    await post(`${base}/start`, driver.auth).expect(200);
    const twice = await post(`${base}/start`, driver.auth).expect(409);
    expect(twice.body.error.message).toBe('El viaje ya está en curso.');
    const lateChecklist = await post(`${base}/checklist`, driver.auth, { items: ALL_OK }).expect(
      409,
    );
    expect(lateChecklist.body.error.message).toMatch(/antes de salir/);
    await post(`${base}/finish`, driver.auth).expect(200);
    await post(`${base}/finish`, driver.auth).expect(409);

    const cancelled = await newTrip({ driverId: driver.id });
    await app.db.system.trip.update({
      where: { id: cancelled.id },
      data: { status: 'cancelled', cancelReason: 'Prueba' },
    });
    const refused = await post(`/driver/trips/${cancelled.id}/start`, driver.auth).expect(409);
    expect(refused.body.error.message).toBe('El viaje está cancelado.');
  });

  it('un checklist con puntos sin aprobar necesita la autorización del despachador', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id });
    const base = `/driver/trips/${trip.id}`;
    const failed = await post(`${base}/checklist`, driver.auth, {
      items: ALL_OK.map((i) => (i.key === 'brakes' ? { ...i, ok: false, note: 'Rechinan' } : i)),
    }).expect(200);
    expect(failed.body).toMatchObject({ passed: false, failed: ['Frenos'], canStart: false });
    const blocked = await post(`${base}/start`, driver.auth).expect(409);
    expect(blocked.body.error.message).toMatch(/el despachador debe autorizar la salida/);

    await request(app.server)
      .post(`/trips/${trip.id}/checklist-exception`)
      .set('authorization', ownerAuth)
      .send({ reason: 'Se revisó en patio, frenos en buen estado' })
      .expect(200);
    await post(`${base}/start`, driver.auth).expect(200);
    const detail = await request(app.server)
      .get(`/trips/${trip.id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.checklistException.reason).toBe('Se revisó en patio, frenos en buen estado');
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual([
      'checklist_submitted',
      'checklist_exception',
      'started',
    ]);
  });

  it('respeta la ventana de inicio, un viaje a la vez y la unidad asignada', async () => {
    const driver = await newDriver();
    const later = await newTrip({ driverId: driver.id, minutesFromNow: 240 });
    await post(`/driver/trips/${later.id}/checklist`, driver.auth, { items: ALL_OK }).expect(200);
    const tooEarly = await post(`/driver/trips/${later.id}/start`, driver.auth).expect(409);
    expect(tooEarly.body.error.message).toMatch(
      /^Todavía es temprano: puedes iniciar este viaje desde las \d{2}:\d{2}\.$/,
    );

    const first = await newTrip({ driverId: driver.id });
    const second = await newTrip({ driverId: driver.id, minutesFromNow: 45 });
    for (const trip of [first, second]) {
      await post(`/driver/trips/${trip.id}/checklist`, driver.auth, { items: ALL_OK }).expect(200);
    }
    await post(`/driver/trips/${first.id}/start`, driver.auth).expect(200);
    const busy = await post(`/driver/trips/${second.id}/start`, driver.auth).expect(409);
    expect(busy.body.error.message).toBe(
      'Tienes otro viaje en curso; termínalo antes de iniciar este.',
    );

    const noVehicle = await newTrip({ driverId: driver.id, vehicleId: null });
    const missing = await post(`/driver/trips/${noVehicle.id}/checklist`, driver.auth, {
      items: ALL_OK,
    }).expect(409);
    expect(missing.body.error.message).toBe(
      'El viaje no tiene unidad asignada; avisa al despachador.',
    );
  });

  it('el chofer solo ve y opera sus viajes; otras empresas no ven la evidencia', async () => {
    const owner = await newDriver();
    const intruder = await newDriver();
    const trip = await newTrip({ driverId: owner.id });
    await post(`/driver/trips/${trip.id}/start`, intruder.auth).expect(404);
    const list = await request(app.server)
      .get('/driver/trips')
      .set('authorization', intruder.auth)
      .expect(200);
    expect((list.body.trips as { id: string }[]).map((t) => t.id)).not.toContain(trip.id);

    const rival = (await fx.tenant()).id;
    const rivalAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: rival, password: PASSWORD, roles: ['owner'] })).email,
    );
    await request(app.server).get(`/trips/${trip.id}`).set('authorization', rivalAuth).expect(404);
    const rivalDriver = await newDriver(rival);
    await post(`/driver/trips/${trip.id}/start`, rivalDriver.auth).expect(404);

    const strangerOrg = await fx.clientOrgWithPlant({ tenantId: rival });
    const strangerAuth = await tokenFor(
      (
        await fx.plantUser({
          clientOrgId: strangerOrg.org.id,
          password: PASSWORD,
          roles: ['plant_logistics'],
        })
      ).email,
    );
    await request(app.server)
      .get(`/trips/${trip.id}`)
      .set('authorization', strangerAuth)
      .expect(404);
  });

  it('un reenvío con el mismo UUID del celular no duplica nada', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id });
    const base = `/driver/trips/${trip.id}`;
    const checklistId = randomUUID();
    const first = await post(`${base}/checklist`, driver.auth, {
      items: ALL_OK,
      clientEventId: checklistId,
    }).expect(200);
    const resent = await post(`${base}/checklist`, driver.auth, {
      items: ALL_OK,
      clientEventId: checklistId,
    }).expect(200);
    expect(resent.body).toMatchObject({ id: first.body.id, duplicate: true });

    const startId = randomUUID();
    await post(`${base}/start`, driver.auth, { clientEventId: startId }).expect(200);
    const restart = await post(`${base}/start`, driver.auth, { clientEventId: startId }).expect(
      200,
    );
    expect(restart.body).toMatchObject({ status: 'in_progress', duplicate: true });

    const scanId = randomUUID();
    const scan = await post(`${base}/scan`, driver.auth, {
      employeeNumber: assigned.employeeNumber,
      clientEventId: scanId,
    }).expect(200);
    const rescan = await post(`${base}/scan`, driver.auth, {
      employeeNumber: assigned.employeeNumber,
      clientEventId: scanId,
    }).expect(200);
    expect(rescan.body).toMatchObject({ result: scan.body.result, onboard: 1, duplicate: true });

    const events = await app.db.system.tripEvent.groupBy({
      by: ['type'],
      where: { tripId: trip.id },
      _count: true,
    });
    expect(Object.fromEntries(events.map((e) => [e.type, e._count]))).toEqual({
      checklist_submitted: 1,
      started: 1,
      passenger_scanned: 1,
    });
  });

  it('pánico con y sin viaje, y su atención en el panel', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id });
    const withoutTrip = await post('/driver/panic', driver.auth, { lat: 31.7, lng: -106.4 }).expect(
      201,
    );
    await post('/driver/panic', driver.auth, { tripId: trip.id }).expect(201);
    const pending = await request(app.server)
      .get('/panic-events')
      .query({ pending: true })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(pending.body.map((p: { id: string }) => p.id)).toContain(withoutTrip.body.id);
    const acknowledged = await request(app.server)
      .post(`/panic-events/${withoutTrip.body.id as string}/acknowledge`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(acknowledged.body.acknowledgedAt).not.toBeNull();
    const events = await app.db.system.tripEvent.findMany({ where: { tripId: trip.id } });
    expect(events.map((e) => e.type)).toEqual(['panic']);
  });

  it('valida el QR de la puerta', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id });
    const base = `/driver/trips/${trip.id}`;
    await post(`${base}/checklist`, driver.auth, { items: ALL_OK }).expect(200);
    await post(`${base}/start`, driver.auth).expect(200);
    const invalid = await post(`${base}/gate`, driver.auth, { code: 'cualquier-cosa' }).expect(400);
    expect(invalid.body.error.message).toBe('El código no es un QR de puerta de Shiftlane.');
    const otherPlant = await fx.clientOrgWithPlant({ tenantId });
    const otherCode = `OTRA${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    await app.db.system.plantGate.create({
      data: {
        clientOrgId: otherPlant.org.id,
        plantId: otherPlant.plant.id,
        name: 'Puerta ajena',
        qrCode: otherCode,
      },
    });
    const foreign = await post(`${base}/gate`, driver.auth, { code: otherCode }).expect(409);
    expect(foreign.body.error.message).toBe('Este QR es de otra planta.');
  });

  it('el despacho resuelve incidentes', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id });
    const incident = await post(`/driver/trips/${trip.id}/incidents`, driver.auth, {
      type: 'mechanical',
      description: 'Se calienta el motor',
    }).expect(201);
    const open = await request(app.server)
      .get('/incidents')
      .query({ status: 'open' })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(open.body.map((i: { id: string }) => i.id)).toContain(incident.body.id);
    const resolved = await request(app.server)
      .post(`/incidents/${incident.body.id as string}/resolve`)
      .set('authorization', ownerAuth)
      .send({ resolution: 'Se envió unidad de respaldo' })
      .expect(200);
    expect(resolved.body).toMatchObject({
      status: 'resolved',
      resolution: 'Se envió unidad de respaldo',
    });
    await request(app.server)
      .post(`/incidents/${incident.body.id as string}/resolve`)
      .set('authorization', ownerAuth)
      .send({ resolution: 'Otra vez' })
      .expect(409);
  });

  it('el historial del viaje no se puede modificar', async () => {
    const driver = await newDriver();
    const trip = await newTrip({ driverId: driver.id });
    await post('/driver/panic', driver.auth, { tripId: trip.id }).expect(201);
    await expect(
      app.db.system.tripEvent.updateMany({ where: { tripId: trip.id }, data: { lat: 1 } }),
    ).rejects.toThrow();
    await expect(
      app.db.system.tripEvent.deleteMany({ where: { tripId: trip.id } }),
    ).rejects.toThrow();
  });

  it('lista para escanear sin señal: planta, ruta, huellas y ya escaneados', async () => {
    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
    const driver = await newDriver();
    const vehicle = await newVehicle(10);
    const trip = await newTrip({ driverId: driver.id, vehicleId: vehicle.id });
    const base = `/driver/trips/${trip.id}`;
    const inactive = await fx.passenger({ clientOrgId, plantId });
    await app.db.system.passenger.update({
      where: { id: inactive.id },
      data: { status: 'inactive' },
    });
    await app.db.system.passengerCredential.create({
      data: {
        clientOrgId,
        passengerId: assigned.id,
        kind: 'badge_qr',
        value: 'VIEJO-001',
        revokedAt: new Date(),
      },
    });
    await post(`${base}/checklist`, driver.auth, { items: ALL_OK }).expect(200);
    await post(`${base}/start`, driver.auth).expect(200);
    await post(`${base}/scan`, driver.auth, { employeeNumber: assigned.employeeNumber }).expect(
      200,
    );

    const manifest = await request(app.server)
      .get(`${base}/manifest`)
      .set('authorization', driver.auth)
      .expect(200);
    type Entry = { id: string; onRoute: boolean; credentialHashes: string[] };
    const byId = new Map(
      (manifest.body.passengers as Entry[]).map((passenger) => [passenger.id, passenger]),
    );
    expect(byId.get(assigned.id)).toMatchObject({
      name: 'Ana T.',
      employeeNumber: assigned.employeeNumber,
      onRoute: true,
    });
    expect(byId.get(assigned.id)!.credentialHashes).not.toContain(sha256('VIEJO-001'));
    expect(byId.get(stranger.id)).toMatchObject({
      onRoute: false,
      credentialHashes: [sha256('GAF-0002')],
    });
    expect(byId.has(inactive.id)).toBe(false);
    expect(manifest.body.boarded).toEqual([assigned.id]);
    // Sin teléfono ni otros datos personales.
    expect(Object.keys(byId.get(assigned.id)!).sort()).toEqual(
      ['credentialHashes', 'employeeNumber', 'id', 'name', 'onRoute'].sort(),
    );

    const other = await newDriver();
    await request(app.server).get(`${base}/manifest`).set('authorization', other.auth).expect(404);
  });

  it('la transportista configura el checklist y las fotos obligatorias', async () => {
    const custom = [
      { key: 'tires', label: 'Llantas', photoRequired: true },
      { key: 'seatbelts', label: 'Cinturones' },
    ];
    await request(app.server)
      .put('/checklist-template')
      .set('authorization', ownerAuth)
      .send({ items: custom })
      .expect(200);
    try {
      const driver = await newDriver();
      const trip = await newTrip({ driverId: driver.id });
      const base = `/driver/trips/${trip.id}`;
      const template = await request(app.server)
        .get('/driver/checklist-template')
        .set('authorization', driver.auth)
        .expect(200);
      expect(template.body).toMatchObject({
        custom: true,
        items: [
          { key: 'tires', photoRequired: true },
          { key: 'seatbelts', photoRequired: false },
        ],
      });

      const noPhoto = await post(`${base}/checklist`, driver.auth, {
        items: [
          { key: 'tires', ok: true },
          { key: 'seatbelts', ok: true },
        ],
      }).expect(400);
      expect(noPhoto.body.error.message).toBe('Falta la foto de Llantas.');
      const missing = await post(`${base}/checklist`, driver.auth, {
        items: [{ key: 'seatbelts', ok: true }],
      }).expect(400);
      expect(missing.body.error.message).toBe('Falta revisar: Llantas.');
      const extra = await post(`${base}/checklist`, driver.auth, {
        items: [...ALL_OK, { key: 'seatbelts', ok: true }],
      }).expect(400);
      expect(extra.body.error.message).toMatch(/no está en el checklist/);
      // Una foto de otro viaje no sirve.
      const otherTrip = await newTrip({ driverId: driver.id, minutesFromNow: 50 });
      const foreignPhoto = await request(app.server)
        .post(`/driver/trips/${otherTrip.id}/photos`)
        .set('authorization', driver.auth)
        .attach('file', PNG, 'otra.png')
        .expect(201);
      await post(`${base}/checklist`, driver.auth, {
        items: [
          { key: 'tires', ok: true, photoId: foreignPhoto.body.id },
          { key: 'seatbelts', ok: true },
        ],
      }).expect(400);
    } finally {
      await app.db.system.checklistTemplate.deleteMany({ where: { tenantId } });
    }
  });
});
