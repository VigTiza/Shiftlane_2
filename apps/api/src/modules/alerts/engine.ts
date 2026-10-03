import { haversineMeters } from '@shiftlane/shared';
import type { FastifyBaseLogger } from 'fastify';

import { withAfterCommit } from '../../lib/after-commit.ts';
import type { Database } from '../../lib/db.ts';
import type { DomainEvent, DomainEvents } from '../../lib/domain-events.ts';
import type { LiveStore } from '../../lib/live-store.ts';
import type { Alert, Prisma } from '../../generated/prisma/client.ts';
import { diagnoseTrip } from '../devices/diagnosis.ts';
import type { RoutesService } from '../routes/service.ts';
import { ALERT_TYPE_LABELS, rulesFor } from './rules.ts';
import type { AlertType, RuleSet } from './rules.ts';

/** Tipos que dependen de un viaje en curso: se cierran solos al terminarlo o cancelarlo. */
const TRIP_SCOPED: readonly AlertType[] = [
  'trip_not_started',
  'delay',
  'off_route',
  'unscheduled_stop',
  'device_silent',
];
/** Distancia a la planta dentro de la cual detenerse no es una parada no programada. */
const PLANT_RADIUS_METERS = 200;
/** Viajes no iniciados más viejos que esto ya no generan alerta (ya se atendieron o no aplican). */
const NOT_STARTED_LOOKBACK_MS = 6 * 60 * 60_000;
/** Posiciones que se revisan para medir cuánto lleva detenida una unidad. */
const STOP_LOOKBACK_MS = 60 * 60_000;

export function dedupeKey(type: AlertType, subject: string) {
  return `${type}:${subject}`;
}

function minutesBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

