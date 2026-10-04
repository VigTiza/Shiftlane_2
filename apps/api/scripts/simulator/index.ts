// Simulador de flota: reproduce un turno completo contra una API en marcha para probar el
// panel y las alertas sin celulares reales. Uso: pnpm simulate -- --units 30 --minutes 20
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { loadEnv } from '../../src/config/env.ts';
import { createDatabase } from '../../src/lib/db.ts';
import { createTokenService } from '../../src/modules/auth/tokens.ts';
import { buildPlan } from './plan.ts';
import { alertCounts, runShift } from './run.ts';
import { api, setupFleet } from './setup.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({
  // pnpm pasa el «--» tal cual: se ignora.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    api: { type: 'string', default: 'http://localhost:3000' },
    units: { type: 'string', default: '30' },
    minutes: { type: 'string', default: '20' },
    interval: { type: 'string', default: '5' },
    seed: { type: 'string', default: '2026' },
  },
});

const units = Number(values.units);
const minutes = Number(values.minutes);
const intervalSeconds = Number(values.interval);
if (!(units >= 1 && units <= 200) || !(minutes > 0) || !(intervalSeconds > 0)) {
  console.error(
    'Uso: pnpm simulate -- --units 30 --minutes 20 --interval 5 [--api http://localhost:3000]',
  );
  process.exit(1);
}

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
// Los tokens de los choferes simulados duran todo el turno (más 10 minutos de margen).
const tokens = createTokenService({ secret: env.JWT_SECRET, accessTtlSeconds: minutes * 60 + 600 });
const log = (message: string) => console.log(`[simulador] ${message}`);

try {
  await api(values.api, 'GET', '/health');
  const durationMs = minutes * 60_000;
  const plans = buildPlan(units, Number(values.seed));
  const fleet = await setupFleet({
    db: database.system,
    tokens,
    baseUrl: values.api,
    plans,
    durationMs,
    log,
  });
  log(`Panel: ${values.api}/docs — usuario ${fleet.ownerEmail}, contraseña ${fleet.ownerPassword}`);
  log(
    'Escenarios: ' +
      plans
        .filter((p) => p.behavior !== 'normal')
        .map((p) => `${p.code} ${p.behavior}`)
        .join(', '),
  );
  const summary = await runShift({
    baseUrl: values.api,
    fleet,
    durationMs,
    intervalMs: intervalSeconds * 1000,
    log,
  });
  // Un token nuevo para leer las alertas al final (el de inicio pudo vencer).
  const login = await api<{ accessToken: string }>(values.api, 'POST', '/auth/login', {
    body: { email: fleet.ownerEmail, password: fleet.ownerPassword },
  });
  summary.alerts = await alertCounts(values.api, `Bearer ${login.accessToken}`);
  log(`Turno terminado: ${JSON.stringify(summary)}`);
  log(
    'La unidad sin batería sigue «en curso»: su alerta de unidad sin reportar sale a los 5 minutos.',
  );
} catch (error) {
  console.error(
    '[simulador] No se pudo completar la simulación:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
