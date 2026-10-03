import { inject } from 'vitest';

import { buildApp } from '../../src/app.ts';
import type { App } from '../../src/app.ts';
import { loadEnv } from '../../src/config/env.ts';
import { createMemoryMailer } from '../../src/lib/mailer.ts';
import type { Mailer } from '../../src/lib/mailer.ts';

/** Secretos fijos solo para pruebas. */
export const TEST_SECRETS = {
  JWT_SECRET: 'secreto-de-pruebas-que-no-se-usa-en-produccion-123',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

export interface TestAppOptions {
  /** Variables de entorno que reemplazan a las de prueba. */
  env?: Record<string, string>;
  /** Permite registrar rutas extra antes de que la app quede lista. */
  beforeReady?: (app: App) => void;
  /** Por omisión, un buzón en memoria (app.mailer.sent). */
  mailer?: Mailer;
}

export async function buildTestApp({
  env = {},
  beforeReady,
  mailer = createMemoryMailer(),
}: TestAppOptions = {}): Promise<App> {
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
  });
  beforeReady?.(app);
  await app.ready();
  return app;
}
