import type { DbClient, DbTransaction } from '../../lib/db.ts';
import type { DeviceHealthReport } from '../../generated/prisma/client.ts';
import { diagnoseSilence } from './health.ts';
import type { Diagnosis, HealthSnapshot } from './health.ts';

/** Hueco entre posiciones a partir del cual se considera pérdida de señal. */
const GAP_MINUTES = 3;
/** Distancia para considerar que un hueco anterior ocurrió en el mismo lugar. */
const DEAD_ZONE_RADIUS_METERS = 300;
const DEAD_ZONE_HISTORY_DAYS = 60;
const REPORTS_LOOKBACK_MS = 6 * 60 * 60_000;

export function toSnapshot(report: DeviceHealthReport): HealthSnapshot {
  return {
    recordedAt: report.recordedAt,
    batteryPct: report.batteryPct,
    charging: report.charging,
    networkType: report.networkType,
    signalLevel: report.signalLevel,
    mobileDataEnabled: report.mobileDataEnabled,
    locationPermission: report.locationPermission,
    gpsEnabled: report.gpsEnabled,
    backgroundAllowed: report.backgroundAllowed,
    batteryOptimizationIgnored: report.batteryOptimizationIgnored,
    cameraPermission: report.cameraPermission,
    appVersion: report.appVersion,
    clockOffsetMs: report.clockOffsetMs,
  };
}

/**
 * Veces que otras unidades de la empresa perdieron la señal (hueco de más de 3 minutos entre
 * posiciones) cerca de un punto en los últimos 60 días: así se aprenden las zonas sin señal.
 */
export async function deadZoneHits(
  db: DbClient | DbTransaction,
  input: { tenantId: string; excludeTripId: string; lat: number; lng: number; now: Date },
) {
  const since = new Date(input.now.getTime() - DEAD_ZONE_HISTORY_DAYS * 86_400_000);
  const [row] = await db.$queryRaw<{ hits: number }[]>`
    WITH ordered AS (
      SELECT trip_id, recorded_at, lat, lng,
             lead(recorded_at) OVER (PARTITION BY trip_id ORDER BY recorded_at) AS next_at
      FROM telemetry.trip_positions
      WHERE tenant_id = ${input.tenantId}::uuid
        AND trip_id <> ${input.excludeTripId}::uuid
        AND recorded_at >= ${since}
    )
    SELECT count(DISTINCT trip_id)::int AS hits FROM ordered
    WHERE next_at - recorded_at > make_interval(mins => ${GAP_MINUTES})
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography,
        ${DEAD_ZONE_RADIUS_METERS}
      )`;
  return row?.hits ?? 0;
}

/** Causa probable de que el celular de un viaje dejó de reportar. */
export async function diagnoseTrip(
  db: DbClient | DbTransaction,
  tripId: string,
  now = new Date(),
): Promise<
  (Diagnosis & { silentSince: Date; lastPosition: { lat: number; lng: number } | null }) | null
> {
  const trip = await db.trip.findFirst({ where: { id: tripId } });
  if (!trip?.driverId) return null;
  const [last] = await db.$queryRaw<{ recorded_at: Date; lat: number; lng: number }[]>`
    SELECT recorded_at, lat, lng FROM telemetry.trip_positions
    WHERE trip_id = ${tripId}::uuid ORDER BY recorded_at DESC LIMIT 1`;
  const silentSince = last?.recorded_at ?? trip.actualStartAt ?? trip.scheduledStartAt;
  const reports = await db.deviceHealthReport.findMany({
    where: {
      tenantId: trip.tenantId,
      driverId: trip.driverId,
      recordedAt: { gte: new Date(now.getTime() - REPORTS_LOOKBACK_MS), lte: now },
    },
    orderBy: { recordedAt: 'desc' },
    take: 20,
  });
  const hits = last
    ? await deadZoneHits(db, {
        tenantId: trip.tenantId,
        excludeTripId: tripId,
        lat: last.lat,
        lng: last.lng,
        now,
      })
    : 0;
  return {
    ...diagnoseSilence({ now, silentSince, reports: reports.map(toSnapshot), deadZoneHits: hits }),
    silentSince,
    lastPosition: last ? { lat: last.lat, lng: last.lng } : null,
  };
}
