// Hora estimada de llegada a las paradas que faltan y al destino del viaje.
import { haversineMeters } from './geo.ts';
import type { LatLng } from './geo.ts';

/** Las calles no son línea recta: la distancia real es mayor que la directa. */
export const ROAD_FACTOR = 1.3;
/** Minutos que la unidad se detiene en cada parada para subir pasajeros. */
export const DWELL_MINUTES = 1;

export interface EtaPoint extends LatLng {
  id: string;
}

export interface EtaInput {
  now: Date;
  position: LatLng;
  /** Paradas que faltan, en orden. */
  stops: readonly EtaPoint[];
  /** Planta (viajes de entrada) o nada si el destino es la última parada. */
  destination?: LatLng | null;
  /** Velocidad promedio esperada en la ruta (km/h). */
  speedKmh: number;
  roadFactor?: number;
  dwellMinutes?: number;
}

export interface EtaResult {
  stops: { id: string; eta: Date; distanceMeters: number }[];
  destination: { eta: Date; distanceMeters: number } | null;
}

/**
 * Suma la distancia por calles (directa × factor) desde la posición actual a cada parada en
 * orden, la convierte en tiempo con la velocidad esperada y agrega la parada en cada una.
 */
export function estimateArrivals(input: EtaInput): EtaResult {
  const factor = input.roadFactor ?? ROAD_FACTOR;
  const dwell = input.dwellMinutes ?? DWELL_MINUTES;
  const metersPerMinute = (Math.max(input.speedKmh, 1) * 1000) / 60;
  let from: LatLng = input.position;
  let meters = 0;
  let minutes = 0;
  const stops = input.stops.map((stop, index) => {
    const leg = haversineMeters(from, stop) * factor;
    meters += leg;
    minutes += leg / metersPerMinute + (index > 0 ? dwell : 0);
    from = stop;
    return {
      id: stop.id,
      eta: new Date(input.now.getTime() + minutes * 60_000),
      distanceMeters: Math.round(meters),
    };
  });
  let destination: EtaResult['destination'] = null;
  if (input.destination) {
    const leg = haversineMeters(from, input.destination) * factor;
    meters += leg;
    minutes += leg / metersPerMinute + (stops.length > 0 ? dwell : 0);
    destination = {
      eta: new Date(input.now.getTime() + minutes * 60_000),
      distanceMeters: Math.round(meters),
    };
  } else if (stops.length > 0) {
    const last = stops.at(-1)!;
    destination = { eta: last.eta, distanceMeters: last.distanceMeters };
  }
  return { stops, destination };
}

/** Minutos de retraso (positivo) o adelanto (negativo) contra la hora programada. */
export function delayMinutes(eta: Date, scheduled: Date): number {
  return Math.round((eta.getTime() - scheduled.getTime()) / 60_000);
}
