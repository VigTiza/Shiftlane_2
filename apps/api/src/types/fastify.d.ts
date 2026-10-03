import type { Env } from '../config/env.ts';
import type { Database } from '../lib/db.ts';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    db: Database;
  }
}
