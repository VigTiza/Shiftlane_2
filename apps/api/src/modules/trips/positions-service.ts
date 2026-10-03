import { delayMinutes, estimateArrivals, haversineMeters } from '@shiftlane/shared';

import { clockOffsetMs, correctedTime } from '../../lib/clock.ts';
import type { Database, DbContext, DbTransaction } from '../../lib/db.ts';
import { withDbContext } from '../../lib/db.ts';
import type { DomainEvents } from '../../lib/domain-events.ts';
import type { LivePosition, LiveStore } from '../../lib/live-store.ts';
import { ensurePositionPartitions, utcDays } from '../../jobs/position-partitions.ts';
import type { RoutesService } from '../routes/service.ts';

export interface PositionPoint {
  tripId: string;
  recordedAt: Date;
  lat: number;
  lng: number;
  speedKmh?: number | undefined;
  heading?: number | undefined;
  accuracyM?: number | undefined;
  battery?: number | undefined;
}

export interface PositionSession {
  tenantId: string;
  driverId: string;
  deviceId: string;
}

type Rejection = 'trip_not_found' | 'outside_trip';

/**
 * Ingesta de posiciones GPS: guarda el historial (particionado por día), detecta la llegada a
 * las paradas por geocerca, calcula la hora estimada de llegada y deja la última posición en
 * vivo. Solo acepta posiciones tomadas durante el viaje (entre el inicio y el fin).
 */
