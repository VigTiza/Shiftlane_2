// Motor de tarifas de contratos: decide qué tarifa aplica a un viaje y cuánto cobrar,
// incluidas las penalizaciones. Todo en centavos para evitar errores de redondeo.
// Lo usan la API (conciliación, F12) y el cotizador del panel.

export const RATE_BASES = [
  'per_trip',
  'per_route',
  'per_km',
  'per_vehicle',
  'per_passenger',
] as const;
export type RateBasis = (typeof RATE_BASES)[number];

export const RATE_BASIS_LABELS: Record<RateBasis, string> = {
  per_trip: 'Por viaje',
  per_route: 'Por viaje en una ruta',
  per_km: 'Por kilómetro',
  per_vehicle: 'Por viaje según tamaño de unidad',
  per_passenger: 'Por pasajero',
};

export interface RateRule {
  id: string;
  basis: RateBasis;
  /** Precio en centavos por la unidad de cobro (viaje, km o pasajero). */
  amountCents: number;
  /** Solo viajes de esta ruta (obligatorio para per_route). */
  routeId?: string | null;
  /** Días de la semana (0 = domingo … 6 = sábado). Vacío o ausente = todos. */
  weekdays?: readonly number[] | null;
  /** Ventana de horario de salida HH:MM; puede cruzar la medianoche (22:00–06:00). */
  startTime?: string | null;
  endTime?: string | null;
  /** true: solo días festivos; false: solo días hábiles; null: cualquiera. */
  holidays?: boolean | null;
  /** Rango de capacidad de la unidad (asientos). */
  minCapacity?: number | null;
  maxCapacity?: number | null;
  /** Vigencia AAAA-MM-DD (inclusive). */
  validFrom?: string | null;
  validTo?: string | null;
  /** Cobro mínimo por viaje en centavos (útil en per_km y per_passenger). */
  minimumChargeCents?: number | null;
  /** Mayor prioridad gana; en empate gana la tarifa más específica. */
  priority?: number | null;
}

export interface TripForPricing {
  /** Fecha del servicio AAAA-MM-DD (en la zona horaria de la planta). */
  date: string;
  /** Hora de salida HH:MM. */
  time: string;
  routeId?: string | null;
  distanceKm?: number | null;
  passengers?: number | null;
  vehicleCapacity?: number | null;
  isHoliday?: boolean;
}

export interface TripPrice {
  ruleId: string;
  basis: RateBasis;
  quantity: number;
  unitCents: number;
  amountCents: number;
  minimumApplied: boolean;
}

function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function inTimeWindow(time: string, start: string, end: string): boolean {
  const t = toMinutes(time);
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s <= e ? t >= s && t < e : t >= s || t < e;
}

function specificity(rule: RateRule): number {
  return (
    (rule.routeId ? 8 : 0) +
    (rule.holidays !== null && rule.holidays !== undefined ? 4 : 0) +
    (rule.weekdays && rule.weekdays.length > 0 ? 2 : 0) +
    (rule.startTime && rule.endTime ? 2 : 0) +
    (rule.minCapacity !== null && rule.minCapacity !== undefined ? 1 : 0) +
    (rule.maxCapacity !== null && rule.maxCapacity !== undefined ? 1 : 0) +
    (rule.validFrom || rule.validTo ? 1 : 0)
  );
}

/** ¿La tarifa aplica a este viaje? */
export function rateMatches(rule: RateRule, trip: TripForPricing): boolean {
  if (rule.basis === 'per_route' && !rule.routeId) return false;
  if (rule.routeId && rule.routeId !== trip.routeId) return false;
  if (rule.validFrom && trip.date < rule.validFrom) return false;
  if (rule.validTo && trip.date > rule.validTo) return false;
  if (rule.weekdays && rule.weekdays.length > 0 && !rule.weekdays.includes(weekdayOf(trip.date)))
    return false;
  if (rule.startTime && rule.endTime && !inTimeWindow(trip.time, rule.startTime, rule.endTime))
    return false;
  if (
    rule.holidays !== null &&
    rule.holidays !== undefined &&
    rule.holidays !== Boolean(trip.isHoliday)
  )
    return false;
  if (rule.minCapacity !== null && rule.minCapacity !== undefined) {
    if (trip.vehicleCapacity === null || trip.vehicleCapacity === undefined) return false;
    if (trip.vehicleCapacity < rule.minCapacity) return false;
  }
  if (rule.maxCapacity !== null && rule.maxCapacity !== undefined) {
    if (trip.vehicleCapacity === null || trip.vehicleCapacity === undefined) return false;
    if (trip.vehicleCapacity > rule.maxCapacity) return false;
  }
  if (rule.basis === 'per_km' && (trip.distanceKm === null || trip.distanceKm === undefined))
    return false;
  if (rule.basis === 'per_passenger' && (trip.passengers === null || trip.passengers === undefined))
    return false;
  return true;
}

