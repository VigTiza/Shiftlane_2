import { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';

/** Última posición conocida de un viaje en curso, con sus horas estimadas de llegada. */
export interface LivePosition {
  tripId: string;
  tenantId: string;
  plantId: string;
  routeId: string | null;
  driverId: string;
  vehicleId: string | null;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  /** ISO 8601 */
  recordedAt: string;
  eta: {
    stops: { stopId: string; eta: string; distanceMeters: number }[];
    destination: { eta: string; distanceMeters: number } | null;
    delayMinutes: number | null;
  } | null;
}

/**
 * Posiciones en vivo (Redis en producción, memoria en desarrollo y pruebas). Si falla, la
 * ingesta sigue guardando el historial: la operación nunca se detiene por el caché.
 */
export interface LiveStore {
  setTripPosition: (position: LivePosition) => Promise<void>;
  getTripPosition: (tripId: string) => Promise<LivePosition | null>;
  listTenantPositions: (tenantId: string) => Promise<LivePosition[]>;
  /** Al terminar el viaje la ubicación deja de mostrarse (solo se comparte durante viajes). */
  removeTrip: (tenantId: string, tripId: string) => Promise<void>;
  close: () => Promise<void>;
}

const PREFIX = 'shiftlane:live';
const tripKey = (tripId: string) => `${PREFIX}:trip:${tripId}`;
const tenantKey = (tenantId: string) => `${PREFIX}:tenant:${tenantId}`;

export function createMemoryLiveStore(ttlSeconds: number): LiveStore {
  const trips = new Map<string, { position: LivePosition; expiresAt: number }>();
  const alive = (tripId: string) => {
    const entry = trips.get(tripId);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      trips.delete(tripId);
      return null;
    }
    return entry.position;
  };
  return {
    setTripPosition: async (position) => {
      trips.set(position.tripId, { position, expiresAt: Date.now() + ttlSeconds * 1000 });
      return Promise.resolve();
    },
    getTripPosition: async (tripId) => Promise.resolve(alive(tripId)),
    listTenantPositions: async (tenantId) =>
      Promise.resolve(
        [...trips.keys()]
          .map(alive)
          .filter((p): p is LivePosition => p !== null && p.tenantId === tenantId),
      ),
    removeTrip: async (_tenantId, tripId) => {
      trips.delete(tripId);
      return Promise.resolve();
    },
    close: async () => Promise.resolve(),
  };
}

export function createRedisLiveStore(url: string, ttlSeconds: number): LiveStore {
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });
  return {
    async setTripPosition(position) {
      await redis
        .multi()
        .set(tripKey(position.tripId), JSON.stringify(position), 'EX', ttlSeconds)
        .sadd(tenantKey(position.tenantId), position.tripId)
        .expire(tenantKey(position.tenantId), ttlSeconds * 2)
        .exec();
    },
    async getTripPosition(tripId) {
      const raw = await redis.get(tripKey(tripId));
      return raw ? (JSON.parse(raw) as LivePosition) : null;
    },
    async listTenantPositions(tenantId) {
      const ids = await redis.smembers(tenantKey(tenantId));
      if (ids.length === 0) return [];
      const values = await redis.mget(ids.map(tripKey));
      const stale = ids.filter((_, i) => values[i] === null);
      if (stale.length > 0) await redis.srem(tenantKey(tenantId), ...stale);
      return values
        .filter((v): v is string => v !== null)
        .map((v) => JSON.parse(v) as LivePosition);
    },
    async removeTrip(tenantId, tripId) {
      await redis.multi().del(tripKey(tripId)).srem(tenantKey(tenantId), tripId).exec();
    },
    async close() {
      redis.disconnect();
      return Promise.resolve();
    },
  };
}

/** Envoltura que registra los errores del caché y nunca los propaga a la operación. */
export function createResilientLiveStore(store: LiveStore, log: FastifyBaseLogger): LiveStore {
  const safe = <T>(fallback: T, fn: () => Promise<T>) =>
    fn().catch((error: unknown) => {
      log.warn({ err: error }, 'Posiciones en vivo no disponibles; se sigue sin caché');
      return fallback;
    });
  return {
    setTripPosition: (position) => safe(undefined, () => store.setTripPosition(position)),
    getTripPosition: (tripId) => safe(null, () => store.getTripPosition(tripId)),
    listTenantPositions: (tenantId) => safe([], () => store.listTenantPositions(tenantId)),
    removeTrip: (tenantId, tripId) => safe(undefined, () => store.removeTrip(tenantId, tripId)),
    close: () => safe(undefined, () => store.close()),
  };
}
