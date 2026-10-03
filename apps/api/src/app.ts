import { randomUUID } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { Env } from './config/env.ts';
import { createCipher } from './lib/crypto.ts';
import { createDatabase } from './lib/db.ts';
import type { Database } from './lib/db.ts';
import { AppError } from './lib/errors.ts';
import { createLogMailer, createSmtpMailer } from './lib/mailer.ts';
import type { Mailer } from './lib/mailer.ts';
import { createLocalStorage, createS3Storage } from './lib/storage.ts';
import type { ObjectStorage } from './lib/storage.ts';
import { MAX_UPLOAD_BYTES } from './lib/uploads.ts';
import { createDriverAuthService } from './modules/auth/driver-service.ts';
import { createPassengerAuthService } from './modules/auth/passenger-service.ts';
import { auditRoutes } from './modules/audit/routes.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { createAuthService } from './modules/auth/service.ts';
import { createSessionService } from './modules/auth/sessions.ts';
import { createTokenService } from './modules/auth/tokens.ts';
import { driverRoutes } from './modules/drivers/routes.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { userRoutes } from './modules/users/routes.ts';
import { vehicleRoutes } from './modules/vehicles/routes.ts';
import { authPlugin } from './plugins/auth.ts';
import { errorHandlerPlugin } from './plugins/error-handler.ts';

export interface BuildAppOptions {
  env: Env;
  /** Conexión ya creada; si no se pasa, la app crea una y la cierra al terminar. */
  db?: Database;
  /** Envío de correo; por omisión SMTP si hay SMTP_URL, si no solo se registra. */
  mailer?: Mailer;
  /** Almacenamiento de archivos; por omisión según STORAGE_DRIVER. */
  storage?: ObjectStorage;
}

function createStorage(env: Env): ObjectStorage {
  if (env.STORAGE_DRIVER === 'local') return createLocalStorage(env.STORAGE_LOCAL_DIR);
  return createS3Storage({
    bucket: env.S3_BUCKET ?? '',
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}

export async function buildApp({ env, db, mailer, storage }: BuildAppOptions) {
  const app = Fastify({
    logger: loggerOptions(env),
    trustProxy: env.TRUST_PROXY,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const database = db ?? createDatabase(env.DATABASE_URL);
  app.decorate('config', env);
  app.decorate('db', database);
  if (!db) {
    app.addHook('onClose', async () => database.close());
  }

  const tokens = createTokenService({
    secret: env.JWT_SECRET,
    accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  const cipher = createCipher(env.ENCRYPTION_KEY);
  const mail =
    mailer ??
    (env.SMTP_URL ? createSmtpMailer(env.SMTP_URL, env.MAIL_FROM) : createLogMailer(app.log));
  const sessions = createSessionService({
    db: database.system,
    ttlDays: {
      user: env.REFRESH_TOKEN_TTL_DAYS,
      driver: env.DRIVER_REFRESH_TOKEN_TTL_DAYS,
      passenger: env.PASSENGER_REFRESH_TOKEN_TTL_DAYS,
    },
  });
  const authDeps = { db: database.system, sessions, tokens };
  app.decorate('tokens', tokens);
  app.decorate('cipher', cipher);
  app.decorate('mailer', mail);
  app.decorate('storage', storage ?? createStorage(env));
  app.decorate('authServices', {
    auth: createAuthService({ ...authDeps, cipher, mailer: mail, appUrl: env.APP_URL }),
    drivers: createDriverAuthService(authDeps),
    passengers: createPassengerAuthService(authDeps),
  });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  await app.register(errorHandlerPlugin);
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } });
  await app.register(authPlugin);
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: (_request, context) =>
      new AppError(
        429,
        'RATE_LIMITED',
        `Demasiadas peticiones. Intenta de nuevo en ${Math.ceil(context.ttl / 1000)} segundos.`,
      ),
  });

  if (env.API_DOCS_ENABLED) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'API de Shiftlane',
          description: 'API del SaaS de transporte de personal Shiftlane.',
          version: '0.1.0',
        },
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
  }

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(driverRoutes);
  await app.register(userRoutes);
  await app.register(auditRoutes);
  await app.register(vehicleRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
