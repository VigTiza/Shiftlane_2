import { describe, expect, it } from 'vitest';

import { matchingRates, priceTrip, toCents, tripCharge, weekdayOf } from './contract-rates.ts';
import type { PenaltyRule, RateRule, TripForPricing } from './contract-rates.ts';

// 2026-10-05 es lunes; 2026-10-04 es domingo.
const MONDAY = '2026-10-05';
const SUNDAY = '2026-10-04';

const base: RateRule = { id: 'base', basis: 'per_trip', amountCents: toCents(1500) };
const trip = (overrides: Partial<TripForPricing> = {}): TripForPricing => ({
  date: MONDAY,
  time: '05:30',
  ...overrides,
});

describe('selección de tarifa', () => {
  it('usa la tarifa por viaje general', () => {
    expect(priceTrip([base], trip())).toMatchObject({ ruleId: 'base', amountCents: 150_000, quantity: 1 });
  });

  it('la tarifa especial de domingo gana a la general', () => {
    const sunday: RateRule = { id: 'domingo', basis: 'per_trip', amountCents: toCents(1800), weekdays: [0] };
    expect(weekdayOf(SUNDAY)).toBe(0);
    expect(priceTrip([base, sunday], trip({ date: SUNDAY }))?.ruleId).toBe('domingo');
    expect(priceTrip([base, sunday], trip())?.ruleId).toBe('base');
  });

  it('el horario nocturno cruza la medianoche', () => {
    const night: RateRule = {
      id: 'noche',
      basis: 'per_trip',
      amountCents: toCents(1700),
      startTime: '22:00',
      endTime: '06:00',
    };
    expect(priceTrip([base, night], trip({ time: '23:15' }))?.ruleId).toBe('noche');
    expect(priceTrip([base, night], trip({ time: '05:59' }))?.ruleId).toBe('noche');
    expect(priceTrip([base, night], trip({ time: '06:00' }))?.ruleId).toBe('base');
    expect(priceTrip([base, night], trip({ time: '14:00' }))?.ruleId).toBe('base');
  });

  it('una tarifa de ruta solo aplica a esa ruta y es la más específica', () => {
    const route: RateRule = { id: 'ruta-7', basis: 'per_route', amountCents: toCents(1250), routeId: 'r7' };
    expect(priceTrip([base, route], trip({ routeId: 'r7' }))).toMatchObject({ ruleId: 'ruta-7', amountCents: 125_000 });
    expect(priceTrip([base, route], trip({ routeId: 'r8' }))?.ruleId).toBe('base');
    // Sin ruta asignada, una tarifa por ruta no puede aplicar.
    expect(priceTrip([{ ...route, routeId: null }], trip({ routeId: 'r7' }))).toBeNull();
  });

  it('por kilómetro con cobro mínimo', () => {
    const perKm: RateRule = { id: 'km', basis: 'per_km', amountCents: toCents(28.5), minimumChargeCents: toCents(600) };
    expect(priceTrip([perKm], trip({ distanceKm: 42.3 }))).toMatchObject({ amountCents: 120_555, minimumApplied: false });
    expect(priceTrip([perKm], trip({ distanceKm: 10 }))).toMatchObject({ amountCents: 60_000, minimumApplied: true });
    expect(priceTrip([perKm], trip())).toBeNull();
  });

  it('por pasajero con mínimo de pasajeros cobrados', () => {
    const perPassenger: RateRule = {
      id: 'pax',
      basis: 'per_passenger',
      amountCents: toCents(45),
      minimumChargeCents: toCents(45 * 12),
    };
    expect(priceTrip([perPassenger], trip({ passengers: 18 }))?.amountCents).toBe(81_000);
    expect(priceTrip([perPassenger], trip({ passengers: 5 }))).toMatchObject({ amountCents: 54_000, minimumApplied: true });
  });

  it('por tamaño de unidad según la capacidad', () => {
    const van: RateRule = { id: 'van', basis: 'per_vehicle', amountCents: toCents(1100), maxCapacity: 20 };
    const bus: RateRule = { id: 'camion', basis: 'per_vehicle', amountCents: toCents(2400), minCapacity: 21 };
    expect(priceTrip([van, bus], trip({ vehicleCapacity: 19 }))?.ruleId).toBe('van');
    expect(priceTrip([van, bus], trip({ vehicleCapacity: 40 }))?.ruleId).toBe('camion');
    expect(priceTrip([van, bus], trip())).toBeNull();
  });

  it('respeta la vigencia de la tarifa', () => {
    const promo: RateRule = { id: 'promo', basis: 'per_trip', amountCents: toCents(1400), validFrom: '2026-10-01', validTo: '2026-10-31' };
    expect(priceTrip([base, promo], trip())?.ruleId).toBe('promo');
    expect(priceTrip([base, promo], trip({ date: '2026-11-02' }))?.ruleId).toBe('base');
  });

  it('tarifa de día festivo', () => {
    const holiday: RateRule = { id: 'festivo', basis: 'per_trip', amountCents: toCents(2000), holidays: true };
    expect(priceTrip([base, holiday], trip({ isHoliday: true }))?.ruleId).toBe('festivo');
    expect(priceTrip([base, holiday], trip())?.ruleId).toBe('base');
  });

  it('la prioridad explícita gana a la especificidad', () => {
    const sunday: RateRule = { id: 'domingo', basis: 'per_trip', amountCents: toCents(1800), weekdays: [0] };
    const forced: RateRule = { id: 'forzada', basis: 'per_trip', amountCents: toCents(1000), priority: 10 };
    expect(matchingRates([base, sunday, forced], trip({ date: SUNDAY })).map((r) => r.id)).toEqual([
      'forzada',
      'domingo',
      'base',
    ]);
  });

  it('sin tarifas aplicables devuelve null', () => {
    expect(priceTrip([], trip())).toBeNull();
  });
});

