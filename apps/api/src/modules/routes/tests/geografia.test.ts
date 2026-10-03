import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { haversineMeters, todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import {
  createOsrmRouting,
  createResilientRouting,
  createStraightLineRouting,
} from '../../../lib/routing.ts';
import type { RoutingCache, RoutingResult } from '../../../lib/routing.ts';

const PASSWORD = 'Transporte2026';
const TODAY = todayIn('America/Ciudad_Juarez');

const PASO_DEL_NORTE = { lat: 31.747, lng: -106.487 };
const MEXICANIDAD = { lat: 31.7445, lng: -106.4605 };
const BERMUDEZ = { lat: 31.7256, lng: -106.4136 };
const AEROPUERTO = { lat: 31.6361, lng: -106.4287 };

/** Servidor que imita a OSRM: responde un trazo por los puntos pedidos. */
function fakeOsrm(behavior: { fail?: boolean; delayMs?: number } = {}) {
  let calls = 0;
  const server = createServer((req, res) => {
    calls += 1;
    const coordinates = decodeURIComponent(
      (req.url ?? '').split('/driving/')[1]?.split('?')[0] ?? '',
    )
      .split(';')
      .map((pair) => pair.split(',').map(Number) as [number, number]);
    const respond = () => {
      if (behavior.fail) {
        res.writeHead(500).end('error');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          code: 'Ok',
          routes: [{ distance: 12_345.6, duration: 1_500, geometry: { coordinates } }],
        }),
      );
    };
    setTimeout(respond, behavior.delayMs ?? 0);
  });
  return {
    async start() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    calls: () => calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function memoryCache(): RoutingCache {
  const store = new Map<string, RoutingResult>();
  return {
    get: (key) => Promise.resolve(store.get(key) ?? null),
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('distancias con PostGIS', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('PostGIS y las funciones de packages/shared coinciden en Ciudad Juárez (±0.5 %)', async () => {
    const pairs = [
      [PASO_DEL_NORTE, MEXICANIDAD],
      [MEXICANIDAD, BERMUDEZ],
      [BERMUDEZ, AEROPUERTO],
    ] as const;
    for (const [a, b] of pairs) {
      const [row] = await app.db.system.$queryRaw<{ meters: number }[]>`
        SELECT ST_Distance(
          ST_SetSRID(ST_MakePoint(${a.lng}, ${a.lat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326)::geography
        ) AS meters`;
      const shared = haversineMeters(a, b);
      expect(Math.abs(shared - row!.meters) / row!.meters).toBeLessThan(0.005);
    }
  });
});

describe('servicio de rutas por calles', () => {
  const points = [MEXICANIDAD, BERMUDEZ];

  it('consulta OSRM y guarda el resultado en caché', async () => {
    const osrm = fakeOsrm();
    const baseUrl = await osrm.start();
    try {
      const routing = createResilientRouting({
        primary: createOsrmRouting({ baseUrl, timeoutMs: 2000 }),
        fallback: createStraightLineRouting(28),
        cache: memoryCache(),
      });
      const first = await routing.route(points);
      expect(first).toMatchObject({
        source: 'osrm',
        distanceMeters: 12_345.6,
        durationSeconds: 1_500,
      });
      expect(first.geometry).toEqual([
        [-106.4605, 31.7445],
        [-106.4136, 31.7256],
      ]);
      await routing.route(points);
      expect(osrm.calls()).toBe(1);
    } finally {
      await osrm.close();
    }
  });

  it('si OSRM falla, usa línea recta y la operación sigue', async () => {
    const osrm = fakeOsrm({ fail: true });
    const baseUrl = await osrm.start();
    const errors: unknown[] = [];
    try {
      const routing = createResilientRouting({
        primary: createOsrmRouting({ baseUrl, timeoutMs: 2000 }),
        fallback: createStraightLineRouting(28),
        cache: memoryCache(),
        onError: (error) => errors.push(error),
      });
      const result = await routing.route(points);
      expect(result.source).toBe('straight_line');
      expect(result.distanceMeters).toBeCloseTo(haversineMeters(MEXICANIDAD, BERMUDEZ), 3);
      expect(errors).toHaveLength(1);
    } finally {
      await osrm.close();
    }
  });

  it('si OSRM tarda más del límite, usa línea recta', async () => {
    const osrm = fakeOsrm({ delayMs: 1_000 });
    const baseUrl = await osrm.start();
    try {
      const routing = createResilientRouting({
        primary: createOsrmRouting({ baseUrl, timeoutMs: 100 }),
        fallback: createStraightLineRouting(28),
      });
      expect((await routing.route(points)).source).toBe('straight_line');
    } finally {
      await osrm.close();
    }
  });
});

describe('rutas con trazo por calles, parada más cercana y desvíos', () => {
  let app: App;
  let osrm: ReturnType<typeof fakeOsrm>;
  let ownerAuth: string;
  let plantId: string;

  beforeAll(async () => {
    osrm = fakeOsrm();
    const baseUrl = await osrm.start();
    app = await buildTestApp({ routing: createOsrmRouting({ baseUrl, timeoutMs: 2000 }) });
    const fx = fixtures(app.db.system);
    const tenantId = (await fx.tenant()).id;
    const owner = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
    const login = await request(app.server)
      .post('/auth/login')
      .send({ email: owner.email, password: PASSWORD });
    ownerAuth = `Bearer ${login.body.accessToken as string}`;
    const { plant } = await fx.clientOrgWithPlant({ tenantId });
    plantId = plant.id;
    await app.db.system.$executeRaw`
      UPDATE plants SET location = ST_SetSRID(ST_MakePoint(${BERMUDEZ.lng}, ${BERMUDEZ.lat}), 4326)::geography
      WHERE id = ${plantId}::uuid`;
  });

  afterAll(async () => {
    await app.close();
    await osrm.close();
  });

  async function createRoute(path?: [number, number][]) {
    const response = await request(app.server)
      .post('/routes')
      .set('authorization', ownerAuth)
      .send({
        plantId,
        code: `G-${Math.random().toString(36).slice(2, 7)}`,
        name: 'Ruta Centro – Bermúdez',
        direction: 'inbound',
        version: {
          validFrom: TODAY,
          stops: [
            {
              name: 'Plaza de la Mexicanidad',
              location: MEXICANIDAD,
              radiusMeters: 100,
              times: [{ time: '05:00' }],
            },
            {
              name: 'Av. Tecnológico',
              location: { lat: 31.7166, lng: -106.4233 },
              times: [{ time: '05:15' }],
            },
          ],
          ...(path ? { path } : {}),
        },
      })
      .expect(201);
    return response.body as {
      id: string;
      current: { id: string; distanceKm: number; durationMinutes: number; routingSource: string };
    };
  }

  it('calcula el trazo por calles hasta la planta con OSRM', async () => {
    const route = await createRoute();
    expect(route.current).toMatchObject({
      routingSource: 'osrm',
      distanceKm: 12.35,
      durationMinutes: 25,
    });
    const detail = await request(app.server)
      .get(`/routes/${route.id}/versions/${route.current.id}`)
      .set('authorization', ownerAuth);
    // Entrada: termina en la planta.
    expect(detail.body.path.at(-1)).toEqual([BERMUDEZ.lng, BERMUDEZ.lat]);
  });

  it('respeta el trazo dibujado a mano y estima el tiempo', async () => {
    const route = await createRoute([
      [MEXICANIDAD.lng, MEXICANIDAD.lat],
      [-106.4233, 31.7166],
      [BERMUDEZ.lng, BERMUDEZ.lat],
    ]);
    expect(route.current.routingSource).toBe('manual');
    expect(route.current.distanceKm).toBeGreaterThan(5);
    expect(route.current.durationMinutes).toBeGreaterThan(5);
  });

  it('asigna la parada más cercana dentro del radio', async () => {
    const route = await createRoute();
    const near = await request(app.server)
      .get(`/route-versions/${route.current.id}/nearest-stop`)
      .query({ lat: 31.7449, lng: -106.4605 })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(near.body.stop).toMatchObject({ name: 'Plaza de la Mexicanidad', sequence: 1 });
    expect(near.body.distanceMeters).toBeGreaterThan(40);
    expect(near.body.distanceMeters).toBeLessThan(50);

    const tight = await request(app.server)
      .get(`/route-versions/${route.current.id}/nearest-stop`)
      .query({ lat: 31.7449, lng: -106.4605, maxMeters: 30 })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(tight.body.stop).toBeNull();

    const far = await request(app.server)
      .get(`/route-versions/${route.current.id}/nearest-stop`)
      .query({ lat: AEROPUERTO.lat, lng: AEROPUERTO.lng })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(far.body.stop).toBeNull();
  });

  it('detecta desvíos por distancia al trazado', async () => {
    const route = await createRoute([
      [-106.4233, 31.7166],
      [-106.4239, 31.6952],
      [-106.4249, 31.6773],
    ]);
    const onRoute = await request(app.server)
      .get(`/route-versions/${route.current.id}/distance-to-path`)
      .query({ lat: 31.705, lng: -106.4236 })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(onRoute.body).toMatchObject({ offRoute: false, thresholdMeters: 150 });
    expect(onRoute.body.distanceMeters).toBeLessThan(10);

    const offRoute = await request(app.server)
      .get(`/route-versions/${route.current.id}/distance-to-path`)
      .query({ lat: 31.705, lng: -106.4183 })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(offRoute.body.offRoute).toBe(true);
    expect(offRoute.body.distanceMeters).toBeGreaterThan(450);
  });

  it('vista previa del editor', async () => {
    const preview = await request(app.server)
      .post('/routing/preview')
      .set('authorization', ownerAuth)
      .send({ points: [MEXICANIDAD, BERMUDEZ] })
      .expect(200);
    expect(preview.body).toMatchObject({ source: 'osrm', distanceKm: 12.35, durationMinutes: 25 });
  });
});
