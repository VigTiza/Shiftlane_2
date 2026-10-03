import { describe, expect, it } from 'vitest';

import {
  distanceToPathMeters,
  estimateMinutes,
  haversineMeters,
  nearestStop,
  pathLengthMeters,
} from './geo.ts';

// Lugares de Ciudad Juárez.
const PASO_DEL_NORTE = { lat: 31.747, lng: -106.487 }; // Puente Internacional Paso del Norte
const MEXICANIDAD = { lat: 31.7445, lng: -106.4605 }; // Plaza de la Mexicanidad
const BERMUDEZ = { lat: 31.7256, lng: -106.4136 }; // Parque Industrial Antonio J. Bermúdez
const AEROPUERTO = { lat: 31.6361, lng: -106.4287 }; // Aeropuerto Abraham González

describe('distancias en Ciudad Juárez', () => {
  it('calcula distancias reales entre puntos conocidos', () => {
    // Valores de referencia calculados con PostGIS (geography, elipsoide WGS84).
    expect(haversineMeters(PASO_DEL_NORTE, MEXICANIDAD)).toBeGreaterThan(2_480);
    expect(haversineMeters(PASO_DEL_NORTE, MEXICANIDAD)).toBeLessThan(2_540);
    expect(haversineMeters(MEXICANIDAD, BERMUDEZ) / 1000).toBeCloseTo(4.88, 1);
    expect(haversineMeters(BERMUDEZ, AEROPUERTO) / 1000).toBeCloseTo(10.0, 0);
  });

  it('la longitud de una línea es la suma de sus tramos', () => {
    const total = pathLengthMeters([PASO_DEL_NORTE, MEXICANIDAD, BERMUDEZ]);
    expect(total).toBeCloseTo(
      haversineMeters(PASO_DEL_NORTE, MEXICANIDAD) + haversineMeters(MEXICANIDAD, BERMUDEZ),
      6,
    );
  });

  it('estima el tiempo a velocidad urbana', () => {
    expect(estimateMinutes(14_000)).toBe(30);
    expect(estimateMinutes(100)).toBe(1);
  });
});

describe('parada más cercana', () => {
  const stops = [
    { id: 'mexicanidad', location: MEXICANIDAD, radiusMeters: 100 },
    { id: 'bermudez', location: BERMUDEZ, radiusMeters: 150 },
  ];

  it('asigna la parada dentro de su radio', () => {
    // ~45 m al este de la Plaza de la Mexicanidad.
    const near = nearestStop(stops, { lat: 31.7445, lng: -106.46003 });
    expect(near?.stop.id).toBe('mexicanidad');
    expect(near!.distanceMeters).toBeLessThan(100);
  });

  it('fuera de cualquier radio no asigna parada', () => {
    expect(nearestStop(stops, { lat: 31.735, lng: -106.44 })).toBeNull();
  });

  it('respeta el radio configurable', () => {
    const point = { lat: 31.7449, lng: -106.4605 }; // ~45 m al norte
    expect(nearestStop(stops, point, 30)).toBeNull();
    expect(nearestStop(stops, point, 60)?.stop.id).toBe('mexicanidad');
  });
});

describe('distancia al trazado', () => {
  // Trazo recto por la Av. Tecnológico, de norte a sur.
  const path = [
    { lat: 31.7166, lng: -106.4233 },
    { lat: 31.6952, lng: -106.4239 },
    { lat: 31.6773, lng: -106.4249 },
  ];

  it('un punto sobre la avenida está a pocos metros del trazado', () => {
    expect(distanceToPathMeters({ lat: 31.705, lng: -106.4236 }, path)).toBeLessThan(10);
  });

  it('un punto a 500 m al este se detecta como desvío', () => {
    const distance = distanceToPathMeters({ lat: 31.705, lng: -106.4183 }, path);
    expect(distance).toBeGreaterThan(450);
    expect(distance).toBeLessThan(550);
  });

  it('más allá del final se mide hasta el extremo del trazado', () => {
    const beyond = { lat: 31.66, lng: -106.4249 };
    expect(distanceToPathMeters(beyond, path)).toBeCloseTo(haversineMeters(beyond, path[2]!), -1);
  });
});
