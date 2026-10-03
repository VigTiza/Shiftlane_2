import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { idParams, optionalText } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import type { Lead } from '../../generated/prisma/client.ts';
import { createClientsService } from '../clients/service.ts';

const TAGS = ['Prospectos'];
const LEAD_STAGES = ['contacted', 'quoted', 'pilot', 'won', 'lost'] as const;

const leadFields = {
  companyName: z.string().trim().min(2, 'Escribe el nombre de la empresa.').max(160),
  contactName: optionalText(120),
  email: z.email({ message: 'Escribe un correo válido.' }).max(254).nullable().optional(),
  phone: optionalText(20),
  stage: z.enum(LEAD_STAGES).default('contacted'),
  estimatedVehicles: z.number().int().min(0).max(5000).nullable().optional(),
  estimatedMonthlyValue: z.number().min(0).max(100_000_000).nullable().optional(),
  lostReason: optionalText(300),
  notes: optionalText(2000),
};

function requireLostReason<T extends z.ZodType<Record<string, unknown>>>(schema: T) {
  return schema.refine((body) => body.stage !== 'lost' || Boolean(body.lostReason), {
    message: 'Indica por qué se perdió el prospecto.',
    path: ['lostReason'],
  });
}

const createLeadBody = requireLostReason(z.object(leadFields));
const updateLeadBody = requireLostReason(
  z
    .object(leadFields)
    .partial()
    .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' }),
);
const listLeadsQuery = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  search: z.string().trim().max(80).optional(),
});
const convertBody = z.object({
  plantName: z.string().trim().min(2).max(120).optional(),
  plantAddress: optionalText(300),
});

const leadSummary = z.object({
  id: z.uuid(),
  companyName: z.string(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  stage: z.enum(LEAD_STAGES),
  estimatedVehicles: z.number().int().nullable(),
  estimatedMonthlyValue: z.number().nullable(),
  lostReason: z.string().nullable(),
  notes: z.string().nullable(),
  convertedClientOrgId: z.uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

function mapLead(lead: Lead) {
  return {
    id: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    stage: lead.stage,
    estimatedVehicles: lead.estimatedVehicles,
    estimatedMonthlyValue:
      lead.estimatedMonthlyValue === null ? null : Number(lead.estimatedMonthlyValue),
    lostReason: lead.lostReason,
    notes: lead.notes,
    convertedClientOrgId: lead.convertedClientOrgId,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

async function findLead(tx: DbTransaction, id: string) {
  const lead = await tx.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw new NotFoundError('No se encontró el prospecto.');
  return lead;
}

function clean<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export const leadRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const clients = createClientsService();
  const canRead = requirePermission(app, 'clients.read');
  const canWrite = requirePermission(app, 'clients.write');

  app.get(
    '/leads',
    {
      onRequest: canRead,
      schema: {
        tags: TAGS,
        summary: 'Prospectos por etapa',
        querystring: listLeadsQuery,
        response: { 200: z.array(leadSummary) },
      },
    },
    async (request) => {
      const { stage, search } = request.query;
      const leads = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        tx.lead.findMany({
          where: {
            deletedAt: null,
            ...(stage ? { stage } : {}),
            ...(search
              ? {
                  OR: [
                    { companyName: { contains: search, mode: 'insensitive' } },
                    { contactName: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
        }),
      );
      return leads.map(mapLead);
    },
  );

  app.post(
    '/leads',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Registra un prospecto',
        body: createLeadBody,
        response: { 201: leadSummary },
      },
    },
    async (request, reply) => {
      const lead = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        tx.lead.create({
          data: { ...clean(request.body), tenantId: tenantIdOf(request) } as Parameters<
            typeof tx.lead.create
          >[0]['data'],
        }),
      );
      return reply.status(201).send(mapLead(lead));
    },
  );

  app.patch(
    '/leads/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Actualiza un prospecto o cambia su etapa',
        params: idParams,
        body: updateLeadBody,
        response: { 200: leadSummary },
      },
    },
    async (request) => {
      const lead = await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const current = await findLead(tx, request.params.id);
        if (request.body.stage === 'lost' && !request.body.lostReason && !current.lostReason) {
          throw new BadRequestError('Indica por qué se perdió el prospecto.');
        }
        return tx.lead.update({ where: { id: current.id }, data: clean(request.body) });
      });
      return mapLead(lead);
    },
  );

  app.delete(
    '/leads/:id',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Elimina un prospecto',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const lead = await findLead(tx, request.params.id);
        await tx.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/leads/:id/convert',
    {
      onRequest: canWrite,
      schema: {
        tags: TAGS,
        summary: 'Convierte el prospecto ganado en empresa cliente (y su primera planta)',
        params: idParams,
        body: convertBody,
        response: {
          200: z.object({ lead: leadSummary, clientOrgId: z.uuid(), plantId: z.uuid().nullable() }),
        },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), async (tx) => {
        const tenantId = tenantIdOf(request);
        const lead = await findLead(tx, request.params.id);
        if (lead.convertedClientOrgId)
          throw new ConflictError('El prospecto ya se convirtió en cliente.');
        const org = await clients.createOrg(tx, tenantId, { name: lead.companyName });
        const plant = request.body.plantName
          ? await clients.createPlant(tx, tenantId, org.id, {
              name: request.body.plantName,
              address: request.body.plantAddress,
            })
          : null;
        if (lead.contactName) {
          await clients.createContact(tx, tenantId, org.id, {
            fullName: lead.contactName,
            area: 'other',
            email: lead.email,
            phone: lead.phone,
          });
        }
        const updated = await tx.lead.update({
          where: { id: lead.id },
          data: { stage: 'won', convertedClientOrgId: org.id },
        });
        return { lead: mapLead(updated), clientOrgId: org.id, plantId: plant?.id ?? null };
      }),
  );

  done();
};
