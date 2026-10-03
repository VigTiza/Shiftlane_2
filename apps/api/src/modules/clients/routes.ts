import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  clientOrgDetail,
  clientOrgSummary,
  contactBody,
  contactSummary,
  createClientOrgBody,
  createPlantBody,
  gateBody,
  gateSummary,
  listClientOrgsQuery,
  plantDetail,
  updateClientOrgBody,
  updateContactBody,
  updateGateBody,
  updatePlantBody,
} from './schemas.ts';
import { createClientsService } from './service.ts';

const TAGS = ['Clientes'];

export const clientRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createClientsService();
  const canRead = requirePermission(app, 'clients.read');
  const canWrite = requirePermission(app, 'clients.write');

  app.get(
    '/client-orgs',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Empresas cliente que atiende o administra la transportista',
        querystring: listClientOrgsQuery,
        response: { 200: z.array(clientOrgSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.listOrgs(tx, tenantIdOf(request), request.query.search),
      ),
  );

  app.post(
    '/client-orgs',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Registra una empresa cliente',
        body: createClientOrgBody,
        response: { 201: clientOrgSummary },
      },
    },
    async (request, reply) => {
      const org = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.createOrg(tx, tenantIdOf(request), request.body),
      );
      return reply.status(201).send(org);
    },
  );

  app.get(
    '/client-orgs/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Ficha de la empresa cliente',
        params: idParams,
        response: { 200: clientOrgDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.getOrg(tx, tenantIdOf(request), request.params.id),
      ),
  );

  app.patch(
    '/client-orgs/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita una empresa cliente que administra la transportista',
        params: idParams,
        body: updateClientOrgBody,
        response: { 200: clientOrgSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateOrg(tx, tenantIdOf(request), request.params.id, request.body),
      ),
  );

  app.post(
    '/client-orgs/:id/plants',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Agrega una planta y su acuerdo de servicio',
        params: idParams,
        body: createPlantBody,
        response: { 201: plantDetail },
      },
    },
    async (request, reply) => {
      const plant = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.createPlant(tx, tenantIdOf(request), request.params.id, request.body),
      );
      return reply.status(201).send(plant);
    },
  );

  app.get(
    '/plants/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Detalle de la planta con sus puertas',
        params: idParams,
        response: { 200: plantDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.getPlant(tx, tenantIdOf(request), request.params.id),
      ),
  );

  app.patch(
    '/plants/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita una planta (nombre, dirección, ubicación)',
        params: idParams,
        body: updatePlantBody,
        response: { 200: plantDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updatePlant(tx, tenantIdOf(request), request.params.id, request.body),
      ),
  );

  app.post(
    '/plants/:id/gates',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Agrega una puerta con su QR fijo de llegada',
        params: idParams,
        body: gateBody,
        response: { 201: gateSummary },
      },
    },
    async (request, reply) => {
      const gate = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.createGate(tx, tenantIdOf(request), request.params.id, request.body),
      );
      return reply.status(201).send(gate);
    },
  );

  app.patch(
    '/plant-gates/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita o desactiva una puerta',
        params: idParams,
        body: updateGateBody,
        response: { 200: gateSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateGate(tx, tenantIdOf(request), request.params.id, request.body),
      ),
  );

  app.post(
    '/plant-gates/:id/rotate-qr',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Genera un QR nuevo para la puerta (el anterior deja de servir)',
        params: idParams,
        response: { 200: gateSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateGate(tx, tenantIdOf(request), request.params.id, { rotateQr: true }),
      ),
  );

  app.get(
    '/client-orgs/:id/contacts',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Contactos de la empresa cliente',
        params: idParams,
        response: { 200: z.array(contactSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.listContacts(tx, request.params.id),
      ),
  );

  app.post(
    '/client-orgs/:id/contacts',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Agrega un contacto',
        params: idParams,
        body: contactBody,
        response: { 201: contactSummary },
      },
    },
    async (request, reply) => {
      const contact = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.createContact(tx, tenantIdOf(request), request.params.id, request.body),
      );
      return reply.status(201).send(contact);
    },
  );

  app.patch(
    '/client-contacts/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita un contacto',
        params: idParams,
        body: updateContactBody,
        response: { 200: contactSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateContact(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/client-contacts/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Elimina un contacto',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.removeContact(tx, request.params.id),
      );
      return reply.status(204).send(null);
    },
  );

  done();
};
