import { clockOffsetMs, correctedTime } from '../../lib/clock.ts';
import type { DbContext, DbTransaction, Database } from '../../lib/db.ts';
import { withDbContext } from '../../lib/db.ts';
import type { DomainEvents } from '../../lib/domain-events.ts';
import { NotFoundError } from '../../lib/errors.ts';
import type { DeviceHealthReport, Prisma } from '../../generated/prisma/client.ts';
import { diagnoseTrip } from './diagnosis.ts';
import { evaluateHealth } from './health.ts';
import type { HealthIssue } from './health.ts';

export interface HealthReportInput {
  recordedAt: Date;
  tripId?: string | undefined;
  batteryPct?: number | undefined;
  charging?: boolean | undefined;
  networkType?: 'wifi' | 'cellular' | 'none' | undefined;
  signalLevel?: number | undefined;
  mobileDataEnabled?: boolean | undefined;
  locationPermission?: 'always' | 'while_in_use' | 'denied' | undefined;
  gpsEnabled?: boolean | undefined;
  backgroundAllowed?: boolean | undefined;
  batteryOptimizationIgnored?: boolean | undefined;
  cameraPermission?: boolean | undefined;
  appVersion?: string | undefined;
  osVersion?: string | undefined;
  platform?: string | undefined;
  deviceModel?: string | undefined;
}

function mapReport(report: DeviceHealthReport) {
  return {
    id: report.id,
    recordedAt: report.recordedAt,
    tripId: report.tripId,
    batteryPct: report.batteryPct,
    charging: report.charging,
    networkType: report.networkType,
    signalLevel: report.signalLevel,
    locationPermission: report.locationPermission,
    gpsEnabled: report.gpsEnabled,
    backgroundAllowed: report.backgroundAllowed,
    batteryOptimizationIgnored: report.batteryOptimizationIgnored,
    appVersion: report.appVersion,
    clockOffsetMs: report.clockOffsetMs,
    status: report.status,
    issues: report.issues as unknown as HealthIssue[],
  };
}

/**
 * Salud de los celulares de los choferes: reportes (lo que impide iniciar un viaje y lo que
 * solo se avisa), inventario para el panel y diagnóstico de las unidades que dejan de reportar.
 */
