import { existsSync } from 'node:fs';

import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = loadEnv();
const app = await buildApp({ env });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Cerrando la API');
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'No se pudo iniciar la API');
  process.exit(1);
}
