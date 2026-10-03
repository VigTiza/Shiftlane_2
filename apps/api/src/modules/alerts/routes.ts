import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { authOf, dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  acknowledgeBody,
  alertDetail,
  alertSummary,
  listAlertsQuery,
  noteBody,
  resolveBody,
  ruleParams,
  ruleSchema,
  saveRuleBody,
} from './schemas.ts';
import { createAlertsService } from './service.ts';

const TAGS = ['Alertas'];

export const alertRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createAlertsService({ events: app.events });
  // La planta ve las alertas que la regla le comparte (la seguridad por filas filtra cuáles).
  const canRead = requirePermission(
    app,
    'alerts.manage',
    'monitoring.view',
    'dispatch.operate',
    'plant.dashboard',
  );
  const canManage = requirePermission(app, 'alerts.manage', 'dispatch.operate');
  const canConfigure = requirePermission(app, 'settings.manage', 'alerts.manage');

  app.get(
    '/alerts',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Alertas (primero las críticas y las más recientes)',
        querystring: listAlertsQuery,
        response: { 200: z.array(alertSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx, request.query)),
  );

  app.get(
    '/alerts/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Detalle de la alerta con su historial (quién la atendió y cuánto tardó)',
        params: idParams,
        response: { 200: alertDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.get(tx, request.params.id)),
  );

  app.post(
    '/alerts/:id/acknowledge',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Toma la alerta (queda como atendida por ti)',
        params: idParams,
        body: acknowledgeBody,
        response: { 200: alertSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.acknowledge(tx, authOf(request, 'user').sub, request.params.id, request.body.note),
      ),
  );

  app.post(
    '/alerts/:id/resolve',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Resuelve la alerta con lo que se hizo',
        params: idParams,
        body: resolveBody,
        response: { 200: alertSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.resolve(
          tx,
          authOf(request, 'user').sub,
          request.params.id,
          request.body.resolution,
        ),
      ),
  );

  app.post(
    '/alerts/:id/notes',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Agrega una nota al historial de la alerta',
        params: idParams,
        body: noteBody,
        response: { 200: alertDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.addNote(tx, authOf(request, 'user').sub, request.params.id, request.body.note),
      ),
  );

  app.get(
    '/alert-rules',
    {
      onRequest: canConfigure,
      schema: {
        tags: TAGS,
        summary: 'Reglas de alertas de la empresa (con los valores por omisión)',
        response: { 200: z.array(ruleSchema) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.rules(tx, tenantIdOf(request)),
      ),
  );

  app.put(
    '/alert-rules/:type',
    {
      onRequest: requirePermission(app, 'settings.manage'),
      schema: {
        tags: TAGS,
        summary:
          'Configura una regla: activa, gravedad, umbrales, escalamiento y aviso a la planta',
        params: ruleParams,
        body: saveRuleBody,
        response: { 200: ruleSchema },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.saveRule(tx, tenantIdOf(request), request.params.type, request.body),
      ),
  );

  done();
};
