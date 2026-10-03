// Cálculos geográficos sin dependencias (distancias en metros). Para distancias de ciudad la
// precisión es de centímetros a pocos metros; el servidor usa PostGIS para lo mismo.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Distancia sobre la superficie terrestre entre dos puntos (fórmula de haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitud total de una línea (suma de tramos). */
export function pathLengthMeters(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}

/**
 * Distancia de un punto a un segmento. Proyecta a un plano local (equirrectangular) centrado
 * en el punto, suficiente para segmentos de unos cuantos kilómetros.
 */
export function pointToSegmentMeters(point: LatLng, a: LatLng, b: LatLng): number {
  const cosLat = Math.cos(toRadians(point.lat));
  const project = (p: LatLng) => ({
    x: toRadians(p.lng - point.lng) * cosLat * EARTH_RADIUS_METERS,
    y: toRadians(p.lat - point.lat) * EARTH_RADIUS_METERS,
  });
  const pa = project(a);
  const pb = project(b);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(pa.x * dx + pa.y * dy) / lengthSquared));
  const x = pa.x + t * dx;
  const y = pa.y + t * dy;
  return Math.sqrt(x * x + y * y);
}

/** Distancia de un punto al trazado de una ruta (para detectar desvíos). */
export function distanceToPathMeters(point: LatLng, path: readonly LatLng[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return haversineMeters(point, path[0]!);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i += 1) {
    best = Math.min(best, pointToSegmentMeters(point, path[i - 1]!, path[i]!));
  }
  return best;
}

export interface StopForMatching {
  id: string;
  location: LatLng;
  /** Radio propio de la parada; si no hay, se usa el máximo indicado. */
  radiusMeters?: number | null;
}

export interface NearestStop<T extends StopForMatching> {
  stop: T;
  distanceMeters: number;
}

/**
 * Parada más cercana dentro de su radio (o del máximo indicado). Se usa para asignar sola la
 * parada al escanear a un pasajero: el chofer nunca la elige.
 */
export function nearestStop<T extends StopForMatching>(
  stops: readonly T[],
  point: LatLng,
  maxMeters?: number,
): NearestStop<T> | null {
  let best: NearestStop<T> | null = null;
  for (const stop of stops) {
    const distanceMeters = haversineMeters(point, stop.location);
    const limit = maxMeters ?? stop.radiusMeters ?? Number.POSITIVE_INFINITY;
    if (distanceMeters > limit) continue;
    if (!best || distanceMeters < best.distanceMeters) best = { stop, distanceMeters };
  }
  return best;
}

/** Tiempo estimado a una velocidad promedio urbana (incluye paradas y semáforos). */
export function estimateMinutes(distanceMeters: number, averageSpeedKmh = 28): number {
  return Math.max(1, Math.round((distanceMeters / 1000 / averageSpeedKmh) * 60));
}
