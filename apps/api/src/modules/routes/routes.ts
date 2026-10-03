import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import type { DbTransaction } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { authOf, dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  createRouteBody,
  createShiftBody,
  createTemporaryChangeBody,
  routePassengersBody,
  routePassengersResponse,
  simulateBody,
  simulationResponse,
  temporaryChangeSummary,
  distanceToPathQuery,
  distanceToPathResponse,
  nearestStopQuery,
  nearestStopResponse,
  previewBody,
  previewResponse,
  effectiveQuery,
  effectiveResponse,
  listRoutesQuery,
  listShiftsQuery,
  restoreBody,
  routeDetail,
  routeSummary,
  routeVersionParams,
  shiftSummary,
  updateRouteBody,
  updateShiftBody,
  versionDetail,
  versionInput,
} from './schemas.ts';
import { createRoutePassengersService } from './route-passengers.ts';
import { createRoutesService } from './service.ts';
import { createTemporaryChangesService } from './temporary-changes.ts';

const TAGS = ['Rutas'];

export const routeRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createRoutesService({
    routing: app.routingProvider,
    averageSpeedKmh: app.config.ROUTING_AVERAGE_SPEED_KMH,
  });
  const temporaryChanges = createTemporaryChangesService({
    routes: service,
    routing: app.routingProvider,
  });
  const routePassengers = createRoutePassengersService({ routes: service });

  /** Después de cada cambio, ajusta los viajes ya generados en la misma transacción. */
  async function refreshTrips(tx: DbTransaction, request: FastifyRequest, routeId: string) {
    await app.schedule.refreshRoutes(tx, tenantIdOf(request), [routeId]);
  }
  const canRead = requirePermission(app, 'routes.read');
  const canWrite = requirePermission(app, 'routes.write');
  const canReadShifts = requirePermission(app, 'routes.read', 'schedule.read', 'settings.manage');
  const canWriteShifts = requirePermission(app, 'routes.write', 'settings.manage');

  app.get(
    '/shifts',
    {
      onRequest: canReadShifts,
      schema: {
        tags: TAGS,
        summary: 'Turnos de las plantas atendidas',
        querystring: listShiftsQuery,
        response: { 200: z.array(shiftSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.listShifts(tx, request.query.plantId),
      ),
  );

  app.post(
    '/shifts',
    {
      onRequest: canWriteShifts,
      schema: {
        tags: TAGS,
        summary: 'Crea un turno de una planta',
        body: createShiftBody,
        response: { 201: shiftSummary },
      },
    },
    async (request, reply) => {
      const shift = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.createShift(tx, tenantIdOf(request), request.body),
      );
      return reply.status(201).send(shift);
    },
  );

  app.patch(
    '/shifts/:id',
    {
      onRequest: canWriteShifts,
      schema: {
        tags: TAGS,
        summary: 'Edita o desactiva un turno',
        params: idParams,
        body: updateShiftBody,
        response: { 200: shiftSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const shift = await service.updateShift(tx, request.params.id, request.body);
        await app.schedule.refreshShift(tx, tenantIdOf(request), shift.id);
        return shift;
      }),
  );

  app.get(
    '/routes',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Rutas con su versión vigente',
        querystring: listRoutesQuery,
        response: { 200: z.array(routeSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx, request.query)),
  );

  app.post(
    '/routes',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Crea una ruta con su primera versión (paradas, horarios y trazo)',
        body: createRouteBody,
        response: { 201: routeDetail },
      },
    },
    async (request, reply) => {
      const route = await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const created = await service.create(
          tx,
          tenantIdOf(request),
          authOf(request, 'user').sub,
          request.body,
        );
        await refreshTrips(tx, request, created.id);
        return created;
      });
      return reply.status(201).send(route);
    },
  );

  app.get(
    '/routes/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Ruta con su historial de versiones y cambios temporales',
        params: idParams,
        response: { 200: routeDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.get(tx, request.params.id)),
  );

  app.patch(
    '/routes/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita datos generales de la ruta (sin crear versión)',
        params: idParams,
        body: updateRouteBody,
        response: { 200: routeDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const route = await service.update(tx, request.params.id, request.body);
        await refreshTrips(tx, request, route.id);
        return route;
      }),
  );

  app.delete(
    '/routes/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Da de baja una ruta',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        await service.remove(tx, request.params.id);
        await refreshTrips(tx, request, request.params.id);
      });
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/routes/:id/effective',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Versión que aplica en una fecha (incluye cambios temporales)',
        params: idParams,
        querystring: effectiveQuery,
        response: { 200: effectiveResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.effective(tx, request.params.id, request.query.date),
      ),
  );

  app.post(
    '/routes/:id/versions',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Crea una versión nueva vigente desde una fecha',
        params: idParams,
        body: versionInput,
        response: { 201: versionDetail },
      },
    },
    async (request, reply) => {
      const version = await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const created = await service.createVersion(
          tx,
          request.params.id,
          authOf(request, 'user').sub,
          request.body,
        );
        await refreshTrips(tx, request, request.params.id);
        return created;
      });
      return reply.status(201).send(version);
    },
  );

  app.get(
    '/routes/:id/versions/:versionId',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Detalle de una versión',
        params: routeVersionParams,
        response: { 200: versionDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.getVersion(tx, request.params.id, request.params.versionId),
      ),
  );

  app.post(
    '/routes/:id/versions/:versionId/restore',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Restaura una versión anterior como versión nueva',
        params: routeVersionParams,
        body: restoreBody,
        response: { 201: versionDetail },
      },
    },
    async (request, reply) => {
      const version = await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const restored = await service.restoreVersion(
          tx,
          request.params.id,
          request.params.versionId,
          authOf(request, 'user').sub,
          request.body.validFrom,
        );
        await refreshTrips(tx, request, request.params.id);
        return restored;
      });
      return reply.status(201).send(version);
    },
  );

  app.delete(
    '/routes/:id/versions/:versionId',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Elimina una versión que todavía no empieza',
        params: routeVersionParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        await service.deleteVersion(tx, request.params.id, request.params.versionId);
        await refreshTrips(tx, request, request.params.id);
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/routes/:id/temporary-changes',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary:
          'Cambio temporal entre dos fechas (otras paradas u horarios, o servicio suspendido)',
        params: idParams,
        body: createTemporaryChangeBody,
        response: { 201: temporaryChangeSummary },
      },
    },
    async (request, reply) => {
      const change = await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const created = await temporaryChanges.create(
          tx,
          request.params.id,
          authOf(request, 'user').sub,
          request.body,
        );
        await refreshTrips(tx, request, request.params.id);
        return created;
      });
      return reply.status(201).send(change);
    },
  );

  app.post(
    '/temporary-changes/:id/cancel',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Cancela un cambio temporal (vuelve la versión normal)',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const { routeId } = await temporaryChanges.cancel(tx, request.params.id);
        await refreshTrips(tx, request, routeId);
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/routes/:id/simulate',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Simula un cambio de ruta sin guardar: paradas, tiempos y pasajeros afectados',
        params: idParams,
        body: simulateBody,
        response: { 200: simulationResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        temporaryChanges.simulate(tx, request.params.id, request.body),
      ),
  );

  app.get(
    '/routes/:id/passengers',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Pasajeros asignados a cada parada',
        params: idParams,
        response: { 200: routePassengersResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        routePassengers.list(tx, request.params.id),
      ),
  );

  app.put(
    '/routes/:id/passengers',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Reemplaza la asignación de pasajeros a paradas',
        params: idParams,
        body: routePassengersBody,
        response: { 200: routePassengersResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        routePassengers.replace(tx, request.params.id, request.body.assignments),
      ),
  );

  app.post(
    '/routing/preview',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Distancia, tiempo y trazo por calles entre puntos (vista previa del editor)',
        body: previewBody,
        response: { 200: previewResponse },
      },
    },
    (request) => service.preview(request.body.points),
  );

  app.get(
    '/route-versions/:id/nearest-stop',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Parada más cercana a un punto (asignación automática al escanear)',
        params: idParams,
        querystring: nearestStopQuery,
        response: { 200: nearestStopResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.nearestStop(
          tx,
          request.params.id,
          { lat: request.query.lat, lng: request.query.lng },
          request.query.maxMeters,
        ),
      ),
  );

  app.get(
    '/route-versions/:id/distance-to-path',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Distancia de un punto al trazado (detección de desvíos)',
        params: idParams,
        querystring: distanceToPathQuery,
        response: { 200: distanceToPathResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.distanceToPath(
          tx,
          request.params.id,
          { lat: request.query.lat, lng: request.query.lng },
          request.query.thresholdMeters ?? app.config.OFF_ROUTE_THRESHOLD_METERS,
        ),
      ),
  );

  done();
};
