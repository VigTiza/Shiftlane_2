import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { authOf, dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  createRouteBody,
  createShiftBody,
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
import { createRoutesService } from './service.ts';

const TAGS = ['Rutas'];

export const routeRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createRoutesService();
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
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateShift(tx, request.params.id, request.body),
      ),
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
      const route = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.create(tx, tenantIdOf(request), authOf(request, 'user').sub, request.body),
      );
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
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.update(tx, request.params.id, request.body),
      ),
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
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.remove(tx, request.params.id),
      );
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
      const version = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.createVersion(tx, request.params.id, authOf(request, 'user').sub, request.body),
      );
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
      const version = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.restoreVersion(
          tx,
          request.params.id,
          request.params.versionId,
          authOf(request, 'user').sub,
          request.body.validFrom,
        ),
      );
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
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.deleteVersion(tx, request.params.id, request.params.versionId),
      );
      return reply.status(204).send(null);
    },
  );

  done();
};
