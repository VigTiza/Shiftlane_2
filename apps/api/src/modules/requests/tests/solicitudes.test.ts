import { addDays, todayIn, zonedDateTime } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';
const TZ = 'America/Ciudad_Juarez';
const TODAY = todayIn(TZ);
const DAY = addDays(TODAY, 3);

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
let carrierAuth: string;
let plantAuth: string;
let plantId: string;
let clientOrgId: string;
let routeId: string;
let routeMinutes: number;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

async function newDriver() {
  return app.db.system.driver.create({
    data: {
      tenantId,
      fullName: `Chofer ${Math.random().toString(36).slice(2, 7)}`,
      documents: { create: [{ type: 'license', expiresOn: null }] },
    },
  });
}

async function newVehicle() {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return app.db.system.vehicle.create({
    data: {
      tenantId,
      economicNumber: `X-${suffix}`,
      plates: `PL-${suffix}`,
      model: 'Hiace',
      year: 2024,
      capacity: 15,
    },
  });
}

function extraRequest(body: Record<string, unknown> = {}) {
  return request(app.server)
    .post('/client-requests')
    .set('authorization', plantAuth)
    .send({
      plantId,
      type: 'extra_trip',
      serviceDate: DAY,
      direction: 'inbound',
      plantTime: '14:00',
      passengers: 12,
      extraReason: 'overtime',
      ...body,
    });
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant('Transportes Solicitudes')).id;
  carrierAuth = await tokenFor(
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
    .set('authorization', carrierAuth)
    .send({
      plantId,
      code: 'EXT-01',
      name: 'Ruta base',
      direction: 'inbound',
      version: { validFrom: TODAY, stops: STOPS },
    })
    .expect(201);
  routeId = route.body.id as string;
  routeMinutes = route.body.current.durationMinutes as number;
});

afterAll(async () => {
  await app.close();
});

