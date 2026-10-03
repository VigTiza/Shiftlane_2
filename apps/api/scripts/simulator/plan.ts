// Plan del turno simulado: rutas alrededor de la planta y el comportamiento de cada unidad.
// Funciones puras y deterministas (la misma semilla da el mismo turno).
import { haversineMeters } from '@shiftlane/shared';
import type { LatLng } from '@shiftlane/shared';

/** Parque industrial en Ciudad Juárez. */
export const PLANT: LatLng = { lat: 31.6904, lng: -106.3712 };
/** Zona sin señal por la que pasan varias unidades (un paso a desnivel). */
export const DEAD_ZONE: LatLng & { radiusMeters: number } = {
  lat: 31.7135,
  lng: -106.4035,
  radiusMeters: 700,
};

export type Behavior = 'normal' | 'delayed' | 'off_route' | 'dead_battery' | 'dead_zone';

export interface UnitPlan {
  index: number;
  code: string;
  behavior: Behavior;
  /** Paradas en orden (la planta no es parada: es el destino). */
  stops: LatLng[];
  /** Pasajeros por parada. */
  passengersPerStop: number[];
}

/** Generador pseudoaleatorio con semilla (mulberry32). */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Qué unidad tiene cada escenario especial (el resto es normal). */
export function behaviorFor(index: number, units: number): Behavior {
  const special: Behavior[] = [
    'delayed',
    'off_route',
    'dead_battery',
    'dead_zone',
    'dead_zone',
    'dead_zone',
  ];
  // Repartidas en el turno; en flotas chicas, las primeras después de la unidad 0.
  const step = Math.max(1, Math.floor(units / (special.length + 1)));
  const slot = index % step === 0 ? index / step - 1 : -1;
  return slot >= 0 && slot < special.length ? special[slot]! : 'normal';
}

function towards(from: LatLng, to: LatLng, fraction: number): LatLng {
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lng: from.lng + (to.lng - from.lng) * fraction,
  };
}

/**
 * Turno de N unidades: cada ruta empieza en una colonia alrededor de la planta (6 a 10 km) y
 * hace 4 paradas hacia ella. Las de «zona sin señal» pasan por la misma zona.
 */
export function buildPlan(units: number, seed = 2026): UnitPlan[] {
  const random = seededRandom(seed);
  return Array.from({ length: units }, (_, index) => {
    const behavior = behaviorFor(index, units);
    const angle = (index / units) * 2 * Math.PI;
    const distanceKm = 6 + random() * 4;
    let start: LatLng = {
      lat: PLANT.lat + (distanceKm / 111) * Math.sin(angle),
      lng:
        PLANT.lng + (distanceKm / (111 * Math.cos((PLANT.lat * Math.PI) / 180))) * Math.cos(angle),
    };
    if (behavior === 'dead_zone') {
      // Del otro lado de la zona sin señal, para cruzarla en el camino a la planta.
      start = towards(PLANT, DEAD_ZONE, 1.8 + random() * 0.2);
    }
    const stops = [0, 0.25, 0.5, 0.72].map((fraction) => {
      const base = towards(start, PLANT, fraction);
      const jitter = behavior === 'dead_zone' ? 0 : 0.004;
      return {
        lat: base.lat + (random() - 0.5) * jitter,
        lng: base.lng + (random() - 0.5) * jitter,
      };
    });
    return {
      index,
      code: `SIM-${String(index + 1).padStart(2, '0')}`,
      behavior,
      stops,
      passengersPerStop: stops.map(() => 2 + Math.floor(random() * 4)),
    };
  });
}

/** Trazado completo: paradas y luego la planta. */
export function pathOf(plan: UnitPlan): LatLng[] {
  return [...plan.stops, PLANT];
}

export function lengthMeters(path: readonly LatLng[]) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}

/** Fracción del recorrido en la que está cada punto del trazado. */
export function waypointFractions(path: readonly LatLng[]) {
  const total = lengthMeters(path);
  let acc = 0;
  return path.map((point, i) => {
    if (i > 0) acc += haversineMeters(path[i - 1]!, point);
    return total === 0 ? 0 : acc / total;
  });
}

/** Punto del trazado a una fracción del recorrido (0 = primera parada, 1 = planta). */
export function pointAt(path: readonly LatLng[], fraction: number): LatLng {
  const f = Math.min(1, Math.max(0, fraction));
  const fractions = waypointFractions(path);
  for (let i = 1; i < path.length; i += 1) {
    if (f <= fractions[i]!) {
      const span = fractions[i]! - fractions[i - 1]!;
      return towards(path[i - 1]!, path[i]!, span === 0 ? 1 : (f - fractions[i - 1]!) / span);
    }
  }
  return path.at(-1)!;
}

/** Desvía un punto unos metros hacia el norte (para el escenario de desvío). */
export function offsetNorth(point: LatLng, meters: number): LatLng {
  return { lat: point.lat + meters / 111_000, lng: point.lng };
}

export function insideDeadZone(point: LatLng) {
  return haversineMeters(point, DEAD_ZONE) <= DEAD_ZONE.radiusMeters;
}

/** Tramo del recorrido en el que la unidad del escenario de desvío se sale de la ruta. */
export const DETOUR = { from: 0.3, to: 0.55, meters: 900 };
/** Batería del celular que se queda sin carga: empieza en 24 % y se apaga en 3 %. */
export const BATTERY = { start: 24, off: 3 };
/** La unidad que salió tarde lleva este retraso desde el inicio. */
export const LATE_START_MINUTES = 25;
