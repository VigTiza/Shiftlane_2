// Salud del celular del chofer y diagnóstico de por qué una unidad dejó de reportar.
// Funciones puras: el servicio carga los reportes y aquí se decide.

export interface HealthSnapshot {
  recordedAt: Date;
  batteryPct: number | null;
  charging: boolean | null;
  networkType: string | null;
  signalLevel: number | null;
  mobileDataEnabled: boolean | null;
  locationPermission: string | null;
  gpsEnabled: boolean | null;
  backgroundAllowed: boolean | null;
  batteryOptimizationIgnored: boolean | null;
  cameraPermission: boolean | null;
  appVersion: string | null;
  /** Hora del servidor menos hora del celular. */
  clockOffsetMs: number | null;
}

/** block: el viaje no puede iniciar; warn: se avisa pero se puede seguir. */
export interface HealthIssue {
  code: string;
  severity: 'block' | 'warn';
  message: string;
}

export const CRITICAL_BATTERY_PCT = 10;
export const LOW_BATTERY_PCT = 20;
export const CLOCK_TOLERANCE_MS = 2 * 60_000;

/** Compara versiones tipo 1.4.10 (número por número). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/**
 * Revisión del celular antes del turno: lo que impide iniciar un viaje (permisos, batería muy
 * baja, ahorro de batería, versión vieja, cámara) y lo que solo se avisa (sin datos, hora).
 */
export function evaluateHealth(
  snapshot: HealthSnapshot,
  options: { minAppVersion?: string | undefined } = {},
) {
  const issues: HealthIssue[] = [];
  const block = (code: string, message: string) =>
    issues.push({ code, severity: 'block', message });
  const warn = (code: string, message: string) => issues.push({ code, severity: 'warn', message });

  if (snapshot.locationPermission && snapshot.locationPermission !== 'always') {
    block(
      'location_permission',
      'La ubicación no tiene permiso «siempre»: actívalo para que se vea tu recorrido.',
    );
  }
  if (snapshot.gpsEnabled === false) block('gps_disabled', 'El GPS está apagado: enciéndelo.');
  if (snapshot.backgroundAllowed === false) {
    block('background_blocked', 'La app no tiene permiso para funcionar en segundo plano.');
  }
  if (snapshot.batteryOptimizationIgnored === false) {
    block(
      'battery_optimization',
      'El ahorro de batería puede cerrar la app: quítala del ahorro de batería.',
    );
  }
  if (snapshot.batteryPct !== null && snapshot.charging !== true) {
    if (snapshot.batteryPct < CRITICAL_BATTERY_PCT) {
      block(
        'battery_critical',
        `Batería muy baja (${snapshot.batteryPct} %): conecta el cargador de la unidad.`,
      );
    } else if (snapshot.batteryPct < LOW_BATTERY_PCT) {
      warn(
        'battery_low',
        `Batería baja (${snapshot.batteryPct} %): conecta el cargador de la unidad.`,
      );
    }
  }
  if (snapshot.cameraPermission === false) {
    block('camera_permission', 'Da permiso de cámara para escanear gafetes.');
  }
  if (
    options.minAppVersion &&
    snapshot.appVersion &&
    compareVersions(snapshot.appVersion, options.minAppVersion) < 0
  ) {
    block(
      'outdated_app',
      `Actualiza la app: tienes la versión ${snapshot.appVersion} y se necesita la ${options.minAppVersion}.`,
    );
  }
  if (
    snapshot.networkType === 'none' ||
    (snapshot.mobileDataEnabled === false && snapshot.networkType !== 'wifi')
  ) {
    warn(
      'no_connection',
      'Sin conexión de datos: puedes seguir, tus datos se guardan en el celular.',
    );
  }
  if (snapshot.clockOffsetMs !== null && Math.abs(snapshot.clockOffsetMs) > CLOCK_TOLERANCE_MS) {
    const minutes = Math.round(Math.abs(snapshot.clockOffsetMs) / 60_000);
    warn(
      'clock_skew',
      `La hora del celular está desfasada ${minutes} min: actívala en automático.`,
    );
  }

  const status: 'ok' | 'warning' | 'problem' = issues.some((i) => i.severity === 'block')
    ? 'problem'
    : issues.length > 0
      ? 'warning'
      : 'ok';
  return { status, issues, canStartTrip: status !== 'problem' };
}

export type SilenceCause =
  'permission_revoked' | 'low_battery' | 'known_dead_zone' | 'no_data' | 'app_closed' | 'unknown';

export interface Diagnosis {
  cause: SilenceCause;
  message: string;
  suggestedAction: string;
  evidence: Record<string, unknown>;
}

