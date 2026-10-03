import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { buildTemplate, parseSpreadsheet, XLSX_CONTENT_TYPE } from '../../lib/excel.ts';
import { sendFile } from '../../lib/files.ts';
import { idParams, paginated } from '../../lib/http-schemas.ts';
import { readUpload } from '../../lib/uploads.ts';
import { z } from '../../lib/zod.ts';
import {
  authOf,
  clientOrgIdOf,
  dbContextOf,
  requireAuth,
  requirePermission,
} from '../../plugins/auth.ts';
import {
  addBadgeBody,
  createPassengerBody,
  importQuery,
  importSummary,
  issuedCredential,
  listPassengersQuery,
  listProvisionalQuery,
  PASSENGER_COLUMNS,
  passengerRowSchema,
  passengerSummary,
  provisionalBody,
  provisionalSummary,
  resolveBody,
  updatePassengerBody,
  verifyBody,
  verifyResponse,
} from './schemas.ts';
import { createPassengersService } from './service.ts';

const TAGS = ['Pasajeros'];

export const passengerRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createPassengersService({ signer: app.credentialSigner });
  const canManage = requirePermission(app, 'plant.employees');
  const canRead = requirePermission(app, 'plant.employees', 'passengers.read');
  const driverOnly = requireAuth(app, { kinds: ['driver'] });

  app.get(
    '/passengers',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Lista de empleados (la planta) o pasajeros atendidos (la transportista)',
        querystring: listPassengersQuery,
        response: { 200: paginated(passengerSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx, request.query)),
  );

  app.post(
    '/passengers',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Da de alta un empleado',
        body: createPassengerBody,
        response: { 201: passengerSummary },
      },
    },
    async (request, reply) => {
      const passenger = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.create(tx, clientOrgIdOf(request), request.body),
      );
      return reply.status(201).send(passenger);
    },
  );

  // Rutas fijas antes que /passengers/:id.
  app.get(
    '/passenger-imports/template',
    { onRequest: canManage, schema: { tags: TAGS, summary: 'Plantilla de Excel de empleados' } },
    async (_request, reply) => {
      const buffer = await buildTemplate(PASSENGER_COLUMNS, 'Empleados');
      return sendFile(
        reply,
        { body: buffer, contentType: XLSX_CONTENT_TYPE, fileName: 'plantilla-empleados.xlsx' },
        'attachment',
      );
    },
  );

  app.get(
    '/passenger-imports',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Cargas de Excel recientes',
        response: { 200: z.array(importSummary) },
      },
    },
    (request) => withDbContext(app.db.app, dbContextOf(request), (tx) => service.listImports(tx)),
  );

  app.post(
    '/passenger-imports',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary:
          'Sube el Excel de empleados y devuelve la vista previa de diferencias (no aplica nada)',
        querystring: importQuery,
        response: { 201: importSummary },
      },
    },
    async (request, reply) => {
      const file = await readUpload(request, 'spreadsheet');
      const parsed = await parseSpreadsheet(file.buffer, PASSENGER_COLUMNS, passengerRowSchema);
      const preview = await withDbContext(
        app.db.app,
        dbContextOf(request),
        (tx) =>
          service.previewImport(tx, {
            clientOrgId: clientOrgIdOf(request),
            plantId: request.query.plantId,
            userId: authOf(request, 'user').sub,
            fileName: file.fileName,
            mode: request.query.mode,
            rows: parsed.rows,
            errors: parsed.errors,
            totalRows: parsed.totalRows,
          }),
        { timeout: 60_000 },
      );
      return reply.status(201).send(preview);
    },
  );

  app.post(
    '/passenger-imports/:id/apply',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Aplica la carga revisada (todo o nada)',
        params: idParams,
        response: { 200: importSummary },
      },
    },
    (request) =>
      withDbContext(
        app.db.app,
        dbContextOf(request),
        (tx) => service.applyImport(tx, request.params.id),
        { timeout: 120_000 },
      ),
  );

  app.post(
    '/passenger-imports/:id/discard',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Descarta una carga sin aplicar',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.discardImport(tx, request.params.id),
      );
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/passengers/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Detalle del empleado con sus credenciales',
        params: idParams,
        response: { 200: passengerSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.get(tx, request.params.id)),
  );

  app.patch(
    '/passengers/:id',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Edita o da de baja a un empleado',
        params: idParams,
        body: updatePassengerBody,
        response: { 200: passengerSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.update(tx, request.params.id, request.body),
      ),
  );

  app.post(
    '/passengers/:id/credential',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Emite una credencial QR nueva (la anterior deja de servir)',
        params: idParams,
        response: { 201: issuedCredential },
      },
    },
    async (request, reply) => {
      const credential = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.issueCredential(tx, request.params.id),
      );
      return reply.status(201).send(credential);
    },
  );

  app.post(
    '/passengers/:id/badges',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Registra el gafete existente de la planta',
        params: idParams,
        body: addBadgeBody,
        response: { 200: passengerSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.addBadge(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/passenger-credentials/:id',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Da de baja una credencial o gafete',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.revokeCredential(tx, request.params.id),
      );
      return reply.status(204).send(null);
    },
  );

  // --- Pasajero, chofer y llave pública ---------------------------------------------

  app.get(
    '/me/credential',
    {
      onRequest: requireAuth(app, { kinds: ['passenger'] }),
      schema: {
        tags: TAGS,
        summary: 'Credencial QR del pasajero para abordar',
        response: { 200: issuedCredential },
      },
    },
    (request) => service.currentCredential(app.db.system, authOf(request, 'passenger').sub),
  );

  app.get(
    '/credentials/public-key',
    {
      schema: {
        tags: TAGS,
        summary: 'Llave pública Ed25519 para verificar credenciales sin señal',
        response: { 200: z.object({ algorithm: z.literal('Ed25519'), publicKeyPem: z.string() }) },
      },
    },
    () => ({ algorithm: 'Ed25519' as const, publicKeyPem: app.credentialSigner.publicKeyPem }),
  );

  app.post(
    '/credentials/verify',
    {
      onRequest: driverOnly,
      schema: {
        tags: TAGS,
        summary: 'El chofer verifica una credencial QR o un gafete',
        body: verifyBody,
        response: { 200: verifyResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.verify(tx, request.body.code),
      ),
  );

  app.post(
    '/provisional-badges',
    {
      onRequest: driverOnly,
      schema: {
        tags: TAGS,
        summary: 'Registra un gafete desconocido sin detener el viaje',
        body: provisionalBody,
        response: { 201: provisionalSummary },
      },
    },
    async (request, reply) => {
      const auth = authOf(request, 'driver');
      const badge = await service.registerProvisional(app.db.system, auth.tenantId, request.body);
      return reply.status(201).send(badge);
    },
  );

  app.get(
    '/provisional-badges',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Gafetes provisionales por resolver',
        querystring: listProvisionalQuery,
        response: { 200: z.array(provisionalSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.listProvisional(tx, request.query),
      ),
  );

  app.post(
    '/provisional-badges/:id/resolve',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Asigna el gafete provisional a un empleado',
        params: idParams,
        body: resolveBody,
        response: { 200: provisionalSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.resolveProvisional(
          tx,
          authOf(request, 'user').sub,
          request.params.id,
          request.body.passengerId,
        ),
      ),
  );

  app.post(
    '/provisional-badges/:id/dismiss',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Descarta un gafete provisional',
        params: idParams,
        response: { 200: provisionalSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.dismissProvisional(tx, authOf(request, 'user').sub, request.params.id),
      ),
  );

  done();
};
