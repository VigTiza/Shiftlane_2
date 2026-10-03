import type { AddressInfo } from 'node:net';

import { haversineMeters } from '@shiftlane/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../test/helpers/app.ts';
import type { App } from '../../../src/app.ts';
import {
  BATTERY,
  behaviorFor,
  buildPlan,
  DEAD_ZONE,
  insideDeadZone,
  pathOf,
  PLANT,
  pointAt,
  waypointFractions,
} from '../plan.ts';
import { runShift } from '../run.ts';
import type { RunSummary } from '../run.ts';
import { setupFleet } from '../setup.ts';
import type { SimFleet } from '../setup.ts';

describe('plan del turno simulado', () => {
  it('30 unidades con un retraso, un desvío, un celular sin batería y tres por la zona sin señal', () => {
    const plan = buildPlan(30);
    const count = (behavior: string) => plan.filter((p) => p.behavior === behavior).length;
    expect(plan).toHaveLength(30);
    expect([
      count('delayed'),
      count('off_route'),
      count('dead_battery'),
      count('dead_zone'),
    ]).toEqual([1, 1, 1, 3]);
    expect(count('normal')).toBe(24);
    // Siempre el mismo turno con la misma semilla.
    expect(buildPlan(30)).toEqual(plan);
    expect(buildPlan(30, 7)).not.toEqual(plan);
  });

  it('las rutas llegan a la planta y las de la zona sin señal la cruzan', () => {
    for (const unit of buildPlan(30)) {
      const path = pathOf(unit);
      expect(path.at(-1)).toEqual(PLANT);
      expect(unit.stops).toHaveLength(4);
      const crosses = Array.from({ length: 101 }, (_, i) => pointAt(path, i / 100)).some(
        insideDeadZone,
      );
      if (unit.behavior === 'dead_zone') expect(crosses).toBe(true);
    }
  });

  it('avanza por el trazado según la fracción del recorrido', () => {
    const path = pathOf(buildPlan(5)[0]!);
    expect(pointAt(path, 0)).toEqual(path[0]);
    expect(pointAt(path, 1)).toEqual(PLANT);
    const fractions = waypointFractions(path);
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBeCloseTo(1, 10);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
    const middle = pointAt(path, 0.5);
    expect(haversineMeters(middle, path[0]!)).toBeGreaterThan(0);
  });

  it('en flotas chicas también están todos los escenarios', () => {
    expect(Array.from({ length: 7 }, (_, i) => behaviorFor(i, 7))).toEqual([
      'normal',
      'delayed',
      'off_route',
      'dead_battery',
      'dead_zone',
      'dead_zone',
      'dead_zone',
    ]);
    expect(DEAD_ZONE.radiusMeters).toBeGreaterThan(0);
  });
});

describe('turno simulado contra la API', () => {
  let app: App;
  let fleet: SimFleet;
  let summary: RunSummary;
  const plans = buildPlan(7);

  beforeAll(async () => {
    app = await buildTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    fleet = await setupFleet({
      db: app.db.system,
      tokens: app.tokens,
      baseUrl,
      plans,
      durationMs: 4_000,
    });
    summary = await runShift({ baseUrl, fleet, durationMs: 4_000, intervalMs: 150 });
    await app.alerts.idle();
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  function unit(behavior: string) {
    return fleet.units.find((u) => u.plan.behavior === behavior)!;
  }

  async function trip(tripId: string) {
    return app.db.system.trip.findUniqueOrThrow({ where: { id: tripId } });
  }

  async function positions(tripId: string) {
    return app.db.system.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT lat, lng FROM telemetry.trip_positions WHERE trip_id = ${tripId}::uuid ORDER BY recorded_at`;
  }

  it('las unidades normales terminan con todos sus pasajeros a bordo', async () => {
    const normal = unit('normal');
    expect(await trip(normal.tripId)).toMatchObject({ status: 'completed' });
    expect((await trip(normal.tripId)).arrivedAt).not.toBeNull();
    const boarded = await app.db.system.boarding.count({ where: { tripId: normal.tripId } });
    expect(boarded).toBe(normal.employeesByStop.flat().length);
    expect((await positions(normal.tripId)).length).toBeGreaterThan(5);
    expect(summary.finished).toBe(6);
  });

  it('la unidad que salió tarde genera la alerta de retraso', async () => {
    const delayed = unit('delayed');
    expect(
      await app.db.system.alert.count({ where: { tripId: delayed.tripId, type: 'delay' } }),
    ).toBe(1);
  });

  it('la unidad que se desvía genera la alerta de desvío', async () => {
    const detour = unit('off_route');
    const [alert] = await app.db.system.alert.findMany({
      where: { tripId: detour.tripId, type: 'off_route' },
    });
    expect(alert).toBeDefined();
    // Al volver a la ruta se cerró sola.
    expect(alert!.status).toBe('resolved');
  });

  it('el celular sin batería deja de reportar y la alerta dice la causa', async () => {
    const battery = unit('dead_battery');
    expect(await trip(battery.tripId)).toMatchObject({ status: 'in_progress' });
    const [last] = await app.db.system.deviceHealthReport.findMany({
      where: { tripId: battery.tripId },
      orderBy: { recordedAt: 'desc' },
      take: 1,
    });
    expect(last!.batteryPct).toBeLessThanOrEqual(BATTERY.off + 3);
    expect(summary.silenced).toBe(1);
    // Cinco minutos después, el motor de alertas lo detecta.
    await app.alerts.runMinute(new Date(Date.now() + 6 * 60_000), {
      tenantIds: [fleet.tenantId],
    });
    const alert = await app.db.system.alert.findFirstOrThrow({
      where: { tripId: battery.tripId, type: 'device_silent' },
    });
    expect(alert.cause).toMatch(/Causa probable: El último reporte tenía \d+ % de batería/);
  });

  it('las unidades en la zona sin señal guardan todo y lo envían al salir', async () => {
    expect(summary.syncedEvents).toBeGreaterThan(0);
    for (const deadZone of fleet.units.filter((u) => u.plan.behavior === 'dead_zone')) {
      expect(await trip(deadZone.tripId)).toMatchObject({ status: 'completed' });
      // Las posiciones dentro de la zona llegaron después, sin perderse.
      const stored = await positions(deadZone.tripId);
      expect(stored.some((p) => insideDeadZone(p))).toBe(true);
      // Los escaneos hechos sin señal llegaron por sincronización.
      const boarded = await app.db.system.boarding.count({ where: { tripId: deadZone.tripId } });
      expect(boarded).toBe(deadZone.employeesByStop.flat().length);
    }
  });
});
