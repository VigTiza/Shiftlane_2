import { randomUUID } from 'node:crypto';

import type { LatLng } from '@shiftlane/shared';

import {
  BATTERY,
  DETOUR,
  insideDeadZone,
  offsetNorth,
  pathOf,
  pointAt,
  waypointFractions,
} from './plan.ts';
import { api } from './setup.ts';
import type { SimFleet, SimUnit } from './setup.ts';

const CHECKLIST = ['tires', 'brakes', 'lights', 'cleanliness', 'extinguisher', 'first_aid'].map(
  (key) => ({ key, ok: true }),
);

interface Position {
  tripId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  speedKmh: number;
}

interface UnitState {
  unit: SimUnit;
  path: LatLng[];
  stopFractions: number[];
  nextStop: number;
  done: boolean;
  /** El celular se apagó (sin batería). */
  dead: boolean;
  /** Lo que guardó el celular sin señal. */
  positions: Position[];
  events: {
    id: string;
    type: string;
    sequence: number;
    occurredAt: string;
    tripId: string;
    data: object;
  }[];
  sequence: number;
  wasInZone: boolean;
}

export interface RunSummary {
  units: number;
  finished: number;
  silenced: number;
  positions: number;
  scans: number;
  syncedEvents: number;
  alerts: Record<string, number>;
}

/**
 * Corre el turno: cada unidad hace su checklist, inicia, avanza por su ruta mandando posiciones
 * y reportes de salud, escanea a sus pasajeros en cada parada, escanea la puerta y termina.
 * Los escenarios: la unidad que salió tarde (retraso), la que se desvía, la que se queda sin
 * batería y las que cruzan la zona sin señal (guardan todo y lo mandan al salir).
 */
