// Reglas de vigencia de las rutas. Funciones puras: las usa la API de rutas, el generador de
// viajes (F04) y la simulación de cambios temporales (F03-P03).

export interface VersionForDate {
  id: string;
  kind: 'regular' | 'temporary';
  /** AAAA-MM-DD desde el que aplica (solo versiones regulares). */
  validFrom: string;
}

export interface TemporaryChangeForDate {
  id: string;
  /** Versión alterna; nula si el cambio suspende el servicio. */
  versionId: string | null;
  startsOn: string;
  endsOn: string;
  cancelled: boolean;
}

export interface EffectiveVersion {
  /** Versión que aplica; nula si un cambio temporal suspende el servicio ese día. */
  versionId: string | null;
  /** Si viene de un cambio temporal, su id. */
  temporaryChangeId: string | null;
  suspended: boolean;
}

/** Cambio temporal vigente en una fecha (gana el que empezó más tarde). */
export function activeTemporaryChange<T extends TemporaryChangeForDate>(
  changes: readonly T[],
  date: string,
): T | undefined {
  return changes
    .filter((change) => !change.cancelled && change.startsOn <= date && date <= change.endsOn)
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0];
}

/**
 * Versión que aplica en una fecha: primero un cambio temporal vigente; si no hay, la versión
 * regular con la fecha de inicio más reciente que no sea posterior a la fecha consultada.
 * Así los cambios temporales se aplican y se revierten solos. Devuelve null si la ruta aún
 * no existía.
 */
export function effectiveVersion(
  versions: readonly VersionForDate[],
  temporaryChanges: readonly TemporaryChangeForDate[],
  date: string,
): EffectiveVersion | null {
  const temporary = activeTemporaryChange(temporaryChanges, date);
  const regular = versions
    .filter((version) => version.kind === 'regular' && version.validFrom <= date)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  if (!regular) return null;
  if (temporary) {
    return {
      versionId: temporary.versionId,
      temporaryChangeId: temporary.id,
      suspended: temporary.versionId === null,
    };
  }
  return { versionId: regular.id, temporaryChangeId: null, suspended: false };
}

export interface StopTimeVariant {
  /** Días de la semana (0 = domingo). Vacío = todos los días. */
  weekdays: readonly number[];
  /** HH:MM */
  time: string;
}

/** Horario de una parada en una fecha: la variante del día gana a la general. */
export function stopTimeFor(variants: readonly StopTimeVariant[], date: string): string | null {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const specific = variants.find((variant) => variant.weekdays.includes(weekday));
  if (specific) return specific.time;
  return variants.find((variant) => variant.weekdays.length === 0)?.time ?? null;
}

/** Fechas AAAA-MM-DD de un rango, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let t = Date.parse(`${from}T12:00:00Z`);
    t <= Date.parse(`${to}T12:00:00Z`);
    t += 86_400_000
  ) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}
