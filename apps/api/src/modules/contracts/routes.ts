import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  contractDetail,
  contractSummary,
  createContractBody,
  createPenaltyBody,
  createRateBody,
  listContractsQuery,
  penaltySummary,
  quoteBody,
  quoteResponse,
  rateSummary,
  updateContractBody,
  updatePenaltyBody,
  updateRateBody,
} from './schemas.ts';
import { createContractsService } from './service.ts';

const TAGS = ['Contratos y tarifas'];
const noContent = z.null();

export const contractRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createContractsService();
  const canRead = requirePermission(app, 'contracts.read');
  const canWrite = requirePermission(app, 'contracts.write');

  app.get(
    '/contracts',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Contratos de la transportista',
        querystring: listContractsQuery,
        response: { 200: z.array(contractSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx, request.query)),
  );

  app.post(
    '/contracts',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Crea un contrato con una empresa cliente',
        body: createContractBody,
        response: { 201: contractDetail },
      },
    },
    async (request, reply) => {
      const contract = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.create(tx, tenantIdOf(request), request.body),
      );
      return reply.status(201).send(contract);
    },
  );

  app.get(
    '/contracts/:id',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Contrato con tarifas y penalizaciones',
        params: idParams,
        response: { 200: contractDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.get(tx, request.params.id)),
  );

  app.patch(
    '/contracts/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita un contrato',
        params: idParams,
        body: updateContractBody,
        response: { 200: contractDetail },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.update(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/contracts/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Da de baja un contrato',
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

  app.post(
    '/contracts/:id/rates',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Agrega una tarifa (general o especial por día, horario, ruta o unidad)',
        params: idParams,
        body: createRateBody,
        response: { 201: rateSummary },
      },
    },
    async (request, reply) => {
      const rate = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.addRate(tx, request.params.id, request.body),
      );
      return reply.status(201).send(rate);
    },
  );

  app.patch(
    '/rates/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita una tarifa',
        params: idParams,
        body: updateRateBody,
        response: { 200: rateSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updateRate(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/rates/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Elimina una tarifa',
        params: idParams,
        response: { 204: noContent },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.removeRate(tx, request.params.id),
      );
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/contracts/:id/penalties',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Agrega una penalización acordada',
        params: idParams,
        body: createPenaltyBody,
        response: { 201: penaltySummary },
      },
    },
    async (request, reply) => {
      const penalty = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.addPenalty(tx, request.params.id, request.body),
      );
      return reply.status(201).send(penalty);
    },
  );

  app.patch(
    '/penalties/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Edita una penalización',
        params: idParams,
        body: updatePenaltyBody,
        response: { 200: penaltySummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.updatePenalty(tx, request.params.id, request.body),
      ),
  );

  app.delete(
    '/penalties/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Elimina una penalización',
        params: idParams,
        response: { 204: noContent },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.removePenalty(tx, request.params.id),
      );
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/contracts/:id/quote',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Cotiza un viaje con las tarifas del contrato',
        params: idParams,
        body: quoteBody,
        response: { 200: quoteResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.quote(tx, request.params.id, request.body),
      ),
  );

  done();
};
