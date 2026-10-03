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
import { dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  createDocumentBody,
  createVehicleBody,
  documentSummary,
  listVehiclesQuery,
  updateDocumentBody,
  updateVehicleBody,
  VEHICLE_COLUMNS,
  vehicleDetail,
  vehicleList,
  vehicleRowSchema,
} from './schemas.ts';
import { createVehiclesService } from './service.ts';

const TAGS = ['Unidades'];
const noContent = z.null();

export const vehicleRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createVehiclesService({
    storage: app.storage,
    timeZone: app.config.DEFAULT_TIME_ZONE,
  });
  const canRead = requirePermission(app, 'vehicles.read');
  const canWrite = requirePermission(app, 'vehicles.write');
  const canReadDocs = requirePermission(app, 'vehicles.read', 'compliance.read');
  const canWriteDocs = requirePermission(app, 'vehicles.write', 'compliance.write');

  app.get(
    '/vehicles',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Busca y lista unidades',
        querystring: listVehiclesQuery,
        response: { 200: vehicleList },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx, request.query)),
  );

  app.post(
    '/vehicles',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Da de alta una unidad',
        body: createVehicleBody,
        response: { 201: vehicleDetail },
      },
    },
    async (request, reply) => {
      const vehicle = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.create(tx, tenantIdOf(request), request.body),
      );
      return reply.status(201).send(vehicle);
    },
  );

  // Las rutas fijas van antes que /vehicles/:id.
  app.get(
    '/vehicles/export',
    { onRequest: canRead, schema: { tags: TAGS, summary: 'Descarga las unidades en Excel' } },
    async (request, reply) => {
      const vehicles = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.exportRows(tx),
      );
      const buffer = await buildSpreadsheet(VEHICLE_COLUMNS, vehicles, 'Unidades');
      return sendFile(
        reply,
        { body: buffer, contentType: XLSX_CONTENT_TYPE, fileName: 'unidades.xlsx' },
        'attachment',
      );
    },
  );

  app.get(
    '/vehicles/import/template',
    {
      onRequest: canRead,
      schema: { tags: TAGS, summary: 'Plantilla de Excel para cargar unidades' },
    },
    async (_request, reply) => {
      const buffer = await buildTemplate(VEHICLE_COLUMNS, 'Unidades');
      return sendFile(
        reply,
        { body: buffer, contentType: XLSX_CONTENT_TYPE, fileName: 'plantilla-unidades.xlsx' },
        'attachment',
      );
    },
  );

  app.post(
    '/vehicles/import',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Carga unidades desde Excel (dryRun=true solo valida)',
        querystring: importQuery,
        response: { 200: importReportSchema },
      },
    },
    async (request) => {
      const file = await readUpload(request, 'spreadsheet');
      const parsed = await parseSpreadsheet(file.buffer, VEHICLE_COLUMNS, vehicleRowSchema);
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
    '/vehicles/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Detalle de una unidad con sus documentos',
        params: idParams,
        response: { 200: vehicleDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.get(tx, request.params.id)),
  );

  app.patch(
    '/vehicles/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita una unidad',
        params: idParams,
        body: updateVehicleBody,
        response: { 200: vehicleDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.update(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/vehicles/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Da de baja una unidad',
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
    '/vehicles/:id/history',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Historial de cambios de la unidad y sus documentos',
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
    '/vehicles/:id/photo',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Sube la foto de la unidad (JPG, PNG o WebP)',
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
    '/vehicles/:id/photo',
    { onRequest: canRead, schema: { tags: TAGS, summary: 'Foto de la unidad', params: idParams } },
    async (request, reply) => {
      const photo = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.getPhoto(tx, request.params.id),
      );
      return sendFile(reply, photo);
    },
  );

  app.post(
    '/vehicles/:id/documents',
    {
      onRequest: canWriteDocs,
      schema: {
        tags: TAGS,
        summary: 'Agrega un documento a la unidad',
        params: idParams,
        body: createDocumentBody,
        response: { 201: documentSummary },
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
    '/vehicle-documents/:id',
    {
      onRequest: canWriteDocs,
      schema: {
        tags: TAGS,
        summary: 'Edita un documento de unidad',
        params: idParams,
        body: updateDocumentBody,
        response: { 200: documentSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateDocument(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/vehicle-documents/:id',
    {
      onRequest: canWriteDocs,
      schema: {
        tags: TAGS,
        summary: 'Elimina un documento de unidad',
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
    '/vehicle-documents/:id/file',
    {
      onRequest: canWriteDocs,
      schema: {
        tags: TAGS,
        summary: 'Adjunta el archivo del documento (PDF o imagen)',
        params: idParams,
        response: { 200: documentSummary },
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
    '/vehicle-documents/:id/file',
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

  done();
};
