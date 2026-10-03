import type { TestProject } from 'vitest/node';

import { startTestDatabase } from './helpers/database.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const database = await startTestDatabase();
  project.provide('databaseUrl', database.url);
  return () => database.stop();
}
