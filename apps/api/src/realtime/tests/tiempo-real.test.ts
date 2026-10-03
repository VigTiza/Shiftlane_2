import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { todayIn } from '@shiftlane/shared';
import { decodeJwt, SignJWT } from 'jose';
import { io as connectClient } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, TEST_SECRETS } from '../../../test/helpers/app.ts';
import { fixtures } from '../../../test/helpers/fixtures.ts';
import type { App } from '../../app.ts';
import { withDbContext } from '../../lib/db.ts';
import { REALTIME_PATH } from '../server.ts';

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

interface Client {
  socket: Socket;
  received: { name: string; data: Record<string, unknown> }[];
}

let app: App;
let url: string;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let plantId: string;
let clientOrgId: string;
let routeA: string;
let routeB: string;
let passengerA: { id: string; employeeNumber: string };
const tokens: Record<string, string> = {};
const drivers: Record<string, string> = {};
const clients: Client[] = [];

async function login(email: string) {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return response.body.accessToken as string;
}

async function driverToken(forTenantId: string) {
  const driver = await app.db.system.driver.create({
    data: { tenantId: forTenantId, fullName: `Chofer ${Math.random().toString(36).slice(2, 7)}` },
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
  return { id: driver.id, token };
}

function passengerToken(passengerId: string) {
  return app.tokens.signAccess({
    kind: 'passenger',
    sub: passengerId,
    sid: randomUUID(),
    clientOrgId,
    plantId,
  });
}

function connect(token: string, target = url): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connectClient(target, {
      path: REALTIME_PATH,
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    const client: Client = { socket, received: [] };
    socket.onAny((name: string, data: Record<string, unknown>) => {
      if (name !== 'ready') client.received.push({ name, data });
    });
    socket.once('ready', () => {
      clients.push(client);
      resolve(client);
    });
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

async function waitFor(
  client: Client,
  name: string,
  match: (data: Record<string, unknown>) => boolean = () => true,
) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const found = client.received.find((e) => e.name === name && match(e.data));
    if (found) return found.data;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No llegó el evento ${name}`);
}

/** Espera un momento para comprobar que algo NO llegó. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

function about(tripId: string) {
  return (data: Record<string, unknown>) => data.tripId === tripId;
}

async function newTrip(driverId: string, status: 'scheduled' | 'in_progress' = 'scheduled') {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const vehicle = await app.db.system.vehicle.create({
    data: {
      tenantId,
      economicNumber: `R-${suffix}`,
      plates: `PR-${suffix}`,
      model: 'Sprinter',
      year: 2024,
      capacity: 19,
    },
  });
  const start = new Date(Date.now() + 30 * MINUTE);
  return app.db.system.trip.create({
    data: {
      tenantId,
      plantId,
      routeId: routeA,
      kind: 'extra',
      extraReason: 'other',
      direction: 'inbound',
      status,
      serviceDate: new Date(`${TODAY}T00:00:00Z`),
      scheduledStartAt: start,
      scheduledEndAt: new Date(start.getTime() + 60 * MINUTE),
      actualStartAt: status === 'in_progress' ? new Date() : null,
      driverId,
      vehicleId: vehicle.id,
      assignmentSource: 'manual',
    },
  });
}

beforeAll(async () => {
  app = await buildTestApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  fx = fixtures(app.db.system);

  tenantId = (await fx.tenant('Transportes del Norte')).id;
  const rival = (await fx.tenant('Rutas Rivales')).id;
  tokens.ownerA = await login(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
  );
  tokens.maintenance = await login(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['maintenance'] })).email,
  );
  tokens.ownerB = await login(
    (await fx.carrierUser({ tenantId: rival, password: PASSWORD, roles: ['owner'] })).email,
  );

  const plant = await fx.clientOrgWithPlant({ tenantId });
  plantId = plant.plant.id;
  clientOrgId = plant.org.id;
  // La rival también atiende la misma planta: aun así no ve los viajes de la otra.
  await app.db.system.serviceAgreement.create({ data: { tenantId: rival, plantId, clientOrgId } });
  tokens.plantA = await login(
    (await fx.plantUser({ clientOrgId, password: PASSWORD, roles: ['plant_hr'] })).email,
  );
  const otherPlant = await fx.clientOrgWithPlant({ tenantId: rival });
  tokens.plantB = await login(
    (
      await fx.plantUser({
        clientOrgId: otherPlant.org.id,
        password: PASSWORD,
        roles: ['plant_hr'],
      })
    ).email,
  );

  const ids: string[] = [];
  for (const code of ['RT-A', 'RT-B']) {
    const created = await request(app.server)
      .post('/routes')
      .set('authorization', `Bearer ${tokens.ownerA}`)
      .send({
        plantId,
        code,
        name: `Ruta ${code}`,
        direction: 'inbound',
        version: { validFrom: TODAY, stops: STOPS },
      })
      .expect(201);
    ids.push(created.body.id as string);
  }
  [routeA, routeB] = ids as [string, string];
  const a = await fx.passenger({ clientOrgId, plantId });
  const b = await fx.passenger({ clientOrgId, plantId });
  for (const [passenger, route] of [
    [a, routeA],
    [b, routeB],
  ] as const) {
    await app.db.system.routePassenger.create({
      data: { tenantId, routeId: route, passengerId: passenger.id, stopKey: randomUUID() },
    });
  }
  passengerA = { id: a.id, employeeNumber: a.employeeNumber };
  tokens.passengerA = await passengerToken(a.id);
  tokens.passengerB = await passengerToken(b.id);

  for (const [name, forTenant] of [
    ['d1', tenantId],
    ['d2', tenantId],
    ['rival', rival],
  ] as const) {
    const driver = await driverToken(forTenant);
    drivers[name] = driver.id;
    tokens[`driver_${name}`] = driver.token;
  }
});

afterAll(async () => {
  for (const client of clients) client.socket.close();
  await app.close();
});

describe('tiempo real con Socket.IO', () => {
  it('rechaza conexiones sin token válido o sin permiso', async () => {
    await expect(connect('')).rejects.toThrow('No autorizado.');
    await expect(connect('token-falso')).rejects.toThrow('No autorizado.');
    await expect(connect(tokens.maintenance!)).rejects.toThrow(
      'Sin permiso para recibir eventos en tiempo real.',
    );
  });

  it('cada evento del viaje llega solo a quien le corresponde', async () => {
    const owner = await connect(tokens.ownerA!);
    const plantUser = await connect(tokens.plantA!);
    const riderOnRoute = await connect(tokens.passengerA!);
    const riderElsewhere = await connect(tokens.passengerB!);
    const otherDriver = await connect(tokens.driver_d2!);
    const rivalOwner = await connect(tokens.ownerB!);
    const rivalPlant = await connect(tokens.plantB!);
    const rivalDriver = await connect(tokens.driver_rival!);

    const trip = await newTrip(drivers.d1!);
    const driverAuth = `Bearer ${tokens.driver_d1!}`;
    await request(app.server)
      .post(`/driver/trips/${trip.id}/checklist`)
      .set('authorization', driverAuth)
      .send({ items: ALL_OK })
      .expect(200);
    await request(app.server)
      .post(`/driver/trips/${trip.id}/start`)
      .set('authorization', driverAuth)
      .send({})
      .expect(200);
    for (const client of [owner, plantUser, riderOnRoute]) {
      expect(await waitFor(client, 'trip.status_changed', about(trip.id))).toMatchObject({
        status: 'in_progress',
        routeId: routeA,
      });
    }

    await request(app.server)
      .post('/driver/positions')
      .set('authorization', driverAuth)
      .send({
        sentAt: new Date().toISOString(),
        points: [
          { tripId: trip.id, recordedAt: new Date().toISOString(), lat: 31.73, lng: -106.44 },
        ],
      })
      .expect(200);
    for (const client of [owner, plantUser, riderOnRoute]) {
      expect(await waitFor(client, 'trip.position', about(trip.id))).toMatchObject({ lat: 31.73 });
      expect(await waitFor(client, 'trip.eta_updated', about(trip.id))).toHaveProperty('eta');
    }

    await request(app.server)
      .post(`/driver/trips/${trip.id}/scan`)
      .set('authorization', driverAuth)
      .send({ employeeNumber: passengerA.employeeNumber })
      .expect(200);
    for (const client of [owner, plantUser]) {
      expect(await waitFor(client, 'boarding.created', about(trip.id))).toMatchObject({
        result: 'ok',
        onboard: 1,
      });
    }

    await request(app.server)
      .post(`/driver/trips/${trip.id}/finish`)
      .set('authorization', driverAuth)
      .send({})
      .expect(200);
    expect(
      await waitFor(
        owner,
        'trip.status_changed',
        (d) => d.tripId === trip.id && d.status === 'completed',
      ),
    ).toBeTruthy();

    await settle();
    // Los pasajeros no ven los abordajes de otros.
    expect(riderOnRoute.received.filter((e) => e.name === 'boarding.created')).toEqual([]);
    // Nadie de otra ruta, de otro chofer ni de otra empresa recibe nada de este viaje.
    for (const outsider of [riderElsewhere, otherDriver, rivalOwner, rivalPlant, rivalDriver]) {
      expect(outsider.received.filter((e) => e.data.tripId === trip.id)).toEqual([]);
    }
    expect(rivalOwner.received).toEqual([]);
    expect(rivalPlant.received).toEqual([]);
    expect(rivalDriver.received).toEqual([]);
  });

  it('el despacho manda mensajes solo al chofer indicado', async () => {
    const driver = await connect(tokens.driver_d1!);
    const other = await connect(tokens.driver_d2!);
    const sent = await request(app.server)
      .post(`/drivers/${drivers.d1!}/messages`)
      .set('authorization', `Bearer ${tokens.ownerA!}`)
      .send({ text: 'Toma el periférico, hay choque en la Tecnológico' })
      .expect(202);
    expect(await waitFor(driver, 'message.to_driver')).toMatchObject({
      id: sent.body.id,
      text: 'Toma el periférico, hay choque en la Tecnológico',
    });
    await request(app.server)
      .post(`/drivers/${drivers.d1!}/messages`)
      .set('authorization', `Bearer ${tokens.ownerB!}`)
      .send({ text: 'Hola' })
      .expect(404);
    await settle();
    expect(other.received).toEqual([]);
    expect(driver.received.filter((e) => e.name === 'message.to_driver')).toHaveLength(1);
  });

  it('una cancelación avisa al chofer y a los pasajeros de la ruta', async () => {
    const driver = await connect(tokens.driver_d1!);
    const rider = await connect(tokens.passengerA!);
    const otherRider = await connect(tokens.passengerB!);
    const owner = await connect(tokens.ownerA!);
    const trip = await newTrip(drivers.d1!);
    await request(app.server)
      .post(`/trips/${trip.id}/cancel`)
      .set('authorization', `Bearer ${tokens.ownerA!}`)
      .send({ reason: 'La planta suspendió el turno' })
      .expect(200);
    for (const client of [driver, rider, owner]) {
      expect(await waitFor(client, 'trip.cancelled', about(trip.id))).toMatchObject({
        reason: 'La planta suspendió el turno',
        status: 'cancelled',
      });
    }
    await settle();
    expect(otherRider.received.filter((e) => e.data.tripId === trip.id)).toEqual([]);
  });

  it('un cambio de ruta avisa a sus pasajeros y a los choferes con viajes próximos', async () => {
    const trip = await newTrip(drivers.d2!);
    const driver = await connect(tokens.driver_d2!);
    const rider = await connect(tokens.passengerA!);
    const otherRider = await connect(tokens.passengerB!);
    const rivalOwner = await connect(tokens.ownerB!);
    await request(app.server)
      .post(`/routes/${routeA}/versions`)
      .set('authorization', `Bearer ${tokens.ownerA!}`)
      .send({
        validFrom: TODAY,
        stops: STOPS.map((stop) => ({ ...stop, times: [{ time: '04:50' }] })),
      })
      .expect((res) => expect([201, 409]).toContain(res.status));
    // Si hoy ya hay una versión, se crea para mañana.
    await request(app.server)
      .post(`/routes/${routeA}/versions`)
      .set('authorization', `Bearer ${tokens.ownerA!}`)
      .send({
        validFrom: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
        stops: STOPS.map((stop) => ({ ...stop, times: [{ time: '04:45' }] })),
      })
      .expect(201);
    for (const client of [driver, rider]) {
      expect(await waitFor(client, 'route.changed')).toMatchObject({
        routeId: routeA,
        code: 'RT-A',
      });
    }
    await settle();
    expect(otherRider.received.filter((e) => e.name === 'route.changed')).toEqual([]);
    expect(rivalOwner.received).toEqual([]);
    expect(trip.routeId).toBe(routeA);
  });

  it('los eventos de una transacción que falla no se envían', async () => {
    const seen: string[] = [];
    const unsubscribe = app.events.subscribe((event) => seen.push(event.type));
    try {
      await expect(
        withDbContext(app.db.app, { tenantId }, () => {
          app.events.publish({ type: 'route.changed', routeId: routeB });
          return Promise.reject(new Error('Falla a la mitad'));
        }),
      ).rejects.toThrow('Falla a la mitad');
      expect(seen).toEqual([]);
      await withDbContext(app.db.app, { tenantId }, () => {
        app.events.publish({ type: 'route.changed', routeId: routeB });
        return Promise.resolve();
      });
      expect(seen).toEqual(['route.changed']);
    } finally {
      unsubscribe();
    }

    // Una petición que responde con error tampoco avisa nada.
    const owner = await connect(tokens.ownerA!);
    const trip = await newTrip(drivers.d1!, 'in_progress');
    await request(app.server)
      .post(`/trips/${trip.id}/cancel`)
      .set('authorization', `Bearer ${tokens.ownerA!}`)
      .send({ reason: 'No debe pasar' })
      .expect(409);
    await settle();
    expect(owner.received.filter((e) => e.data.tripId === trip.id)).toEqual([]);
  });

  it('cierra la conexión cuando vence el token', async () => {
    const claims = decodeJwt(tokens.ownerA!);
    const shortLived = await new SignJWT({
      kind: claims.kind,
      sub: claims.sub,
      sid: claims.sid,
      tenantId: claims.tenantId,
      clientOrgId: claims.clientOrgId,
      roles: claims.roles,
      permissions: claims.permissions,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('shiftlane-api')
      .setAudience('access')
      .setIssuedAt()
      .setExpirationTime('2s')
      .sign(new TextEncoder().encode(TEST_SECRETS.JWT_SECRET));
    const client = await connect(shortLived);
    const disconnected = new Promise<string>((resolve) =>
      client.socket.once('disconnect', resolve),
    );
    expect(await waitFor(client, 'session.expired')).toBeUndefined();
    expect(await disconnected).toBe('io server disconnect');
  });
});

// Varias copias de la API comparten las salas por Redis (en CI con un contenedor).
const redisUrl = process.env.REDIS_TEST_URL;
describe.runIf(Boolean(redisUrl))('tiempo real con varias copias de la API (Redis)', () => {
  it('un evento publicado en una copia llega a los clientes conectados a otra', async () => {
    const first = await buildTestApp({ env: { REDIS_URL: redisUrl! } });
    const second = await buildTestApp({ env: { REDIS_URL: redisUrl! } });
    try {
      await second.listen({ port: 0, host: '127.0.0.1' });
      const secondUrl = `http://127.0.0.1:${(second.server.address() as AddressInfo).port}`;
      const driver = await connect(tokens.driver_d1!, secondUrl);
      // Da tiempo a que la suscripción de Redis quede lista.
      await settle();
      first.events.publish({
        type: 'message.to_driver',
        tenantId,
        driverId: drivers.d1!,
        message: {
          id: randomUUID(),
          text: 'Desde otra copia',
          sentAt: new Date().toISOString(),
          fromUserId: randomUUID(),
        },
      });
      expect(await waitFor(driver, 'message.to_driver')).toMatchObject({
        text: 'Desde otra copia',
      });
      driver.socket.close();
    } finally {
      await first.close();
      await second.close();
    }
  });
});
