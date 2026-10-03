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
  versionId: string;
  startsOn: string;
  endsOn: string;
  cancelled: boolean;
}

export interface EffectiveVersion {
  versionId: string;
  /** Si viene de un cambio temporal, su id. */
  temporaryChangeId: string | null;
}

/**
 * Versión que aplica en una fecha: primero un cambio temporal vigente (gana el que empezó
 * más tarde); si no hay, la versión regular con la fecha de inicio más reciente que no sea
 * posterior a la fecha consultada. Devuelve null si la ruta aún no existía.
 */
export function effectiveVersion(
  versions: readonly VersionForDate[],
  temporaryChanges: readonly TemporaryChangeForDate[],
  date: string,
): EffectiveVersion | null {
  const temporary = temporaryChanges
    .filter((change) => !change.cancelled && change.startsOn <= date && date <= change.endsOn)
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0];
  if (temporary) return { versionId: temporary.versionId, temporaryChangeId: temporary.id };

  const regular = versions
    .filter((version) => version.kind === 'regular' && version.validFrom <= date)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return regular ? { versionId: regular.id, temporaryChangeId: null } : null;
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
