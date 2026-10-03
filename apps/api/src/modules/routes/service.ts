import { estimateMinutes, todayIn } from '@shiftlane/shared';
import type { LatLng } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { fromDbDate, toDbDate } from '../../lib/http-schemas.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { RoutingProvider } from '../../lib/routing.ts';
import type { Route, RouteVersion, Shift } from '../../generated/prisma/client.ts';
import { effectiveVersion } from './versioning.ts';

type Optional<T> = T | null | undefined;

export interface StopInput {
  name: string;
  address?: Optional<string>;
  location: { lat: number; lng: number };
  radiusMeters: number;
  notes?: Optional<string>;
  times: { weekdays: number[]; time: string }[];
  /** Se conserva al copiar una versión (misma parada lógica). */
  stopKey?: string;
}

export interface VersionInput {
  validFrom: string;
  path?: [number, number][] | undefined;
  stops: StopInput[];
  notes?: Optional<string>;
}

function clean<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function mapShift(shift: Shift) {
  return {
    id: shift.id,
    plantId: shift.plantId,
    name: shift.name,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    weekdays: shift.weekdays,
    active: shift.active,
  };
}

/**
 * Rutas con versiones vigentes por fecha. Las versiones que ya empezaron no se modifican:
 * un cambio crea una versión nueva, así el historial queda intacto y se puede restaurar.
 */
