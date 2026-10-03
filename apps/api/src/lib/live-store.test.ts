import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createMemoryLiveStore,
  createRedisLiveStore,
  createResilientLiveStore,
} from './live-store.ts';
import type { LivePosition, LiveStore } from './live-store.ts';

function position(tenantId: string, overrides: Partial<LivePosition> = {}): LivePosition {
  return {
    tripId: randomUUID(),
    tenantId,
    plantId: randomUUID(),
    routeId: null,
    driverId: randomUUID(),
    vehicleId: null,
    lat: 31.7,
    lng: -106.4,
    speedKmh: 40,
    heading: 90,
    recordedAt: new Date().toISOString(),
    eta: null,
    ...overrides,
  };
}

function contract(name: string, create: () => LiveStore) {
  describe(name, () => {
    const store = create();
    afterAll(async () => store.close());

    it('guarda y lee la última posición de un viaje', async () => {
      const tenant = randomUUID();
      const first = position(tenant);
      await store.setTripPosition(first);
      await store.setTripPosition({ ...first, lat: 31.71 });
      expect(await store.getTripPosition(first.tripId)).toMatchObject({ lat: 31.71 });
      expect(await store.getTripPosition(randomUUID())).toBeNull();
    });

    it('lista solo las posiciones de la empresa', async () => {
      const norte = randomUUID();
      const juarez = randomUUID();
      const a = position(norte);
      const b = position(norte);
      const c = position(juarez);
      for (const p of [a, b, c]) await store.setTripPosition(p);
      const listed = await store.listTenantPositions(norte);
      expect(listed.map((p) => p.tripId).sort()).toEqual([a.tripId, b.tripId].sort());
      expect((await store.listTenantPositions(juarez)).map((p) => p.tripId)).toEqual([c.tripId]);
    });

    it('al terminar el viaje deja de mostrarse', async () => {
      const tenant = randomUUID();
      const p = position(tenant);
      await store.setTripPosition(p);
      await store.removeTrip(tenant, p.tripId);
      expect(await store.getTripPosition(p.tripId)).toBeNull();
      expect(await store.listTenantPositions(tenant)).toEqual([]);
    });
  });
}

contract('posiciones en vivo en memoria', () => createMemoryLiveStore(60));

// Redis real: en CI con un contenedor; en local, con REDIS_TEST_URL (pnpm services:up).
const redisUrl = process.env.REDIS_TEST_URL;
if (redisUrl) contract('posiciones en vivo en Redis', () => createRedisLiveStore(redisUrl, 60));
describe.skipIf(Boolean(redisUrl))('posiciones en vivo en Redis', () => {
  it.skip('requiere REDIS_TEST_URL', () => undefined);
});

describe('caché que falla', () => {
  it('nunca detiene la operación: registra el error y sigue', async () => {
    const broken: LiveStore = {
      setTripPosition: () => Promise.reject(new Error('sin conexión')),
      getTripPosition: () => Promise.reject(new Error('sin conexión')),
      listTenantPositions: () => Promise.reject(new Error('sin conexión')),
      removeTrip: () => Promise.reject(new Error('sin conexión')),
      close: () => Promise.reject(new Error('sin conexión')),
    };
    const warnings: unknown[] = [];
    const log = {
      warn: (...args: unknown[]) => warnings.push(args),
    } as unknown as FastifyBaseLogger;
    const store = createResilientLiveStore(broken, log);
    await expect(store.setTripPosition(position(randomUUID()))).resolves.toBeUndefined();
    await expect(store.getTripPosition(randomUUID())).resolves.toBeNull();
    await expect(store.listTenantPositions(randomUUID())).resolves.toEqual([]);
    await expect(store.removeTrip(randomUUID(), randomUUID())).resolves.toBeUndefined();
    expect(warnings).toHaveLength(4);
  });
});
