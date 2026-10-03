import type { Env } from '../config/env.ts';
import type { DbPool } from '../lib/db.ts';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    db: DbPool;
  }
}
