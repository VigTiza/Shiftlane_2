import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { authOf, dbContextOf, requireAuth } from '../../plugins/auth.ts';
import { driverParams, enrollmentResponse, messageResponse } from './schemas.ts';

const TAGS = ['Choferes'];
// Hasta F01-P04 (permisos por acción) se limita por rol.
const DISPATCH_ROLES = ['owner', 'manager', 'dispatcher'];

export const driverRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const { drivers } = app.authServices;
  const canDispatch = requireAuth(app, { kinds: ['user'], roles: DISPATCH_ROLES });

  app.post(
    '/drivers/:driverId/enrollment',
    {
      preHandler: canDispatch,
      schema: {
        tags: TAGS,
        summary: 'Genera el código QR de un solo uso para vincular al chofer con su celular',
        params: driverParams,
        response: { 201: enrollmentResponse },
      },
    },
    async (request, reply) => {
      const auth = authOf(request, 'user');
      const enrollment = await withDbContext(app.db.app, dbContextOf(auth), (tx) =>
        drivers.createEnrollment(tx, {
          driverId: request.params.driverId,
          createdByUserId: auth.sub,
        }),
      );
      return reply.status(201).send(enrollment);
    },
  );

  app.post(
    '/drivers/:driverId/pin-reset',
    {
      preHandler: canDispatch,
      schema: {
        tags: TAGS,
        summary: 'Restablece el PIN del chofer; creará uno nuevo en su celular',
        params: driverParams,
        response: { 200: messageResponse },
      },
    },
    async (request) => {
      const auth = authOf(request, 'user');
      await withDbContext(app.db.app, dbContextOf(auth), (tx) =>
        drivers.resetPin(tx, request.params.driverId),
      );
      return { message: 'El PIN se restableció. El chofer creará uno nuevo al entrar.' };
    },
  );

  done();
};
