import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { authOf, dbContextOf, requirePermission } from '../../plugins/auth.ts';
import { driverParams, enrollmentResponse, messageResponse } from './schemas.ts';

const TAGS = ['Choferes'];

export const driverRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const { drivers } = app.authServices;
  const canEnroll = requirePermission(app, 'drivers.enroll');

  app.post(
    '/drivers/:driverId/enrollment',
    {
      preHandler: canEnroll,
      schema: {
        tags: TAGS,
        summary: 'Genera el código QR de un solo uso para vincular al chofer con su celular',
        params: driverParams,
        response: { 201: enrollmentResponse },
      },
    },
    async (request, reply) => {
      const auth = authOf(request, 'user');
      const enrollment = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
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
      preHandler: canEnroll,
      schema: {
        tags: TAGS,
        summary: 'Restablece el PIN del chofer; creará uno nuevo en su celular',
        params: driverParams,
        response: { 200: messageResponse },
      },
    },
    async (request) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        drivers.resetPin(tx, request.params.driverId),
      );
      return { message: 'El PIN se restableció. El chofer creará uno nuevo al entrar.' };
    },
  );

  done();
};