export function createRoutesService(deps: { routing: RoutingProvider; averageSpeedKmh?: number }) {
  async function plantToday(tx: DbTransaction, plantId: string): Promise<string> {
    const plant = await tx.plant.findFirst({ where: { id: plantId } });
    return todayIn(plant?.timezone ?? 'America/Ciudad_Juarez');
  }

  async function assertServedPlant(tx: DbTransaction, tenantId: string, plantId: string) {
    const agreement = await tx.serviceAgreement.findFirst({
      where: { tenantId, plantId, status: 'active', deletedAt: null },
    });
    if (!agreement)
      throw new BadRequestError('La planta no tiene un acuerdo de servicio activo con tu empresa.');
  }

  async function assertShift(tx: DbTransaction, plantId: string, shiftId: Optional<string>) {
    if (!shiftId) return;
    const shift = await tx.shift.findFirst({ where: { id: shiftId, deletedAt: null } });
    if (!shift || shift.plantId !== plantId)
      throw new BadRequestError('El turno no pertenece a la planta de la ruta.');
  }

  async function findRoute(tx: DbTransaction, id: string) {
    const route = await tx.route.findFirst({ where: { id, deletedAt: null } });
    if (!route) throw new NotFoundError('No se encontró la ruta.');
    return route;
  }

  async function stopsCount(tx: DbTransaction, versionIds: string[]) {
    if (versionIds.length === 0) return new Map<string, number>();
    const rows = await tx.stop.groupBy({
      by: ['routeVersionId'],
      where: { routeVersionId: { in: versionIds } },
      _count: true,
    });
    return new Map(rows.map((row) => [row.routeVersionId, row._count]));
  }

  function mapVersion(
    version: RouteVersion,
    counts: Map<string, number>,
    currentId: string | null,
  ) {
    return {
      id: version.id,
      number: version.number,
      kind: version.kind,
      validFrom: fromDbDate(version.validFrom)!,
      distanceKm: version.distanceKm === null ? null : Number(version.distanceKm),
      durationMinutes: version.durationMinutes,
      stopsCount: counts.get(version.id) ?? 0,
      basedOnId: version.basedOnId,
      routingSource: version.routingSource,
      notes: version.notes,
      createdAt: version.createdAt,
      current: version.id === currentId,
    };
  }

  /** Datos de vigencia de varias rutas a la vez. */
  async function versionsAndChanges(tx: DbTransaction, routeIds: string[]) {
    const [versions, changes] = await Promise.all([
      tx.routeVersion.findMany({
        where: { routeId: { in: routeIds }, deletedAt: null },
        orderBy: { number: 'desc' },
      }),
      tx.temporaryChange.findMany({
        where: { routeId: { in: routeIds } },
        orderBy: { startsOn: 'asc' },
      }),
    ]);
    return { versions, changes };
  }

  function resolveEffective(
    routeId: string,
    data: Awaited<ReturnType<typeof versionsAndChanges>>,
    date: string,
    regularOnly = false,
  ) {
    const versions = data.versions
      .filter((v) => v.routeId === routeId)
      .map((v) => ({ id: v.id, kind: v.kind, validFrom: fromDbDate(v.validFrom)! }));
    const changes = regularOnly
      ? []
      : data.changes
          .filter((c) => c.routeId === routeId)
          .map((c) => ({
            id: c.id,
            versionId: c.routeVersionId,
            startsOn: fromDbDate(c.startsOn)!,
            endsOn: fromDbDate(c.endsOn)!,
            cancelled: c.cancelledAt !== null,
          }));
    return effectiveVersion(versions, changes, date);
  }

  async function plantLocation(tx: DbTransaction, plantId: string): Promise<LatLng | null> {
    const [row] = await tx.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM plants WHERE id = ${plantId}::uuid AND location IS NOT NULL`;
    return row ?? null;
  }

  /**
   * Trazo, distancia y tiempo de la versión. Con trazo dibujado se respeta (manual); si no, se
   * calcula por calles con el servicio de rutas, incluyendo la planta como destino (entrada)
   * u origen (salida). Si el servicio falla, se usa la línea recta y la operación sigue.
   */
  async function storePath(
    tx: DbTransaction,
    route: Route,
    versionId: string,
    input: VersionInput,
  ) {
    const stops = input.stops.map((stop) => stop.location);
    let coordinates: [number, number][];
    let durationMinutes: number;
    let source: string;
    let roadMeters: number | null = null;
    if (input.path) {
      coordinates = input.path;
      source = 'manual';
      durationMinutes = 0;
    } else {
      const plant = await plantLocation(tx, route.plantId);
      const points = plant
        ? route.direction === 'inbound'
          ? [...stops, plant]
          : [plant, ...stops]
        : stops;
      if (points.length < 2) return;
      const result = await deps.routing.route(points);
      coordinates = result.geometry;
      durationMinutes = Math.max(1, Math.round(result.durationSeconds / 60));
      source = result.source;
      // Por calles se guarda la distancia que reporta el servicio; si no, la longitud del trazo.
      if (result.source === 'osrm') roadMeters = result.distanceMeters;
    }
    if (coordinates.length < 2) return;
    const geojson = JSON.stringify({ type: 'LineString', coordinates });
    const [row] = await tx.$queryRaw<{ meters: number }[]>`
      UPDATE route_versions
      SET path = ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography,
          distance_km = round((COALESCE(${roadMeters}::float8, ST_Length(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography)) / 1000)::numeric, 2),
          routing_source = ${source}
      WHERE id = ${versionId}::uuid
      RETURNING ST_Length(path) AS meters`;
    const minutes =
      source === 'manual'
        ? estimateMinutes(row?.meters ?? 0, deps.averageSpeedKmh)
        : durationMinutes;
    await tx.routeVersion.update({ where: { id: versionId }, data: { durationMinutes: minutes } });
  }

  async function insertVersion(
    tx: DbTransaction,
    route: Route,
    input: VersionInput,
    meta: { kind: 'regular' | 'temporary'; basedOnId?: string | null; userId?: string | null },
  ): Promise<RouteVersion> {
    const last = await tx.routeVersion.findFirst({
      where: { routeId: route.id },
      orderBy: { number: 'desc' },
    });
    const version = await tx.routeVersion.create({
      data: {
        tenantId: route.tenantId,
        routeId: route.id,
        number: (last?.number ?? 0) + 1,
        kind: meta.kind,
        validFrom: toDbDate(input.validFrom),
        notes: input.notes ?? null,
        basedOnId: meta.basedOnId ?? null,
        createdByUserId: meta.userId ?? null,
      },
    });

    for (const [index, stop] of input.stops.entries()) {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO stops (tenant_id, route_version_id, stop_key, sequence, name, address, location, radius_meters, notes)
        VALUES (
          ${route.tenantId}::uuid, ${version.id}::uuid, COALESCE(${stop.stopKey ?? null}::uuid, gen_random_uuid()),
          ${index + 1}, ${stop.name}, ${stop.address ?? null},
          ST_SetSRID(ST_MakePoint(${stop.location.lng}, ${stop.location.lat}), 4326)::geography,
          ${stop.radiusMeters}, ${stop.notes ?? null}
        )
        RETURNING id::text`;
      await tx.routeStopTime.createMany({
        data: stop.times.map((t) => ({
          tenantId: route.tenantId,
          stopId: row!.id,
          weekdays: [...new Set(t.weekdays)].sort(),
          time: t.time,
        })),
      });
    }

    await storePath(tx, route, version.id, input);
    return tx.routeVersion.findUniqueOrThrow({ where: { id: version.id } });
  }

  async function versionDetail(tx: DbTransaction, versionId: string, currentId: string | null) {
    const version = await tx.routeVersion.findFirst({ where: { id: versionId, deletedAt: null } });
    if (!version) throw new NotFoundError('No se encontró la versión.');
    const [stops, pathRows] = await Promise.all([
      tx.$queryRaw<
        {
          id: string;
          stop_key: string;
          sequence: number;
          name: string;
          address: string | null;
          lat: number;
          lng: number;
          radius_meters: number;
          notes: string | null;
        }[]
      >`
        SELECT id::text, stop_key::text, sequence, name, address, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
               radius_meters, notes
        FROM stops WHERE route_version_id = ${versionId}::uuid ORDER BY sequence`,
      tx.$queryRaw<{ geojson: string | null }[]>`
        SELECT ST_AsGeoJSON(path::geometry) AS geojson FROM route_versions WHERE id = ${versionId}::uuid`,
    ]);
    const times = await tx.routeStopTime.findMany({
      where: { stopId: { in: stops.map((s) => s.id) } },
    });
    const geojson = pathRows[0]?.geojson;
    return {
      ...mapVersion(version, new Map([[version.id, stops.length]]), currentId),
      path: geojson
        ? (JSON.parse(geojson) as { coordinates: [number, number][] }).coordinates
        : null,
      stops: stops.map((stop) => ({
        id: stop.id,
        stopKey: stop.stop_key,
        sequence: stop.sequence,
        name: stop.name,
        address: stop.address,
        location: { lat: stop.lat, lng: stop.lng },
        radiusMeters: stop.radius_meters,
        notes: stop.notes,
        times: times
          .filter((t) => t.stopId === stop.id)
          .map((t) => ({ weekdays: t.weekdays, time: t.time }))
          .sort((a, b) => a.weekdays.length - b.weekdays.length),
      })),
    };
  }

  async function routeSummaries(tx: DbTransaction, routes: Route[]) {
    const data = await versionsAndChanges(
      tx,
      routes.map((r) => r.id),
    );
    const counts = await stopsCount(
      tx,
      data.versions.map((v) => v.id),
    );
    const todays = new Map<string, string>();
    for (const route of routes) {
      if (!todays.has(route.plantId))
        todays.set(route.plantId, await plantToday(tx, route.plantId));
    }
    return routes.map((route) => {
      const effective = resolveEffective(route.id, data, todays.get(route.plantId)!, true);
      const current = effective
        ? data.versions.find((v) => v.id === effective.versionId)
        : undefined;
      return {
        id: route.id,
        plantId: route.plantId,
        shiftId: route.shiftId,
        code: route.code,
        name: route.name,
        direction: route.direction,
        active: route.active,
        notes: route.notes,
        current: current ? mapVersion(current, counts, current.id) : null,
        data,
        counts,
        currentId: current?.id ?? null,
      };
    });
  }

  return {
    insertVersion,
    versionsAndChanges,
    resolveEffective,
    versionDetail,
    findRoute,
    plantToday,

    /** Parada de la versión más cercana a un punto, dentro del radio de la parada o del máximo dado. */
    async nearestStop(tx: DbTransaction, versionId: string, point: LatLng, maxMeters?: number) {
      const version = await tx.routeVersion.findFirst({
        where: { id: versionId, deletedAt: null },
      });
      if (!version) throw new NotFoundError('No se encontró la versión.');
      const [row] = await tx.$queryRaw<
        { id: string; name: string; sequence: number; radius_meters: number; distance: number }[]
      >`
        SELECT id::text, name, sequence, radius_meters,
               ST_Distance(location, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography) AS distance
        FROM stops
        WHERE route_version_id = ${versionId}::uuid
        ORDER BY location <-> ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography
        LIMIT 1`;
      if (!row) return { stop: null, distanceMeters: null };
      const limit = maxMeters ?? row.radius_meters;
      const distanceMeters = Math.round(row.distance * 10) / 10;
      return distanceMeters <= limit
        ? { stop: { id: row.id, name: row.name, sequence: row.sequence }, distanceMeters }
        : { stop: null, distanceMeters };
    },

    /** Distancia de un punto al trazado de la versión (para detectar desvíos). */
    async distanceToPath(
      tx: DbTransaction,
      versionId: string,
      point: LatLng,
      thresholdMeters: number,
    ) {
      const version = await tx.routeVersion.findFirst({
        where: { id: versionId, deletedAt: null },
      });
      if (!version) throw new NotFoundError('No se encontró la versión.');
      const [row] = await tx.$queryRaw<{ distance: number | null }[]>`
        SELECT ST_Distance(path, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography) AS distance
        FROM route_versions WHERE id = ${versionId}::uuid`;
      if (row?.distance === null || row?.distance === undefined) {
        throw new BadRequestError('La versión no tiene trazo.');
      }
      const distanceMeters = Math.round(row.distance * 10) / 10;
      return { distanceMeters, thresholdMeters, offRoute: distanceMeters > thresholdMeters };
    },

    /** Calcula distancia, tiempo y trazo por calles para puntos dados (vista previa del editor). */
    async preview(points: LatLng[]) {
      const result = await deps.routing.route(points);
      return {
        distanceKm: Math.round(result.distanceMeters / 10) / 100,
        durationMinutes: Math.max(1, Math.round(result.durationSeconds / 60)),
        path: result.geometry,
        source: result.source,
      };
    },

    // --- Turnos ---------------------------------------------------------------------

    async listShifts(tx: DbTransaction, plantId?: string) {
      const shifts = await tx.shift.findMany({
        where: { deletedAt: null, ...(plantId ? { plantId } : {}) },
        orderBy: [{ plantId: 'asc' }, { startsAt: 'asc' }],
      });
      return shifts.map(mapShift);
    },

    async createShift(
      tx: DbTransaction,
      tenantId: string,
      input: {
        plantId: string;
        name: string;
        startsAt: string;
        endsAt: string;
        weekdays?: number[] | undefined;
      },
    ) {
      await assertServedPlant(tx, tenantId, input.plantId);
      try {
        const { weekdays, ...data } = input;
        return mapShift(
          await tx.shift.create({ data: { ...data, ...(weekdays ? { weekdays } : {}), tenantId } }),
        );
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictError('Ya existe un turno con ese nombre en la planta.');
        throw error;
      }
    },

    async updateShift(
      tx: DbTransaction,
      id: string,
      input: {
        name?: string | undefined;
        startsAt?: string | undefined;
        endsAt?: string | undefined;
        weekdays?: number[] | undefined;
        active?: boolean | undefined;
      },
    ) {
      const shift = await tx.shift.findFirst({ where: { id, deletedAt: null } });
      if (!shift) throw new NotFoundError('No se encontró el turno.');
      return mapShift(await tx.shift.update({ where: { id }, data: clean(input) }));
    },

    // --- Rutas ----------------------------------------------------------------------

    async list(
      tx: DbTransaction,
      query: {
        plantId?: string | undefined;
        direction?: Route['direction'] | undefined;
        search?: string | undefined;
        active?: boolean | undefined;
      },
    ) {
      const routes = await tx.route.findMany({
        where: {
          deletedAt: null,
          ...(query.plantId ? { plantId: query.plantId } : {}),
          ...(query.direction ? { direction: query.direction } : {}),
          ...(query.active !== undefined ? { active: query.active } : {}),
          ...(query.search
            ? {
                OR: [
                  { code: { contains: query.search, mode: 'insensitive' } },
                  { name: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { code: 'asc' },
      });
      return (await routeSummaries(tx, routes)).map(
        ({ data: _data, counts: _counts, currentId: _currentId, ...summary }) => summary,
      );
    },

    async get(tx: DbTransaction, id: string) {
      const route = await findRoute(tx, id);
      const [summary] = await routeSummaries(tx, [route]);
      const { data, counts, currentId, ...rest } = summary!;
      return {
        ...rest,
        versions: data.versions.map((v) => mapVersion(v, counts, currentId)),
        temporaryChanges: data.changes.map((c) => ({
          id: c.id,
          versionId: c.routeVersionId,
          suspendsService: c.suspendsService,
          startsOn: fromDbDate(c.startsOn)!,
          endsOn: fromDbDate(c.endsOn)!,
          reason: c.reason,
          cancelled: c.cancelledAt !== null,
        })),
      };
    },

    async create(
      tx: DbTransaction,
      tenantId: string,
      userId: string,
      input: {
        plantId: string;
        shiftId?: Optional<string>;
        code: string;
        name: string;
        direction: Route['direction'];
        notes?: Optional<string>;
        version: VersionInput;
      },
    ) {
      await assertServedPlant(tx, tenantId, input.plantId);
      await assertShift(tx, input.plantId, input.shiftId);
      let route: Route;
      try {
        route = await tx.route.create({
          data: {
            tenantId,
            plantId: input.plantId,
            shiftId: input.shiftId ?? null,
            code: input.code,
            name: input.name,
            direction: input.direction,
            notes: input.notes ?? null,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error, 'code'))
          throw new ConflictError('Ya existe una ruta con esa clave.');
        throw error;
      }
      await insertVersion(tx, route, input.version, { kind: 'regular', userId });
      return this.get(tx, route.id);
    },

    async update(
      tx: DbTransaction,
      id: string,
      input: {
        shiftId?: Optional<string>;
        code?: string | undefined;
        name?: string | undefined;
        direction?: Route['direction'] | undefined;
        active?: boolean | undefined;
        notes?: Optional<string>;
      },
    ) {
      const route = await findRoute(tx, id);
      if (input.shiftId !== undefined) await assertShift(tx, route.plantId, input.shiftId);
      try {
        await tx.route.update({ where: { id }, data: clean(input) });
      } catch (error) {
        if (isUniqueViolation(error, 'code'))
          throw new ConflictError('Ya existe una ruta con esa clave.');
        throw error;
      }
      return this.get(tx, id);
    },

    async remove(tx: DbTransaction, id: string) {
      await findRoute(tx, id);
      await tx.route.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    },

    async getVersion(tx: DbTransaction, routeId: string, versionId: string) {
      const route = await findRoute(tx, routeId);
      const data = await versionsAndChanges(tx, [routeId]);
      const current = resolveEffective(routeId, data, await plantToday(tx, route.plantId), true);
      const detail = await versionDetail(tx, versionId, current?.versionId ?? null);
      if (!data.versions.some((v) => v.id === versionId))
        throw new NotFoundError('No se encontró la versión.');
      return detail;
    },

    /** Versión nueva desde una fecha (hoy o futura): el pasado no se reescribe. */
    async createVersion(
      tx: DbTransaction,
      routeId: string,
      userId: string,
      input: VersionInput,
      basedOnId?: string,
    ) {
      const route = await findRoute(tx, routeId);
      const today = await plantToday(tx, route.plantId);
      if (input.validFrom < today) {
        throw new BadRequestError('Una versión nueva no puede empezar en el pasado.');
      }
      const clash = await tx.routeVersion.findFirst({
        where: { routeId, kind: 'regular', deletedAt: null, validFrom: toDbDate(input.validFrom) },
      });
      if (clash) {
        throw new ConflictError(
          `Ya hay una versión que empieza el ${input.validFrom}. Elimínala o elige otra fecha.`,
        );
      }
      const version = await insertVersion(tx, route, input, {
        kind: 'regular',
        basedOnId: basedOnId ?? null,
        userId,
      });
      return this.getVersion(tx, routeId, version.id);
    },

    /** Restaura una versión anterior como versión nueva desde la fecha indicada. */
    async restoreVersion(
      tx: DbTransaction,
      routeId: string,
      versionId: string,
      userId: string,
      validFrom: string,
    ) {
      await findRoute(tx, routeId);
      const source = await versionDetail(tx, versionId, null);
      return this.createVersion(
        tx,
        routeId,
        userId,
        {
          validFrom,
          path: source.path ?? undefined,
          notes: `Restaurada de la versión ${source.number}`,
          stops: source.stops.map((stop) => ({
            stopKey: stop.stopKey,
            name: stop.name,
            address: stop.address,
            location: stop.location,
            radiusMeters: stop.radiusMeters,
            notes: stop.notes,
            times: stop.times,
          })),
        },
        source.id,
      );
    },

    /** Solo se eliminan versiones regulares que todavía no empiezan. */
    async deleteVersion(tx: DbTransaction, routeId: string, versionId: string) {
      const route = await findRoute(tx, routeId);
      const version = await tx.routeVersion.findFirst({
        where: { id: versionId, routeId, deletedAt: null },
      });
      if (!version) throw new NotFoundError('No se encontró la versión.');
      if (
        version.kind !== 'regular' ||
        fromDbDate(version.validFrom)! <= (await plantToday(tx, route.plantId))
      ) {
        throw new ConflictError('Solo se pueden eliminar versiones que todavía no empiezan.');
      }
      await tx.routeVersion.update({ where: { id: versionId }, data: { deletedAt: new Date() } });
    },

    async effective(tx: DbTransaction, routeId: string, date?: string) {
      const route = await findRoute(tx, routeId);
      const day = date ?? (await plantToday(tx, route.plantId));
      const data = await versionsAndChanges(tx, [routeId]);
      const effective = resolveEffective(routeId, data, day);
      const current = resolveEffective(routeId, data, await plantToday(tx, route.plantId), true);
      return {
        date: day,
        temporaryChangeId: effective?.temporaryChangeId ?? null,
        suspended: effective?.suspended ?? false,
        version: effective?.versionId
          ? await versionDetail(tx, effective.versionId, current?.versionId ?? null)
          : null,
      };
    },
  };
}

export type RoutesService = ReturnType<typeof createRoutesService>;
