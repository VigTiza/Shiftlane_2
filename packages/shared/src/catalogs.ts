// Etiquetas en español de los catálogos y reglas de vencimiento de documentos.

export const VEHICLE_STATUSES = ['available', 'on_route', 'maintenance', 'out_of_service'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  available: 'Disponible',
  on_route: 'En ruta',
  maintenance: 'Mantenimiento',
  out_of_service: 'Fuera de servicio',
};

export const DRIVER_STATUSES = ['active', 'inactive'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
};

export const VEHICLE_DOCUMENT_TYPES = [
  'permit',
  'insurance',
  'registration_card',
  'emissions_verification',
  'other',
] as const;
export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

export const VEHICLE_DOCUMENT_TYPE_LABELS: Record<VehicleDocumentType, string> = {
  permit: 'Permiso',
  insurance: 'Seguro',
  registration_card: 'Tarjeta de circulación',
  emissions_verification: 'Verificación',
  other: 'Otro',
};

export const DRIVER_DOCUMENT_TYPES = [
  'license',
  'medical_exam',
  'drug_test',
  'training',
  'other',
] as const;
export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export const DRIVER_DOCUMENT_TYPE_LABELS: Record<DriverDocumentType, string> = {
  license: 'Licencia',
  medical_exam: 'Examen médico',
  drug_test: 'Antidoping',
  training: 'Capacitación',
  other: 'Otro',
};

/** Días antes del vencimiento en que un documento se marca «por vencer» (avisos a 30, 15 y 5). */
export const DOCUMENT_WARNING_DAYS = 30;

export type DocumentStatus = 'valid' | 'expiring' | 'expired' | 'no_expiry';

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  valid: 'Vigente',
  expiring: 'Por vencer',
  expired: 'Vencido',
  no_expiry: 'Sin vencimiento',
};

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria indicada. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Estado de un documento según su fecha de vencimiento (AAAA-MM-DD). Vence al terminar el
 * día indicado: el mismo día todavía es válido.
 */
export function documentStatus(
  expiresOn: string | null | undefined,
  today: string,
  warningDays: number = DOCUMENT_WARNING_DAYS,
): DocumentStatus {
  if (!expiresOn) return 'no_expiry';
  const remaining = daysBetween(today, expiresOn);
  if (remaining < 0) return 'expired';
  if (remaining <= warningDays) return 'expiring';
  return 'valid';
}

/** Días que faltan para vencer (negativo si ya venció). */
export function daysUntil(expiresOn: string, today: string): number {
  return daysBetween(today, expiresOn);
}

// --- Programación y solicitudes de la planta ---------------------------------------------

export const TRIP_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  scheduled: 'Programado',
  in_progress: 'En curso',
  completed: 'Terminado',
  cancelled: 'Cancelado',
};

export const EXTRA_TRIP_REASONS = ['overtime', 'shift_change', 'event', 'other'] as const;
export type ExtraTripReason = (typeof EXTRA_TRIP_REASONS)[number];

export const EXTRA_TRIP_REASON_LABELS: Record<ExtraTripReason, string> = {
  overtime: 'Tiempo extra',
  shift_change: 'Cambio de turno',
  event: 'Evento',
  other: 'Otro',
};

export const CLIENT_REQUEST_TYPES = [
  'extra_trip',
  'schedule_change',
  'route_change',
  'other',
] as const;
export type ClientRequestType = (typeof CLIENT_REQUEST_TYPES)[number];

export const CLIENT_REQUEST_TYPE_LABELS: Record<ClientRequestType, string> = {
  extra_trip: 'Viaje extra',
  schedule_change: 'Cambio de horario o turno',
  route_change: 'Cambio de ruta o parada',
  other: 'Otra solicitud',
};

export const CLIENT_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ClientRequestStatus = (typeof CLIENT_REQUEST_STATUSES)[number];

export const CLIENT_REQUEST_STATUS_LABELS: Record<ClientRequestStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
};