describe('solicitud de viaje extra de la planta', () => {
  it('la planta ve a su transportista, pide el viaje y la transportista lo aprueba', async () => {
    const carriers = await request(app.server)
      .get('/plant/carriers')
      .set('authorization', plantAuth)
      .expect(200);
    expect(carriers.body).toEqual([
      {
        id: tenantId,
        name: 'Transportes Solicitudes',
        plants: [expect.objectContaining({ id: plantId })],
      },
    ]);

    const created = await extraRequest({
      routeId,
      description: 'Línea 3 se queda a inventario',
    }).expect(201);
    expect(created.body).toMatchObject({
      status: 'pending',
      title: `Viaje extra · ${DAY}`,
      carrier: { id: tenantId },
      route: { id: routeId, code: 'EXT-01' },
      trips: [],
    });
    const requestId = created.body.id as string;

    const inbox = await request(app.server)
      .get('/client-requests')
      .query({ status: 'pending' })
      .set('authorization', carrierAuth)
      .expect(200);
    expect(inbox.body.items.map((r: { id: string }) => r.id)).toContain(requestId);

    const driver = await newDriver();
    const vehicle = await newVehicle();
    const approved = await request(app.server)
      .post(`/client-requests/${requestId}/approve`)
      .set('authorization', carrierAuth)
      .send({ response: 'Listo, va la unidad X', driverId: driver.id, vehicleId: vehicle.id })
      .expect(200);
    expect(approved.body.request).toMatchObject({
      status: 'approved',
      response: 'Listo, va la unidad X',
    });
    expect(approved.body.conflicts).toEqual([]);
    const [trip] = approved.body.request.trips as {
      id: string;
      scheduledStartAt: string;
      scheduledEndAt: string;
    }[];
    // Llega a planta a las 14:00 y sale con el tiempo de recorrido de la ruta.
    const arrival = zonedDateTime(DAY, '14:00', TZ);
    expect(new Date(trip!.scheduledEndAt).toISOString()).toBe(arrival.toISOString());
    expect(new Date(trip!.scheduledStartAt).getTime()).toBe(
      arrival.getTime() - routeMinutes * 60_000,
    );

    // La planta ve el viaje generado en su tablero.
    const plantTrips = await request(app.server)
      .get('/trips')
      .query({ from: DAY, to: DAY, kind: 'extra' })
      .set('authorization', plantAuth)
      .expect(200);
    expect(plantTrips.body.items).toEqual([
      expect.objectContaining({
        id: trip!.id,
        kind: 'extra',
        routeId,
        extraReason: 'overtime',
        requestedPassengers: 12,
        clientRequestId: requestId,
      }),
    ]);
    const carrierTrip = await request(app.server)
      .get('/trips')
      .query({ from: DAY, to: DAY, kind: 'extra' })
      .set('authorization', carrierAuth)
      .expect(200);
    expect(carrierTrip.body.items[0]).toMatchObject({
      driverId: driver.id,
      vehicleId: vehicle.id,
      assignmentSource: 'manual',
      notes: `Viaje extra · ${DAY}. Línea 3 se queda a inventario`,
    });

    await request(app.server)
      .post(`/client-requests/${requestId}/approve`)
      .set('authorization', carrierAuth)
      .send({})
      .expect(409);
    await request(app.server)
      .post(`/client-requests/${requestId}/cancel`)
      .set('authorization', plantAuth)
      .expect(409);
  });

  it('valida los datos del viaje extra', async () => {
    const missing = await request(app.server)
      .post('/client-requests')
      .set('authorization', plantAuth)
      .send({ plantId, type: 'extra_trip' })
      .expect(400);
    const messages = (missing.body.error.details as { message: string }[]).map((d) => d.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Indica la fecha del viaje extra.',
        'Indica el sentido del viaje extra.',
        'Indica la hora en planta del viaje extra.',
        'Indica cuántos pasajeros viajarán.',
      ]),
    );
    await extraRequest({ serviceDate: addDays(TODAY, -1) }).expect(400);
    const other = await fx.clientOrgWithPlant({ tenantId });
    await extraRequest({ plantId: other.plant.id }).expect(400);
  });

  it('sin ruta ni horario el viaje dura 60 minutos; con horario se respeta', async () => {
    const outbound = await extraRequest({ direction: 'outbound', plantTime: '22:00' }).expect(201);
    const approved = await request(app.server)
      .post(`/client-requests/${outbound.body.id as string}/approve`)
      .set('authorization', carrierAuth)
      .send({})
      .expect(200);
    const trip = approved.body.request.trips[0];
    expect(new Date(trip.scheduledStartAt).toISOString()).toBe(
      zonedDateTime(DAY, '22:00', TZ).toISOString(),
    );
    expect(new Date(trip.scheduledEndAt).toISOString()).toBe(
      zonedDateTime(DAY, '23:00', TZ).toISOString(),
    );

    const explicit = await extraRequest().expect(201);
    const withTimes = await request(app.server)
      .post(`/client-requests/${explicit.body.id as string}/approve`)
      .set('authorization', carrierAuth)
      .send({ startTime: '12:40', endTime: '13:50' })
      .expect(200);
    expect(new Date(withTimes.body.request.trips[0].scheduledStartAt).toISOString()).toBe(
      zonedDateTime(DAY, '12:40', TZ).toISOString(),
    );
    await request(app.server)
      .post(`/client-requests/${explicit.body.id as string}/approve`)
      .set('authorization', carrierAuth)
      .send({ startTime: '12:40' })
      .expect(400);
  });

  it('si la asignación tiene conflictos no aprueba nada, salvo que se confirme', async () => {
    const driver = await newDriver();
    const first = await extraRequest().expect(201);
    await request(app.server)
      .post(`/client-requests/${first.body.id as string}/approve`)
      .set('authorization', carrierAuth)
      .send({ driverId: driver.id, vehicleId: (await newVehicle()).id })
      .expect(200);

    const second = await extraRequest().expect(201);
    const vehicle = await newVehicle();
    const blocked = await request(app.server)
      .post(`/client-requests/${second.body.id as string}/approve`)
      .set('authorization', carrierAuth)
      .send({ driverId: driver.id, vehicleId: vehicle.id })
      .expect(409);
    expect(blocked.body.error.details[0].path).toBe('driver_double_booked');
    const stillPending = await request(app.server)
      .get(`/client-requests/${second.body.id as string}`)
      .set('authorization', plantAuth)
      .expect(200);
    expect(stillPending.body).toMatchObject({ status: 'pending', trips: [] });

    const forced = await request(app.server)
      .post(`/client-requests/${second.body.id as string}/approve`)
      .set('authorization', carrierAuth)
      .send({ driverId: driver.id, vehicleId: vehicle.id, force: true })
      .expect(200);
    expect(forced.body.request.status).toBe('approved');
    expect(forced.body.conflicts[0].type).toBe('driver_double_booked');
  });
});