export async function runShift(options: {
  baseUrl: string;
  fleet: SimFleet;
  durationMs: number;
  intervalMs: number;
  /** Cada cuántas vueltas manda su reporte de salud cada unidad (la de batería, en cada una). */
  healthEveryTicks?: number;
  log?: (message: string) => void;
}): Promise<RunSummary> {
  const { baseUrl, fleet } = options;
  const log = options.log ?? (() => undefined);
  const healthEvery =
    options.healthEveryTicks ?? Math.max(1, Math.round(30_000 / options.intervalMs));
  const summary: RunSummary = {
    units: fleet.units.length,
    finished: 0,
    silenced: 0,
    positions: 0,
    scans: 0,
    syncedEvents: 0,
    alerts: {},
  };
  const states: UnitState[] = fleet.units.map((unit) => {
    const path = pathOf(unit.plan);
    return {
      unit,
      path,
      stopFractions: waypointFractions(path).slice(0, unit.plan.stops.length),
      nextStop: 0,
      done: false,
      dead: false,
      positions: [],
      events: [],
      sequence: 0,
      wasInZone: false,
    };
  });

  for (const { unit } of states) {
    await api(baseUrl, 'POST', `/driver/trips/${unit.tripId}/checklist`, {
      auth: unit.driverAuth,
      body: { items: CHECKLIST, clientEventId: randomUUID() },
    });
    await api(baseUrl, 'POST', `/driver/trips/${unit.tripId}/start`, {
      auth: unit.driverAuth,
      body: { clientEventId: randomUUID(), ...unit.plan.stops[0]! },
    });
  }
  log(`Turno iniciado: ${states.length} unidades en ruta.`);

  async function flush(state: UnitState, current?: Position) {
    const batch = [...state.positions, ...(current ? [current] : [])];
    state.positions = [];
    if (batch.length > 0) {
      await api(baseUrl, 'POST', '/driver/positions', {
        auth: state.unit.driverAuth,
        body: { sentAt: new Date().toISOString(), points: batch },
      });
      summary.positions += batch.length;
    }
    if (state.events.length > 0) {
      const events = state.events;
      state.events = [];
      await api(baseUrl, 'POST', '/sync/batch', {
        auth: state.unit.driverAuth,
        body: { sentAt: new Date().toISOString(), events },
      });
      summary.syncedEvents += events.length;
    }
  }

  async function tick(state: UnitState, progress: number, tickNumber: number) {
    if (state.done || state.dead) return;
    const { unit } = state;
    const fraction = Math.min(1, progress);
    const now = new Date().toISOString();

    let battery = 85;
    if (unit.plan.behavior === 'dead_battery') {
      // Se apaga al 60 % del recorrido.
      battery = Math.round(BATTERY.start - ((BATTERY.start - BATTERY.off) * fraction) / 0.6);
      if (battery <= BATTERY.off) {
        state.dead = true;
        summary.silenced += 1;
        log(`${unit.vehicleNumber}: el celular se quedó sin batería.`);
        return;
      }
    }

    let point = pointAt(state.path, fraction);
    if (unit.plan.behavior === 'off_route' && fraction >= DETOUR.from && fraction <= DETOUR.to) {
      point = offsetNorth(point, DETOUR.meters);
    }
    const inZone = insideDeadZone(point);
    if (inZone && !state.wasInZone) log(`${unit.vehicleNumber}: entró a la zona sin señal.`);
    if (!inZone && state.wasInZone)
      log(`${unit.vehicleNumber}: recuperó la señal y envía lo guardado.`);
    state.wasInZone = inZone;

    if (!inZone && (unit.plan.behavior === 'dead_battery' || tickNumber % healthEvery === 0)) {
      await api(baseUrl, 'POST', '/driver/health', {
        auth: unit.driverAuth,
        body: {
          sentAt: now,
          reports: [
            {
              recordedAt: now,
              tripId: unit.tripId,
              batteryPct: battery,
              charging: false,
              networkType: 'cellular',
              signalLevel: 3,
              locationPermission: 'always',
              gpsEnabled: true,
              backgroundAllowed: true,
              batteryOptimizationIgnored: true,
              cameraPermission: true,
              appVersion: '1.0.0',
              platform: 'android',
              deviceModel: 'Simulador',
            },
          ],
        },
      });
    }

    // Escanea a los pasajeros de cada parada a la que llega.
    while (
      state.nextStop < state.stopFractions.length &&
      fraction >= state.stopFractions[state.nextStop]!
    ) {
      const stop = unit.plan.stops[state.nextStop]!;
      for (const employeeNumber of unit.employeesByStop[state.nextStop] ?? []) {
        summary.scans += 1;
        if (inZone) {
          state.events.push({
            id: randomUUID(),
            type: 'scan',
            sequence: state.sequence++,
            occurredAt: now,
            tripId: unit.tripId,
            data: { employeeNumber, ...stop },
          });
        } else {
          await api(baseUrl, 'POST', `/driver/trips/${unit.tripId}/scan`, {
            auth: unit.driverAuth,
            body: { employeeNumber, ...stop, clientEventId: randomUUID() },
          });
        }
      }
      state.nextStop += 1;
    }

    const position: Position = {
      tripId: unit.tripId,
      recordedAt: now,
      ...point,
      speedKmh: unit.plan.behavior === 'off_route' ? 45 : 32,
    };
    if (inZone) state.positions.push(position);
    else await flush(state, position);

    if (fraction >= 1) {
      await flush(state);
      await api(baseUrl, 'POST', `/driver/trips/${unit.tripId}/gate`, {
        auth: unit.driverAuth,
        body: { code: `shiftlane-puerta://${fleet.gateCode}`, clientEventId: randomUUID() },
      });
      await api(baseUrl, 'POST', `/driver/trips/${unit.tripId}/finish`, {
        auth: unit.driverAuth,
        body: { clientEventId: randomUUID() },
      });
      state.done = true;
      summary.finished += 1;
    }
  }

  const started = Date.now();
  let tickNumber = 0;
  while (states.some((s) => !s.done && !s.dead)) {
    const progress = (Date.now() - started) / options.durationMs;
    await Promise.all(states.map((state) => tick(state, progress, tickNumber)));
    tickNumber += 1;
    if (tickNumber % Math.max(1, Math.round(60_000 / options.intervalMs)) === 0) {
      log(
        `Avance ${Math.min(100, Math.round(progress * 100))} %: ${summary.positions} posiciones, ${summary.scans} escaneos.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }

  return summary;
}

/** Cuenta las alertas de la empresa simulada por tipo. */
export async function alertCounts(baseUrl: string, ownerAuth: string) {
  const alerts = await api<{ type: string }[]>(baseUrl, 'GET', '/alerts?limit=500', {
    auth: ownerAuth,
  });
  const counts: Record<string, number> = {};
  for (const alert of alerts) counts[alert.type] = (counts[alert.type] ?? 0) + 1;
  return counts;
}
