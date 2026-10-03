import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { authOf, dbContextOf, requireAuth } from '../../plugins/auth.ts';
import { createPassengersService } from '../passengers/service.ts';
import { createRoutesService } from '../routes/service.ts';
import { createDriverTripsService } from '../trips/driver-service.ts';
import { syncBatchBody, syncBatchResponse } from './schemas.ts';
import { createSyncService } from './service.ts';

/** Los lotes grandes (hasta 1000 eventos) caben de sobra en 5 MB. */
const BATCH_BODY_LIMIT = 5 * 1024 * 1024;

export const syncRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const sync = createSyncService({
    db: app.db,
    log: app.log,
    driver: createDriverTripsService({
      passengers: createPassengersService({ signer: app.credentialSigner }),
      routes: createRoutesService({
        routing: app.routingProvider,
        averageSpeedKmh: app.config.ROUTING_AVERAGE_SPEED_KMH,
      }),
      storage: app.storage,
      system: app.db.system,
      timeZone: app.config.DEFAULT_TIME_ZONE,
    }),
  });

  app.post(
    '/sync/batch',
    {
      onRequest: requireAuth(app, { kinds: ['driver'] }),
      bodyLimit: BATCH_BODY_LIMIT,
      schema: {
        tags: ['App del chofer'],
        summary: 'Sincroniza los eventos que el celular guardó sin señal',
        description:
          'Cada evento lleva su UUID, el contador del celular (sequence), la hora del celular y su tipo (checklist, start, stop_arrived, scan, incident, panic, gate, finish). Se procesan en orden, se ignoran duplicados, se aceptan los que llegan tarde si ocurrieron antes de terminar el viaje y la hora se corrige con el desfase del reloj del celular. Un evento con error no detiene a los demás.',
        body: syncBatchBody,
        response: { 200: syncBatchResponse },
      },
    },
    (request) => {
      const claims = authOf(request, 'driver');
      return sync.processBatch(
        dbContextOf(request),
        { tenantId: claims.tenantId, driverId: claims.sub, deviceId: claims.deviceId },
        request.body,
      );
    },
  );

  done();
};