export function createPositionsService(deps: {
  db: Database;
  routes: RoutesService;
  liveStore: LiveStore;
  averageSpeedKmh: number;
  events?: DomainEvents;
}) {
  async function insertPoints(
    tx: DbTransaction,
    session: PositionSession,
    points: PositionPoint[],
  ) {
    if (points.length === 0) return 0;
    // Crea la partición del día si falta (datos que llegan tarde o justo al cambiar de día).
    await ensurePositionPartitions(tx, utcDays(points.map((p) => p.recordedAt)));
    return tx.$executeRaw`
      INSERT INTO telemetry.trip_positions
        (tenant_id, trip_id, driver_id, device_id, recorded_at, lat, lng, speed_kmh, heading, accuracy_m, battery)
      SELECT ${session.tenantId}::uuid, t.trip_id, ${session.driverId}::uuid, ${session.deviceId}::uuid,
             t.recorded_at, t.lat, t.lng, t.speed_kmh, t.heading, t.accuracy_m, t.battery
      FROM unnest(
        ${points.map((p) => p.tripId)}::uuid[],
        ${points.map((p) => p.recordedAt.toISOString())}::timestamptz[],
        ${points.map((p) => p.lat)}::float8[],
        ${points.map((p) => p.lng)}::float8[],
        ${points.map((p) => p.speedKmh ?? null)}::float4[],
        ${points.map((p) => p.heading ?? null)}::float4[],
        ${points.map((p) => p.accuracyM ?? null)}::float4[],
        ${points.map((p) => p.battery ?? null)}::int2[]
      ) AS t(trip_id, recorded_at, lat, lng, speed_kmh, heading, accuracy_m, battery)
      ON CONFLICT DO NOTHING`;
  }

  async function plantLocations(tx: DbTransaction, plantIds: string[]) {
    if (plantIds.length === 0) return new Map<string, { lat: number; lng: number }>();
    const rows = await tx.$queryRaw<{ id: string; lat: number | null; lng: number | null }[]>`
      SELECT id::text, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM plants WHERE id = ANY(${plantIds}::uuid[])`;
    return new Map(
      rows.flatMap((r) =>
        r.lat !== null && r.lng !== null ? [[r.id, { lat: r.lat, lng: r.lng }] as const] : [],
      ),
    );
  }

  return {
    async ingest(
      context: DbContext,
      session: PositionSession,
      body: { sentAt: Date; points: PositionPoint[] },
    ) {
      const receivedAt = new Date();
      const offset = clockOffsetMs(body.sentAt, receivedAt);
      const points = body.points.map((p) => ({
        ...p,
        recordedAt: correctedTime(p.recordedAt, offset, receivedAt),
      }));

      return withDbContext(
        deps.db.app,
        context,
        async (tx) => {
          const tripIds = [...new Set(points.map((p) => p.tripId))];
          const trips = await tx.trip.findMany({
            where: { id: { in: tripIds }, tenantId: session.tenantId, driverId: session.driverId },
          });
          const tripById = new Map(trips.map((t) => [t.id, t]));
          const rejected: Record<Rejection, number> = { trip_not_found: 0, outside_trip: 0 };
          const accepted: PositionPoint[] = [];
          for (const point of points) {
            const trip = tripById.get(point.tripId);
            if (!trip) {
              rejected.trip_not_found += 1;
              continue;
            }
            // La ubicación solo se guarda durante el viaje.
            const end = trip.actualEndAt ?? receivedAt;
            const during =
              (trip.status === 'in_progress' || trip.status === 'completed') &&
              trip.actualStartAt !== null &&
              point.recordedAt >= trip.actualStartAt &&
              point.recordedAt <= end;
            if (!during) {
              rejected.outside_trip += 1;
              continue;
            }
            accepted.push(point);
          }
          const inserted = await insertPoints(tx, session, accepted);

          const plants = await plantLocations(tx, [...new Set(trips.map((t) => t.plantId))]);
          const summaries = [];
          for (const trip of trips) {
            const own = accepted
              .filter((p) => p.tripId === trip.id)
              .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
            if (own.length === 0) continue;
            const version = trip.routeVersionId
              ? await deps.routes.versionDetail(tx, trip.routeVersionId, null)
              : null;
            const stops = version?.stops ?? [];

            // Geocerca: la primera posición dentro del radio de una parada registra la llegada.
            const arrivedEvents = await tx.tripEvent.findMany({
              where: { tripId: trip.id, type: 'stop_arrived' },
              select: { data: true },
            });
            const arrived = new Set(
              arrivedEvents.map((e) => (e.data as { stopId: string }).stopId),
            );
            const autoArrivals: { stopId: string; stopName: string; at: Date }[] = [];
            for (const point of own) {
              for (const stop of stops) {
                if (arrived.has(stop.id)) continue;
                if (haversineMeters(point, stop.location) <= stop.radiusMeters) {
                  arrived.add(stop.id);
                  autoArrivals.push({ stopId: stop.id, stopName: stop.name, at: point.recordedAt });
                  await tx.tripEvent.create({
                    data: {
                      tenantId: trip.tenantId,
                      tripId: trip.id,
                      type: 'stop_arrived',
                      occurredAt: point.recordedAt,
                      actorType: 'system',
                      lat: point.lat,
                      lng: point.lng,
                      data: {
                        stopId: stop.id,
                        stopName: stop.name,
                        sequence: stop.sequence,
                        auto: true,
                      },
                    },
                  });
                }
              }
            }

            let eta: LivePosition['eta'] = null;
            const latest = own.at(-1)!;
            if (trip.status === 'in_progress') {
              const lastArrived = Math.max(
                -1,
                ...stops.filter((s) => arrived.has(s.id)).map((s) => s.sequence),
              );
              const remaining = stops.filter((s) => !arrived.has(s.id) && s.sequence > lastArrived);
              const speed =
                version?.distanceKm && version.durationMinutes
                  ? version.distanceKm / (version.durationMinutes / 60)
                  : deps.averageSpeedKmh;
              const estimate = estimateArrivals({
                now: latest.recordedAt,
                position: latest,
                stops: remaining.map((s) => ({ id: s.id, ...s.location })),
                destination:
                  trip.direction === 'inbound' ? (plants.get(trip.plantId) ?? null) : null,
                speedKmh: speed,
              });
              eta = {
                stops: estimate.stops.map((s) => ({
                  stopId: s.id,
                  eta: s.eta.toISOString(),
                  distanceMeters: s.distanceMeters,
                })),
                destination: estimate.destination
                  ? {
                      eta: estimate.destination.eta.toISOString(),
                      distanceMeters: estimate.destination.distanceMeters,
                    }
                  : null,
                delayMinutes: estimate.destination
                  ? delayMinutes(estimate.destination.eta, trip.scheduledEndAt)
                  : null,
              };
              const current = await deps.liveStore.getTripPosition(trip.id);
              // Un lote atrasado no reemplaza una posición más reciente.
              if (!current || new Date(current.recordedAt) <= latest.recordedAt) {
                await deps.liveStore.setTripPosition({
                  tripId: trip.id,
                  tenantId: trip.tenantId,
                  plantId: trip.plantId,
                  routeId: trip.routeId,
                  driverId: session.driverId,
                  vehicleId: trip.vehicleId,
                  lat: latest.lat,
                  lng: latest.lng,
                  speedKmh: latest.speedKmh ?? null,
                  heading: latest.heading ?? null,
                  recordedAt: latest.recordedAt.toISOString(),
                  eta,
                });
                deps.events?.publish({
                  type: 'trip.position',
                  tripId: trip.id,
                  autoArrivals: autoArrivals.map((a) => ({
                    stopId: a.stopId,
                    at: a.at.toISOString(),
                  })),
                });
              }
            }
            summaries.push({ tripId: trip.id, autoArrivals, eta });
          }

          return {
            receivedAt,
            clockOffsetMs: offset,
            accepted: inserted,
            duplicates: accepted.length - inserted,
            rejected,
            trips: summaries,
          };
        },
        { timeout: 30_000 },
      );
    },

    /** Recorrido guardado de un viaje (la RLS deja ver solo lo propio o lo de la planta). */
    async history(
      tx: DbTransaction,
      tripId: string,
      range: { from?: Date | undefined; to?: Date | undefined; limit: number },
    ) {
      const rows = await tx.$queryRaw<
        {
          recorded_at: Date;
          lat: number;
          lng: number;
          speed_kmh: number | null;
          heading: number | null;
          accuracy_m: number | null;
        }[]
      >`
        SELECT recorded_at, lat, lng, speed_kmh, heading, accuracy_m
        FROM telemetry.trip_positions
        WHERE trip_id = ${tripId}::uuid
          AND recorded_at >= ${range.from ?? new Date(0)}
          AND recorded_at <= ${range.to ?? new Date('9999-12-31T00:00:00Z')}
        ORDER BY recorded_at
        LIMIT ${range.limit}`;
      return rows.map((r) => ({
        recordedAt: r.recorded_at,
        lat: r.lat,
        lng: r.lng,
        speedKmh: r.speed_kmh,
        heading: r.heading,
        accuracyM: r.accuracy_m,
      }));
    },
  };
}

export type PositionsService = ReturnType<typeof createPositionsService>;
