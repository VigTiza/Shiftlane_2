import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError } from '../../lib/errors.ts';
import type { RoutesService } from './service.ts';

/** Pasajeros asignados a paradas de una ruta (por stop_key, estable entre versiones). */
export function createRoutePassengersService(deps: { routes: RoutesService }) {
  const { routes } = deps;

  async function currentStops(tx: DbTransaction, routeId: string) {
    const route = await routes.findRoute(tx, routeId);
    const data = await routes.versionsAndChanges(tx, [routeId]);
    const today = await routes.plantToday(tx, route.plantId);
    const effective = routes.resolveEffective(routeId, data, today, true);
    // Paradas válidas: las de la versión vigente y las de versiones futuras.
    const keys = new Map<string, string>();
    const futureVersions = data.versions.filter(
      (v) =>
        v.kind === 'regular' &&
        (v.id === effective?.versionId || v.validFrom.toISOString().slice(0, 10) > today),
    );
    for (const version of futureVersions) {
      const detail = await routes.versionDetail(tx, version.id, null);
      for (const stop of detail.stops)
        if (!keys.has(stop.stopKey)) keys.set(stop.stopKey, stop.name);
    }
    return { route, stops: keys, currentVersionId: effective?.versionId ?? null };
  }

  async function list(tx: DbTransaction, routeId: string) {
    const { stops } = await currentStops(tx, routeId);
    const assignments = await tx.routePassenger.findMany({
      where: { routeId, deletedAt: null },
      include: { passenger: true },
      orderBy: { passenger: { fullName: 'asc' } },
    });
    return assignments.map((a) => ({
      passengerId: a.passengerId,
      fullName: a.passenger.fullName,
      employeeNumber: a.passenger.employeeNumber,
      status: a.passenger.status,
      stopKey: a.stopKey,
      /** Nulo si la parada ya no existe en la ruta (hay que reasignar). */
      stopName: stops.get(a.stopKey) ?? null,
    }));
  }

  return {
    list,

    /** Reemplaza las asignaciones de la ruta. */
    async replace(
      tx: DbTransaction,
      routeId: string,
      assignments: { passengerId: string; stopKey: string }[],
    ) {
      const { route, stops } = await currentStops(tx, routeId);
      const ids = assignments.map((a) => a.passengerId);
      if (new Set(ids).size !== ids.length)
        throw new BadRequestError('Un pasajero aparece dos veces.');
      const passengers = await tx.passenger.findMany({
        where: { id: { in: ids }, deletedAt: null },
      });
      const byId = new Map(passengers.map((p) => [p.id, p]));
      for (const assignment of assignments) {
        const passenger = byId.get(assignment.passengerId);
        if (!passenger || passenger.plantId !== route.plantId) {
          throw new BadRequestError('Hay pasajeros que no son de la planta de esta ruta.');
        }
        if (passenger.status !== 'active') {
          throw new BadRequestError(`${passenger.fullName} está dado de baja.`);
        }
        if (!stops.has(assignment.stopKey)) {
          throw new BadRequestError(
            `La parada asignada a ${passenger.fullName} no existe en la ruta.`,
          );
        }
      }

      await tx.routePassenger.updateMany({
        where: { routeId, deletedAt: null, passengerId: { notIn: ids } },
        data: { deletedAt: new Date() },
      });
      for (const assignment of assignments) {
        await tx.routePassenger.upsert({
          where: { routeId_passengerId: { routeId, passengerId: assignment.passengerId } },
          update: { stopKey: assignment.stopKey, deletedAt: null },
          create: {
            tenantId: route.tenantId,
            routeId,
            passengerId: assignment.passengerId,
            stopKey: assignment.stopKey,
          },
        });
      }
      return list(tx, routeId);
    },
  };
}
