import { haversineMeters } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { fromDbDate, toDbDate } from '../../lib/http-schemas.ts';
import type { RoutingProvider } from '../../lib/routing.ts';
import type { RoutesService, StopInput, VersionInput } from './service.ts';
import { datesBetween } from './versioning.ts';

const MAX_TEMPORARY_DAYS = 180;
/** A partir de esta distancia, una parada con la misma identidad se considera movida. */
const MOVED_THRESHOLD_METERS = 25;

export type Proposal =
  | {
      kind: 'temporary';
      startsOn: string;
      endsOn: string;
      suspendService: boolean;
      version?: Omit<VersionInput, 'validFrom'> | undefined;
    }
  | { kind: 'version'; validFrom: string; version: Omit<VersionInput, 'validFrom'> };

type StopDetail = Awaited<ReturnType<RoutesService['versionDetail']>>['stops'][number];

function generalTime(times: { weekdays: number[]; time: string }[]) {
  return times.find((t) => t.weekdays.length === 0)?.time ?? times[0]?.time ?? null;
}

/**
 * Cambios temporales (paradas u horarios distintos, o servicio suspendido, entre dos fechas)
 * y simulación de cualquier cambio de ruta sin guardar nada.
 */
export function createTemporaryChangesService(deps: {
  routes: RoutesService;
  routing: RoutingProvider;
}) {
  const { routes } = deps;

  async function baselineFor(tx: DbTransaction, routeId: string, date: string) {
    const data = await routes.versionsAndChanges(tx, [routeId]);
    const effective = routes.resolveEffective(routeId, data, date, true);
    if (!effective?.versionId) return null;
    return routes.versionDetail(tx, effective.versionId, null);
  }

  async function plannedMetrics(
    tx: DbTransaction,
    routeId: string,
    version: Omit<VersionInput, 'validFrom'>,
  ) {
    const route = await routes.findRoute(tx, routeId);
    if (version.path) {
      const geojson = JSON.stringify({ type: 'LineString', coordinates: version.path });
      const [row] = await tx.$queryRaw<{ meters: number }[]>`
        SELECT ST_Length(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography) AS meters`;
      return { distanceKm: Math.round((row?.meters ?? 0) / 10) / 100, durationMinutes: null };
    }
    const [plant] = await tx.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM plants WHERE id = ${route.plantId}::uuid AND location IS NOT NULL`;
    const stops = version.stops.map((stop) => stop.location);
    const points = plant
      ? route.direction === 'inbound'
        ? [...stops, plant]
        : [plant, ...stops]
      : stops;
    if (points.length < 2) return { distanceKm: null, durationMinutes: null };
    const result = await deps.routing.route(points);
    return {
      distanceKm: Math.round(result.distanceMeters / 10) / 100,
      durationMinutes: Math.max(1, Math.round(result.durationSeconds / 60)),
    };
  }

  function diffStops(baseline: StopDetail[], proposed: StopInput[]) {
    const byKey = new Map(baseline.map((stop) => [stop.stopKey, stop]));
    const proposedKeys = new Set(proposed.map((stop) => stop.stopKey).filter(Boolean));
    const added: { name: string }[] = [];
    const moved: { stopKey: string; name: string; distanceMeters: number }[] = [];
    const retimed: { stopKey: string; name: string; from: string | null; to: string | null }[] = [];
    for (const stop of proposed) {
      const before = stop.stopKey ? byKey.get(stop.stopKey) : undefined;
      if (!before) {
        added.push({ name: stop.name });
        continue;
      }
      const distanceMeters = Math.round(haversineMeters(before.location, stop.location));
      if (distanceMeters > MOVED_THRESHOLD_METERS)
        moved.push({ stopKey: before.stopKey, name: stop.name, distanceMeters });
      const from = generalTime(before.times);
      const to = generalTime(stop.times);
      if (from !== to) retimed.push({ stopKey: before.stopKey, name: stop.name, from, to });
    }
    const removed = baseline
      .filter((stop) => !proposedKeys.has(stop.stopKey))
      .map((stop) => ({ stopKey: stop.stopKey, name: stop.name }));
    return { added, removed, moved, retimed };
  }

  async function serviceDays(tx: DbTransaction, routeId: string, proposal: Proposal) {
    if (proposal.kind === 'temporary') {
      return {
        from: proposal.startsOn,
        to: proposal.endsOn,
        days: datesBetween(proposal.startsOn, proposal.endsOn).length,
      };
    }
    // Una versión nueva aplica hasta que empieza la siguiente versión regular.
    const next = await tx.routeVersion.findFirst({
      where: {
        routeId,
        kind: 'regular',
        deletedAt: null,
        validFrom: { gt: toDbDate(proposal.validFrom) },
      },
      orderBy: { validFrom: 'asc' },
    });
    if (!next) return { from: proposal.validFrom, to: null, days: null };
    const to = new Date(next.validFrom.getTime() - 86_400_000).toISOString().slice(0, 10);
    return { from: proposal.validFrom, to, days: datesBetween(proposal.validFrom, to).length };
  }

  async function simulate(tx: DbTransaction, routeId: string, proposal: Proposal) {
    await routes.findRoute(tx, routeId);
    const date = proposal.kind === 'temporary' ? proposal.startsOn : proposal.validFrom;
    const baseline = await baselineFor(tx, routeId, date);
    if (!baseline) throw new BadRequestError('La ruta no tiene una versión vigente en esa fecha.');

    const suspended = proposal.kind === 'temporary' && proposal.suspendService;
    const proposedStops = suspended ? [] : (proposal.version?.stops ?? []);
    const stops = suspended
      ? {
          added: [],
          removed: baseline.stops.map((s) => ({ stopKey: s.stopKey, name: s.name })),
          moved: [],
          retimed: [],
        }
      : diffStops(baseline.stops, proposedStops);
    const metrics =
      suspended || !proposal.version
        ? { distanceKm: null, durationMinutes: null }
        : await plannedMetrics(tx, routeId, proposal.version);

    const reasonByKey = new Map<
      string,
      'service_suspended' | 'stop_removed' | 'stop_moved' | 'time_changed'
    >();
    for (const stop of stops.retimed) reasonByKey.set(stop.stopKey, 'time_changed');
    for (const stop of stops.moved) reasonByKey.set(stop.stopKey, 'stop_moved');
    for (const stop of stops.removed)
      reasonByKey.set(stop.stopKey, suspended ? 'service_suspended' : 'stop_removed');
    const stopNames = new Map(baseline.stops.map((stop) => [stop.stopKey, stop.name]));

    const assignments = await tx.routePassenger.findMany({
      where: { routeId, deletedAt: null, stopKey: { in: [...reasonByKey.keys()] } },
      include: { passenger: true },
    });
    const passengers = assignments
      .filter((a) => a.passenger.status === 'active' && !a.passenger.deletedAt)
      .map((a) => ({
        id: a.passenger.id,
        fullName: a.passenger.fullName,
        employeeNumber: a.passenger.employeeNumber,
        stopName: stopNames.get(a.stopKey) ?? null,
        reason: reasonByKey.get(a.stopKey)!,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const period = await serviceDays(tx, routeId, proposal);
    const trips = await tx.trip.findMany({
      where: {
        routeId,
        status: 'scheduled',
        serviceDate: {
          gte: toDbDate(period.from),
          ...(period.to ? { lte: toDbDate(period.to) } : {}),
        },
      },
      orderBy: { serviceDate: 'asc' },
      select: { id: true, serviceDate: true },
    });

    return {
      period,
      suspended,
      stops,
      distanceKm: { from: baseline.distanceKm, to: metrics.distanceKm },
      durationMinutes: { from: baseline.durationMinutes, to: metrics.durationMinutes },
      passengers,
      // Viajes ya programados en el periodo; el chofer se llena con la asignación (F04-P02).
      trips: trips.map((trip) => ({
        id: trip.id,
        date: fromDbDate(trip.serviceDate)!,
        driverName: null as string | null,
      })),
      drivers: [] as { id: string; fullName: string }[],
    };
  }

  return {
    simulate,

    async create(
      tx: DbTransaction,
      routeId: string,
      userId: string,
      input: {
        startsOn: string;
        endsOn: string;
        reason: string;
        suspendService: boolean;
        version?: Omit<VersionInput, 'validFrom'> | undefined;
      },
    ) {
      const route = await routes.findRoute(tx, routeId);
      const today = await routes.plantToday(tx, route.plantId);
      if (input.startsOn < today)
        throw new BadRequestError('Un cambio temporal no puede empezar en el pasado.');
      if (input.endsOn < input.startsOn)
        throw new BadRequestError('La fecha de fin no puede ser anterior a la de inicio.');
      if (datesBetween(input.startsOn, input.endsOn).length > MAX_TEMPORARY_DAYS) {
        throw new BadRequestError(
          `Un cambio temporal dura como máximo ${MAX_TEMPORARY_DAYS} días; para algo más largo crea una versión.`,
        );
      }
      if (!input.suspendService && !input.version) {
        throw new BadRequestError(
          'Indica las paradas y horarios del cambio, o marca que se suspende el servicio.',
        );
      }
      const overlapping = await tx.temporaryChange.findFirst({
        where: {
          routeId,
          cancelledAt: null,
          startsOn: { lte: toDbDate(input.endsOn) },
          endsOn: { gte: toDbDate(input.startsOn) },
        },
      });
      if (overlapping) {
        throw new ConflictError(
          `Ya hay un cambio temporal del ${fromDbDate(overlapping.startsOn)} al ${fromDbDate(overlapping.endsOn)}. Cancélalo o elige otras fechas.`,
        );
      }
      if (!(await baselineFor(tx, routeId, input.startsOn))) {
        throw new BadRequestError('La ruta no tiene una versión vigente en esa fecha.');
      }

      const version = input.suspendService
        ? null
        : await routes.insertVersion(
            tx,
            route,
            { ...input.version!, validFrom: input.startsOn },
            { kind: 'temporary', userId },
          );
      const change = await tx.temporaryChange.create({
        data: {
          tenantId: route.tenantId,
          routeId,
          routeVersionId: version?.id ?? null,
          suspendsService: input.suspendService,
          startsOn: toDbDate(input.startsOn),
          endsOn: toDbDate(input.endsOn),
          reason: input.reason,
          createdByUserId: userId,
        },
      });
      return {
        id: change.id,
        versionId: change.routeVersionId,
        suspendsService: change.suspendsService,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        reason: change.reason,
        cancelled: false,
      };
    },

    /** Cancela un cambio que no ha terminado; desde ese momento vuelve la versión normal. */
    async cancel(tx: DbTransaction, changeId: string) {
      const change = await tx.temporaryChange.findFirst({
        where: { id: changeId, cancelledAt: null },
      });
      if (!change) throw new NotFoundError('No se encontró el cambio temporal.');
      const route = await routes.findRoute(tx, change.routeId);
      if (fromDbDate(change.endsOn)! < (await routes.plantToday(tx, route.plantId))) {
        throw new ConflictError('El cambio temporal ya terminó; queda en el historial.');
      }
      await tx.temporaryChange.update({
        where: { id: changeId },
        data: { cancelledAt: new Date() },
      });
      return { routeId: change.routeId };
    },
  };
}