describe('otras solicitudes, rechazo y cancelación', () => {
  it('la transportista rechaza con una respuesta que la planta ve', async () => {
    const created = await request(app.server)
      .post('/client-requests')
      .set('authorization', plantAuth)
      .send({
        plantId,
        type: 'schedule_change',
        title: 'Mover la entrada del turno A a las 6:30',
        description: 'A partir del lunes',
      })
      .expect(201);
    const id = created.body.id as string;
    await request(app.server)
      .post(`/client-requests/${id}/reject`)
      .set('authorization', carrierAuth)
      .send({})
      .expect(400);
    await request(app.server)
      .post(`/client-requests/${id}/reject`)
      .set('authorization', carrierAuth)
      .send({ response: 'El contrato no incluye cambios de horario sin aviso de una semana.' })
      .expect(200);
    const seen = await request(app.server)
      .get(`/client-requests/${id}`)
      .set('authorization', plantAuth)
      .expect(200);
    expect(seen.body).toMatchObject({
      status: 'rejected',
      response: 'El contrato no incluye cambios de horario sin aviso de una semana.',
    });
  });

  it('aprobar un cambio de horario solo registra la respuesta', async () => {
    const created = await request(app.server)
      .post('/client-requests')
      .set('authorization', plantAuth)
      .send({ plantId, type: 'route_change', title: 'Agregar parada en Av. de las Torres' })
      .expect(201);
    const approved = await request(app.server)
      .post(`/client-requests/${created.body.id as string}/approve`)
      .set('authorization', carrierAuth)
      .send({ response: 'Se agrega desde el lunes.' })
      .expect(200);
    expect(approved.body.request).toMatchObject({ status: 'approved', trips: [] });
  });

  it('la planta cancela una solicitud pendiente', async () => {
    const created = await extraRequest().expect(201);
    const cancelled = await request(app.server)
      .post(`/client-requests/${created.body.id as string}/cancel`)
      .set('authorization', plantAuth)
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    await request(app.server)
      .post(`/client-requests/${created.body.id as string}/approve`)
      .set('authorization', carrierAuth)
      .send({})
      .expect(409);
  });

  it('cada quien ve solo lo suyo y respeta los permisos', async () => {
    const created = await extraRequest().expect(201);
    const id = created.body.id as string;
    // La planta no aprueba y la transportista no crea solicitudes.
    await request(app.server)
      .post(`/client-requests/${id}/approve`)
      .set('authorization', plantAuth)
      .send({})
      .expect(403);
    await request(app.server)
      .post('/client-requests')
      .set('authorization', carrierAuth)
      .send({ plantId, type: 'other', title: 'Prueba' })
      .expect(403);

    // Otra transportista no ve ni responde la solicitud.
    const rival = (await fx.tenant()).id;
    const rivalAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: rival, password: PASSWORD, roles: ['owner'] })).email,
    );
    await request(app.server)
      .get(`/client-requests/${id}`)
      .set('authorization', rivalAuth)
      .expect(404);
    await request(app.server)
      .post(`/client-requests/${id}/approve`)
      .set('authorization', rivalAuth)
      .send({})
      .expect(404);

    // Otra planta tampoco.
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
    const strangerList = await request(app.server)
      .get('/client-requests')
      .set('authorization', strangerAuth)
      .expect(200);
    expect(strangerList.body.total).toBe(0);
  });

  it('con varias transportistas la planta indica a cuál va dirigida', async () => {
    const second = await fx.tenant();
    await app.db.system.serviceAgreement.create({
      data: { tenantId: second.id, plantId, clientOrgId },
    });
    const ambiguous = await extraRequest().expect(400);
    expect(ambiguous.body.error.message).toMatch(/varias transportistas/);
    const directed = await extraRequest({ carrierId: second.id }).expect(201);
    expect(directed.body.carrier.id).toBe(second.id);
    await extraRequest({ carrierId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    // La ruta debe ser de la transportista elegida.
    await extraRequest({ carrierId: second.id, routeId }).expect(400);
    await app.db.system.serviceAgreement.deleteMany({ where: { tenantId: second.id } });
  });
});

