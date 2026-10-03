import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { authOf, dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  assignmentBody,
  assignmentResponse,
  autoAssignBody,
  autoAssignResponse,
  cancelTripBody,
  conflictsQuery,
  conflictsResponse,
  copyWeekBody,
  copyWeekResponse,
  createHolidayBody,
  extraTripBody,
  generateBody,
  generationResult,
  holidaySummary,
  importOfficialBody,
  importOfficialResult,
  listHolidaysQuery,
  listTripsQuery,
  tripPage,
  tripSummary,
  updateHolidayBody,
} from './schemas.ts';

const TAGS = ['Programación'];

export const scheduleRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = app.schedule;
  const canRead = requirePermission(app, 'schedule.read');
  const canWrite = requirePermission(app, 'schedule.write');
  const canCancel = requirePermission(app, 'schedule.write', 'dispatch.operate');
  // La planta ve los viajes de sus transportistas (la seguridad por filas filtra cuáles).
  const canReadTrips = requirePermission(app, 'schedule.read', 'plant.dashboard');
  const canReadHolidays = requirePermission(app, 'schedule.read', 'settings.manage');
  const canWriteHolidays = requirePermission(app, 'schedule.write', 'settings.manage');

  app.post(
    '/schedule/generate',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Genera los viajes regulares de un rango de fechas (idempotente)',
        description:
          'Crea los viajes que faltan, actualiza los programados que cambiaron y cancela los que ya no aplican. No toca viajes iniciados ni fechas pasadas. Máximo 62 días.',
        body: generateBody,
        response: { 200: generationResult },
      },
    },
    (request) =>
      withDbContext(
        app.db.app,
        dbContextOf(request),
        (tx) => service.generate(tx, tenantIdOf(request), request.body.from, request.body.to),
        { timeout: 60_000 },
      ),
  );

  app.get(
    '/trips',
    {
      onRequest: canReadTrips,
      schema: {
        tags: TAGS,
        summary: 'Viajes programados de un rango de fechas (por omisión, esta semana)',
        querystring: listTripsQuery,
        response: { 200: tripPage },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.listTrips(tx, request.query)),
  );

  app.post(
    '/trips/extra',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Crea un viaje extraordinario (tiempo extra, cambio de turno, evento)',
        description:
          'Puede basarse en una ruta (paradas y recorrido) o ir sin ruta. Si se indica chofer o unidad, revisa conflictos como la asignación normal.',
        body: extraTripBody,
        response: { 201: assignmentResponse },
      },
    },
    async (request, reply) => {
      const { startTime, endTime, ...body } = request.body;
      const result = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.createExtra(tx, tenantIdOf(request), authOf(request, 'user').sub, {
          ...body,
          times: { start: startTime, end: endTime },
        }),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/trips/:id/cancel',
    {
      onRequest: canCancel,
      schema: {
        tags: TAGS,
        summary: 'Cancela un viaje programado (la generación automática no lo reactiva)',
        params: idParams,
        body: cancelTripBody,
        response: { 200: tripSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.cancel(tx, tenantIdOf(request), request.params.id, request.body.reason),
      ),
  );

  app.put(
    '/trips/:id/assignment',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Asigna unidad y chofer a un viaje programado',
        description:
          'Revisa conflictos (chofer u unidad en dos viajes, unidad en mantenimiento, documentos vencidos, licencia, cupo). Si hay conflictos que bloquean responde 409 con el detalle; con force: true asigna de todos modos.',
        params: idParams,
        body: assignmentBody,
        response: { 200: assignmentResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.assign(
          tx,
          tenantIdOf(request),
          authOf(request, 'user').sub,
          request.params.id,
          request.body,
        ),
      ),
  );

  app.post(
    '/schedule/auto-assign',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Asigna el chofer y la unidad habituales de cada ruta a los viajes sin asignar',
        description:
          'No reemplaza asignaciones manuales ni copiadas, y deja sin asignar los viajes donde la asignación habitual tendría un conflicto que bloquea.',
        body: autoAssignBody,
        response: { 200: autoAssignResponse },
      },
    },
    (request) =>
      withDbContext(
        app.db.app,
        dbContextOf(request),
        (tx) => service.autoAssign(tx, tenantIdOf(request), request.body),
        { timeout: 60_000 },
      ),
  );

  app.post(
    '/schedule/copy-week',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Copia la asignación de unidades y choferes de una semana a otra',
        description:
          'Genera los viajes de la semana destino y copia la asignación por ruta y día. Respeta las asignaciones manuales salvo con overwrite: true y no copia las que crean conflictos que bloquean.',
        body: copyWeekBody,
        response: { 200: copyWeekResponse },
      },
    },
    (request) =>
      withDbContext(
        app.db.app,
        dbContextOf(request),
        (tx) =>
          service.copyWeek(tx, tenantIdOf(request), authOf(request, 'user').sub, request.body),
        { timeout: 60_000 },
      ),
  );

  app.get(
    '/schedule/conflicts',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Conflictos de la programación con sugerencia de solución',
        querystring: conflictsQuery,
        response: { 200: conflictsResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.conflicts(tx, tenantIdOf(request), request.query),
      ),
  );

  app.get(
    '/holidays',
    {
      onRequest: canReadHolidays,
      schema: {
        tags: TAGS,
        summary: 'Días festivos del año (generales y por planta)',
        querystring: listHolidaysQuery,
        response: { 200: z.array(holidaySummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.listHolidays(tx, request.query),
      ),
  );

  app.post(
    '/holidays',
    {
      onRequest: canWriteHolidays,
      schema: {
        tags: TAGS,
        summary: 'Registra un día festivo y ajusta los viajes ya programados',
        body: createHolidayBody,
        response: { 201: holidaySummary },
      },
    },
    async (request, reply) => {
      const holiday = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.createHoliday(tx, tenantIdOf(request), request.body),
      );
      return reply.status(201).send(holiday);
    },
  );

  app.post(
    '/holidays/official',
    {
      onRequest: canWriteHolidays,
      schema: {
        tags: TAGS,
        summary: 'Agrega los días de descanso obligatorio de la Ley Federal del Trabajo',
        body: importOfficialBody,
        response: { 200: importOfficialResult },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.importOfficial(tx, tenantIdOf(request), request.body),
      ),
  );

  app.patch(
    '/holidays/:id',
    {
      onRequest: canWriteHolidays,
      schema: {
        tags: TAGS,
        summary: 'Cambia el nombre o si hay servicio ese día',
        params: idParams,
        body: updateHolidayBody,
        response: { 200: holidaySummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateHoliday(tx, tenantIdOf(request), request.params.id, request.body),
      ),
  );

  app.delete(
    '/holidays/:id',
    {
      onRequest: canWriteHolidays,
      schema: {
        tags: TAGS,
        summary: 'Elimina un día festivo y ajusta los viajes ya programados',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.removeHoliday(tx, tenantIdOf(request), request.params.id),
      );
      return reply.status(204).send(null);
    },
  );

  done();
};
