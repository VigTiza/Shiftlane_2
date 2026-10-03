import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { healthResponseSchema, readyResponseSchema } from './schemas.ts';
import { createHealthService } from './service.ts';

export const healthRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createHealthService({ db: app.db });

  app.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['Sistema'],
        summary: 'Verifica que la API esté viva',
        response: { 200: healthResponseSchema },
      },
    },
    () => service.liveness(),
  );

  app.get(
    '/ready',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['Sistema'],
        summary: 'Verifica que la API pueda atender peticiones (base de datos disponible)',
        response: { 200: readyResponseSchema, 503: readyResponseSchema },
      },
    },
    async (_request, reply) => {
      const result = await service.readiness();
      return reply.status(result.status === 'ready' ? 200 : 503).send(result);
    },
  );

  done();
};
