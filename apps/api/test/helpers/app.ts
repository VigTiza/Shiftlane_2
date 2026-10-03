import { inject } from 'vitest';

import { buildApp } from '../../src/app.ts';
import type { App } from '../../src/app.ts';
import { loadEnv } from '../../src/config/env.ts';

export interface TestAppOptions {
  /** Variables de entorno que reemplazan a las de prueba. */
  env?: Record<string, string>;
  /** Permite registrar rutas extra antes de que la app quede lista. */
  beforeReady?: (app: App) => void;
}

export async function buildTestApp({ env = {}, beforeReady }: TestAppOptions = {}): Promise<App> {
  const app = await buildApp({
    env: loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: inject('databaseUrl'),
      ...env,
    }),
  });
  beforeReady?.(app);
  await app.ready();
  return app;
}
