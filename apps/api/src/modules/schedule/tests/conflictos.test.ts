import { describe, expect, it } from 'vitest';

import {
  availableDrivers,
  availableVehicles,
  blocking,
  suggestFixes,
  tripConflicts,
} from '../conflicts.ts';
import type {
  ConflictContext,
  DriverForConflicts,
  TripForConflicts,
  VehicleForConflicts,
} from '../conflicts.ts';

const TZ = 'America/Ciudad_Juarez';
const DATE = '2026-10-12';

function at(time: string) {
  // Ciudad Juárez en octubre: UTC-6.
  return new Date(`${DATE}T${time}:00-06:00`);
}

function trip(overrides: Partial<TripForConflicts> = {}): TripForConflicts {
  return {
    id: 'trip-1',
    routeId: 'route-1',
    routeCode: 'R-01',
    serviceDate: DATE,
    startAt: at('05:00'),
    endAt: at('06:00'),
    driverId: 'juan',
    vehicleId: 'u1',
    passengers: 10,
    ...overrides,
  };
}

function driver(overrides: Partial<DriverForConflicts> = {}): DriverForConflicts {
  return {
    id: 'juan',
    fullName: 'Juan Pérez',
    active: true,
    licenseType: 'Federal B',
    documents: [
      { type: 'license', expiresOn: '2028-01-01' },
      { type: 'medical_exam', expiresOn: '2027-01-01' },
    ],
    ...overrides,
  };
}

function vehicle(overrides: Partial<VehicleForConflicts> = {}): VehicleForConflicts {
  return {
    id: 'u1',
    economicNumber: 'U-001',
    capacity: 19,
    status: 'available',
    active: true,
    requiredLicenseType: null,
    documents: [{ type: 'insurance', expiresOn: '2027-06-30' }],
    ...overrides,
  };
}

function context(input: {
  drivers?: DriverForConflicts[];
  vehicles?: VehicleForConflicts[];
  busy?: TripForConflicts[];
}): ConflictContext {
  return {
    drivers: new Map((input.drivers ?? [driver()]).map((d) => [d.id, d])),
    vehicles: new Map((input.vehicles ?? [vehicle()]).map((v) => [v.id, v])),
    busy: input.busy ?? [],
  };
}

function types(t: TripForConflicts, ctx: ConflictContext) {
  return tripConflicts(t, ctx, TZ).map((c) => c.type);
}

describe('detector de conflictos', () => {
  it('un viaje bien asignado no tiene conflictos', () => {
    expect(types(trip(), context({}))).toEqual([]);
  });

  it('chofer en dos viajes a la vez', () => {
    const other = trip({
      id: 'trip-2',
      routeCode: 'R-02',
      startAt: at('05:30'),
      endAt: at('06:30'),
      vehicleId: 'u2',
    });
    const conflicts = tripConflicts(trip(), context({ busy: [other] }), TZ);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      type: 'driver_double_booked',
      severity: 'error',
      otherTripId: 'trip-2',
      message: 'Juan Pérez tiene otro viaje a la misma hora (R-02, 05:30 a 06:30).',
    });
    // Viajes que solo se tocan en la hora de llegada no chocan.
    const after = trip({ id: 'trip-3', startAt: at('06:00'), endAt: at('07:00'), vehicleId: 'u2' });
    expect(types(trip(), context({ busy: [after] }))).toEqual([]);
  });

  it('unidad en dos viajes a la vez', () => {
    const other = trip({
      id: 'trip-2',
      driverId: 'pedro',
      startAt: at('04:30'),
      endAt: at('05:15'),
    });
    expect(types(trip(), context({ busy: [other] }))).toEqual(['vehicle_double_booked']);
  });

  it('unidad en mantenimiento, fuera de servicio o dada de baja', () => {
    expect(
      tripConflicts(trip(), context({ vehicles: [vehicle({ status: 'maintenance' })] }), TZ)[0],
    ).toMatchObject({
      type: 'vehicle_unavailable',
      message: 'La unidad U-001 está en mantenimiento.',
    });
    expect(
      tripConflicts(trip(), context({ vehicles: [vehicle({ status: 'out_of_service' })] }), TZ)[0]!
        .message,
    ).toBe('La unidad U-001 está fuera de servicio.');
    expect(
      tripConflicts(trip(), context({ vehicles: [vehicle({ active: false })] }), TZ)[0]!.message,
    ).toBe('La unidad U-001 está dada de baja.');
  });

  it('documentos vencidos de la unidad a la fecha del viaje', () => {
    const expired = vehicle({
      documents: [
        { type: 'insurance', expiresOn: '2026-10-11' },
        { type: 'other', expiresOn: '2020-01-01' },
      ],
    });
    const conflicts = tripConflicts(trip(), context({ vehicles: [expired] }), TZ);
    expect(conflicts.map((c) => c.message)).toEqual([
      'Seguro de la unidad U-001: venció el 2026-10-11.',
    ]);
    // Vence el mismo día del viaje: todavía es válido.
    const sameDay = vehicle({ documents: [{ type: 'insurance', expiresOn: DATE }] });
    expect(types(trip(), context({ vehicles: [sameDay] }))).toEqual([]);
    // Un documento renovado reemplaza al vencido.
    const renewed = vehicle({
      documents: [
        { type: 'insurance', expiresOn: '2026-01-01' },
        { type: 'insurance', expiresOn: '2027-01-01' },
      ],
    });
    expect(types(trip(), context({ vehicles: [renewed] }))).toEqual([]);
  });

  it('documentos vencidos del chofer', () => {
    const expired = driver({
      documents: [
        { type: 'license', expiresOn: null },
        { type: 'medical_exam', expiresOn: '2026-09-30' },
        { type: 'drug_test', expiresOn: '2026-10-01' },
      ],
    });
    const conflicts = tripConflicts(trip(), context({ drivers: [expired] }), TZ);
    expect(conflicts.map((c) => [c.type, c.message])).toEqual([
      ['driver_documents_expired', 'Examen médico de Juan Pérez: venció el 2026-09-30.'],
      ['driver_documents_expired', 'Antidoping de Juan Pérez: venció el 2026-10-01.'],
    ]);
  });

  it('licencia no válida: sin licencia, vencida o de otro tipo', () => {
    const none = driver({ documents: [] });
    expect(tripConflicts(trip(), context({ drivers: [none] }), TZ)[0]).toMatchObject({
      type: 'driver_license_invalid',
      message: 'Juan Pérez no tiene licencia registrada.',
    });
    const expired = driver({ documents: [{ type: 'license', expiresOn: '2026-10-01' }] });
    expect(tripConflicts(trip(), context({ drivers: [expired] }), TZ)[0]!.message).toBe(
      'La licencia de Juan Pérez venció el 2026-10-01.',
    );
    const wrongType = driver({ licenseType: 'C' });
    const strict = vehicle({ requiredLicenseType: 'Federal B' });
    expect(
      tripConflicts(trip(), context({ drivers: [wrongType], vehicles: [strict] }), TZ)[0]!.message,
    ).toBe('La unidad U-001 requiere licencia Federal B y Juan Pérez tiene C.');
    // Mayúsculas y espacios no importan.
    const sameType = driver({ licenseType: ' federal  b ' });
    expect(types(trip(), context({ drivers: [sameType], vehicles: [strict] }))).toEqual([]);
  });

  it('chofer inactivo', () => {
    expect(types(trip(), context({ drivers: [driver({ active: false })] }))).toEqual([
      'driver_inactive',
    ]);
  });

  it('capacidad menor que los pasajeros asignados es una advertencia', () => {
    const conflicts = tripConflicts(trip({ passengers: 22 }), context({}), TZ);
    expect(conflicts).toEqual([
      expect.objectContaining({
        type: 'capacity_exceeded',
        severity: 'warning',
        message: 'La unidad U-001 tiene 19 asientos y la ruta tiene 22 pasajeros asignados.',
      }),
    ]);
    expect(blocking(conflicts)).toEqual([]);
  });

  it('viaje sin asignar', () => {
    expect(
      tripConflicts(trip({ driverId: null, vehicleId: null }), context({}), TZ)[0],
    ).toMatchObject({
      type: 'unassigned',
      severity: 'warning',
      message: 'Falta asignar chofer y unidad.',
    });
    expect(tripConflicts(trip({ vehicleId: null }), context({}), TZ)[0]!.message).toBe(
      'Falta asignar unidad.',
    );
  });
});

