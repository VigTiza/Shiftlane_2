import { todayIn, zonedDateTime } from '@shiftlane/shared';

import type { DbClient, DbTransaction } from '../../lib/db.ts';
import { fromDbDate, toDbDate } from '../../lib/http-schemas.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import { datesBetween, effectiveVersion, stopTimeFor } from '../routes/versioning.ts';

type Db = DbClient | DbTransaction;

/** Prefijo de las cancelaciones que hace el generador (las manuales no se reactivan solas). */
export const AUTO_CANCEL_PREFIX = '[Automático] ';
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];
const ARRIVAL_MARGIN_MINUTES = 10;

export interface GenerationResult {
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
}

interface DesiredTrip {
  routeVersionId: string;
  shiftId: string | null;
  temporaryChangeId: string | null;
  startAt: Date;
  endAt: Date;
  isHoliday: boolean;
}

type Decision = { trip: DesiredTrip; skip?: never } | { skip: string; trip?: never };

function sameInstant(a: Date, b: Date) {
  return a.getTime() === b.getTime();
}

function plusMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Genera los viajes regulares de una transportista para un rango de fechas a partir de las
 * rutas vigentes, sus turnos, los días festivos y los cambios temporales. Es idempotente: crea
 * los que faltan, actualiza los programados que cambiaron y cancela los que ya no aplican.
 * Nunca toca viajes iniciados ni terminados, ni reactiva cancelaciones manuales, ni modifica
 * fechas pasadas.
 */
export async function generateTrips(
  db: Db,
  params: { tenantId: string; from: string; to: string; routeIds?: string[] },
): Promise<GenerationResult> {
  const result: GenerationResult = { created: 0, updated: 0, cancelled: 0, unchanged: 0 };
  const routes = await db.route.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.routeIds ? { id: { in: params.routeIds } } : {}),
      // Las eliminadas solo si aún tienen viajes programados que cancelar.
      OR: [
        { deletedAt: null },
        { trips: { some: { status: 'scheduled', serviceDate: { gte: toDbDate(params.from) } } } },
      ],
    },
    include: { shift: true, plant: { select: { timezone: true } } },
  });
  if (routes.length === 0) return result;
  const routeIds = routes.map((r) => r.id);

  const [versions, changes, holidays, existing, agreements] = await Promise.all([
    db.routeVersion.findMany({ where: { routeId: { in: routeIds }, deletedAt: null } }),
    db.temporaryChange.findMany({ where: { routeId: { in: routeIds } } }),
    db.holiday.findMany({
      where: {
        tenantId: params.tenantId,
        date: { gte: toDbDate(params.from), lte: toDbDate(params.to) },
      },
    }),
    db.trip.findMany({
      where: {
        tenantId: params.tenantId,
        kind: 'regular',
        routeId: { in: routeIds },
        serviceDate: { gte: toDbDate(params.from), lte: toDbDate(params.to) },
      },
    }),
    db.serviceAgreement.findMany({
      where: { tenantId: params.tenantId, status: 'active', deletedAt: null },
      select: { plantId: true, startsOn: true, endsOn: true },
    }),
  ]);
  const agreementByPlant = new Map(
    agreements.map((a) => [
      a.plantId,
      { startsOn: fromDbDate(a.startsOn), endsOn: fromDbDate(a.endsOn) },
    ]),
  );

  // Primer y último horario de cada versión (por día de la semana).
  const stops = await db.stop.findMany({
    where: { routeVersionId: { in: versions.map((v) => v.id) } },
    select: {
      id: true,
      routeVersionId: true,
      sequence: true,
      times: { select: { weekdays: true, time: true } },
    },
    orderBy: { sequence: 'asc' },
  });
  const stopsByVersion = new Map<string, typeof stops>();
  for (const stop of stops) {
    const list = stopsByVersion.get(stop.routeVersionId) ?? [];
    list.push(stop);
    stopsByVersion.set(stop.routeVersionId, list);
  }
  const existingByKey = new Map(existing.map((trip) => [trip.generationKey, trip]));
  const toCreate: Prisma.TripCreateManyInput[] = [];

  for (const route of routes) {
    const timeZone = route.plant.timezone;
    const today = todayIn(timeZone);
    const from = params.from < today ? today : params.from;
    if (from > params.to) continue;
    const routeVersions = versions
      .filter((v) => v.routeId === route.id)
      .map((v) => ({ id: v.id, kind: v.kind, validFrom: fromDbDate(v.validFrom)! }));
    const routeChanges = changes
      .filter((c) => c.routeId === route.id)
      .map((c) => ({
        id: c.id,
        versionId: c.routeVersionId,
        startsOn: fromDbDate(c.startsOn)!,
        endsOn: fromDbDate(c.endsOn)!,
        cancelled: c.cancelledAt !== null,
        reason: c.reason,
      }));

    for (const date of datesBetween(from, params.to)) {
      const agreement = agreementByPlant.get(route.plantId);
      const decision: Decision =
        agreement &&
        (!agreement.startsOn || agreement.startsOn <= date) &&
        (!agreement.endsOn || date <= agreement.endsOn)
          ? decide(route, date, timeZone, routeVersions, routeChanges, holidays, stopsByVersion)
          : { skip: 'Sin acuerdo de servicio vigente con la planta' };
      const key = `${route.id}:${date}`;
      const current = existingByKey.get(key);

      if (decision.skip !== undefined) {
        if (current && current.status === 'scheduled') {
          await db.trip.update({
            where: { id: current.id },
            data: { status: 'cancelled', cancelReason: AUTO_CANCEL_PREFIX + decision.skip },
          });
          result.cancelled += 1;
        } else if (current) {
          result.unchanged += 1;
        }
        continue;
      }

      const desired = decision.trip;
      if (!current) {
        toCreate.push({
          tenantId: route.tenantId,
          plantId: route.plantId,
          routeId: route.id,
          routeVersionId: desired.routeVersionId,
          shiftId: desired.shiftId,
          temporaryChangeId: desired.temporaryChangeId,
          kind: 'regular',
          direction: route.direction,
          serviceDate: toDbDate(date),
          scheduledStartAt: desired.startAt,
          scheduledEndAt: desired.endAt,
          isHoliday: desired.isHoliday,
          generationKey: key,
        });
        continue;
      }

      const autoCancelled =
        current.status === 'cancelled' && current.cancelReason?.startsWith(AUTO_CANCEL_PREFIX);
      if (current.status !== 'scheduled' && !autoCancelled) {
        result.unchanged += 1;
        continue;
      }
      const changed =
        autoCancelled ||
        current.routeVersionId !== desired.routeVersionId ||
        current.shiftId !== desired.shiftId ||
        current.temporaryChangeId !== desired.temporaryChangeId ||
        current.isHoliday !== desired.isHoliday ||
        current.direction !== route.direction ||
        !sameInstant(current.scheduledStartAt, desired.startAt) ||
        !sameInstant(current.scheduledEndAt, desired.endAt);
      if (!changed) {
        result.unchanged += 1;
        continue;
      }
      await db.trip.update({
        where: { id: current.id },
        data: {
          status: 'scheduled',
          cancelReason: null,
          routeVersionId: desired.routeVersionId,
          shiftId: desired.shiftId,
          temporaryChangeId: desired.temporaryChangeId,
          direction: route.direction,
          scheduledStartAt: desired.startAt,
          scheduledEndAt: desired.endAt,
          isHoliday: desired.isHoliday,
        },
      });
      result.updated += 1;
    }
  }

  if (toCreate.length > 0) {
    // skipDuplicates: si dos generaciones corren a la vez, la llave única evita duplicar.
    const created = await db.trip.createMany({ data: toCreate, skipDuplicates: true });
    result.created += created.count;
  }
  return result;
}

