import { addDays } from '@shiftlane/shared';

import type { DbClient, DbTransaction } from '../lib/db.ts';

/** Días UTC (AAAA-MM-DD) que cubren un rango de instantes. */
export function utcDays(instants: readonly Date[]): string[] {
  return [...new Set(instants.map((at) => at.toISOString().slice(0, 10)))].sort();
}

/** Crea (si faltan) las particiones diarias del historial GPS para esos días. */
export async function ensurePositionPartitions(
  db: DbClient | DbTransaction,
  days: readonly string[],
) {
  for (const day of days) {
    await db.$executeRaw`SELECT app.ensure_trip_positions_partition(${day}::date)`;
  }
  return days;
}

/** Tarea diaria: la partición de ayer, hoy y los próximos días ya creadas. */
export async function ensureUpcomingPartitions(db: DbClient, daysAhead: number, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const days = Array.from({ length: daysAhead + 2 }, (_, i) => addDays(today, i - 1));
  await ensurePositionPartitions(db, days);
  return { from: days[0]!, to: days.at(-1)!, days: days.length };
}
