import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { idParams } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { authOf, dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import { passwordSchema } from '../auth/passwords.ts';
import { REFRESH_COOKIE } from '../auth/routes.ts';
import { createClientsService } from '../clients/service.ts';
import { createInvitationsService, PLANT_INVITATION_ROLES } from './service.ts';

const TAGS = ['Invitaciones de planta'];

const invitationSummary = z.object({
  id: z.uuid(),
  plantId: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.string(),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  expiresAt: z.date(),
  acceptedAt: z.date().nullable(),
});

const createInvitationBody = z.object({
  email: z.email({ message: 'Escribe un correo válido.' }).max(254),
  fullName: z.string().trim().min(3, 'Escribe el nombre completo.').max(120),
  role: z.enum(PLANT_INVITATION_ROLES).default('plant_logistics'),
});

const acceptBody = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
const acceptExistingBody = z.object({
  token: z.string().min(20).max(200),
  plantId: z.uuid().optional(),
});

export const invitationRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const env = app.config;
  const service = createInvitationsService({
    system: app.db.system,
    clients: createClientsService(),
    auth: app.authServices.auth,
    mailer: app.mailer,
    appUrl: env.APP_URL,
  });
  const cookieSecure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';

  app.post(
    '/plants/:id/invitations',
    {
      onRequest: requirePermission(app, 'clients.write'),
      schema: {
        tags: TAGS,
        summary: 'Invita por correo a un usuario de la planta',
        params: idParams,
        body: createInvitationBody,
        response: { 201: invitationSummary },
      },
    },
    async (request, reply) => {
      const invitation = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.create(
          tx,
          tenantIdOf(request),
          request.params.id,
          request.body,
          authOf(request, 'user').sub,
        ),
      );
      const { token: _token, ...summary } = invitation;
      return reply.status(201).send(summary);
    },
  );

  app.get(
    '/plants/:id/invitations',
    {
      onRequest: requirePermission(app, 'clients.read'),
      schema: {
        tags: TAGS,
        summary: 'Invitaciones enviadas a la planta',
        params: idParams,
        response: { 200: z.array(invitationSummary) },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx, request.params.id)),
  );

  app.delete(
    '/plant-invitations/:id',
    {
      onRequest: requirePermission(app, 'clients.write'),
      schema: {
        tags: TAGS,
        summary: 'Cancela una invitación pendiente',
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.revoke(tx, request.params.id),
      );
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/invitations/accept',
    {
      config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: 60_000 } },
      schema: {
        tags: TAGS,
        summary: 'Acepta la invitación creando tu cuenta',
        body: acceptBody,
        response: { 200: z.object({ accessToken: z.string(), expiresIn: z.number().int() }) },
      },
    },
    async (request, reply) => {
      const result = await service.accept(request.body, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      if ('twoFactorRequired' in result) throw new Error('Una cuenta nueva no tiene 2FA.');
      void reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: 'strict',
        path: '/auth',
        maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
      });
      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    },
  );

  app.post(
    '/invitations/accept-existing',
    {
      onRequest: requirePermission(app, 'users.manage'),
      schema: {
        tags: TAGS,
        summary: 'Acepta la invitación con tu cuenta de planta existente',
        body: acceptExistingBody,
        response: {
          200: z.object({
            tenantId: z.uuid(),
            tenantName: z.string(),
            clientOrgId: z.uuid(),
            plantId: z.uuid(),
          }),
        },
      },
    },
    (request) => {
      const claims = authOf(request, 'user');
      return service.acceptExisting(
        { id: claims.sub, clientOrgId: claims.clientOrgId },
        request.body,
      );
    },
  );

  done();
};
