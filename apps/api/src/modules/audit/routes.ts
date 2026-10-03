import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { z } from '../../lib/zod.ts';
import { dbContextOf, requirePermission } from '../../plugins/auth.ts';

const auditQuery = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  /** Devuelve registros anteriores a este id (paginación hacia atrás). */
  before: z.coerce.bigint().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const auditEntry = z.object({
  id: z.string(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  requestId: z.string().nullable(),
  createdAt: z.date(),
});

export const auditRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/audit-log',
    {
      onRequest: requirePermission(app, 'audit.read'),
      schema: {
        tags: ['Auditoría'],
        summary: 'Historial de cambios de la cuenta, del más reciente al más antiguo',
        querystring: auditQuery,
        response: { 200: z.array(auditEntry) },
      },
    },
    async (request) => {
      const { entityType, entityId, before, limit } = request.query;
      const rows = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        tx.auditLog.findMany({
          where: {
            ...(entityType ? { entityType } : {}),
            ...(entityId ? { entityId } : {}),
            ...(before ? { id: { lt: before } } : {}),
          },
          orderBy: { id: 'desc' },
          take: limit,
        }),
      );
      return rows.map((row) => ({ ...row, id: row.id.toString() }));
    },
  );

  done();
};