describe('sugerencias de solución', () => {
  const maria = driver({ id: 'maria', fullName: 'María López' });
  const pedro = driver({ id: 'pedro', fullName: 'Pedro Ruiz', documents: [] });
  const busyAna = driver({ id: 'ana', fullName: 'Ana Díaz' });
  const u2 = vehicle({ id: 'u2', economicNumber: 'U-002', capacity: 40 });
  const u3 = vehicle({ id: 'u3', economicNumber: 'U-003', capacity: 25 });
  const small = vehicle({ id: 'u4', economicNumber: 'U-004', capacity: 8 });
  const broken = vehicle({ id: 'u5', economicNumber: 'U-005', status: 'maintenance' });

  it('propone choferes libres con licencia y documentos vigentes', () => {
    const anaTrip = trip({ id: 'trip-9', driverId: 'ana', vehicleId: 'u9' });
    const other = trip({ id: 'trip-2', vehicleId: 'u2' });
    const ctx = context({ drivers: [driver(), maria, pedro, busyAna], busy: [other, anaTrip] });
    const [conflict] = tripConflicts(trip(), ctx, TZ);
    const fixed = suggestFixes(conflict!, trip(), ctx);
    expect(fixed.suggestion).toEqual({
      message: 'Asigna otro chofer: María López.',
      options: [{ kind: 'driver', id: 'maria', label: 'María López' }],
    });
    expect(availableDrivers(trip(), ctx).map((d) => d.id)).toEqual(['maria']);
  });

  it('propone unidades libres con cupo, de la más chica a la más grande, y la habitual primero', () => {
    const ctx = context({ vehicles: [vehicle({ status: 'maintenance' }), u2, u3, small, broken] });
    const t = trip({ passengers: 12 });
    const [conflict] = tripConflicts(t, ctx, TZ);
    expect(suggestFixes(conflict!, t, ctx).suggestion!.message).toBe(
      'Usa otra unidad: U-003 (25 asientos), U-002 (40 asientos).',
    );
    expect(availableVehicles({ ...t, habitualVehicleId: 'u2' }, ctx).map((v) => v.id)).toEqual([
      'u2',
      'u3',
    ]);
  });

  it('avisa cuando no hay con quién reemplazar', () => {
    const ctx = context({ drivers: [driver({ active: false })] });
    const [conflict] = tripConflicts(trip(), ctx, TZ);
    expect(suggestFixes(conflict!, trip(), ctx).suggestion).toEqual({
      message: 'No hay choferes libres con documentos vigentes a esa hora.',
      options: [],
    });
  });
});
