import { addDays } from '@shiftlane/shared';

import type { DbClient, DbTransaction } from '../../lib/db.ts';
import { fromDbDate, toDbDate } from '../../lib/http-schemas.ts';
import type { TripAssignmentSource } from '../../generated/prisma/client.ts';
import { blocking, suggestFixes, tripConflicts } from './conflicts.ts';
import type {
  Conflict,
  ConflictContext,
  DriverForConflicts,
  TripForConflicts,
  VehicleForConflicts,
} from './conflicts.ts';

type Db = DbClient | DbTransaction;

export interface PlannedTrip extends TripForConflicts {
  plantId: string;
  timeZone: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  kind: 'regular' | 'extra';
  generationKey: string | null;
  assignmentSource: TripAssignmentSource | null;
}

export interface ScheduleSnapshot {
  /** Viajes programados del rango pedido. */
  trips: PlannedTrip[];
  context: ConflictContext & { busy: PlannedTrip[] };
  /** Unidad habitual de cada chofer. */
  habitualVehicleByDriver: ReadonlyMap<string, string | null>;
}

/**
 * Carga lo necesario para revisar conflictos en un rango: viajes activos (un día antes y
 * después para los que cruzan la medianoche), choferes y unidades con sus documentos y los
 * pasajeros asignados a cada ruta.
 */
export async function loadSnapshot(
  db: Db,
  tenantId: string,
  range: {
    from: string;
    to: string;
    plantId?: string | undefined;
    routeIds?: string[] | undefined;
  },
): Promise<ScheduleSnapshot> {
  const rows = await db.trip.findMany({
    where: {
      tenantId,
      status: { in: ['scheduled', 'in_progress'] },
      serviceDate: { gte: toDbDate(addDays(range.from, -1)), lte: toDbDate(addDays(range.to, 1)) },
    },
    include: {
      route: { select: { code: true, habitualDriverId: true, habitualVehicleId: true } },
      plant: { select: { timezone: true } },
    },
    orderBy: [{ scheduledStartAt: 'asc' }, { id: 'asc' }],
  });
  const routeIds = [
    ...new Set(rows.map((r) => r.routeId).filter((id): id is string => id !== null)),
  ];
  const assignments = await db.routePassenger.findMany({
    where: {
      routeId: { in: routeIds },
      deletedAt: null,
      passenger: { status: 'active', deletedAt: null },
    },
    select: { routeId: true },
  });
  const passengersByRoute = new Map<string, number>();
  for (const { routeId } of assignments) {
    passengersByRoute.set(routeId, (passengersByRoute.get(routeId) ?? 0) + 1);
  }

  const all: PlannedTrip[] = rows.map((row) => ({
    id: row.id,
    plantId: row.plantId,
    timeZone: row.plant.timezone,
    status: row.status,
    kind: row.kind,
    generationKey: row.generationKey,
    routeId: row.routeId,
    routeCode: row.route?.code ?? null,
    serviceDate: fromDbDate(row.serviceDate)!,
    startAt: row.scheduledStartAt,
    endAt: row.scheduledEndAt,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    assignmentSource: row.assignmentSource,
    passengers: row.routeId ? (passengersByRoute.get(row.routeId) ?? 0) : 0,
    habitualDriverId: row.route?.habitualDriverId ?? null,
    habitualVehicleId: row.route?.habitualVehicleId ?? null,
  }));

  const [drivers, vehicles] = await Promise.all([
    db.driver.findMany({
      where: { tenantId },
      select: {
        id: true,
        fullName: true,
        status: true,
        deletedAt: true,
        licenseType: true,
        habitualVehicleId: true,
        documents: { where: { deletedAt: null }, select: { type: true, expiresOn: true } },
      },
    }),
    db.vehicle.findMany({
      where: { tenantId },
      select: {
        id: true,
        economicNumber: true,
        capacity: true,
        status: true,
        deletedAt: true,
        requiredLicenseType: true,
        documents: { where: { deletedAt: null }, select: { type: true, expiresOn: true } },
      },
    }),
  ]);

  return {
    habitualVehicleByDriver: new Map(drivers.map((d) => [d.id, d.habitualVehicleId])),
    trips: all.filter(
      (trip) =>
        trip.status === 'scheduled' &&
        trip.serviceDate >= range.from &&
        trip.serviceDate <= range.to &&
        (!range.plantId || trip.plantId === range.plantId) &&
        (!range.routeIds || (trip.routeId !== null && range.routeIds.includes(trip.routeId))),
    ),
    context: {
      busy: all,
      drivers: new Map(
        drivers.map((d): [string, DriverForConflicts] => [
          d.id,
          {
            id: d.id,
            fullName: d.fullName,
            active: d.status === 'active' && d.deletedAt === null,
            licenseType: d.licenseType,
            documents: d.documents.map((doc) => ({
              type: doc.type,
              expiresOn: fromDbDate(doc.expiresOn),
            })),
          },
        ]),
      ),
      vehicles: new Map(
        vehicles.map((v): [string, VehicleForConflicts] => [
          v.id,
          {
            id: v.id,
            economicNumber: v.economicNumber,
            capacity: v.capacity,
            status: v.status,
            active: v.deletedAt === null,
            requiredLicenseType: v.requiredLicenseType,
            documents: v.documents.map((doc) => ({
              type: doc.type,
              expiresOn: fromDbDate(doc.expiresOn),
            })),
          },
        ]),
      ),
    },
  };
}

