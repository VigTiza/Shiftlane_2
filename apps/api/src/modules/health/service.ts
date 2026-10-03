import { isDatabaseReachable } from '../../lib/db.ts';
import type { Database } from '../../lib/db.ts';
import type { HealthResponse, ReadyResponse } from './schemas.ts';

export function createHealthService(deps: { db: Database }) {
  return {
    liveness(): HealthResponse {
      return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
    },

    async readiness(): Promise<ReadyResponse> {
      const databaseOk = await isDatabaseReachable(deps.db.pool);
      return {
        status: databaseOk ? 'ready' : 'not_ready',
        checks: { database: databaseOk ? 'ok' : 'error' },
      };
    },
  };
}
