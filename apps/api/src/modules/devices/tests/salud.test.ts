import { describe, expect, it } from 'vitest';

import { compareVersions, diagnoseSilence, evaluateHealth } from '../health.ts';
import type { HealthSnapshot } from '../health.ts';

const NOW = new Date('2026-10-05T12:00:00Z');
const MINUTE = 60_000;

function snapshot(overrides: Partial<HealthSnapshot> = {}, minutesAgo = 10): HealthSnapshot {
  return {
    recordedAt: new Date(NOW.getTime() - minutesAgo * MINUTE),
    batteryPct: 80,
    charging: false,
    networkType: 'cellular',
    signalLevel: 3,
    mobileDataEnabled: true,
    locationPermission: 'always',
    gpsEnabled: true,
    backgroundAllowed: true,
    batteryOptimizationIgnored: true,
    cameraPermission: true,
    appVersion: '1.4.0',
    clockOffsetMs: 0,
    ...overrides,
  };
}

/** El celular dejó de mandar posiciones hace 8 minutos. */
const SILENT_SINCE = new Date(NOW.getTime() - 8 * MINUTE);

function diagnose(reports: HealthSnapshot[], deadZoneHits = 0) {
  return diagnoseSilence({ now: NOW, silentSince: SILENT_SINCE, reports, deadZoneHits });
}

describe('revisión del celular antes del turno', () => {
  it('todo en orden permite iniciar', () => {
    expect(evaluateHealth(snapshot())).toEqual({ status: 'ok', issues: [], canStartTrip: true });
  });

  it('permisos, GPS, segundo plano, ahorro de batería y cámara impiden iniciar', () => {
    const result = evaluateHealth(
      snapshot({
        locationPermission: 'while_in_use',
        gpsEnabled: false,
        backgroundAllowed: false,
        batteryOptimizationIgnored: false,
        cameraPermission: false,
      }),
    );
    expect(result.status).toBe('problem');
    expect(result.canStartTrip).toBe(false);
    expect(result.issues.map((i) => [i.code, i.severity])).toEqual([
      ['location_permission', 'block'],
      ['gps_disabled', 'block'],
      ['background_blocked', 'block'],
      ['battery_optimization', 'block'],
      ['camera_permission', 'block'],
    ]);
  });

  it('batería: muy baja impide, baja avisa, cargando no importa', () => {
    expect(evaluateHealth(snapshot({ batteryPct: 7 })).issues[0]).toEqual({
      code: 'battery_critical',
      severity: 'block',
      message: 'Batería muy baja (7 %): conecta el cargador de la unidad.',
    });
    expect(evaluateHealth(snapshot({ batteryPct: 15 }))).toMatchObject({
      status: 'warning',
      canStartTrip: true,
    });
    expect(evaluateHealth(snapshot({ batteryPct: 5, charging: true })).status).toBe('ok');
  });

  it('sin datos y hora desfasada solo avisan (se puede seguir sin señal)', () => {
    const result = evaluateHealth(snapshot({ networkType: 'none', clockOffsetMs: 4 * MINUTE }));
    expect(result).toMatchObject({ status: 'warning', canStartTrip: true });
    expect(result.issues.map((i) => i.message)).toEqual([
      'Sin conexión de datos: puedes seguir, tus datos se guardan en el celular.',
      'La hora del celular está desfasada 4 min: actívala en automático.',
    ]);
  });

  it('una versión vieja de la app impide iniciar', () => {
    const result = evaluateHealth(snapshot({ appVersion: '1.3.9' }), { minAppVersion: '1.4.0' });
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'outdated_app', severity: 'block' }),
    ]);
    expect(
      evaluateHealth(snapshot({ appVersion: '1.10.0' }), { minAppVersion: '1.4.0' }).status,
    ).toBe('ok');
  });

  it('compara versiones número por número', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
  });
});

describe('causa probable de una unidad sin reportar', () => {
  it('permiso revocado', () => {
    expect(diagnose([snapshot({ locationPermission: 'denied' }, 9)])).toMatchObject({
      cause: 'permission_revoked',
      suggestedAction: 'Pide al chofer que active la ubicación «siempre» y el GPS.',
    });
    expect(diagnose([snapshot({ gpsEnabled: false }, 9)]).cause).toBe('permission_revoked');
  });

  it('batería baja en el último reporte', () => {
    const result = diagnose([snapshot({ batteryPct: 6 }, 9)]);
    expect(result).toMatchObject({
      cause: 'low_battery',
      message: 'El último reporte tenía 6 % de batería sin cargar: probablemente se apagó.',
    });
  });

  it('batería que por su tendencia ya se acabó', () => {
    // Bajó de 30 % a 18 % en 12 minutos: 1 % por minuto; 20 minutos después, en cero.
    const result = diagnose([snapshot({ batteryPct: 18 }, 20), snapshot({ batteryPct: 30 }, 32)]);
    expect(result.cause).toBe('low_battery');
    expect(result.evidence.projectedBatteryPct).toBe(0);
    // La misma batería sin bajar no es la causa.
    expect(diagnose([snapshot({ batteryPct: 18 }, 9)]).cause).not.toBe('low_battery');
  });

  it('zona sin señal conocida', () => {
    const result = diagnose([snapshot({ networkType: 'none' }, 9)], 3);
    expect(result).toMatchObject({
      cause: 'known_dead_zone',
      evidence: expect.objectContaining({ deadZoneHits: 3 }),
    });
    // Un solo hueco anterior todavía no hace una zona conocida.
    expect(diagnose([snapshot({ networkType: 'none' }, 9)], 1).cause).toBe('no_data');
  });

  it('sin datos', () => {
    expect(diagnose([snapshot({ networkType: 'none' }, 9)]).cause).toBe('no_data');
    expect(diagnose([snapshot({ signalLevel: 0 }, 9)]).cause).toBe('no_data');
    expect(diagnose([snapshot({ mobileDataEnabled: false }, 9)]).cause).toBe('no_data');
  });

  it('app cerrada: dejaron de llegar también los reportes de salud', () => {
    expect(diagnose([snapshot({}, 9)])).toMatchObject({
      cause: 'app_closed',
      message: 'La app se cerró: la cerró el chofer o la detuvo el celular.',
    });
    expect(diagnose([snapshot({ batteryOptimizationIgnored: false }, 9)]).message).toBe(
      'El sistema cerró la app por el ahorro de batería.',
    );
  });

  it('sin causa clara cuando la app sigue reportando salud', () => {
    expect(diagnose([snapshot({}, 2)])).toMatchObject({
      cause: 'unknown',
      message: 'El celular sigue reportando su salud pero no envía su ubicación.',
    });
    expect(diagnose([]).message).toBe('No hay reportes de salud de este celular.');
  });
});
