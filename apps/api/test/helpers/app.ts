import { inject } from 'vitest';

import { buildApp } from '../../src/app.ts';
import type { App } from '../../src/app.ts';
import { loadEnv } from '../../src/config/env.ts';
import { generateCredentialKey } from '../../src/lib/credential-signer.ts';
import { createMemoryMailer } from '../../src/lib/mailer.ts';
import { createMemoryPushSender } from '../../src/lib/push.ts';
import type { PushSender } from '../../src/lib/push.ts';
import type { Mailer } from '../../src/lib/mailer.ts';
import type { RoutingProvider } from '../../src/lib/routing.ts';
import { createMemoryStorage } from '../../src/lib/storage.ts';

/** Secretos fijos solo para pruebas. */
export const TEST_SECRETS = {
  JWT_SECRET: 'secreto-de-pruebas-que-no-se-usa-en-produccion-123',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CREDENTIAL_SIGNING_KEY: generateCredentialKey(),
};

export interface TestAppOptions {
  /** Variables de entorno que reemplazan a las de prueba. */
  env?: Record<string, string>;
  /** Permite registrar rutas extra antes de que la app quede lista. */
  beforeReady?: (app: App) => void;
  /** Por omisión, un buzón en memoria (app.mailer.sent). */
  mailer?: Mailer;
  /** Servicio de rutas (por omisión, línea recta). */
  routing?: RoutingProvider;
  /** Avisos al celular; por omisión en memoria (app.push.sent). */
  push?: PushSender;
}

export async function buildTestApp({
  env = {},
  beforeReady,
  mailer = createMemoryMailer(),
  routing,
  push = createMemoryPushSender(),
}: TestAppOptions = {}): Promise<App> {
  const storage = createMemoryStorage();
  const app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: inject('databaseUrl'),
      AUTH_RATE_LIMIT_MAX: '1000',
      SMTP_URL: undefined,
      ...TEST_SECRETS,
      ...env,
    }),
    mailer,
    storage,
    push,
    ...(routing ? { routing } : {}),
  });
  beforeReady?.(app);
  await app.ready();
  return app;
}
