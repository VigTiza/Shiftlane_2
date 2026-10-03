import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { sendFile } from '../../lib/files.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { readUpload } from '../../lib/uploads.ts';
import { z } from '../../lib/zod.ts';
import {
  authOf,
  dbContextOf,
  requireAuth,
  requirePermission,
  tenantIdOf,
} from '../../plugins/auth.ts';
import { tripSummary } from '../schedule/schemas.ts';
import { createPassengersService } from '../passengers/service.ts';
import { createRoutesService } from '../routes/service.ts';
import { createDriverTripsService } from './driver-service.ts';
import type { DriverSession } from './driver-service.ts';
import { createTripPanelService } from './panel-service.ts';
import {
  actionBody,
  arriveStopBody,
  checklistBody,
  checklistResponse,
  checklistTemplate,
  driverTrips,
  driverTripsQuery,
  exceptionBody,
  gateBody,
  incidentBody,
  incidentResponse,
  incidentSummary,
  incidentsQuery,
  panicBody,
  panicResponse,
  panicSummary,
  panicsQuery,
  photoKindQuery,
  photoResponse,
  resolveIncidentBody,
  saveTemplateBody,
  scanBody,
  scanResponse,
  tripDetail,
  tripPhotoParams,
  tripState,
} from './schemas.ts';

const DRIVER_TAGS = ['App del chofer'];
const TAGS = ['Ejecución de viajes'];

function sessionOf(request: FastifyRequest): DriverSession {
  const claims = authOf(request, 'driver');
  return { tenantId: claims.tenantId, driverId: claims.sub };
}

