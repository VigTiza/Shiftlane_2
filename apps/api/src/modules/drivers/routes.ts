import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import {
  buildSpreadsheet,
  buildTemplate,
  parseSpreadsheet,
  XLSX_CONTENT_TYPE,
} from '../../lib/excel.ts';
import { sendFile } from '../../lib/files.ts';
import {
  auditEntrySchema,
  idParams,
  importQuery,
  importReportSchema,
} from '../../lib/http-schemas.ts';
import { readUpload } from '../../lib/uploads.ts';
import { z } from '../../lib/zod.ts';
import { authOf, dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  createDriverBody,
  createDriverDocumentBody,
  DRIVER_COLUMNS,
  driverDetail,
  driverDocumentSummary,
  driverList,
  driverRowSchema,
  enrollmentResponse,
  listDriversQuery,
  messageResponse,
  updateDriverBody,
  updateDriverDocumentBody,
} from './schemas.ts';
import { createDriversService } from './service.ts';

const TAGS = ['Choferes'];
const noContent = z.null();

export const driverRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const { drivers: driverAuth } = app.authServices;
  const service = createDriversService({
    storage: app.storage,
    timeZone: app.config.DEFAULT_TIME_ZONE,
  });
  const canRead = requirePermission(app, 'drivers.read');
  const canWrite = requirePermission(app, 'drivers.write');
  const canEnroll = requirePermission(app, 'drivers.enroll');
  const canReadDocs = requirePermission(app, 'drivers.read', 'compliance.read');
  const canWriteDocs = requirePermission(app, 'drivers.write', 'compliance.write');

  app.get(
    '/drivers',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Busca y lista choferes',
        querystring: listDriversQuery,
        response: { 200: driverList },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx, request.query)),
  );

  app.post(
    '/drivers',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Da de alta un chofer',
        body: createDriverBody,
        response: { 201: driverDetail },
      },
    },
    async (request, reply) => {
      const driver = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.create(tx, tenantIdOf(request), request.body),
      );
      return reply.status(201).send(driver);
    },
  );

  app.get(
    '/drivers/export',
    { onRequest: canRead, schema: { tags: TAGS, summary: 'Descarga los choferes en Excel' } },
    async (request, reply) => {
      const rows = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.exportRows(tx),
      );
      const buffer = await buildSpreadsheet(DRIVER_COLUMNS, rows, 'Choferes');
      return sendFile(
        reply,
        { body: buffer, contentType: XLSX_CONTENT_TYPE, fileName: 'choferes.xlsx' },
        'attachment',
      );
    },
  );

  app.get(
    '/drivers/import/template',
    {
      onRequest: canRead,
      schema: { tags: TAGS, summary: 'Plantilla de Excel para cargar choferes' },
    },
    async (_request, reply) => {
      const buffer = await buildTemplate(DRIVER_COLUMNS, 'Choferes');
      return sendFile(
        reply,
        { body: buffer, contentType: XLSX_CONTENT_TYPE, fileName: 'plantilla-choferes.xlsx' },
        'attachment',
      );
    },
  );

  app.post(
    '/drivers/import',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Carga choferes desde Excel (dryRun=true solo valida)',
        querystring: importQuery,
        response: { 200: importReportSchema },
      },
    },
    async (request) => {
      const file = await readUpload(request, 'spreadsheet');
      const parsed = await parseSpreadsheet(file.buffer, DRIVER_COLUMNS, driverRowSchema);
      return withDbContext(
        app.db.app,
        dbContextOf(request),
        (tx) =>
          service.importRows(
            tx,
            tenantIdOf(request),
            parsed.rows,
            {
              totalRows: parsed.totalRows,
              created: 0,
              updated: 0,
              errors: parsed.errors,
              applied: false,
            },
            request.query.dryRun,
          ),
        { timeout: 60_000 },
      );
    },
  );

  app.get(
    '/drivers/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Detalle del chofer con sus documentos',
        params: idParams,
        response: { 200: driverDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.get(tx, request.params.id)),
  );

  app.patch(
    '/drivers/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita un chofer',
        params: idParams,
        body: updateDriverBody,
        response: { 200: driverDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.update(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/drivers/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Da de baja un chofer y lo desvincula de sus celulares',
        params: idParams,
        response: { 204: noContent },
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
    '/drivers/:id/history',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Historial de cambios del chofer y sus documentos',
        params: idParams,
        response: { 200: z.array(auditEntrySchema) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.history(tx, request.params.id),
      ),
  );

  app.put(
    '/drivers/:id/photo',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Sube la foto del chofer',
        params: idParams,
        response: { 204: noContent },
      },
    },
    async (request, reply) => {
      const file = await readUpload(request, 'image');
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.setPhoto(tx, request.params.id, file),
      );
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/drivers/:id/photo',
    { onRequest: canRead, schema: { tags: TAGS, summary: 'Foto del chofer', params: idParams } },
    async (request, reply) => {
      const photo = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.getPhoto(tx, request.params.id),
      );
      return sendFile(reply, photo);
    },
  );

  app.post(
    '/drivers/:id/documents',
    {
      onRequest: canWriteDocs,
      schema: {
        tags: TAGS,
        summary: 'Agrega un documento al chofer',
        params: idParams,
        body: createDriverDocumentBody,
        response: { 201: driverDocumentSummary },
      },
    },
    async (request, reply) => {
      const doc = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.addDocument(tx, request.params.id, request.body),
      );
      return reply.status(201).send(doc);
    },
  );

  app.patch(
    '/driver-documents/:id',
    {
      onRequest: canWriteDocs,
      schema: {
        tags: TAGS,
        summary: 'Edita un documento de chofer',
        params: idParams,
        body: updateDriverDocumentBody,
        response: { 200: driverDocumentSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateDocument(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/driver-documents/:id',
    {
      onRequest: canWriteDocs,
      schema: {
        tags: TAGS,
        summary: 'Elimina un documento de chofer',
        params: idParams,
        response: { 204: noContent },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.removeDocument(tx, request.params.id),
      );
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/driver-documents/:id/file',
    {
      onRequest: canWriteDocs,
      schema: {
        tags: TAGS,
        summary: 'Adjunta el archivo del documento',
        params: idParams,
        response: { 200: driverDocumentSummary },
      },
    },
    async (request) => {
      const file = await readUpload(request, 'document');
      return withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.attachFile(tx, request.params.id, file),
      );
    },
  );

  app.get(
    '/driver-documents/:id/file',
    {
      onRequest: canReadDocs,
      schema: { tags: TAGS, summary: 'Descarga el archivo del documento', params: idParams },
    },
    async (request, reply) => {
      const file = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.getFile(tx, request.params.id),
      );
      return sendFile(reply, file);
    },
  );

  // --- Acceso a la app del chofer (F01-P03) ----------------------------------------

  app.post(
    '/drivers/:id/enrollment',
    {
      onRequest: canEnroll,
      schema: {
        tags: TAGS,
        summary: 'Genera el código QR de un solo uso para vincular al chofer con su celular',
        params: idParams,
        response: { 201: enrollmentResponse },
      },
    },
    async (request, reply) => {
      const auth = authOf(request, 'user');
      const enrollment = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        driverAuth.createEnrollment(tx, { driverId: request.params.id, createdByUserId: auth.sub }),
      );
      return reply.status(201).send(enrollment);
    },
  );

  app.post(
    '/drivers/:id/pin-reset',
    {
      onRequest: canEnroll,
      schema: {
        tags: TAGS,
        summary: 'Restablece el PIN del chofer; creará uno nuevo en su celular',
        params: idParams,
        response: { 200: messageResponse },
      },
    },
    async (request) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        driverAuth.resetPin(tx, request.params.id),
      );
      return { message: 'El PIN se restableció. El chofer creará uno nuevo al entrar.' };
    },
  );

  done();
};
