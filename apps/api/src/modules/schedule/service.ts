import { addDays, mexicanOfficialHolidays, todayIn } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { fromDbDate, toDbDate } from '../../lib/http-schemas.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { Holiday, Prisma } from '../../generated/prisma/client.ts';
import { datesBetween } from '../routes/versioning.ts';
import {
  applyInSnapshot,
  autoAssign,
  conflictsFor,
  copyWeek,
  loadSnapshot,
  saveAssignment,
} from './assignments.ts';
import { blocking } from './conflicts.ts';
import type { ConflictSeverity } from './conflicts.ts';
import { generateTrips } from './generator.ts';
import { MAX_CONFLICT_DAYS, MAX_GENERATION_DAYS, MAX_LIST_DAYS } from './schemas.ts';

type TripStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

function mapHoliday(holiday: Holiday) {
  return {
    id: holiday.id,
    plantId: holiday.plantId,
    date: fromDbDate(holiday.date)!,
    name: holiday.name,
    serviceRuns: holiday.serviceRuns,
  };
}

/**
 * Programación: generación de viajes regulares, consulta de viajes y días festivos. Cada
 * cambio que afecta la programación (rutas, turnos, festivos, cambios temporales) llama a
 * refresh* para que los viajes ya generados reflejen el cambio en la misma transacción.
 */