/** Tarifas que aplican, de la que gana a la que menos. */
export function matchingRates(rules: readonly RateRule[], trip: TripForPricing): RateRule[] {
  return rules
    .filter((rule) => rateMatches(rule, trip))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || specificity(b) - specificity(a));
}

/** Precio del viaje con la tarifa ganadora, o null si ninguna aplica. */
export function priceTrip(rules: readonly RateRule[], trip: TripForPricing): TripPrice | null {
  const [rule] = matchingRates(rules, trip);
  if (!rule) return null;
  const quantity =
    rule.basis === 'per_km'
      ? (trip.distanceKm ?? 0)
      : rule.basis === 'per_passenger'
        ? (trip.passengers ?? 0)
        : 1;
  const raw = Math.round(rule.amountCents * quantity);
  const minimum = rule.minimumChargeCents ?? 0;
  return {
    ruleId: rule.id,
    basis: rule.basis,
    quantity,
    unitCents: rule.amountCents,
    amountCents: Math.max(raw, minimum),
    minimumApplied: minimum > raw,
  };
}

// --- Penalizaciones -------------------------------------------------------------

export const PENALTY_TYPES = ['late_arrival', 'missed_trip', 'incomplete_trip', 'other'] as const;
export type PenaltyType = (typeof PENALTY_TYPES)[number];

export const PENALTY_TYPE_LABELS: Record<PenaltyType, string> = {
  late_arrival: 'Llegada tarde',
  missed_trip: 'Viaje no realizado',
  incomplete_trip: 'Viaje incompleto',
  other: 'Otra',
};

export interface PenaltyRule {
  id: string;
  type: PenaltyType;
  /** fixed: centavos; percent: porcentaje del precio del viaje (10 = 10 %). */
  amountType: 'fixed' | 'percent';
  amount: number;
  /** Para llegada tarde: minutos de tolerancia antes de penalizar. */
  graceMinutes?: number | null;
}

export type TripOutcomeStatus = 'completed' | 'incomplete' | 'missed' | 'cancelled';

export interface TripOutcome {
  status: TripOutcomeStatus;
  /** Minutos de retraso en la llegada a planta (0 o negativo = a tiempo). */
  delayMinutes?: number | null;
}

export interface AppliedPenalty {
  penaltyId: string;
  type: PenaltyType;
  amountCents: number;
}

export interface TripCharge {
  price: TripPrice | null;
  /** Lo que se cobra por el servicio (0 si no se realizó o se canceló). */
  baseCents: number;
  penalties: AppliedPenalty[];
  /** Base menos penalizaciones; negativo es un saldo a favor del cliente. */
  totalCents: number;
}

/**
 * Cargo de un viaje: precio de la tarifa que aplica según cómo terminó el viaje, menos las
 * penalizaciones del contrato. Un viaje no realizado no se cobra y su penalización queda a
 * favor del cliente; uno cancelado no se cobra ni se penaliza.
 */
export function tripCharge(
  rules: readonly RateRule[],
  penalties: readonly PenaltyRule[],
  trip: TripForPricing,
  outcome: TripOutcome,
): TripCharge {
  const price = priceTrip(rules, trip);
  const priceCents = price?.amountCents ?? 0;
  const charged = outcome.status === 'completed' || outcome.status === 'incomplete';
  const baseCents = charged ? priceCents : 0;

  const applied: AppliedPenalty[] = [];
  for (const penalty of penalties) {
    let applies = false;
    if (penalty.type === 'late_arrival') {
      applies = charged && (outcome.delayMinutes ?? 0) > (penalty.graceMinutes ?? 0);
    } else if (penalty.type === 'missed_trip') {
      applies = outcome.status === 'missed';
    } else if (penalty.type === 'incomplete_trip') {
      applies = outcome.status === 'incomplete';
    }
    if (!applies) continue;
    const amountCents =
      penalty.amountType === 'fixed'
        ? Math.round(penalty.amount)
        : Math.round((priceCents * penalty.amount) / 100);
    applied.push({ penaltyId: penalty.id, type: penalty.type, amountCents });
  }

  const totalPenalties = applied.reduce((sum, penalty) => sum + penalty.amountCents, 0);
  return { price, baseCents, penalties: applied, totalCents: baseCents - totalPenalties };
}

/** Pesos con dos decimales → centavos enteros. */
export function toCents(pesos: number | string): number {
  return Math.round(Number(pesos) * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}
