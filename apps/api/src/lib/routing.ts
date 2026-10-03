import { createHash } from 'node:crypto';

import { estimateMinutes, pathLengthMeters } from '@shiftlane/shared';
import type { LatLng } from '@shiftlane/shared';

import type { DbClient } from './db.ts';

export type RoutingSource = 'osrm' | 'straight_line';

export interface RoutingResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Trazo [lng, lat] (orden GeoJSON). */
  geometry: [number, number][];
  source: RoutingSource;
}

/** Calcula distancia, tiempo y trazo por calles entre puntos en orden. */
export interface RoutingProvider {
  route: (points: readonly LatLng[]) => Promise<RoutingResult>;
}

/** Respaldo: línea recta entre los puntos a velocidad urbana promedio. */
export function createStraightLineRouting(averageSpeedKmh: number): RoutingProvider {
  return {
    route(points) {
      const distanceMeters = pathLengthMeters(points);
      return Promise.resolve({
        distanceMeters,
        durationSeconds: estimateMinutes(distanceMeters, averageSpeedKmh) * 60,
        geometry: points.map((p) => [p.lng, p.lat] as [number, number]),
        source: 'straight_line',
      });
    },
  };
}

interface OsrmResponse {
  code: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
}

/** Servidor OSRM (propio o compatible). Falla con error si no responde a tiempo. */
export function createOsrmRouting(options: {
  baseUrl: string;
  timeoutMs: number;
}): RoutingProvider {
  const base = options.baseUrl.replace(/\/$/, '');
  return {
    async route(points) {
      const coordinates = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
      const url = `${base}/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
      const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) });
      if (!response.ok) throw new Error(`OSRM respondió ${response.status}`);
      const body = (await response.json()) as OsrmResponse;
      const best = body.routes?.[0];
      if (body.code !== 'Ok' || !best) throw new Error(`OSRM no encontró ruta (${body.code})`);
      return {
        distanceMeters: best.distance,
        durationSeconds: best.duration,
        geometry: best.geometry.coordinates,
        source: 'osrm',
      };
    },
  };
}

export interface RoutingCache {
  get: (key: string) => Promise<RoutingResult | null>;
  set: (key: string, value: RoutingResult) => Promise<void>;
}

/** Caché en PostgreSQL (tabla routing_cache, solo db.system). */
export function createDbRoutingCache(db: DbClient, ttlDays = 30): RoutingCache {
  return {
    async get(key) {
      const row = await db.routingCache.findUnique({ where: { key } });
      if (!row || row.createdAt.getTime() < Date.now() - ttlDays * 86_400_000) return null;
      return row.result as unknown as RoutingResult;
    },
    async set(key, value) {
      const result = value as unknown as object;
      await db.routingCache.upsert({
        where: { key },
        update: { result, createdAt: new Date() },
        create: { key, result },
      });
    },
  };
}

/** Llave de caché: puntos redondeados a ~1 m. */
export function routingCacheKey(points: readonly LatLng[]): string {
  const normalized = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Proveedor principal con caché y respaldo: si el servicio falla o tarda, se usa la línea
 * recta y la operación sigue (el resultado de respaldo no se guarda en caché).
 */
export function createResilientRouting(options: {
  primary: RoutingProvider;
  fallback: RoutingProvider;
  cache?: RoutingCache;
  onError?: (error: unknown) => void;
}): RoutingProvider {
  return {
    async route(points) {
      if (points.length < 2) return options.fallback.route(points);
      const key = routingCacheKey(points);
      const cached = await options.cache?.get(key).catch(() => null);
      if (cached) return cached;
      try {
        const result = await options.primary.route(points);
        if (result.source !== 'straight_line')
          await options.cache?.set(key, result).catch(() => undefined);
        return result;
      } catch (error) {
        options.onError?.(error);
        return options.fallback.route(points);
      }
    },
  };
}