function hhmm(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** Lo que se envía en tiempo real y devuelve la API. */
export function summarizeAlert(alert: Alert) {
  return {
    id: alert.id,
    type: alert.type,
    typeLabel: ALERT_TYPE_LABELS[alert.type],
    severity: alert.severity,
    status: alert.status,
    cause: alert.cause,
    suggestedAction: alert.suggestedAction,
    lat: alert.lat,
    lng: alert.lng,
    tripId: alert.tripId,
    plantId: alert.plantId,
    driverId: alert.driverId,
    vehicleId: alert.vehicleId,
    notifyPlant: alert.notifyPlant,
    openedAt: alert.openedAt,
    acknowledgedAt: alert.acknowledgedAt,
    resolvedAt: alert.resolvedAt,
    escalatedAt: alert.escalatedAt,
    autoResolved: alert.autoResolved,
    resolution: alert.resolution,
    /** Cuánto tardó en atenderse y en resolverse. */
    minutesToAcknowledge: alert.acknowledgedAt
      ? minutesBetween(alert.openedAt, alert.acknowledgedAt)
      : null,
    minutesToResolve: alert.resolvedAt ? minutesBetween(alert.openedAt, alert.resolvedAt) : null,
    data: (alert.data ?? null) as Record<string, unknown> | null,
  };
}

export interface OpenAlertInput {
  tenantId: string;
  type: AlertType;
  /** Qué identifica a la alerta mientras sigue abierta (el viaje, el pánico, el checklist). */
  subject: string;
  plantId?: string | null;
  tripId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  cause: string;
  suggestedAction: string;
  lat?: number | null;
  lng?: number | null;
  data?: Record<string, unknown>;
}

/**
 * Motor de alertas. Evalúa con cada evento de dominio (posición, abordaje, pánico, checklist,
 * asignación, cambio de estado) y cada minuto (viajes no iniciados, unidades sin reportar,
 * paradas no programadas, escalamiento). Cada alerta lleva causa, ubicación y acción
 * sugerida, no se duplica mientras sigue abierta y se cierra sola cuando la causa desaparece.
 */
export function createAlertEngine(deps: {
  db: Database;
  events: DomainEvents;
  liveStore: LiveStore;
  routes: RoutesService;
  log: FastifyBaseLogger;
}) {
  const system = deps.db.system;
  const pending = new Set<Promise<unknown>>();

  async function open(input: OpenAlertInput, rules?: RuleSet): Promise<Alert | null> {
    const rule = (rules ?? (await rulesFor(system, input.tenantId)))[input.type];
    if (!rule.enabled) return null;
    const key = dedupeKey(input.type, input.subject);
    return withAfterCommit(() =>
      system.$transaction(async (tx) => {
        // Dos evaluaciones al mismo tiempo no abren la misma alerta dos veces.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`alert:${input.tenantId}:${key}`}))`;
        const existing = await tx.alert.findFirst({
          where: { tenantId: input.tenantId, dedupeKey: key, status: { not: 'resolved' } },
        });
        if (existing) return null;
        const notifyPlant = rule.notifyPlant && Boolean(input.plantId);
        const alert = await tx.alert.create({
          data: {
            tenantId: input.tenantId,
            plantId: input.plantId ?? null,
            tripId: input.tripId ?? null,
            driverId: input.driverId ?? null,
            vehicleId: input.vehicleId ?? null,
            type: input.type,
            severity: rule.severity,
            cause: input.cause,
            suggestedAction: input.suggestedAction,
            lat: input.lat ?? null,
            lng: input.lng ?? null,
            data: (input.data ?? {}) as Prisma.InputJsonValue,
            dedupeKey: key,
            notifyPlant,
          },
        });
        await tx.alertAction.create({
          data: {
            tenantId: input.tenantId,
            alertId: alert.id,
            action: 'created',
            note: input.cause,
          },
        });
        deps.events.publish({
          type: 'alert.created',
          tenantId: alert.tenantId,
          plantId: alert.plantId,
          notifyPlant,
          alert: summarizeAlert(alert),
        });
        return alert;
      }),
    );
  }

  /** Cierra sola la alerta abierta de esa clave cuando la causa desaparece. */
  async function autoResolve(tenantId: string, type: AlertType, subject: string, reason: string) {
    const key = dedupeKey(type, subject);
    return withAfterCommit(() =>
      system.$transaction(async (tx) => {
        const openAlerts = await tx.alert.findMany({
          where: { tenantId, dedupeKey: key, status: { not: 'resolved' } },
        });
        for (const alert of openAlerts) {
          const resolved = await tx.alert.update({
            where: { id: alert.id },
            data: {
              status: 'resolved',
              resolvedAt: new Date(),
              resolution: reason,
              autoResolved: true,
            },
          });
          await tx.alertAction.create({
            data: { tenantId, alertId: alert.id, action: 'auto_resolved', note: reason },
          });
          deps.events.publish({
            type: 'alert.updated',
            tenantId,
            plantId: resolved.plantId,
            notifyPlant: resolved.notifyPlant,
            alert: summarizeAlert(resolved),
          });
        }
        return openAlerts.length;
      }),
    );
  }

  async function tripContext(tripId: string) {
    return system.trip.findUnique({
      where: { id: tripId },
      include: {
        route: { select: { code: true } },
        driver: { select: { fullName: true } },
        vehicle: { select: { economicNumber: true, capacity: true } },
        plant: { select: { timezone: true } },
      },
    });
  }
  type TripContext = NonNullable<Awaited<ReturnType<typeof tripContext>>>;

  function tripName(trip: TripContext) {
    return trip.route ? `el viaje ${trip.route.code}` : 'el viaje extra';
  }

  function unitName(trip: TripContext) {
    return trip.vehicle ? `la unidad ${trip.vehicle.economicNumber}` : 'la unidad';
  }

  function tripFields(trip: TripContext) {
    return {
      tenantId: trip.tenantId,
      subject: trip.id,
      plantId: trip.plantId,
      tripId: trip.id,
      driverId: trip.driverId,
      vehicleId: trip.vehicleId,
    };
  }

  async function onPosition(tripId: string) {
    const trip = await tripContext(tripId);
    if (!trip || trip.status !== 'in_progress') return;
    const position = await deps.liveStore.getTripPosition(tripId);
    if (!position) return;
    const rules = await rulesFor(system, trip.tenantId);
    const where = { lat: position.lat, lng: position.lng };
    await autoResolve(
      trip.tenantId,
      'device_silent',
      trip.id,
      'La unidad volvió a reportar su ubicación.',
    );

    const { limitKmh } = rules.speeding.params;
    if (position.speedKmh !== null && position.speedKmh > limitKmh) {
      await open(
        {
          ...tripFields(trip),
          type: 'speeding',
          cause: `${unitName(trip).replace(/^la/, 'La')} va a ${Math.round(position.speedKmh)} km/h en ${tripName(trip)} (límite ${limitKmh} km/h).`,
          suggestedAction: 'Pide al chofer que reduzca la velocidad.',
          ...where,
          data: { speedKmh: position.speedKmh, limitKmh },
        },
        rules,
      );
    }

    const delay = position.eta?.delayMinutes ?? null;
    const { toleranceMinutes } = rules.delay.params;
    if (delay !== null && delay > toleranceMinutes && position.eta?.destination) {
      const eta = new Date(position.eta.destination.eta);
      await open(
        {
          ...tripFields(trip),
          type: 'delay',
          cause: `La llegada estimada de ${tripName(trip)} es a las ${hhmm(eta, trip.plant.timezone)}, ${delay} min después de lo programado.`,
          suggestedAction: 'Avisa a la planta del retraso o envía apoyo.',
          ...where,
          data: { delayMinutes: delay, eta: position.eta.destination.eta },
        },
        rules,
      );
    } else if (delay !== null && delay <= toleranceMinutes) {
      await autoResolve(trip.tenantId, 'delay', trip.id, 'La unidad recuperó el horario.');
    }

    if (trip.routeVersionId) {
      const { thresholdMeters } = rules.off_route.params;
      const distance = await deps.routes
        .distanceToPath(system, trip.routeVersionId, where, thresholdMeters)
        .catch(() => null);
      if (distance?.offRoute) {
        await open(
          {
            ...tripFields(trip),
            type: 'off_route',
            cause: `La unidad de ${tripName(trip)} está a ${Math.round(distance.distanceMeters)} m del trazado de la ruta.`,
            suggestedAction: 'Comunícate con el chofer para confirmar el motivo del desvío.',
            ...where,
            data: { distanceMeters: distance.distanceMeters, thresholdMeters },
          },
          rules,
        );
      } else if (distance) {
        await autoResolve(trip.tenantId, 'off_route', trip.id, 'La unidad regresó a la ruta.');
      }
    }
  }

  async function resolveTripAlerts(tenantId: string, tripId: string, reason: string) {
    for (const type of TRIP_SCOPED) await autoResolve(tenantId, type, tripId, reason);
  }

  async function handle(event: DomainEvent) {
    switch (event.type) {
      case 'trip.position':
        return onPosition(event.tripId);
      case 'trip.status_changed': {
        const trip = await system.trip.findUnique({ where: { id: event.tripId } });
        if (!trip) return;
        if (trip.status === 'in_progress') {
          await autoResolve(
            trip.tenantId,
            'trip_not_started',
            trip.id,
            'El chofer inició el viaje.',
          );
        } else if (trip.status === 'completed') {
          await resolveTripAlerts(trip.tenantId, trip.id, 'El viaje terminó.');
        }
        return;
      }
      case 'trip.cancelled': {
        const trip = await system.trip.findUnique({ where: { id: event.tripId } });
        if (trip) await resolveTripAlerts(trip.tenantId, trip.id, 'El viaje se canceló.');
        return;
      }
      case 'boarding.created': {
        if (!event.boarding.overCapacity) return;
        const trip = await tripContext(event.tripId);
        if (!trip) return;
        const position = await deps.liveStore.getTripPosition(trip.id);
        await open({
          ...tripFields(trip),
          type: 'overcapacity',
          cause: `Hay ${event.boarding.onboard} pasajeros a bordo y ${unitName(trip)} tiene ${trip.vehicle?.capacity ?? 'menos'} asientos.`,
          suggestedAction: 'Envía otra unidad o redistribuye a los pasajeros.',
          lat: position?.lat ?? null,
          lng: position?.lng ?? null,
          data: { onboard: event.boarding.onboard, capacity: trip.vehicle?.capacity ?? null },
        });
        return;
      }
      case 'panic.created': {
        const panic = await system.panicEvent.findUnique({
          where: { id: event.panicEventId },
          include: { driver: { select: { fullName: true } } },
        });
        if (!panic) return;
        const trip = panic.tripId ? await tripContext(panic.tripId) : null;
        await open({
          tenantId: panic.tenantId,
          type: 'panic',
          subject: panic.id,
          plantId: trip?.plantId ?? null,
          tripId: panic.tripId,
          driverId: panic.driverId,
          vehicleId: trip?.vehicleId ?? null,
          cause: `${panic.driver.fullName} presionó el botón de pánico${trip ? ` durante ${tripName(trip)}` : ''}.`,
          suggestedAction:
            'Llama al chofer de inmediato; si no responde, llama al 911 y envía apoyo.',
          lat: panic.lat,
          lng: panic.lng,
          data: { panicEventId: panic.id },
        });
        return;
      }
      case 'checklist.submitted': {
        if (event.passed) return;
        const result = await system.checklistResult.findUnique({
          where: { id: event.checklistResultId },
          include: { vehicle: { select: { economicNumber: true } } },
        });
        if (!result) return;
        const trip = result.tripId ? await tripContext(result.tripId) : null;
        const failed = (result.items as { label: string; ok: boolean }[])
          .filter((i) => !i.ok)
          .map((i) => i.label);
        await open({
          tenantId: result.tenantId,
          type: 'checklist_failed',
          subject: result.id,
          plantId: trip?.plantId ?? null,
          tripId: result.tripId,
          driverId: result.driverId,
          vehicleId: result.vehicleId,
          cause: `El checklist de la unidad ${result.vehicle.economicNumber} tiene puntos sin aprobar: ${failed.join(', ')}.`,
          suggestedAction:
            'Revisa la unidad o autoriza la salida si es seguro, y avisa a mantenimiento.',
          data: { checklistResultId: result.id, failed },
        });
        return;
      }
      case 'trip.assigned': {
        const documents = event.conflicts.filter((c) =>
          [
            'vehicle_documents_expired',
            'driver_documents_expired',
            'driver_license_invalid',
          ].includes(c.type),
        );
        if (documents.length === 0) return;
        const trip = await tripContext(event.tripId);
        if (!trip) return;
        await open({
          ...tripFields(trip),
          type: 'expired_documents_on_assign',
          cause: `Se asignó ${tripName(trip)} con documentos vencidos o no válidos: ${documents.map((d) => d.message).join(' ')}`,
          suggestedAction: 'Renueva el documento o cambia la asignación antes del viaje.',
          data: { conflicts: documents },
        });
        return;
      }
      default:
        return;
    }
  }

  /** Evaluación periódica: viajes no iniciados, unidades sin reportar, paradas y escalamiento. */
  async function runMinute(
    now = new Date(),
    /** Limita la evaluación a estas transportistas (soporte y pruebas). */
    options: { tenantIds?: string[] } = {},
  ) {
    const result = { notStarted: 0, silent: 0, stopped: 0, escalated: 0 };
    const scope = options.tenantIds ? { tenantId: { in: options.tenantIds } } : {};
    const rulesCache = new Map<string, RuleSet>();
    const rules = async (tenantId: string) => {
      if (!rulesCache.has(tenantId)) rulesCache.set(tenantId, await rulesFor(system, tenantId));
      return rulesCache.get(tenantId)!;
    };

    const late = await system.trip.findMany({
      where: {
        ...scope,
        status: 'scheduled',
        driverId: { not: null },
        scheduledStartAt: { lte: now, gte: new Date(now.getTime() - NOT_STARTED_LOOKBACK_MS) },
      },
      include: {
        route: { select: { code: true } },
        driver: { select: { fullName: true } },
        vehicle: { select: { economicNumber: true, capacity: true } },
        plant: { select: { timezone: true } },
      },
    });
    for (const trip of late) {
      const set = await rules(trip.tenantId);
      const { toleranceMinutes } = set.trip_not_started.params;
      const lateBy = minutesBetween(trip.scheduledStartAt, now);
      if (lateBy < toleranceMinutes) continue;
      const [firstStop] = trip.routeVersionId
        ? await system.$queryRaw<{ lat: number; lng: number }[]>`
            SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
            FROM stops WHERE route_version_id = ${trip.routeVersionId}::uuid ORDER BY sequence LIMIT 1`
        : [];
      const opened = await open(
        {
          ...tripFields(trip),
          type: 'trip_not_started',
          cause: `${tripName(trip).replace(/^el/, 'El')} debía iniciar a las ${hhmm(trip.scheduledStartAt, trip.plant.timezone)} y ${trip.driver?.fullName ?? 'el chofer'} no lo ha iniciado (${lateBy} min).`,
          suggestedAction: 'Llama al chofer o envía una unidad de respaldo.',
          lat: firstStop?.lat ?? null,
          lng: firstStop?.lng ?? null,
          data: { lateMinutes: lateBy },
        },
        set,
      );
      if (opened) result.notStarted += 1;
    }

    const running = await system.trip.findMany({
      where: { ...scope, status: 'in_progress' },
      include: {
        route: { select: { code: true } },
        driver: { select: { fullName: true } },
        vehicle: { select: { economicNumber: true, capacity: true } },
        plant: { select: { timezone: true } },
      },
    });
    for (const trip of running) {
      const set = await rules(trip.tenantId);
      // Unidad sin reportar.
      const live = await deps.liveStore.getTripPosition(trip.id);
      const [stored] = await system.$queryRaw<{ last: Date | null }[]>`
        SELECT max(recorded_at) AS last FROM telemetry.trip_positions WHERE trip_id = ${trip.id}::uuid`;
      const lastReport = [live ? new Date(live.recordedAt) : null, stored?.last ?? null]
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const reference = lastReport ?? trip.actualStartAt ?? trip.scheduledStartAt;
      const silentFor = minutesBetween(reference, now);
      const alreadySilent = await system.alert.findFirst({
        where: {
          tenantId: trip.tenantId,
          dedupeKey: dedupeKey('device_silent', trip.id),
          status: { not: 'resolved' },
        },
        select: { id: true },
      });
      if (silentFor >= set.device_silent.params.minutes && !alreadySilent) {
        // Causa probable con el último reporte de salud y el historial (F06-P02).
        const diagnosis = await diagnoseTrip(system, trip.id, now);
        const base = lastReport
          ? `El celular de ${tripName(trip)} no envía su ubicación desde hace ${silentFor} min.`
          : `El celular de ${tripName(trip)} no ha enviado su ubicación desde que inició el viaje (${silentFor} min).`;
        const opened = await open(
          {
            ...tripFields(trip),
            type: 'device_silent',
            cause: diagnosis ? `${base} Causa probable: ${diagnosis.message}` : base,
            suggestedAction:
              diagnosis && diagnosis.cause !== 'unknown'
                ? diagnosis.suggestedAction
                : 'Llama al chofer y revisa la batería y los datos del celular.',
            lat: live?.lat ?? diagnosis?.lastPosition?.lat ?? null,
            lng: live?.lng ?? diagnosis?.lastPosition?.lng ?? null,
            data: {
              silentMinutes: silentFor,
              lastReportAt: lastReport?.toISOString() ?? null,
              probableCause: diagnosis?.cause ?? null,
            },
          },
          set,
        );
        if (opened) result.silent += 1;
      }

      // Parada no programada: detenida más del tiempo permitido lejos de paradas y planta.
      const { minutes, radiusMeters } = set.unscheduled_stop.params;
      // Últimas posiciones (hasta una hora): desde la más reciente hacia atrás mientras siga
      // dentro del radio, eso es lo que lleva detenida.
      const recent = await system.$queryRaw<{ recorded_at: Date; lat: number; lng: number }[]>`
        SELECT recorded_at, lat, lng FROM telemetry.trip_positions
        WHERE trip_id = ${trip.id}::uuid
          AND recorded_at > ${new Date(now.getTime() - STOP_LOOKBACK_MS)} AND recorded_at <= ${now}
        ORDER BY recorded_at DESC LIMIT 500`;
      const anchor = recent[0];
      // Sin posiciones recientes es una unidad sin reportar, no una parada.
      if (!anchor || recent.length < 2 || minutesBetween(anchor.recorded_at, now) >= minutes)
        continue;
      let stoppedSince = anchor.recorded_at;
      for (const point of recent) {
        if (haversineMeters(anchor, point) > radiusMeters) break;
        stoppedSince = point.recorded_at;
      }
      const stoppedFor = minutesBetween(stoppedSince, now);
      if (stoppedFor < minutes) {
        await autoResolve(
          trip.tenantId,
          'unscheduled_stop',
          trip.id,
          'La unidad volvió a avanzar.',
        );
        continue;
      }
      const version = trip.routeVersionId
        ? await deps.routes.versionDetail(system, trip.routeVersionId, null)
        : null;
      const nearStop = (version?.stops ?? []).some(
        (stop) => haversineMeters(anchor, stop.location) <= stop.radiusMeters + radiusMeters,
      );
      const [plant] = await system.$queryRaw<{ lat: number | null; lng: number | null }[]>`
        SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM plants WHERE id = ${trip.plantId}::uuid`;
      const nearPlant =
        plant?.lat != null &&
        plant.lng != null &&
        haversineMeters(anchor, { lat: plant.lat, lng: plant.lng }) <= PLANT_RADIUS_METERS;
      if (nearStop || nearPlant) continue;
      const opened = await open(
        {
          ...tripFields(trip),
          type: 'unscheduled_stop',
          cause: `La unidad de ${tripName(trip)} lleva ${stoppedFor} min detenida fuera de una parada.`,
          suggestedAction: 'Llama al chofer para saber si necesita ayuda.',
          lat: anchor.lat,
          lng: anchor.lng,
          data: { stoppedMinutes: stoppedFor },
        },
        set,
      );
      if (opened) result.stopped += 1;
    }

    result.escalated = await escalateDue(now, rules, scope);
    return result;
  }

  /** Escala al gerente las alertas que nadie atendió a tiempo. */
  async function escalateDue(
    now: Date,
    rules: (tenantId: string) => Promise<RuleSet>,
    scope: { tenantId?: { in: string[] } },
  ) {
    const openAlerts = await system.alert.findMany({
      where: { ...scope, status: 'open', escalatedAt: null },
    });
    let escalated = 0;
    for (const alert of openAlerts) {
      const rule = (await rules(alert.tenantId))[alert.type];
      if (minutesBetween(alert.openedAt, now) < rule.escalateAfterMinutes) continue;
      await withAfterCommit(() =>
        system.$transaction(async (tx) => {
          const updated = await tx.alert.update({
            where: { id: alert.id },
            data: { escalatedAt: now },
          });
          await tx.alertAction.create({
            data: {
              tenantId: alert.tenantId,
              alertId: alert.id,
              action: 'escalated',
              note: `Se escaló al gerente: nadie la atendió en ${rule.escalateAfterMinutes} min.`,
            },
          });
          deps.events.publish({
            type: 'alert.updated',
            tenantId: alert.tenantId,
            plantId: updated.plantId,
            notifyPlant: updated.notifyPlant,
            alert: { ...summarizeAlert(updated), escalatedTo: 'manager' },
          });
        }),
      );
      escalated += 1;
    }
    return escalated;
  }

  const unsubscribe = deps.events.subscribe((event) => {
    const work = handle(event)
      .catch((error: unknown) =>
        deps.log.error({ err: error, event: event.type }, 'Falló la evaluación de alertas'),
      )
      .finally(() => pending.delete(work));
    pending.add(work);
  });

  return {
    open,
    autoResolve,
    handle,
    runMinute,
    /** Espera a que terminen las evaluaciones en curso (pruebas y cierre ordenado). */
    async idle() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
    close: unsubscribe,
  };
}

export type AlertEngine = ReturnType<typeof createAlertEngine>;
