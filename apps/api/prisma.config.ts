import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.ts',
  },
  datasource: {
    // Vacía al generar el cliente sin base de datos (por ejemplo, en CI).
    url: process.env.DATABASE_URL ?? '',
  },
});
