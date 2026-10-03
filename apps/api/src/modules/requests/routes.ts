import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import {
  authOf,
  clientOrgIdOf,
  dbContextOf,
  requirePermission,
  tenantIdOf,
} from '../../plugins/auth.ts';
import {
  approveRequestBody,
  approveResponse,
  carrierSummary,
  createRequestBody,
  listRequestsQuery,
  rejectRequestBody,
  requestPage,
  requestSummary,
} from './schemas.ts';
import { createRequestsService } from './service.ts';

const TAGS = ['Solicitudes de la planta'];

export const requestRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createRequestsService({ schedule: app.schedule });
  const canRead = requirePermission(app, 'requests.manage', 'plant.requests');
  const canRequest = requirePermission(app, 'plant.requests');
  const canRespond = requirePermission(app, 'requests.manage');

  app.get(
    '/plant/carriers',
    {
      onRequest: requirePermission(app, 'plant.requests', 'plant.dashboard'),
      schema: {
        tags: TAGS,
        summary: 'Transportistas con acuerdo activo con la empresa y las plantas que atienden',
        response: { 200: z.array(carrierSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.carriers(tx, clientOrgIdOf(request)),
      ),
  );

  app.get(
    '/client-requests',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Solicitudes (la transportista ve las suyas; la planta, las que hizo)',
        querystring: listRequestsQuery,
        response: { 200: requestPage },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx, request.query)),
  );

  app.post(
    '/client-requests',
    {
      onRequest: canRequest,
      schema: {
        tags: TAGS,
        summary: 'La planta pide un viaje extra, un cambio de horario o de ruta',
        body: createRequestBody,
        response: { 201: requestSummary },
      },
    },
    async (request, reply) => {
      const created = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.create(tx, clientOrgIdOf(request), authOf(request, 'user').sub, request.body),
      );
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/client-requests/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Detalle de una solicitud con el viaje que generó',
        params: idParams,
        response: { 200: requestSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.get(tx, request.params.id)),
  );

  app.post(
    '/client-requests/:id/cancel',
    {
      onRequest: canRequest,
      schema: {
        tags: TAGS,
        summary: 'La planta cancela una solicitud pendiente',
        params: idParams,
        response: { 200: requestSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.cancel(tx, clientOrgIdOf(request), request.params.id),
      ),
  );

  app.post(
    '/client-requests/:id/approve',
    {
      onRequest: canRespond,
      schema: {
        tags: TAGS,
        summary: 'Aprueba una solicitud; si es un viaje extra, crea el viaje',
        description:
          'El horario del viaje se calcula con la hora en planta y el recorrido de la ruta (o 60 minutos sin ruta), salvo que se indique. Si se asigna chofer o unidad con conflictos que bloquean, responde 409 (con force: true se asigna de todos modos).',
        params: idParams,
        body: approveRequestBody,
        response: { 200: approveResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.approve(
          tx,
          tenantIdOf(request),
          authOf(request, 'user').sub,
          request.params.id,
          request.body,
        ),
      ),
  );

  app.post(
    '/client-requests/:id/reject',
    {
      onRequest: canRespond,
      schema: {
        tags: TAGS,
        summary: 'Rechaza una solicitud con una respuesta para la planta',
        params: idParams,
        body: rejectRequestBody,
        response: { 200: requestSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.reject(
          tx,
          tenantIdOf(request),
          authOf(request, 'user').sub,
          request.params.id,
          request.body.response,
        ),
      ),
  );

  done();
};
