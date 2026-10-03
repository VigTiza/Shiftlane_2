// Detector de conflictos de la programación. Funciones puras: el servicio carga los datos y
// aquí se decide qué está mal y qué se sugiere, antes de que el viaje ocurra.
import {
  DRIVER_DOCUMENT_TYPE_LABELS,
  VEHICLE_DOCUMENT_TYPE_LABELS,
  VEHICLE_STATUS_LABELS,
} from '@shiftlane/shared';
import type { DriverDocumentType, VehicleDocumentType, VehicleStatus } from '@shiftlane/shared';

export const CONFLICT_TYPES = [
  'driver_double_booked',
  'vehicle_double_booked',
  'vehicle_unavailable',
  'vehicle_documents_expired',
  'driver_documents_expired',
  'driver_license_invalid',
  'driver_inactive',
  'capacity_exceeded',
  'unassigned',
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

/** error: impide asignar sin confirmación; warning: se avisa pero no bloquea. */
export type ConflictSeverity = 'error' | 'warning';

const SEVERITY: Record<ConflictType, ConflictSeverity> = {
  driver_double_booked: 'error',
  vehicle_double_booked: 'error',
  vehicle_unavailable: 'error',
  vehicle_documents_expired: 'error',
  driver_documents_expired: 'error',
  driver_license_invalid: 'error',
  driver_inactive: 'error',
  capacity_exceeded: 'warning',
  unassigned: 'warning',
};

/** Documentos cuyo vencimiento impide operar (los de tipo «otro» son informativos). */
const DRIVER_REQUIRED_DOCUMENTS: DriverDocumentType[] = ['medical_exam', 'drug_test', 'training'];
const VEHICLE_REQUIRED_DOCUMENTS: VehicleDocumentType[] = [
  'permit',
  'insurance',
  'registration_card',
  'emissions_verification',
];
const UNAVAILABLE_STATUSES: VehicleStatus[] = ['maintenance', 'out_of_service'];
const MAX_OPTIONS = 3;

export interface TripForConflicts {
  id: string;
  routeId: string | null;
  routeCode: string | null;
  serviceDate: string;
  startAt: Date;
  endAt: Date;
  driverId: string | null;
  vehicleId: string | null;
  /** Pasajeros asignados a la ruta. */
  passengers: number;
  /** Chofer y unidad habituales de la ruta (para sugerirlos). */
  habitualDriverId?: string | null;
  habitualVehicleId?: string | null;
}

interface DocumentForConflicts<T> {
  type: T;
  /** AAAA-MM-DD o null si no vence. */
  expiresOn: string | null;
}

export interface DriverForConflicts {
  id: string;
  fullName: string;
  active: boolean;
  licenseType: string | null;
  documents: DocumentForConflicts<DriverDocumentType>[];
}

export interface VehicleForConflicts {
  id: string;
  economicNumber: string;
  capacity: number;
  status: VehicleStatus;
  active: boolean;
  requiredLicenseType: string | null;
  documents: DocumentForConflicts<VehicleDocumentType>[];
}

export interface ConflictContext {
  drivers: ReadonlyMap<string, DriverForConflicts>;
  vehicles: ReadonlyMap<string, VehicleForConflicts>;
  /** Viajes activos con chofer o unidad que pueden traslaparse (incluye los revisados). */
  busy: readonly TripForConflicts[];
}

export interface SuggestionOption {
  kind: 'driver' | 'vehicle';
  id: string;
  label: string;
}

export interface Conflict {
  tripId: string;
  type: ConflictType;
  severity: ConflictSeverity;
  message: string;
  /** Viaje con el que choca (dobles asignaciones). */
  otherTripId?: string;
  suggestion?: { message: string; options: SuggestionOption[] };
}

function overlaps(a: TripForConflicts, b: TripForConflicts) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

function hhmm(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function normalizeLicense(value: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') || null;
}

/** Último vencimiento de cada tipo de documento (null = no vence; ausente = no hay). */
function latestExpiry<T extends string>(documents: readonly DocumentForConflicts<T>[], type: T) {
  const ofType = documents.filter((doc) => doc.type === type);
  if (ofType.length === 0) return undefined;
  if (ofType.some((doc) => doc.expiresOn === null)) return null;
  return ofType
    .map((doc) => doc.expiresOn!)
    .sort()
    .at(-1)!;
}

function expiredOn<T extends string>(
  documents: readonly DocumentForConflicts<T>[],
  type: T,
  date: string,
) {
  const expiry = latestExpiry(documents, type);
  return typeof expiry === 'string' && expiry < date ? expiry : null;
}

function conflict(
  trip: TripForConflicts,
  type: ConflictType,
  message: string,
  extra: Partial<Conflict> = {},
): Conflict {
  return { tripId: trip.id, type, severity: SEVERITY[type], message, ...extra };
}

/** Problemas de licencia del chofer para la fecha y la unidad del viaje. */
function licenseProblem(
  driver: DriverForConflicts,
  vehicle: VehicleForConflicts | undefined,
  date: string,
) {
  const expiry = latestExpiry(driver.documents, 'license');
  if (expiry === undefined) return `${driver.fullName} no tiene licencia registrada.`;
  if (expiry !== null && expiry < date)
    return `La licencia de ${driver.fullName} venció el ${expiry}.`;
  const required = normalizeLicense(vehicle?.requiredLicenseType ?? null);
  if (required && normalizeLicense(driver.licenseType) !== required) {
    return driver.licenseType
      ? `La unidad ${vehicle!.economicNumber} requiere licencia ${vehicle!.requiredLicenseType} y ${driver.fullName} tiene ${driver.licenseType}.`
      : `La unidad ${vehicle!.economicNumber} requiere licencia ${vehicle!.requiredLicenseType} y ${driver.fullName} no tiene el tipo registrado.`;
  }
  return null;
}

function doubleBooking(
  trip: TripForConflicts,
  busy: readonly TripForConflicts[],
  key: 'driverId' | 'vehicleId',
) {
  const id = trip[key];
  if (!id) return undefined;
  return busy.find((other) => other.id !== trip.id && other[key] === id && overlaps(trip, other));
}

/** Conflictos de un viaje con su chofer y unidad (asignados o propuestos). */
export function tripConflicts(
  trip: TripForConflicts,
  context: ConflictContext,
  timeZone: string,
): Conflict[] {
  const conflicts: Conflict[] = [];
  const driver = trip.driverId ? context.drivers.get(trip.driverId) : undefined;
  const vehicle = trip.vehicleId ? context.vehicles.get(trip.vehicleId) : undefined;

  if (!trip.driverId || !trip.vehicleId) {
    const missing =
      !trip.driverId && !trip.vehicleId ? 'chofer y unidad' : !trip.driverId ? 'chofer' : 'unidad';
    conflicts.push(conflict(trip, 'unassigned', `Falta asignar ${missing}.`));
  }

  if (trip.driverId) {
    if (!driver || !driver.active) {
      conflicts.push(
        conflict(
          trip,
          'driver_inactive',
          `${driver?.fullName ?? 'El chofer'} está dado de baja o inactivo.`,
        ),
      );
    } else {
      const other = doubleBooking(trip, context.busy, 'driverId');
      if (other) {
        conflicts.push(
          conflict(
            trip,
            'driver_double_booked',
            `${driver.fullName} tiene otro viaje a la misma hora (${other.routeCode ?? 'viaje extra'}, ${hhmm(other.startAt, timeZone)} a ${hhmm(other.endAt, timeZone)}).`,
            { otherTripId: other.id },
          ),
        );
      }
      const license = licenseProblem(driver, vehicle, trip.serviceDate);
      if (license) conflicts.push(conflict(trip, 'driver_license_invalid', license));
      for (const type of DRIVER_REQUIRED_DOCUMENTS) {
        const expired = expiredOn(driver.documents, type, trip.serviceDate);
        if (expired) {
          conflicts.push(
            conflict(
              trip,
              'driver_documents_expired',
              `${DRIVER_DOCUMENT_TYPE_LABELS[type]} de ${driver.fullName}: venció el ${expired}.`,
            ),
          );
        }
      }
    }
  }

  if (trip.vehicleId) {
    if (!vehicle || !vehicle.active || UNAVAILABLE_STATUSES.includes(vehicle.status)) {
      const name = vehicle ? `La unidad ${vehicle.economicNumber}` : 'La unidad';
      const state =
        vehicle?.active && vehicle.status === 'maintenance'
          ? 'está en mantenimiento'
          : vehicle?.active
            ? `está ${VEHICLE_STATUS_LABELS[vehicle.status].toLowerCase()}`
            : 'está dada de baja';
      conflicts.push(conflict(trip, 'vehicle_unavailable', `${name} ${state}.`));
    } else {
      const other = doubleBooking(trip, context.busy, 'vehicleId');
      if (other) {
        conflicts.push(
          conflict(
            trip,
            'vehicle_double_booked',
            `La unidad ${vehicle.economicNumber} tiene otro viaje a la misma hora (${other.routeCode ?? 'viaje extra'}, ${hhmm(other.startAt, timeZone)} a ${hhmm(other.endAt, timeZone)}).`,
            { otherTripId: other.id },
          ),
        );
      }
      for (const type of VEHICLE_REQUIRED_DOCUMENTS) {
        const expired = expiredOn(vehicle.documents, type, trip.serviceDate);
        if (expired) {
          conflicts.push(
            conflict(
              trip,
              'vehicle_documents_expired',
              `${VEHICLE_DOCUMENT_TYPE_LABELS[type]} de la unidad ${vehicle.economicNumber}: venció el ${expired}.`,
            ),
          );
        }
      }
      if (trip.passengers > vehicle.capacity) {
        conflicts.push(
          conflict(
            trip,
            'capacity_exceeded',
            `La unidad ${vehicle.economicNumber} tiene ${vehicle.capacity} asientos y la ruta tiene ${trip.passengers} pasajeros asignados.`,
          ),
        );
      }
    }
  }
  return conflicts;
}

/** Choferes que podrían hacer el viaje: activos, con licencia y documentos vigentes y libres. */
export function availableDrivers(
  trip: TripForConflicts,
  context: ConflictContext,
): DriverForConflicts[] {
  const vehicle = trip.vehicleId ? context.vehicles.get(trip.vehicleId) : undefined;
  return [...context.drivers.values()]
    .filter(
      (driver) =>
        driver.active &&
        driver.id !== trip.driverId &&
        !licenseProblem(driver, vehicle, trip.serviceDate) &&
        DRIVER_REQUIRED_DOCUMENTS.every(
          (type) => !expiredOn(driver.documents, type, trip.serviceDate),
        ) &&
        !context.busy.some(
          (other) => other.id !== trip.id && other.driverId === driver.id && overlaps(trip, other),
        ),
    )
    .sort(
      (a, b) =>
        Number(b.id === trip.habitualDriverId) - Number(a.id === trip.habitualDriverId) ||
        a.fullName.localeCompare(b.fullName),
    );
}

/** Unidades que podrían hacer el viaje: disponibles, con documentos vigentes, libres y con cupo. */
export function availableVehicles(
  trip: TripForConflicts,
  context: ConflictContext,
): VehicleForConflicts[] {
  return [...context.vehicles.values()]
    .filter(
      (vehicle) =>
        vehicle.active &&
        vehicle.id !== trip.vehicleId &&
        !UNAVAILABLE_STATUSES.includes(vehicle.status) &&
        vehicle.capacity >= trip.passengers &&
        VEHICLE_REQUIRED_DOCUMENTS.every(
          (type) => !expiredOn(vehicle.documents, type, trip.serviceDate),
        ) &&
        !context.busy.some(
          (other) =>
            other.id !== trip.id && other.vehicleId === vehicle.id && overlaps(trip, other),
        ),
    )
    .sort(
      (a, b) =>
        Number(b.id === trip.habitualVehicleId) - Number(a.id === trip.habitualVehicleId) ||
        a.capacity - b.capacity ||
        a.economicNumber.localeCompare(b.economicNumber),
    );
}

function driverOptions(trip: TripForConflicts, context: ConflictContext): SuggestionOption[] {
  return availableDrivers(trip, context)
    .slice(0, MAX_OPTIONS)
    .map((driver) => ({ kind: 'driver', id: driver.id, label: driver.fullName }));
}

function vehicleOptions(trip: TripForConflicts, context: ConflictContext): SuggestionOption[] {
  return availableVehicles(trip, context)
    .slice(0, MAX_OPTIONS)
    .map((vehicle) => ({
      kind: 'vehicle',
      id: vehicle.id,
      label: `${vehicle.economicNumber} (${vehicle.capacity} asientos)`,
    }));
}

function suggestion(intro: string, options: SuggestionOption[], none: string) {
  if (options.length === 0) return { message: none, options };
  return { message: `${intro} ${options.map((o) => o.label).join(', ')}.`, options };
}

/** Agrega a cada conflicto una sugerencia de solución con opciones concretas. */
export function suggestFixes(
  conflict: Conflict,
  trip: TripForConflicts,
  context: ConflictContext,
): Conflict {
  const noDrivers = 'No hay choferes libres con documentos vigentes a esa hora.';
  const noVehicles = 'No hay unidades libres con cupo y documentos vigentes a esa hora.';
  switch (conflict.type) {
    case 'driver_double_booked':
    case 'driver_inactive':
      return {
        ...conflict,
        suggestion: suggestion('Asigna otro chofer:', driverOptions(trip, context), noDrivers),
      };
    case 'driver_license_invalid':
    case 'driver_documents_expired':
      return {
        ...conflict,
        suggestion: suggestion(
          'Actualiza el documento en el expediente del chofer o asigna otro:',
          driverOptions(trip, context),
          `Actualiza el documento en el expediente del chofer. ${noDrivers}`,
        ),
      };
    case 'vehicle_double_booked':
    case 'vehicle_unavailable':
      return {
        ...conflict,
        suggestion: suggestion('Usa otra unidad:', vehicleOptions(trip, context), noVehicles),
      };
    case 'vehicle_documents_expired':
      return {
        ...conflict,
        suggestion: suggestion(
          'Renueva el documento de la unidad o usa otra:',
          vehicleOptions(trip, context),
          `Renueva el documento de la unidad. ${noVehicles}`,
        ),
      };
    case 'capacity_exceeded':
      return {
        ...conflict,
        suggestion: suggestion(
          `Usa una unidad con al menos ${trip.passengers} asientos:`,
          vehicleOptions(trip, context),
          'No hay unidades libres con ese cupo; considera dividir la ruta.',
        ),
      };
    case 'unassigned': {
      const options = [
        ...(trip.driverId ? [] : driverOptions(trip, context).slice(0, 2)),
        ...(trip.vehicleId ? [] : vehicleOptions(trip, context).slice(0, 2)),
      ];
      return {
        ...conflict,
        suggestion: suggestion(
          'Disponibles:',
          options,
          'No hay choferes ni unidades libres a esa hora.',
        ),
      };
    }
  }
}

export function blocking(conflicts: readonly Conflict[]) {
  return conflicts.filter((c) => c.severity === 'error');
}