describe('viajes extra manuales y cancelación', () => {
  it('la transportista crea un viaje extra que cruza la medianoche y lo cancela', async () => {
    const created = await request(app.server)
      .post('/trips/extra')
      .set('authorization', carrierAuth)
      .send({
        plantId,
        direction: 'outbound',
        serviceDate: DAY,
        startTime: '23:30',
        endTime: '00:20',
        reason: 'event',
        passengers: 30,
        notes: 'Posada de fin de año',
      })
      .expect(201);
    expect(created.body.trip).toMatchObject({
      kind: 'extra',
      routeId: null,
      extraReason: 'event',
      requestedPassengers: 30,
      scheduledStartAt: zonedDateTime(DAY, '23:30', TZ).toISOString(),
      scheduledEndAt: zonedDateTime(addDays(DAY, 1), '00:20', TZ).toISOString(),
    });
    expect(created.body.conflicts).toEqual([]);

    const cancelled = await request(app.server)
      .post(`/trips/${created.body.trip.id as string}/cancel`)
      .set('authorization', carrierAuth)
      .send({ reason: 'Se pospuso el evento' })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Se pospuso el evento',
    });
    await request(app.server)
      .post(`/trips/${created.body.trip.id as string}/cancel`)
      .set('authorization', carrierAuth)
      .send({ reason: 'Otra vez' })
      .expect(409);
  });

  it('valida fecha, planta y ruta del viaje extra', async () => {
    const base = {
      plantId,
      direction: 'inbound',
      serviceDate: DAY,
      startTime: '10:00',
      endTime: '11:00',
      reason: 'overtime',
    };
    await request(app.server)
      .post('/trips/extra')
      .set('authorization', carrierAuth)
      .send({ ...base, serviceDate: addDays(TODAY, -2) })
      .expect(400);
    const foreign = await fx.clientOrgWithPlant({ tenantId: (await fx.tenant()).id });
    await request(app.server)
      .post('/trips/extra')
      .set('authorization', carrierAuth)
      .send({ ...base, plantId: foreign.plant.id })
      .expect(400);
    const otherPlant = await fx.clientOrgWithPlant({ tenantId });
    await request(app.server)
      .post('/trips/extra')
      .set('authorization', carrierAuth)
      .send({ ...base, plantId: otherPlant.plant.id, routeId })
      .expect(400);
  });

  it('un viaje extra entra en la revisión de conflictos', async () => {
    const driver = await newDriver();
    await request(app.server)
      .post('/trips/extra')
      .set('authorization', carrierAuth)
      .send({
        plantId,
        direction: 'inbound',
        serviceDate: DAY,
        startTime: '16:00',
        endTime: '17:00',
        reason: 'overtime',
        driverId: driver.id,
        vehicleId: (await newVehicle()).id,
      })
      .expect(201);
    const blocked = await request(app.server)
      .post('/trips/extra')
      .set('authorization', carrierAuth)
      .send({
        plantId,
        direction: 'outbound',
        serviceDate: DAY,
        startTime: '16:30',
        endTime: '17:30',
        reason: 'overtime',
        driverId: driver.id,
        vehicleId: (await newVehicle()).id,
      })
      .expect(409);
    expect(blocked.body.error.details[0].message).toMatch(/viaje extra, 16:00 a 17:00/);
  });
});