export function createDevicesService(deps: {
  db: Database;
  events: DomainEvents;
  minAppVersion?: string | undefined;
}) {
  return {
    /** Guarda el token de avisos del celular de la sesión (uno por celular). */
    async savePushToken(context: DbContext, session: { deviceId: string }, token: string | null) {
      const result = await withDbContext(deps.db.app, context, (tx) =>
        tx.device.updateMany({
          where: { id: session.deviceId, revokedAt: null },
          data: { pushToken: token || null, pushTokenUpdatedAt: new Date() },
        }),
      );
      return { saved: result.count === 1 };
    },

    async ingest(
      context: DbContext,
      session: { tenantId: string; driverId: string; deviceId: string },
      body: { sentAt: Date; reports: HealthReportInput[] },
    ) {
      const receivedAt = new Date();
      const offset = clockOffsetMs(body.sentAt, receivedAt);
      return withDbContext(deps.db.app, context, async (tx) => {
        const previous = await tx.deviceHealthReport.findFirst({
          where: { deviceId: session.deviceId },
          orderBy: { recordedAt: 'desc' },
        });
        const ownTrips = new Set(
          (
            await tx.trip.findMany({
              where: {
                id: { in: body.reports.flatMap((r) => (r.tripId ? [r.tripId] : [])) },
                driverId: session.driverId,
              },
              select: { id: true },
            })
          ).map((t) => t.id),
        );
        const rows = body.reports
          .map((report) => {
            const recordedAt = correctedTime(report.recordedAt, offset, receivedAt);
            const evaluation = evaluateHealth(
              {
                recordedAt,
                batteryPct: report.batteryPct ?? null,
                charging: report.charging ?? null,
                networkType: report.networkType ?? null,
                signalLevel: report.signalLevel ?? null,
                mobileDataEnabled: report.mobileDataEnabled ?? null,
                locationPermission: report.locationPermission ?? null,
                gpsEnabled: report.gpsEnabled ?? null,
                backgroundAllowed: report.backgroundAllowed ?? null,
                batteryOptimizationIgnored: report.batteryOptimizationIgnored ?? null,
                cameraPermission: report.cameraPermission ?? null,
                appVersion: report.appVersion ?? null,
                clockOffsetMs: offset,
              },
              { minAppVersion: deps.minAppVersion },
            );
            return {
              evaluation,
              data: {
                tenantId: session.tenantId,
                deviceId: session.deviceId,
                driverId: session.driverId,
                // Un viaje que no es del chofer no se liga al reporte.
                tripId: report.tripId && ownTrips.has(report.tripId) ? report.tripId : null,
                recordedAt,
                batteryPct: report.batteryPct ?? null,
                charging: report.charging ?? null,
                networkType: report.networkType ?? null,
                signalLevel: report.signalLevel ?? null,
                mobileDataEnabled: report.mobileDataEnabled ?? null,
                locationPermission: report.locationPermission ?? null,
                gpsEnabled: report.gpsEnabled ?? null,
                backgroundAllowed: report.backgroundAllowed ?? null,
                batteryOptimizationIgnored: report.batteryOptimizationIgnored ?? null,
                cameraPermission: report.cameraPermission ?? null,
                appVersion: report.appVersion ?? null,
                osVersion: report.osVersion ?? null,
                platform: report.platform ?? null,
                deviceModel: report.deviceModel ?? null,
                clockOffsetMs: offset,
                status: evaluation.status,
                issues: evaluation.issues as unknown as Prisma.InputJsonValue,
              },
            };
          })
          .sort((a, b) => a.data.recordedAt.getTime() - b.data.recordedAt.getTime());
        await tx.deviceHealthReport.createMany({ data: rows.map((r) => r.data) });

        const latest = rows.at(-1)!;
        const newest = previous && previous.recordedAt > latest.data.recordedAt ? null : latest;
        await tx.device.update({
          where: { id: session.deviceId },
          data: {
            lastSeenAt: receivedAt,
            ...(newest
              ? {
                  platform: newest.data.platform ?? undefined,
                  model: newest.data.deviceModel ?? undefined,
                  appVersion: newest.data.appVersion ?? undefined,
                }
              : {}),
          },
        });
        // El panel se entera cuando cambia el estado del celular.
        if (newest && newest.evaluation.status !== previous?.status) {
          deps.events.publish({
            type: 'device.health_changed',
            tenantId: session.tenantId,
            device: {
              deviceId: session.deviceId,
              driverId: session.driverId,
              status: newest.evaluation.status,
              previousStatus: previous?.status ?? null,
              issues: newest.evaluation.issues,
            },
          });
        }
        return {
          accepted: rows.length,
          clockOffsetMs: offset,
          status: latest.evaluation.status,
          issues: latest.evaluation.issues,
          canStartTrip: latest.evaluation.canStartTrip,
        };
      });
    },

    /** Inventario de celulares con su último reporte (calidad de señal, batería, problemas). */
    async list(tx: DbTransaction) {
      const devices = await tx.device.findMany({
        where: { revokedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      const latest = await tx.deviceHealthReport.findMany({
        where: { deviceId: { in: devices.map((d) => d.id) } },
        orderBy: { recordedAt: 'desc' },
        distinct: ['deviceId'],
      });
      const byDevice = new Map(latest.map((r) => [r.deviceId, r]));
      const driverIds = [...new Set(latest.flatMap((r) => (r.driverId ? [r.driverId] : [])))];
      const drivers = new Map(
        (
          await tx.driver.findMany({
            where: { id: { in: driverIds } },
            select: { id: true, fullName: true },
          })
        ).map((d) => [d.id, d]),
      );
      return devices.map((device) => {
        const report = byDevice.get(device.id);
        return {
          id: device.id,
          platform: device.platform,
          model: device.model,
          appVersion: device.appVersion,
          lastSeenAt: device.lastSeenAt,
          lastSyncAt: device.lastSyncAt,
          driver: report?.driverId ? (drivers.get(report.driverId) ?? null) : null,
          health: report ? mapReport(report) : null,
        };
      });
    },

    async history(tx: DbTransaction, deviceId: string, limit: number) {
      const device = await tx.device.findFirst({ where: { id: deviceId } });
      if (!device) throw new NotFoundError('No se encontró el celular.');
      const reports = await tx.deviceHealthReport.findMany({
        where: { deviceId },
        orderBy: { recordedAt: 'desc' },
        take: limit,
      });
      return reports.map(mapReport);
    },

    async diagnose(tx: DbTransaction, tripId: string) {
      const trip = await tx.trip.findFirst({ where: { id: tripId } });
      if (!trip) throw new NotFoundError('No se encontró el viaje.');
      const diagnosis = await diagnoseTrip(tx, tripId);
      if (!diagnosis) throw new NotFoundError('El viaje no tiene chofer asignado.');
      return diagnosis;
    },
  };
}