describe('cargo del viaje con penalizaciones', () => {
  const late: PenaltyRule = { id: 'tarde', type: 'late_arrival', amountType: 'percent', amount: 10, graceMinutes: 10 };
  const missed: PenaltyRule = { id: 'falta', type: 'missed_trip', amountType: 'fixed', amount: toCents(500) };
  const incomplete: PenaltyRule = { id: 'incompleto', type: 'incomplete_trip', amountType: 'fixed', amount: toCents(300) };
  const penalties = [late, missed, incomplete];

  it('viaje a tiempo o dentro de la tolerancia: sin penalización', () => {
    const charge = tripCharge([base], penalties, trip(), { status: 'completed', delayMinutes: 10 });
    expect(charge).toMatchObject({ baseCents: 150_000, penalties: [], totalCents: 150_000 });
  });

  it('llegada tarde: porcentaje del precio', () => {
    const charge = tripCharge([base], penalties, trip(), { status: 'completed', delayMinutes: 25 });
    expect(charge.penalties).toEqual([{ penaltyId: 'tarde', type: 'late_arrival', amountCents: 15_000 }]);
    expect(charge.totalCents).toBe(135_000);
  });

  it('viaje no realizado: no se cobra y la penalización queda a favor del cliente', () => {
    const charge = tripCharge([base], penalties, trip(), { status: 'missed' });
    expect(charge).toMatchObject({ baseCents: 0, totalCents: -50_000 });
  });

  it('viaje incompleto: se cobra con su penalización', () => {
    const charge = tripCharge([base], penalties, trip(), { status: 'incomplete', delayMinutes: 0 });
    expect(charge.totalCents).toBe(150_000 - 30_000);
  });

  it('viaje cancelado: ni cobro ni penalización', () => {
    expect(tripCharge([base], penalties, trip(), { status: 'cancelled' })).toMatchObject({
      baseCents: 0,
      penalties: [],
      totalCents: 0,
    });
  });
});