export interface DiagnosisInput {
  now: Date;
  /** Desde cuándo no llegan posiciones. */
  silentSince: Date;
  /** Reportes de salud del chofer, del más reciente al más viejo. */
  reports: readonly HealthSnapshot[];
  /** Veces que otras unidades perdieron la señal cerca de la última posición conocida. */
  deadZoneHits: number;
}

/** Huecos previos en el mismo lugar a partir de los cuales es una zona sin señal conocida. */
export const DEAD_ZONE_MIN_HITS = 2;

function minutesBetween(from: Date, to: Date) {
  return (to.getTime() - from.getTime()) / 60_000;
}

/**
 * Causa probable de que una unidad deje de reportar, en orden: permiso revocado, batería,
 * zona sin señal conocida, sin datos y app cerrada. Usa el último reporte de salud y el
 * historial (la tendencia de la batería y los huecos de señal de otras unidades).
 */
export function diagnoseSilence(input: DiagnosisInput): Diagnosis {
  const [last, ...older] = input.reports;
  if (!last) {
    return {
      cause: 'unknown',
      message: 'No hay reportes de salud de este celular.',
      suggestedAction: 'Llama al chofer y pídele que abra la app.',
      evidence: {},
    };
  }
  const evidence: Record<string, unknown> = {
    lastReportAt: last.recordedAt.toISOString(),
    batteryPct: last.batteryPct,
    networkType: last.networkType,
  };

  if (
    (last.locationPermission !== null && last.locationPermission !== 'always') ||
    last.gpsEnabled === false ||
    last.backgroundAllowed === false
  ) {
    return {
      cause: 'permission_revoked',
      message: 'Se quitó el permiso de ubicación o el GPS está apagado.',
      suggestedAction: 'Pide al chofer que active la ubicación «siempre» y el GPS.',
      evidence: {
        ...evidence,
        locationPermission: last.locationPermission,
        gpsEnabled: last.gpsEnabled,
      },
    };
  }

  if (last.batteryPct !== null && last.charging !== true) {
    // Tendencia: lo que bajó entre los dos últimos reportes, proyectado hasta ahora.
    const previous = older.find((r) => r.batteryPct !== null && r.batteryPct > last.batteryPct!);
    const rate =
      previous && minutesBetween(previous.recordedAt, last.recordedAt) > 0
        ? (previous.batteryPct! - last.batteryPct) /
          minutesBetween(previous.recordedAt, last.recordedAt)
        : 0;
    const projected = last.batteryPct - rate * minutesBetween(last.recordedAt, input.now);
    if (last.batteryPct <= CRITICAL_BATTERY_PCT || projected <= 2) {
      return {
        cause: 'low_battery',
        message: `El último reporte tenía ${last.batteryPct} % de batería sin cargar: probablemente se apagó.`,
        suggestedAction: 'Pide al chofer que conecte el celular al cargador de la unidad.',
        evidence: { ...evidence, projectedBatteryPct: Math.max(0, Math.round(projected)) },
      };
    }
  }

  if (input.deadZoneHits >= DEAD_ZONE_MIN_HITS) {
    return {
      cause: 'known_dead_zone',
      message: `La unidad está en una zona donde otras unidades han perdido la señal (${input.deadZoneHits} veces).`,
      suggestedAction:
        'Espera unos minutos: los datos se guardan en el celular y llegan al recuperar la señal.',
      evidence: { ...evidence, deadZoneHits: input.deadZoneHits },
    };
  }

  if (
    last.networkType === 'none' ||
    last.signalLevel === 0 ||
    (last.mobileDataEnabled === false && last.networkType !== 'wifi')
  ) {
    return {
      cause: 'no_data',
      message: 'El celular reportó que estaba sin señal o sin datos.',
      suggestedAction: 'Llama al chofer; revisa que tenga datos móviles y saldo en su plan.',
      evidence: {
        ...evidence,
        signalLevel: last.signalLevel,
        mobileDataEnabled: last.mobileDataEnabled,
      },
    };
  }

  // Si la app siguiera abierta, seguirían llegando reportes de salud después del silencio.
  if (last.recordedAt.getTime() <= input.silentSince.getTime() + 60_000) {
    return {
      cause: 'app_closed',
      message:
        last.batteryOptimizationIgnored === false
          ? 'El sistema cerró la app por el ahorro de batería.'
          : 'La app se cerró: la cerró el chofer o la detuvo el celular.',
      suggestedAction: 'Llama al chofer y pídele que abra la app.',
      evidence: { ...evidence, batteryOptimizationIgnored: last.batteryOptimizationIgnored },
    };
  }

  return {
    cause: 'unknown',
    message: 'El celular sigue reportando su salud pero no envía su ubicación.',
    suggestedAction: 'Llama al chofer y pídele que revise el GPS.',
    evidence,
  };
}