interface RouteForDecision {
  plantId: string;
  active: boolean;
  deletedAt: Date | null;
  direction: 'inbound' | 'outbound';
  shiftId: string | null;
  shift: {
    active: boolean;
    deletedAt: Date | null;
    weekdays: number[];
    startsAt: string;
    endsAt: string;
  } | null;
}

function decide(
  route: RouteForDecision,
  date: string,
  timeZone: string,
  versions: { id: string; kind: 'regular' | 'temporary'; validFrom: string }[],
  changes: {
    id: string;
    versionId: string | null;
    startsOn: string;
    endsOn: string;
    cancelled: boolean;
    reason: string;
  }[],
  holidays: { plantId: string | null; date: Date; name: string; serviceRuns: boolean }[],
  stopsByVersion: Map<
    string,
    { sequence: number; times: { weekdays: number[]; time: string }[] }[]
  >,
): Decision {
  if (route.deletedAt) return { skip: 'Ruta eliminada' };
  if (!route.active) return { skip: 'Ruta inactiva' };
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (route.shift && (!route.shift.active || route.shift.deletedAt))
    return { skip: 'Turno inactivo' };
  if (!(route.shift?.weekdays ?? DEFAULT_WEEKDAYS).includes(weekday))
    return { skip: 'Sin turno ese día' };

  const dayHolidays = holidays.filter((h) => fromDbDate(h.date) === date);
  const holiday =
    dayHolidays.find((h) => h.plantId === route.plantId) ??
    dayHolidays.find((h) => h.plantId === null);
  if (holiday && !holiday.serviceRuns) return { skip: `Día festivo: ${holiday.name}` };

  const effective = effectiveVersion(versions, changes, date);
  if (!effective) return { skip: 'La ruta aún no existe' };
  if (effective.suspended || !effective.versionId) {
    const change = changes.find((c) => c.id === effective.temporaryChangeId);
    return { skip: `Servicio suspendido: ${change?.reason ?? 'cambio temporal'}` };
  }

  const versionStops = stopsByVersion.get(effective.versionId) ?? [];
  const firstTime = versionStops[0] ? stopTimeFor(versionStops[0].times, date) : null;
  const lastTime = versionStops.at(-1) ? stopTimeFor(versionStops.at(-1)!.times, date) : null;
  if (!firstTime || !lastTime) return { skip: 'Sin horario ese día' };

  let startAt: Date;
  let endAt: Date;
  if (route.direction === 'inbound') {
    // Entrada: sale de la primera parada y llega a la planta a la hora de entrada del turno.
    startAt = zonedDateTime(date, firstTime, timeZone);
    endAt = route.shift
      ? zonedDateTime(date, route.shift.startsAt, timeZone)
      : plusMinutes(zonedDateTime(date, lastTime, timeZone), ARRIVAL_MARGIN_MINUTES);
  } else {
    // Salida: sale de la planta al terminar el turno y deja a todos en la última parada.
    startAt = route.shift
      ? zonedDateTime(date, route.shift.endsAt, timeZone)
      : zonedDateTime(date, firstTime, timeZone);
    endAt = zonedDateTime(date, lastTime, timeZone);
  }
  // Turnos que cruzan la medianoche.
  while (endAt <= startAt) endAt = plusMinutes(endAt, 24 * 60);

  return {
    trip: {
      routeVersionId: effective.versionId,
      shiftId: route.shiftId,
      temporaryChangeId: effective.temporaryChangeId,
      startAt,
      endAt,
      isHoliday: Boolean(holiday),
    },
  };
}