export const tripRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const driver = createDriverTripsService({
    passengers: createPassengersService({ signer: app.credentialSigner }),
    routes: createRoutesService({
      routing: app.routingProvider,
      averageSpeedKmh: app.config.ROUTING_AVERAGE_SPEED_KMH,
    }),
    storage: app.storage,
    system: app.db.system,
    timeZone: app.config.DEFAULT_TIME_ZONE,
  });
  const panel = createTripPanelService({ schedule: app.schedule, storage: app.storage });
  const driverOnly = requireAuth(app, { kinds: ['driver'] });
  const canSeeEvidence = requirePermission(
    app,
    'schedule.read',
    'monitoring.view',
    'plant.evidence',
    'plant.dashboard',
  );
  const canDispatch = requirePermission(app, 'dispatch.operate', 'alerts.manage');

  /** Acción del chofer sobre un viaje: siempre dentro del contexto de su empresa. */
  function driverAction<T>(request: FastifyRequest, fn: Parameters<typeof withDbContext<T>>[2]) {
    return withDbContext(app.db.app, dbContextOf(request), fn);
  }

  // --- App del chofer ------------------------------------------------------------------

  app.get(
    '/driver/trips',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Viajes del día del chofer (el que está en curso y el siguiente arriba)',
        querystring: driverTripsQuery,
        response: { 200: driverTrips },
      },
    },
    (request) =>
      driverAction(request, (tx) => driver.todayTrips(tx, sessionOf(request), request.query.date)),
  );

  app.get(
    '/driver/checklist-template',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Puntos del checklist de la unidad',
        response: { 200: checklistTemplate },
      },
    },
    (request) => driverAction(request, (tx) => panel.template(tx, sessionOf(request).tenantId)),
  );

  app.post(
    '/driver/trips/:id/photos',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Sube una foto del viaje (checklist, incidente o evidencia)',
        params: idParams,
        querystring: photoKindQuery,
        response: { 201: photoResponse },
      },
    },
    async (request, reply) => {
      const file = await readUpload(request, 'image');
      const photo = await driverAction(request, (tx) =>
        driver.uploadPhoto(tx, sessionOf(request), request.params.id, request.query.kind, file),
      );
      return reply.status(201).send(photo);
    },
  );

  app.post(
    '/driver/trips/:id/checklist',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Envía el checklist de la unidad (vale para los viajes del día de esa unidad)',
        params: idParams,
        body: checklistBody,
        response: { 200: checklistResponse },
      },
    },
    (request) =>
      driverAction(request, (tx) =>
        driver.submitChecklist(tx, sessionOf(request), request.params.id, request.body),
      ),
  );

  app.post(
    '/driver/trips/:id/start',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Inicia el viaje',
        description:
          'Requiere unidad asignada, checklist aprobado (o salida autorizada por el despachador), estar dentro de las 2 horas previas y no tener otro viaje en curso.',
        params: idParams,
        body: actionBody,
        response: { 200: tripState },
      },
    },
    (request) =>
      driverAction(request, (tx) =>
        driver.start(tx, sessionOf(request), request.params.id, request.body),
      ),
  );

  app.post(
    '/driver/trips/:id/stops',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Registra la llegada a una parada',
        params: idParams,
        body: arriveStopBody,
        response: { 200: tripState },
      },
    },
    (request) =>
      driverAction(request, (tx) =>
        driver.arriveStop(tx, sessionOf(request), request.params.id, request.body),
      ),
  );

  app.post(
    '/driver/trips/:id/scan',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Escanea a un pasajero (credencial QR, gafete o número de empleado)',
        description:
          'La parada se asigna sola por la ubicación del escaneo. Un gafete desconocido queda como provisional y el viaje sigue.',
        params: idParams,
        body: scanBody,
        response: { 200: scanResponse },
      },
    },
    (request) =>
      driverAction(request, (tx) =>
        driver.scan(tx, sessionOf(request), request.params.id, request.body),
      ),
  );

  app.post(
    '/driver/trips/:id/incidents',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Reporta un incidente con tipo, foto y ubicación',
        params: idParams,
        body: incidentBody,
        response: { 201: incidentResponse },
      },
    },
    async (request, reply) => {
      const incident = await driverAction(request, (tx) =>
        driver.reportIncident(tx, sessionOf(request), request.params.id, request.body),
      );
      return reply.status(201).send(incident);
    },
  );

  app.post(
    '/driver/panic',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Botón de pánico (con o sin viaje en curso)',
        body: panicBody,
        response: { 201: panicResponse },
      },
    },
    async (request, reply) => {
      const panic = await driverAction(request, (tx) =>
        driver.panic(tx, sessionOf(request), request.body),
      );
      return reply.status(201).send(panic);
    },
  );

  app.post(
    '/driver/trips/:id/gate',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Escanea el QR fijo de la puerta de la planta (prueba de llegada)',
        params: idParams,
        body: gateBody,
        response: { 200: tripState },
      },
    },
    (request) =>
      driverAction(request, (tx) =>
        driver.gate(tx, sessionOf(request), request.params.id, request.body),
      ),
  );

  app.post(
    '/driver/trips/:id/finish',
    {
      onRequest: driverOnly,
      schema: {
        tags: DRIVER_TAGS,
        summary: 'Termina el viaje',
        params: idParams,
        body: actionBody,
        response: { 200: tripState },
      },
    },
    (request) =>
      driverAction(request, (tx) =>
        driver.finish(tx, sessionOf(request), request.params.id, request.body),
      ),
  );

  // --- Panel y portal de la planta -------------------------------------------------------

  app.get(
    '/trips/:id',
    {
      onRequest: canSeeEvidence,
      schema: {
        tags: TAGS,
        summary:
          'Detalle del viaje con su evidencia (historial, checklist, abordajes, incidentes, fotos)',
        params: idParams,
        response: { 200: tripDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => panel.detail(tx, request.params.id)),
  );

  app.get(
    '/trips/:id/photos/:photoId',
    {
      onRequest: canSeeEvidence,
      schema: { tags: TAGS, summary: 'Foto tomada en el viaje', params: tripPhotoParams },
    },
    async (request, reply) => {
      const photo = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        panel.photo(tx, request.params.id, request.params.photoId),
      );
      return sendFile(reply, photo);
    },
  );

  app.post(
    '/trips/:id/checklist-exception',
    {
      onRequest: requirePermission(app, 'dispatch.operate'),
      schema: {
        tags: TAGS,
        summary: 'Autoriza la salida aunque el checklist tenga puntos sin aprobar',
        params: idParams,
        body: exceptionBody,
        response: { 200: tripSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        panel.authorizeChecklistException(
          tx,
          tenantIdOf(request),
          authOf(request, 'user').sub,
          request.params.id,
          request.body.reason,
        ),
      ),
  );

  app.get(
    '/checklist-template',
    {
      onRequest: requirePermission(app, 'settings.manage', 'schedule.read'),
      schema: {
        tags: TAGS,
        summary: 'Checklist de la unidad (el de la empresa o el predeterminado)',
        response: { 200: checklistTemplate },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        panel.template(tx, tenantIdOf(request)),
      ),
  );

  app.put(
    '/checklist-template',
    {
      onRequest: requirePermission(app, 'settings.manage'),
      schema: {
        tags: TAGS,
        summary: 'Configura los puntos del checklist y en cuáles es obligatoria la foto',
        body: saveTemplateBody,
        response: { 200: checklistTemplate },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        panel.saveTemplate(tx, tenantIdOf(request), request.body.items),
      ),
  );

  app.get(
    '/incidents',
    {
      onRequest: requirePermission(app, 'alerts.manage', 'monitoring.view', 'dispatch.operate'),
      schema: {
        tags: TAGS,
        summary: 'Incidentes reportados por los choferes',
        querystring: incidentsQuery,
        response: { 200: z.array(incidentSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        panel.listIncidents(tx, request.query),
      ),
  );

  app.post(
    '/incidents/:id/resolve',
    {
      onRequest: canDispatch,
      schema: {
        tags: TAGS,
        summary: 'Registra la solución de un incidente',
        params: idParams,
        body: resolveIncidentBody,
        response: { 200: incidentSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        panel.resolveIncident(
          tx,
          authOf(request, 'user').sub,
          request.params.id,
          request.body.resolution,
        ),
      ),
  );

  app.get(
    '/panic-events',
    {
      onRequest: requirePermission(app, 'alerts.manage', 'monitoring.view', 'dispatch.operate'),
      schema: {
        tags: TAGS,
        summary: 'Alertas de pánico',
        querystring: panicsQuery,
        response: { 200: z.array(panicSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => panel.listPanics(tx, request.query)),
  );

  app.post(
    '/panic-events/:id/acknowledge',
    {
      onRequest: canDispatch,
      schema: {
        tags: TAGS,
        summary: 'Marca la alerta de pánico como atendida',
        params: idParams,
        response: { 200: panicSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        panel.acknowledgePanic(tx, authOf(request, 'user').sub, request.params.id),
      ),
  );

  done();
};
