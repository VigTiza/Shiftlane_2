import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { authOf, dbContextOf, requireAuth, requirePermission } from '../../plugins/auth.ts';
import {
  appVersionResponse,
  pushTokenBody,
  pushTokenResponse,
  deviceList,
  diagnosisResponse,
  healthBody,
  healthResponse,
  historyQuery,
  historyResponse,
} from './schemas.ts';
import { createDevicesService } from './service.ts';

const TAGS = ['Celulares'];

export const deviceRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createDevicesService({
    db: app.db,
    events: app.events,
    minAppVersion: app.config.MIN_DRIVER_APP_VERSION,
  });
  const canMonitor = requirePermission(app, 'monitoring.view', 'dispatch.operate', 'alerts.manage');

  app.post(
    '/driver/health',
    {
      onRequest: requireAuth(app, { kinds: ['driver'] }),
      schema: {
        tags: ['App del chofer'],
        summary: 'Reporte de salud del celular (permisos, batería, señal, versión y hora)',
        description:
          'Responde lo que impide iniciar un viaje (problem) y lo que solo se avisa (warning) según el último reporte.',
        body: healthBody,
        response: { 200: healthResponse },
      },
    },
    (request) => {
      const claims = authOf(request, 'driver');
      return service.ingest(
        dbContextOf(request),
        { tenantId: claims.tenantId, driverId: claims.sub, deviceId: claims.deviceId },
        request.body,
      );
    },
  );

  app.post(
    '/driver/push-token',
    {
      onRequest: requireAuth(app, { kinds: ['driver'] }),
      schema: {
        tags: ['App del chofer'],
        summary: 'Token de avisos (Firebase) del celular',
        description:
          'Los mensajes del despachador, cancelaciones y cambios de ruta llegan aunque la app esté cerrada.',
        body: pushTokenBody,
        response: { 200: pushTokenResponse },
      },
    },
    (request) =>
      service.savePushToken(
        dbContextOf(request),
        { deviceId: authOf(request, 'driver').deviceId },
        request.body.token,
      ),
  );

  app.get(
    '/driver/app-version',
    {
      schema: {
        tags: ['App del chofer'],
        summary: 'Versión mínima y última de la app del chofer',
        description: 'Pública: la app la revisa al abrir, aun sin sesión.',
        response: { 200: appVersionResponse },
      },
    },
    () => ({
      minVersion: app.config.MIN_DRIVER_APP_VERSION ?? null,
      latestVersion: app.config.LATEST_DRIVER_APP_VERSION ?? null,
      downloadUrl: app.config.DRIVER_APP_DOWNLOAD_URL ?? null,
    }),
  );

  app.get(
    '/devices/health',
    {
      onRequest: canMonitor,
      schema: {
        tags: TAGS,
        summary: 'Inventario de celulares con su último reporte de salud',
        response: { 200: deviceList },
      },
    },
    (request) => withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx)),
  );

  app.get(
    '/devices/:id/health',
    {
      onRequest: canMonitor,
      schema: {
        tags: TAGS,
        summary: 'Historial de salud de un celular',
        params: idParams,
        querystring: historyQuery,
        response: { 200: historyResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.history(tx, request.params.id, request.query.limit),
      ),
  );

  app.get(
    '/trips/:id/diagnosis',
    {
      onRequest: canMonitor,
      schema: {
        tags: TAGS,
        summary: 'Causa probable de que la unidad del viaje dejó de reportar',
        params: idParams,
        response: { 200: diagnosisResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.diagnose(tx, request.params.id),
      ),
  );

  done();
};