/** Conflictos con sugerencia de solución de un viaje (con su asignación actual o una propuesta). */
export function conflictsFor(trip: PlannedTrip, snapshot: ScheduleSnapshot): Conflict[] {
  return tripConflicts(trip, snapshot.context, trip.timeZone).map((c) =>
    suggestFixes(c, trip, snapshot.context),
  );
}

/** Cambia la asignación de un viaje dentro del snapshot (para revisar los siguientes). */
export function applyInSnapshot(
  snapshot: ScheduleSnapshot,
  trip: PlannedTrip,
  driverId: string | null,
  vehicleId: string | null,
) {
  trip.driverId = driverId;
  trip.vehicleId = vehicleId;
  const busy = snapshot.context.busy.find((t) => t.id === trip.id);
  if (busy && busy !== trip) {
    busy.driverId = driverId;
    busy.vehicleId = vehicleId;
  }
}

export async function saveAssignment(
  db: Db,
  tripId: string,
  input: {
    driverId: string | null;
    vehicleId: string | null;
    source: TripAssignmentSource;
    userId: string | null;
  },
) {
  const assigned = input.driverId !== null || input.vehicleId !== null;
  await db.trip.update({
    where: { id: tripId },
    data: {
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      assignmentSource: assigned ? input.source : null,
      assignedAt: assigned ? new Date() : null,
      assignedByUserId: assigned ? input.userId : null,
    },
  });
}

export interface SkippedAssignment {
  tripId: string;
  routeCode: string | null;
  serviceDate: string;
  reasons: string[];
}

function skipped(trip: PlannedTrip, conflicts: Conflict[]): SkippedAssignment {
  return {
    tripId: trip.id,
    routeCode: trip.routeCode,
    serviceDate: trip.serviceDate,
    reasons: conflicts.map((c) => c.message),
  };
}

/**
 * Asigna el chofer y la unidad habituales de cada ruta a sus viajes programados sin
 * asignación (o con una asignación habitual que cambió). Nunca reemplaza asignaciones
 * manuales o copiadas, y no asigna si eso crea un conflicto que bloquea: el viaje queda
 * pendiente y aparece en los conflictos.
 */
