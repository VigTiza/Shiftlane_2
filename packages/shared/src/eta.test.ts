import { describe, expect, it } from 'vitest';

import { delayMinutes, estimateArrivals } from './eta.ts';
import { haversineMeters } from './geo.ts';

const NOW = new Date('2026-10-05T11:00:00Z');
// Ciudad Juárez: Plaza de la Mexicanidad → Av. Tecnológico → Waterfill → planta.
const POSITION = { lat: 31.7445, lng: -106.4605 };
const TECNOLOGICO = { id: 'tec', lat: 31.7166, lng: -106.4233 };
const WATERFILL = { id: 'wat', lat: 31.7101, lng: -106.4081 };
const PLANT = { lat: 31.6904, lng: -106.3712 };

function minutesUntil(date: Date) {
  return (date.getTime() - NOW.getTime()) / 60_000;
}

describe('hora estimada de llegada', () => {
  it('suma distancia por calles, velocidad y paradas en orden', () => {
    const result = estimateArrivals({
      now: NOW,
      position: POSITION,
      stops: [TECNOLOGICO, WATERFILL],
      destination: PLANT,
      speedKmh: 30,
    });
    const leg1 = haversineMeters(POSITION, TECNOLOGICO) * 1.3;
    const leg2 = haversineMeters(TECNOLOGICO, WATERFILL) * 1.3;
    const leg3 = haversineMeters(WATERFILL, PLANT) * 1.3;
    const perMinute = 30_000 / 60;
    expect(result.stops.map((s) => s.id)).toEqual(['tec', 'wat']);
    expect(minutesUntil(result.stops[0]!.eta)).toBeCloseTo(leg1 / perMinute, 3);
    // Un minuto de parada en Av. Tecnológico antes de seguir.
    expect(minutesUntil(result.stops[1]!.eta)).toBeCloseTo((leg1 + leg2) / perMinute + 1, 3);
    expect(minutesUntil(result.destination!.eta)).toBeCloseTo(
      (leg1 + leg2 + leg3) / perMinute + 2,
      3,
    );
    expect(result.destination!.distanceMeters).toBe(Math.round(leg1 + leg2 + leg3));
    // Del orden de 12 km y media hora a 30 km/h.
    expect(result.destination!.distanceMeters).toBeGreaterThan(10_000);
    expect(minutesUntil(result.destination!.eta)).toBeGreaterThan(20);
  });

  it('sin planta, el destino es la última parada (viajes de salida)', () => {
    const result = estimateArrivals({
      now: NOW,
      position: PLANT,
      stops: [WATERFILL, TECNOLOGICO],
      speedKmh: 25,
    });
    expect(result.destination).toEqual({
      eta: result.stops[1]!.eta,
      distanceMeters: result.stops[1]!.distanceMeters,
    });
  });

  it('sin paradas pendientes llega directo a la planta; en la planta no falta nada', () => {
    const direct = estimateArrivals({
      now: NOW,
      position: WATERFILL,
      stops: [],
      destination: PLANT,
      speedKmh: 40,
    });
    expect(direct.stops).toEqual([]);
    expect(minutesUntil(direct.destination!.eta)).toBeCloseTo(
      (haversineMeters(WATERFILL, PLANT) * 1.3) / (40_000 / 60),
      3,
    );
    const there = estimateArrivals({
      now: NOW,
      position: PLANT,
      stops: [],
      destination: PLANT,
      speedKmh: 40,
    });
    expect(there.destination).toEqual({ eta: NOW, distanceMeters: 0 });
    expect(
      estimateArrivals({ now: NOW, position: PLANT, stops: [], speedKmh: 40 }).destination,
    ).toBeNull();
  });

  it('una velocidad cero no rompe el cálculo', () => {
    const result = estimateArrivals({
      now: NOW,
      position: POSITION,
      stops: [TECNOLOGICO],
      speedKmh: 0,
    });
    expect(Number.isFinite(result.stops[0]!.eta.getTime())).toBe(true);
  });

  it('calcula el retraso contra la hora programada', () => {
    expect(delayMinutes(new Date('2026-10-05T12:07:30Z'), new Date('2026-10-05T12:00:00Z'))).toBe(
      8,
    );
    expect(delayMinutes(new Date('2026-10-05T11:55:00Z'), new Date('2026-10-05T12:00:00Z'))).toBe(
      -5,
    );
  });
});
