import { existsSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

// Las variables del entorno tienen prioridad sobre las del archivo .env local.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    hookTimeout: 120_000,
  },
});