export function createScheduleService(deps: { horizonDays: number; timeZone: string }) {
  /** Fin del horizonte: los 14 días de la tarea diaria o lo que ya se haya generado de más. */
  async function horizonEnd(tx: DbTransaction, tenantId: string, routeIds?: string[]) {
    const horizon = addDays(todayIn(deps.timeZone), deps.horizonDays - 1);
    const last = await tx.trip.findFirst({
      where: { tenantId, kind: 'regular', ...(routeIds ? { routeId: { in: routeIds } } : {}) },
      orderBy: { serviceDate: 'desc' },
      select: { serviceDate: true },
    });
    const lastDate = fromDbDate(last?.serviceDate ?? null);
    return lastDate && lastDate > horizon ? lastDate : horizon;
  }

  /** Desde ayer: el generador recorta a "hoy" en la zona horaria de cada planta. */
  function horizonStart() {
    return addDays(todayIn(deps.timeZone), -1);
  }

  async function refreshRoutes(tx: DbTransaction, tenantId: string, routeIds: string[]) {
    if (routeIds.length === 0) return null;
    const from = horizonStart();
    const to = await horizonEnd(tx, tenantId, routeIds);
    const result = await generateTrips(tx, { tenantId, from, to, routeIds });
    // Chofer y unidad habituales para los viajes nuevos (o si cambiaron en la ruta).
    await autoAssign(tx, tenantId, { from, to, routeIds });
    return result;
  }

  /** Regenera un día ya programado (los días fuera del horizonte se generan a su tiempo). */
  async function refreshDate(
    tx: DbTransaction,
    tenantId: string,
    date: string,
    plantId: string | null,
  ) {
    if (date > (await horizonEnd(tx, tenantId))) return null;
    const routes = plantId
      ? await tx.route.findMany({ where: { tenantId, plantId }, select: { id: true } })
      : undefined;
    return generateTrips(tx, {
      tenantId,
      from: date,
      to: date,
      routeIds: routes?.map((r) => r.id),
    });
  }

  return {
    refreshRoutes,

    async refreshShift(tx: DbTransaction, tenantId: string, shiftId: string) {
      const routes = await tx.route.findMany({
        where: { tenantId, shiftId },
        select: { id: true },
      });
      return refreshRoutes(
        tx,
        tenantId,
        routes.map((r) => r.id),
      );
    },

    async generate(tx: DbTransaction, tenantId: string, from: string, to: string) {
      if (datesBetween(from, to).length > MAX_GENERATION_DAYS) {
        throw new BadRequestError(
          `Se pueden generar como máximo ${MAX_GENERATION_DAYS} días a la vez.`,
        );
      }
      const result = await generateTrips(tx, { tenantId, from, to });
      const assignment = await autoAssign(tx, tenantId, { from, to });
      return { from, to, ...result, assigned: assignment.assigned };
    },

    // --- Asignación de unidad y chofer -----------------------------------------------

    async assign(
      tx: DbTransaction,
      tenantId: string,
      userId: string,
      tripId: string,
      input: {
        driverId?: string | null | undefined;
        vehicleId?: string | null | undefined;
        force: boolean;
      },
    ) {
      const current = await tx.trip.findFirst({ where: { id: tripId, tenantId } });
      if (!current) throw new NotFoundError('No se encontró el viaje.');
      if (current.status !== 'scheduled') {
        throw new ConflictError(
          current.status === 'cancelled'
            ? 'El viaje está cancelado.'
            : 'El viaje ya empezó o terminó; los cambios en curso se hacen desde el despacho.',
        );
      }
      const driverId = input.driverId === undefined ? current.driverId : input.driverId;
      const vehicleId = input.vehicleId === undefined ? current.vehicleId : input.vehicleId;
      if (driverId && input.driverId !== undefined) {
        const driver = await tx.driver.findFirst({ where: { id: driverId, deletedAt: null } });
        if (!driver) throw new BadRequestError('No se encontró el chofer.');
      }
      if (vehicleId && input.vehicleId !== undefined) {
        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
        if (!vehicle) throw new BadRequestError('No se encontró la unidad.');
      }

      const date = fromDbDate(current.serviceDate)!;
      const snapshot = await loadSnapshot(tx, tenantId, { from: date, to: date });
      const trip = snapshot.trips.find((t) => t.id === tripId)!;
      applyInSnapshot(snapshot, trip, driverId, vehicleId);
      const conflicts = conflictsFor(trip, snapshot);
      const errors = blocking(conflicts);
      if (errors.length > 0 && !input.force) {
        throw new AppError(
          409,
          'ASSIGNMENT_CONFLICTS',
          'La asignación tiene conflictos. Corrígelos o confirma para asignar de todos modos.',
          errors.map((c) => ({ path: c.type, message: c.message })),
        );
      }
      await saveAssignment(tx, tripId, { driverId, vehicleId, source: 'manual', userId });
      const listed = await this.listTrips(tx, { from: date, to: date, page: 1, pageSize: 500 });
      return { trip: listed.items.find((t) => t.id === tripId)!, conflicts };
    },

    async autoAssign(
      tx: DbTransaction,
      tenantId: string,
      range: {
        from: string;
        to: string;
        plantId?: string | undefined;
        routeId?: string | undefined;
      },
    ) {
      if (datesBetween(range.from, range.to).length > MAX_GENERATION_DAYS) {
        throw new BadRequestError(`Asigna como máximo ${MAX_GENERATION_DAYS} días a la vez.`);
      }
      return autoAssign(tx, tenantId, {
        from: range.from,
        to: range.to,
        plantId: range.plantId,
        routeIds: range.routeId ? [range.routeId] : undefined,
      });
    },

    /** Copia la asignación de una semana a otra; primero genera los viajes de la semana destino. */
    async copyWeek(
      tx: DbTransaction,
      tenantId: string,
      userId: string,
      input: {
        sourceWeekStart: string;
        targetWeekStart?: string | undefined;
        plantId?: string | undefined;
        routeId?: string | undefined;
        overwrite: boolean;
      },
    ) {
      const targetStart = input.targetWeekStart ?? addDays(input.sourceWeekStart, 7);
      if (targetStart === input.sourceWeekStart) {
        throw new BadRequestError('La semana destino debe ser distinta de la semana origen.');
      }
      const routeIds = input.routeId ? [input.routeId] : undefined;
      const generated = await generateTrips(tx, {
        tenantId,
        from: targetStart,
        to: addDays(targetStart, 6),
        routeIds,
      });
      const result = await copyWeek(tx, tenantId, userId, {
        sourceStart: input.sourceWeekStart,
        targetStart,
        plantId: input.plantId,
        routeIds,
        overwrite: input.overwrite,
      });
      return {
        sourceWeekStart: input.sourceWeekStart,
        targetWeekStart: targetStart,
        generated: generated.created,
        ...result,
      };
    },

    async conflicts(
      tx: DbTransaction,
      tenantId: string,
      query: {
        from?: string | undefined;
        to?: string | undefined;
        plantId?: string | undefined;
        routeId?: string | undefined;
        severity?: ConflictSeverity | undefined;
      },
    ) {
      const from = query.from ?? todayIn(deps.timeZone);
      const to = query.to ?? addDays(from, 6);
      if (datesBetween(from, to).length > MAX_CONFLICT_DAYS) {
        throw new BadRequestError(`Revisa como máximo ${MAX_CONFLICT_DAYS} días a la vez.`);
      }
      const snapshot = await loadSnapshot(tx, tenantId, {
        from,
        to,
        plantId: query.plantId,
        routeIds: query.routeId ? [query.routeId] : undefined,
      });
      const items = snapshot.trips.flatMap((trip) =>
        conflictsFor(trip, snapshot)
          .filter((c) => !query.severity || c.severity === query.severity)
          .map((c) => ({
            ...c,
            plantId: trip.plantId,
            routeId: trip.routeId,
            routeCode: trip.routeCode,
            serviceDate: trip.serviceDate,
            scheduledStartAt: trip.startAt.toISOString(),
          })),
      );
      return {
        from,
        to,
        total: items.length,
        errors: items.filter((c) => c.severity === 'error').length,
        items,
      };
    },

    async listTrips(
      tx: DbTransaction,
      query: {
        from?: string | undefined;
        to?: string | undefined;
        plantId?: string | undefined;
        routeId?: string | undefined;
        status?: TripStatus | undefined;
        kind?: 'regular' | 'extra' | undefined;
        page: number;
        pageSize: number;
      },
    ) {
      const from = query.from ?? (query.to ? addDays(query.to, -6) : todayIn(deps.timeZone));
      const to = query.to ?? addDays(from, 6);
      if (datesBetween(from, to).length > MAX_LIST_DAYS) {
        throw new BadRequestError(`Consulta como máximo ${MAX_LIST_DAYS} días a la vez.`);
      }
      const where: Prisma.TripWhereInput = {
        serviceDate: { gte: toDbDate(from), lte: toDbDate(to) },
        ...(query.plantId ? { plantId: query.plantId } : {}),
        ...(query.routeId ? { routeId: query.routeId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
      };
      const [total, trips] = await Promise.all([
        tx.trip.count({ where }),
        tx.trip.findMany({
          where,
          include: {
            route: { select: { code: true, name: true } },
            shift: { select: { name: true } },
            plant: { select: { name: true } },
            driver: { select: { fullName: true } },
            vehicle: { select: { economicNumber: true } },
          },
          orderBy: [{ scheduledStartAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return {
        from,
        to,
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: trips.map((trip) => ({
          id: trip.id,
          plantId: trip.plantId,
          plantName: trip.plant.name,
          routeId: trip.routeId,
          routeCode: trip.route?.code ?? null,
          routeName: trip.route?.name ?? null,
          routeVersionId: trip.routeVersionId,
          shiftId: trip.shiftId,
          shiftName: trip.shift?.name ?? null,
          temporaryChangeId: trip.temporaryChangeId,
          kind: trip.kind,
          status: trip.status,
          direction: trip.direction,
          serviceDate: fromDbDate(trip.serviceDate)!,
          scheduledStartAt: trip.scheduledStartAt.toISOString(),
          scheduledEndAt: trip.scheduledEndAt.toISOString(),
          isHoliday: trip.isHoliday,
          cancelReason: trip.cancelReason,
          driverId: trip.driverId,
          driverName: trip.driver?.fullName ?? null,
          vehicleId: trip.vehicleId,
          vehicleNumber: trip.vehicle?.economicNumber ?? null,
          assignmentSource: trip.assignmentSource,
        })),
      };
    },

    // --- Días festivos -------------------------------------------------------------

    async listHolidays(
      tx: DbTransaction,
      query: { year?: number | undefined; plantId?: string | undefined },
    ) {
      const year = query.year ?? Number(todayIn(deps.timeZone).slice(0, 4));
      const holidays = await tx.holiday.findMany({
        where: {
          date: { gte: toDbDate(`${year}-01-01`), lte: toDbDate(`${year}-12-31`) },
          // Los de una planta incluyen los generales.
          ...(query.plantId ? { OR: [{ plantId: query.plantId }, { plantId: null }] } : {}),
        },
        orderBy: [{ date: 'asc' }, { plantId: 'asc' }],
      });
      return holidays.map(mapHoliday);
    },

    async createHoliday(
      tx: DbTransaction,
      tenantId: string,
      input: {
        date: string;
        name: string;
        plantId?: string | null | undefined;
        serviceRuns: boolean;
      },
    ) {
      const plantId = input.plantId ?? null;
      if (plantId) {
        const agreement = await tx.serviceAgreement.findFirst({
          where: { tenantId, plantId, deletedAt: null },
        });
        if (!agreement)
          throw new BadRequestError('La planta no tiene un acuerdo de servicio con tu empresa.');
      }
      let holiday: Holiday;
      try {
        holiday = await tx.holiday.create({
          data: {
            tenantId,
            plantId,
            date: toDbDate(input.date),
            name: input.name,
            serviceRuns: input.serviceRuns,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictError('Ya hay un día festivo registrado en esa fecha.');
        throw error;
      }
      await refreshDate(tx, tenantId, input.date, plantId);
      return mapHoliday(holiday);
    },

    async updateHoliday(
      tx: DbTransaction,
      tenantId: string,
      id: string,
      input: { name?: string | undefined; serviceRuns?: boolean | undefined },
    ) {
      const current = await tx.holiday.findFirst({ where: { id } });
      if (!current) throw new NotFoundError('No se encontró el día festivo.');
      const holiday = await tx.holiday.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.serviceRuns !== undefined ? { serviceRuns: input.serviceRuns } : {}),
        },
      });
      await refreshDate(tx, tenantId, fromDbDate(holiday.date)!, holiday.plantId);
      return mapHoliday(holiday);
    },

    async removeHoliday(tx: DbTransaction, tenantId: string, id: string) {
      const holiday = await tx.holiday.findFirst({ where: { id } });
      if (!holiday) throw new NotFoundError('No se encontró el día festivo.');
      await tx.holiday.delete({ where: { id } });
      await refreshDate(tx, tenantId, fromDbDate(holiday.date)!, holiday.plantId);
    },

    /** Agrega los días de descanso obligatorio de la LFT que todavía no estén registrados. */
    async importOfficial(
      tx: DbTransaction,
      tenantId: string,
      input: { year: number; serviceRuns: boolean },
    ) {
      const official = mexicanOfficialHolidays(input.year);
      const existing = await tx.holiday.findMany({
        where: { plantId: null, date: { in: official.map((h) => toDbDate(h.date)) } },
        select: { date: true },
      });
      const taken = new Set(existing.map((h) => fromDbDate(h.date)));
      const missing = official.filter((h) => !taken.has(h.date));
      const created: Holiday[] = [];
      for (const holiday of missing) {
        created.push(
          await tx.holiday.create({
            data: {
              tenantId,
              plantId: null,
              date: toDbDate(holiday.date),
              name: holiday.name,
              serviceRuns: input.serviceRuns,
            },
          }),
        );
      }
      for (const holiday of missing) await refreshDate(tx, tenantId, holiday.date, null);
      return {
        created: created.length,
        skipped: official.length - missing.length,
        holidays: created.map(mapHoliday),
      };
    },
  };
}

export type ScheduleService = ReturnType<typeof createScheduleService>;