export async function autoAssign(
  db: Db,
  tenantId: string,
  range: {
    from: string;
    to: string;
    plantId?: string | undefined;
    routeIds?: string[] | undefined;
  },
) {
  const snapshot = await loadSnapshot(db, tenantId, range);
  const result = { assigned: 0, unchanged: 0, skipped: [] as SkippedAssignment[] };
  for (const trip of snapshot.trips) {
    if (trip.assignmentSource === 'manual' || trip.assignmentSource === 'copied') continue;
    // Sin unidad habitual en la ruta, se usa la unidad habitual del chofer.
    const driverId = trip.habitualDriverId ?? null;
    const vehicleId =
      trip.habitualVehicleId ??
      (driverId ? (snapshot.habitualVehicleByDriver.get(driverId) ?? null) : null);
    if (!driverId && !vehicleId) continue;
    if (trip.driverId === driverId && trip.vehicleId === vehicleId) {
      result.unchanged += 1;
      continue;
    }
    const previous = { driverId: trip.driverId, vehicleId: trip.vehicleId };
    applyInSnapshot(snapshot, trip, driverId, vehicleId);
    const problems = blocking(tripConflicts(trip, snapshot.context, trip.timeZone));
    if (problems.length > 0) {
      applyInSnapshot(snapshot, trip, previous.driverId, previous.vehicleId);
      result.skipped.push(skipped(trip, problems));
      continue;
    }
    await saveAssignment(db, trip.id, { driverId, vehicleId, source: 'habitual', userId: null });
    trip.assignmentSource = 'habitual';
    result.assigned += 1;
  }
  return result;
}

/**
 * Copia la asignación de una semana a otra (por ruta y día de la semana). Respeta las
 * asignaciones manuales de la semana destino salvo que se pida reemplazarlas, y no copia las
 * que crean un conflicto que bloquea.
 */
export async function copyWeek(
  db: Db,
  tenantId: string,
  userId: string,
  input: {
    sourceStart: string;
    targetStart: string;
    plantId?: string | undefined;
    routeIds?: string[] | undefined;
    overwrite: boolean;
  },
) {
  const sourceEnd = addDays(input.sourceStart, 6);
  const targetEnd = addDays(input.targetStart, 6);
  const offsetDays = Math.round(
    (Date.parse(`${input.targetStart}T00:00:00Z`) - Date.parse(`${input.sourceStart}T00:00:00Z`)) /
      86_400_000,
  );
  const sources = await db.trip.findMany({
    where: {
      tenantId,
      kind: 'regular',
      status: { not: 'cancelled' },
      serviceDate: { gte: toDbDate(input.sourceStart), lte: toDbDate(sourceEnd) },
      OR: [{ driverId: { not: null } }, { vehicleId: { not: null } }],
      ...(input.plantId ? { plantId: input.plantId } : {}),
      ...(input.routeIds ? { routeId: { in: input.routeIds } } : {}),
    },
    select: { routeId: true, serviceDate: true, driverId: true, vehicleId: true },
  });
  const sourceByKey = new Map(
    sources.map((s) => [`${s.routeId}:${addDays(fromDbDate(s.serviceDate)!, offsetDays)}`, s]),
  );
  const snapshot = await loadSnapshot(db, tenantId, {
    from: input.targetStart,
    to: targetEnd,
    plantId: input.plantId,
    routeIds: input.routeIds,
  });
  const result = { copied: 0, unchanged: 0, skipped: [] as SkippedAssignment[] };
  for (const trip of snapshot.trips) {
    if (trip.kind !== 'regular' || !trip.generationKey) continue;
    const source = sourceByKey.get(trip.generationKey);
    if (!source) continue;
    if (trip.driverId === source.driverId && trip.vehicleId === source.vehicleId) {
      result.unchanged += 1;
      continue;
    }
    if (trip.assignmentSource === 'manual' && !input.overwrite) {
      result.skipped.push({
        tripId: trip.id,
        routeCode: trip.routeCode,
        serviceDate: trip.serviceDate,
        reasons: ['Ya tiene una asignación manual.'],
      });
      continue;
    }
    const previous = { driverId: trip.driverId, vehicleId: trip.vehicleId };
    applyInSnapshot(snapshot, trip, source.driverId, source.vehicleId);
    const problems = blocking(tripConflicts(trip, snapshot.context, trip.timeZone));
    if (problems.length > 0) {
      applyInSnapshot(snapshot, trip, previous.driverId, previous.vehicleId);
      result.skipped.push(skipped(trip, problems));
      continue;
    }
    await saveAssignment(db, trip.id, {
      driverId: source.driverId,
      vehicleId: source.vehicleId,
      source: 'copied',
      userId,
    });
    trip.assignmentSource = 'copied';
    result.copied += 1;
  }
  return result;
}
