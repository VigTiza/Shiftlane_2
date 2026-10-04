// Prueba integral del chofer: la app de Flutter recorre un turno completo (alta con QR, PIN,
// revisión del celular, checklist con foto, inicio, GPS, escaneo, puerta y fin) contra la API
// local mientras el simulador mueve al resto de la flota.
// Uso (con la API en marcha): pnpm e2e:chofer [-- --api http://localhost:3000 --units 4]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadEnv } from '../../src/config/env.ts';
import { createDatabase } from '../../src/lib/db.ts';
import { createTokenService } from '../../src/modules/auth/tokens.ts';
import { buildPlan } from '../simulator/plan.ts';
import { runShift } from '../simulator/run.ts';
import { api, setupFleet } from '../simulator/setup.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({
  // pnpm pasa el «--» tal cual: se ignora.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    api: { type: 'string', default: 'http://localhost:3000' },
    units: { type: 'string', default: '4' },
    minutes: { type: 'string', default: '4' },
  },
});
const units = Math.max(2, Number(values.units));
const minutes = Math.max(2, Number(values.minutes));
const here = dirname(fileURLToPath(import.meta.url));
const driverApp = resolve(here, '../../../driver');
const log = (message: string) => console.log(`[e2e] ${message}`);

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const tokens = createTokenService({ secret: env.JWT_SECRET, accessTtlSeconds: minutes * 60 + 600 });

function runFlutter(defines: string): Promise<number> {
  const flutter = process.platform === 'win32' ? 'flutter.bat' : 'flutter';
  return new Promise((done) => {
    const child = spawn(
      flutter,
      [
        'test',
        'integration_test/turno_completo_test.dart',
        '-d',
        'flutter-tester',
        `--dart-define-from-file=${defines}`,
      ],
      { cwd: driverApp, stdio: 'inherit', shell: process.platform === 'win32' },
    );
    child.on('exit', (code) => done(code ?? 1));
  });
}

let exitCode = 1;
try {
  await api(values.api, 'GET', '/health');
  const durationMs = minutes * 60_000;
  // La unidad 0 siempre es «normal»: la maneja la app; el simulador mueve a las demás.
  const plans = buildPlan(units, 2026);
  const fleet = await setupFleet({
    db: database.system,
    tokens,
    baseUrl: values.api,
    plans,
    durationMs,
    log,
  });
  const [appUnit, ...simulated] = fleet.units;
  const enrollment = await api<{ qrPayload: string }>(
    values.api,
    'POST',
    `/drivers/${appUnit!.driverId}/enrollment`,
    { auth: fleet.ownerAuth },
  );

  const defines = resolve(driverApp, 'build/e2e-turno.json');
  mkdirSync(dirname(defines), { recursive: true });
  writeFileSync(
    defines,
    JSON.stringify(
      {
        E2E_API_URL: values.api,
        E2E_ENROLL_QR: enrollment.qrPayload,
        E2E_TRIP_ID: appUnit!.tripId,
        E2E_EMPLOYEE: appUnit!.employeesByStop.flat()[0] ?? '',
        E2E_GATE_QR: `shiftlane-puerta://${fleet.gateCode}`,
      },
      null,
      2,
    ),
  );
  log(`Empresa lista: ${fleet.ownerEmail} / ${fleet.ownerPassword}`);
  log(`La app maneja ${appUnit!.plan.code}; el simulador, ${simulated.length} unidades más.`);

  const simulation = runShift({
    baseUrl: values.api,
    fleet: { ...fleet, units: simulated },
    durationMs,
    intervalMs: 5000,
    log,
  });
  const flutterCode = await runFlutter(defines);
  const summary = await simulation;
  log(
    `Simulador: ${summary.finished}/${summary.units} viajes terminados, ` +
      `${summary.positions} posiciones, ${summary.scans} escaneos.`,
  );

  // El turno de la app quedó completo en el servidor.
  const trip = await api<{ status: string; arrivalGate: unknown }>(
    values.api,
    'GET',
    `/trips/${appUnit!.tripId}`,
    { auth: fleet.ownerAuth },
  );
  const track = await api<unknown[]>(values.api, 'GET', `/trips/${appUnit!.tripId}/positions`, {
    auth: fleet.ownerAuth,
  });
  const ok =
    flutterCode === 0 &&
    trip.status === 'completed' &&
    trip.arrivalGate !== null &&
    track.length > 0;
  log(
    `Viaje de la app: ${trip.status}, puerta ${trip.arrivalGate ? 'escaneada' : 'sin escanear'}, ` +
      `${track.length} posiciones. ${ok ? 'TURNO COMPLETO' : 'FALLÓ'}`,
  );
  exitCode = ok ? 0 : 1;
} catch (error) {
  console.error('[e2e] Error:', error instanceof Error ? error.message : error);
} finally {
  await database.close();
}
process.exit(exitCode);
