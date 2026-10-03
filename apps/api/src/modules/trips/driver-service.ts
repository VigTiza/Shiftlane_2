import { todayIn } from '@shiftlane/shared';

import type { DbClient, DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { fromDbDate } from '../../lib/http-schemas.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { DomainEvents } from '../../lib/domain-events.ts';
import type { LiveStore } from '../../lib/live-store.ts';
import type { ObjectStorage } from '../../lib/storage.ts';
import type { UploadedFile } from '../../lib/uploads.ts';
import { storageKey } from '../../lib/uploads.ts';
import type { Prisma, Trip, TripEventType } from '../../generated/prisma/client.ts';
import type { createPassengersService } from '../passengers/service.ts';
import type { RoutesService } from '../routes/service.ts';
import { assertCan, startWindowOpensAt } from './lifecycle.ts';
import type { TripAction } from './lifecycle.ts';

type PassengersService = ReturnType<typeof createPassengersService>;

export interface ChecklistItem {
  key: string;
  label: string;
  photoRequired: boolean;
}

/** Revisión rápida antes de salir cuando la transportista no ha configurado la suya. */
export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { key: 'tires', label: 'Llantas', photoRequired: false },
  { key: 'brakes', label: 'Frenos', photoRequired: false },
  { key: 'lights', label: 'Luces', photoRequired: false },
  { key: 'cleanliness', label: 'Limpieza', photoRequired: false },
  { key: 'extinguisher', label: 'Extintor', photoRequired: false },
  { key: 'first_aid', label: 'Botiquín', photoRequired: false },
];

/** Distancia máxima para asignar un escaneo a una parada. */
const SCAN_STOP_MAX_METERS = 500;
/** Tolerancia para la hora adelantada del celular (la sincronización la corrige en F05-P02). */
const CLOCK_TOLERANCE_MS = 5 * 60_000;
export const GATE_QR_PREFIX = 'shiftlane-puerta://';

export interface DriverSession {
  tenantId: string;
  driverId: string;
}

/** Datos comunes de cada acción del chofer (todo es opcional salvo lo que pide cada acción). */
export interface ActionInput {
  lat?: number | undefined;
  lng?: number | undefined;
  /** Hora del celular; si viene adelantada se usa la del servidor. */
  occurredAt?: Date | undefined;
  /** UUID que genera el celular: si la acción se reenvía, no se duplica. */
  clientEventId?: string | undefined;
}

export type ScanResult = 'ok' | 'other_route' | 'unregistered' | 'already_scanned' | 'rejected';

/** Respuesta de un escaneo (se guarda en el evento para responder igual a un reenvío). */
export interface ScanResponse {
  result: ScanResult;
  message: string;
  passenger: { id: string; fullName: string; employeeNumber: string } | null;
  provisionalBadgeId: string | null;
  stop: { id: string; name: string } | null;
  onboard: number;
  capacity: number | null;
  overCapacity: boolean;
}

function hhmm(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function occurredAt(input: ActionInput, now = new Date()) {
  if (!input.occurredAt || input.occurredAt.getTime() > now.getTime() + CLOCK_TOLERANCE_MS) {
    return now;
  }
  return input.occurredAt;
}

export interface LateOptions {
  /**
   * Sincronización sin señal: acepta paradas, escaneos, QR de puerta e incidentes de un viaje
   * ya terminado si ocurrieron antes de terminarlo (llegaron tarde por falta de señal).
   */
  allowLate?: boolean;
}

const LATE_ACTIONS: readonly TripAction[] = ['arrive_stop', 'scan', 'gate', 'incident'];

function assertCanAt(
  trip: Pick<Trip, 'status' | 'actualEndAt'>,
  action: TripAction,
  at: Date,
  options: LateOptions,
) {
  const lateButValid =
    options.allowLate &&
    LATE_ACTIONS.includes(action) &&
    trip.status === 'completed' &&
    trip.actualEndAt !== null &&
    at <= trip.actualEndAt;
  if (!lateButValid) assertCan(trip.status, action);
}

export function parseChecklistItems(value: Prisma.JsonValue): ChecklistItem[] {
  return Array.isArray(value) ? (value as unknown as ChecklistItem[]) : DEFAULT_CHECKLIST;
}

/**
 * Acciones del chofer sobre sus viajes. Cada acción revisa la máquina de estados, escribe el
 * evento en trip_events (inmutable) y es idempotente con el UUID del celular.
 */
export function createDriverTripsService(deps: {
  passengers: PassengersService;
  routes: RoutesService;
  storage: ObjectStorage;
  system: DbClient;
  timeZone: string;
  /** Al terminar el viaje se borra su posición en vivo. */
  liveStore?: LiveStore;
  /** Avisos en tiempo real (inicio, fin y abordajes). */
  events?: DomainEvents;
}) {
  const { passengers, routes, storage } = deps;

  async function driverTrip(tx: DbTransaction, session: DriverSession, tripId: string) {
    const trip = await tx.trip.findFirst({
      where: { id: tripId, tenantId: session.tenantId, driverId: session.driverId },
      include: { plant: { select: { timezone: true } } },
    });
    // Un viaje de otro chofer no existe para este chofer.
    if (!trip) throw new NotFoundError('No se encontró el viaje.');
    return trip;
  }

  async function previousEvent(tx: DbTransaction, tripId: string, input: ActionInput) {
    if (!input.clientEventId) return null;
    return tx.tripEvent.findFirst({ where: { tripId, clientEventId: input.clientEventId } });
  }

  async function record(
    tx: DbTransaction,
    trip: Pick<Trip, 'id' | 'tenantId'>,
    type: TripEventType,
    actor: { type: 'driver' | 'user'; id: string },
    input: ActionInput,
    data: Record<string, unknown>,
  ) {
    try {
      return await tx.tripEvent.create({
        data: {
          tenantId: trip.tenantId,
          tripId: trip.id,
          type,
          occurredAt: occurredAt(input),
          actorType: actor.type,
          actorId: actor.id,
          clientEventId: input.clientEventId ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          data: data as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Este evento ya se había registrado.');
      throw error;
    }
  }

  /** Estado del viaje que ve el chofer después de cada acción. */
  async function state(tx: DbTransaction, tripId: string, duplicate = false) {
    const trip = await tx.trip.findFirstOrThrow({
      where: { id: tripId },
      include: { vehicle: { select: { capacity: true } } },
    });
    const [onboard, arrivals] = [
      await tx.boarding.count({ where: { tripId } }),
      await tx.tripEvent.findMany({
        where: { tripId, type: 'stop_arrived' },
        select: { data: true },
        orderBy: { occurredAt: 'asc' },
      }),
    ];
    return {
      id: trip.id,
      status: trip.status,
      actualStartAt: trip.actualStartAt,
      arrivedAt: trip.arrivedAt,
      actualEndAt: trip.actualEndAt,
      onboard,
      capacity: trip.vehicle?.capacity ?? null,
      stopsArrived: arrivals.map((a) => (a.data as { stopId: string }).stopId),
      duplicate,
    };
  }

  async function templateFor(tx: DbTransaction, tenantId: string) {
    const template = await tx.checklistTemplate.findFirst({ where: { tenantId } });
    return template ? parseChecklistItems(template.items) : DEFAULT_CHECKLIST;
  }

  async function assertPhotos(tx: DbTransaction, tripId: string, photoIds: string[]) {
    if (photoIds.length === 0) return;
    const found = await tx.tripPhoto.count({ where: { id: { in: photoIds }, tripId } });
    if (found !== new Set(photoIds).size) {
      throw new BadRequestError('Alguna foto no es de este viaje; vuelve a tomarla.');
    }
  }

  return {
    templateFor,

    /** Viajes del día del chofer: el que está en curso y el siguiente siempre arriba. */
    async todayTrips(tx: DbTransaction, session: DriverSession, date?: string) {
      const day = date ?? todayIn(deps.timeZone);
      const trips = await tx.trip.findMany({
        where: {
          tenantId: session.tenantId,
          driverId: session.driverId,
          OR: [{ serviceDate: new Date(`${day}T00:00:00Z`) }, { status: 'in_progress' }],
        },
        include: {
          route: { select: { id: true, code: true, name: true } },
          plant: { select: { id: true, name: true, timezone: true } },
          vehicle: { select: { id: true, economicNumber: true, capacity: true } },
        },
        orderBy: { scheduledStartAt: 'asc' },
      });
      const rank = { in_progress: 0, scheduled: 1, completed: 2, cancelled: 3 } as const;
      trips.sort((a, b) => rank[a.status] - rank[b.status]);

      const versions = new Map<string, Awaited<ReturnType<RoutesService['versionDetail']>>>();
      for (const versionId of new Set(trips.map((t) => t.routeVersionId).filter(Boolean))) {
        versions.set(versionId!, await routes.versionDetail(tx, versionId!, null));
      }
      const result = [];
      for (const trip of trips) {
        const version = trip.routeVersionId ? versions.get(trip.routeVersionId) : undefined;
        const [expected, onboard, checklist] = [
          trip.routeId
            ? await tx.routePassenger.count({
                where: {
                  routeId: trip.routeId,
                  deletedAt: null,
                  passenger: { status: 'active', deletedAt: null },
                },
              })
            : (trip.requestedPassengers ?? 0),
          await tx.boarding.count({ where: { tripId: trip.id } }),
          trip.vehicleId
            ? await tx.checklistResult.findFirst({
                where: { vehicleId: trip.vehicleId, serviceDate: trip.serviceDate },
                orderBy: { submittedAt: 'desc' },
              })
            : null,
        ];
        result.push({
          id: trip.id,
          status: trip.status,
          kind: trip.kind,
          direction: trip.direction,
          serviceDate: fromDbDate(trip.serviceDate)!,
          scheduledStartAt: trip.scheduledStartAt,
          scheduledEndAt: trip.scheduledEndAt,
          canStartFrom: startWindowOpensAt(trip.scheduledStartAt),
          route: trip.route,
          plant: { id: trip.plant.id, name: trip.plant.name },
          vehicle: trip.vehicle,
          expectedPassengers: expected,
          onboard,
          checklist: {
            done: checklist !== null,
            passed: checklist?.passed ?? false,
            exceptionAuthorized: trip.checklistExceptionAt !== null,
          },
          stops: (version?.stops ?? []).map((stop) => ({
            id: stop.id,
            sequence: stop.sequence,
            name: stop.name,
            location: stop.location,
            radiusMeters: stop.radiusMeters,
            times: stop.times,
          })),
        });
      }
      return { date: day, trips: result };
    },

    async uploadPhoto(
      tx: DbTransaction,
      session: DriverSession,
      tripId: string,
      kind: 'checklist' | 'incident' | 'evidence',
      file: UploadedFile,
    ) {
      const trip = await driverTrip(tx, session, tripId);
      if (trip.status === 'completed' || trip.status === 'cancelled') {
        throw new ConflictError(
          trip.status === 'completed' ? 'El viaje ya terminó.' : 'El viaje está cancelado.',
        );
      }
      const key = storageKey(session.tenantId, `trips/${tripId}`, file.extension);
      await storage.put(key, file.buffer, file.contentType);
      const photo = await tx.tripPhoto.create({
        data: {
          tenantId: session.tenantId,
          tripId,
          driverId: session.driverId,
          kind,
          storageKey: key,
          contentType: file.contentType,
          sizeBytes: file.buffer.length,
        },
      });
      return { id: photo.id, kind: photo.kind, createdAt: photo.createdAt };
    },

    async submitChecklist(
      tx: DbTransaction,
      session: DriverSession,
      tripId: string,
      input: ActionInput & {
        items: {
          key: string;
          ok: boolean;
          note?: string | undefined;
          photoId?: string | undefined;
        }[];
      },
    ) {
      const trip = await driverTrip(tx, session, tripId);
      if (input.clientEventId) {
        const previous = await tx.checklistResult.findFirst({
          where: { clientEventId: input.clientEventId },
        });
        if (previous) {
          return {
            id: previous.id,
            passed: previous.passed,
            failed: (previous.items as { label: string; ok: boolean }[])
              .filter((i) => !i.ok)
              .map((i) => i.label),
            canStart: previous.passed || trip.checklistExceptionAt !== null,
            duplicate: true,
          };
        }
      }
      assertCan(trip.status, 'checklist');
      if (!trip.vehicleId) {
        throw new ConflictError('El viaje no tiene unidad asignada; avisa al despachador.');
      }
      const template = await templateFor(tx, session.tenantId);
      const byKey = new Map(input.items.map((item) => [item.key, item]));
      if (byKey.size !== input.items.length)
        throw new BadRequestError('Hay puntos repetidos en el checklist.');
      for (const key of byKey.keys()) {
        if (!template.some((t) => t.key === key)) {
          throw new BadRequestError(`El punto «${key}» no está en el checklist.`);
        }
      }
      const items = template.map((point) => {
        const answer = byKey.get(point.key);
        if (!answer) throw new BadRequestError(`Falta revisar: ${point.label}.`);
        if (point.photoRequired && !answer.photoId) {
          throw new BadRequestError(`Falta la foto de ${point.label}.`);
        }
        return {
          key: point.key,
          label: point.label,
          ok: answer.ok,
          note: answer.note ?? null,
          photoId: answer.photoId ?? null,
        };
      });
      await assertPhotos(
        tx,
        tripId,
        items.flatMap((i) => (i.photoId ? [i.photoId] : [])),
      );
      const passed = items.every((i) => i.ok);
      const failed = items.filter((i) => !i.ok).map((i) => i.label);
      const result = await tx.checklistResult.create({
        data: {
          tenantId: session.tenantId,
          tripId,
          driverId: session.driverId,
          vehicleId: trip.vehicleId,
          serviceDate: trip.serviceDate,
          passed,
          items,
          submittedAt: occurredAt(input),
          clientEventId: input.clientEventId ?? null,
        },
      });
      // El evento lleva su propio id: el UUID del celular ya identifica al resultado.
      await record(
        tx,
        trip,
        'checklist_submitted',
        { type: 'driver', id: session.driverId },
        { ...input, clientEventId: undefined },
        {
          checklistResultId: result.id,
          passed,
          failed,
        },
      );
      return {
        id: result.id,
        passed,
        failed,
        canStart: passed || trip.checklistExceptionAt !== null,
        duplicate: false,
      };
    },

    async start(tx: DbTransaction, session: DriverSession, tripId: string, input: ActionInput) {
      const trip = await driverTrip(tx, session, tripId);
      if (await previousEvent(tx, tripId, input)) return state(tx, tripId, true);
      assertCan(trip.status, 'start');
      if (!trip.vehicleId) {
        throw new ConflictError('El viaje no tiene unidad asignada; avisa al despachador.');
      }
      const at = occurredAt(input);
      const opens = startWindowOpensAt(trip.scheduledStartAt);
      if (at < opens) {
        throw new ConflictError(
          `Todavía es temprano: puedes iniciar este viaje desde las ${hhmm(opens, trip.plant.timezone)}.`,
        );
      }
      const other = await tx.trip.findFirst({
        where: { driverId: session.driverId, status: 'in_progress', id: { not: trip.id } },
      });
      if (other)
        throw new ConflictError('Tienes otro viaje en curso; termínalo antes de iniciar este.');
      const checklist = await tx.checklistResult.findFirst({
        where: { vehicleId: trip.vehicleId, serviceDate: trip.serviceDate },
        orderBy: { submittedAt: 'desc' },
      });
      if (!checklist)
        throw new ConflictError('Haz el checklist de la unidad antes de iniciar el viaje.');
      if (!checklist.passed && !trip.checklistExceptionAt) {
        throw new ConflictError(
          'El checklist tiene puntos sin aprobar; el despachador debe autorizar la salida.',
        );
      }
      await tx.trip.update({
        where: { id: trip.id },
        data: { status: 'in_progress', actualStartAt: at },
      });
      await record(tx, trip, 'started', { type: 'driver', id: session.driverId }, input, {
        checklistResultId: checklist.id,
      });
      deps.events?.publish({ type: 'trip.status_changed', tripId: trip.id });
      return state(tx, tripId);
    },

    async arriveStop(
      tx: DbTransaction,
      session: DriverSession,
      tripId: string,
      input: ActionInput & { stopId: string },
      options: LateOptions = {},
    ) {
      const trip = await driverTrip(tx, session, tripId);
      if (await previousEvent(tx, tripId, input)) return state(tx, tripId, true);
      assertCanAt(trip, 'arrive_stop', occurredAt(input), options);
      const stop = trip.routeVersionId
        ? await tx.stop.findFirst({
            where: { id: input.stopId, routeVersionId: trip.routeVersionId },
          })
        : null;
      if (!stop) throw new BadRequestError('La parada no es de la ruta de este viaje.');
      const already = await tx.tripEvent.findFirst({
        where: { tripId, type: 'stop_arrived', data: { path: ['stopId'], equals: stop.id } },
      });
      if (already) return state(tx, tripId, true);
      await record(tx, trip, 'stop_arrived', { type: 'driver', id: session.driverId }, input, {
        stopId: stop.id,
        stopName: stop.name,
        sequence: stop.sequence,
      });
      return state(tx, tripId);
    },

    /**
     * Escaneo de un pasajero: identifica la credencial QR, el gafete o el número de empleado,
     * revisa que sea de la ruta, asigna la parada más cercana y avisa del sobrecupo. Un gafete
     * desconocido queda como provisional y no detiene el viaje.
     */
    async scan(
      tx: DbTransaction,
      session: DriverSession,
      tripId: string,
      input: ActionInput & {
        code?: string | undefined;
        codeType?: 'barcode' | 'qr' | undefined;
        employeeNumber?: string | undefined;
      },
      options: LateOptions = {},
    ) {
      const trip = await driverTrip(tx, session, tripId);
      const previous = await previousEvent(tx, tripId, input);
      if (previous) return { ...(previous.data as unknown as ScanResponse), duplicate: true };
      assertCanAt(trip, 'scan', occurredAt(input), options);

      let method: 'shiftlane_qr' | 'badge' | 'manual' = 'manual';
      let passenger: {
        id: string;
        fullName: string;
        employeeNumber: string;
        plantId: string;
      } | null = null;
      let provisionalId: string | null = null;
      let rejection: string | null = null;

      if (input.code) {
        const verified = await passengers.verify(tx, input.code);
        if (verified.valid) {
          method = verified.source === 'shiftlane_qr' ? 'shiftlane_qr' : 'badge';
          passenger = verified.passenger;
        } else if (verified.reason === 'unknown') {
          method = 'badge';
          // El gafete queda provisional para que la planta lo resuelva; el viaje sigue.
          const badge = await passengers.registerProvisional(deps.system, session.tenantId, {
            plantId: trip.plantId,
            value: input.code,
            kind: input.codeType ?? 'barcode',
          });
          provisionalId = badge.id;
        } else {
          rejection = verified.message;
        }
      } else if (input.employeeNumber) {
        const found = await tx.passenger.findFirst({
          where: { plantId: trip.plantId, employeeNumber: input.employeeNumber, deletedAt: null },
        });
        if (!found) rejection = 'No se encontró el número de empleado en esta planta.';
        else if (found.status !== 'active') rejection = 'El empleado está dado de baja.';
        else passenger = found;
      }

      const capacity = trip.vehicleId
        ? ((
            await tx.vehicle.findFirst({
              where: { id: trip.vehicleId },
              select: { capacity: true },
            })
          )?.capacity ?? null)
        : null;
      const respond = async (
        result: ScanResult,
        message: string,
        extra: Partial<ScanResponse> = {},
      ) => {
        const onboard = await tx.boarding.count({ where: { tripId } });
        const response: ScanResponse = {
          result,
          message,
          passenger: passenger
            ? {
                id: passenger.id,
                fullName: passenger.fullName,
                employeeNumber: passenger.employeeNumber,
              }
            : null,
          provisionalBadgeId: provisionalId,
          stop: null,
          onboard,
          capacity,
          overCapacity: capacity !== null && onboard > capacity,
          ...extra,
        };
        await record(
          tx,
          trip,
          'passenger_scanned',
          { type: 'driver', id: session.driverId },
          input,
          response as unknown as Record<string, unknown>,
        );
        return { ...response, duplicate: false };
      };

      if (rejection) return respond('rejected', rejection);

      const already = await tx.boarding.findFirst({
        where: passenger
          ? { tripId, passengerId: passenger.id }
          : { tripId, provisionalBadgeId: provisionalId },
      });
      if (already) return respond('already_scanned', 'Ya se había escaneado en este viaje.');

      let result: 'ok' | 'other_route' | 'unregistered';
      let message: string;
      if (!passenger) {
        result = 'unregistered';
        message = 'Gafete no registrado: queda como provisional y la planta lo revisará.';
      } else if (passenger.plantId !== trip.plantId) {
        result = 'other_route';
        message = 'El empleado es de otra planta.';
      } else if (
        trip.routeId &&
        !(await tx.routePassenger.findFirst({
          where: { routeId: trip.routeId, passengerId: passenger.id, deletedAt: null },
        }))
      ) {
        result = 'other_route';
        message = 'Pasajero de otra ruta o turno.';
      } else {
        result = 'ok';
        message = `Bienvenido, ${passenger.fullName.split(' ')[0]}.`;
      }

      // La parada la decide la ubicación del escaneo, nunca el chofer.
      const nearest =
        trip.routeVersionId && input.lat !== undefined && input.lng !== undefined
          ? (
              await routes.nearestStop(
                tx,
                trip.routeVersionId,
                { lat: input.lat, lng: input.lng },
                SCAN_STOP_MAX_METERS,
              )
            ).stop
          : null;
      try {
        await tx.boarding.create({
          data: {
            tenantId: session.tenantId,
            tripId,
            passengerId: passenger?.id ?? null,
            provisionalBadgeId: provisionalId,
            stopId: nearest?.id ?? null,
            method,
            result,
            scannedAt: occurredAt(input),
            lat: input.lat ?? null,
            lng: input.lng ?? null,
            clientEventId: input.clientEventId ?? null,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error))
          return respond('already_scanned', 'Ya se había escaneado en este viaje.');
        throw error;
      }
      const overCapacityNote =
        capacity !== null && (await tx.boarding.count({ where: { tripId } })) > capacity;
      const response = await respond(
        result,
        overCapacityNote ? `${message} Sobrecupo: avisa al despachador.` : message,
        {
          stop: nearest ? { id: nearest.id, name: nearest.name } : null,
        },
      );
      deps.events?.publish({
        type: 'boarding.created',
        tripId,
        boarding: {
          result,
          passenger: passenger ? { id: passenger.id, fullName: passenger.fullName } : null,
          stop: response.stop,
          onboard: response.onboard,
          overCapacity: response.overCapacity,
        },
      });
      return response;
    },

    async reportIncident(
      tx: DbTransaction,
      session: DriverSession,
      tripId: string,
      input: ActionInput & {
        type: 'traffic' | 'mechanical' | 'accident' | 'passenger' | 'forced_detour' | 'other';
        description?: string | null | undefined;
        photoIds: string[];
      },
      options: LateOptions = {},
    ) {
      const trip = await driverTrip(tx, session, tripId);
      if (input.clientEventId) {
        const previous = await tx.incident.findFirst({
          where: { clientEventId: input.clientEventId },
        });
        if (previous) return { id: previous.id, status: previous.status, duplicate: true };
      }
      assertCanAt(trip, 'incident', occurredAt(input), options);
      await assertPhotos(tx, tripId, input.photoIds);
      const incident = await tx.incident.create({
        data: {
          tenantId: session.tenantId,
          tripId,
          driverId: session.driverId,
          type: input.type,
          description: input.description ?? null,
          photoIds: input.photoIds,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          occurredAt: occurredAt(input),
          clientEventId: input.clientEventId ?? null,
        },
      });
      await record(
        tx,
        trip,
        'incident_reported',
        { type: 'driver', id: session.driverId },
        { ...input, clientEventId: undefined },
        { incidentId: incident.id, type: input.type },
      );
      return { id: incident.id, status: incident.status, duplicate: false };
    },

    /** Pánico: siempre se acepta, con o sin viaje; avisa de inmediato (F06 genera la alerta). */
    async panic(
      tx: DbTransaction,
      session: DriverSession,
      input: ActionInput & { tripId?: string | undefined },
    ) {
      if (input.clientEventId) {
        const previous = await tx.panicEvent.findFirst({
          where: { clientEventId: input.clientEventId },
        });
        if (previous) return { id: previous.id, occurredAt: previous.occurredAt, duplicate: true };
      }
      const trip = input.tripId ? await driverTrip(tx, session, input.tripId) : null;
      const at = occurredAt(input);
      const panic = await tx.panicEvent.create({
        data: {
          tenantId: session.tenantId,
          driverId: session.driverId,
          tripId: trip?.id ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          occurredAt: at,
          clientEventId: input.clientEventId ?? null,
        },
      });
      if (trip) {
        await record(
          tx,
          trip,
          'panic',
          { type: 'driver', id: session.driverId },
          { ...input, clientEventId: undefined },
          { panicEventId: panic.id },
        );
      }
      return { id: panic.id, occurredAt: at, duplicate: false };
    },

    /** Llegada comprobada: el chofer escanea el QR fijo de la puerta de la planta. */
    async gate(
      tx: DbTransaction,
      session: DriverSession,
      tripId: string,
      input: ActionInput & { code: string },
      options: LateOptions = {},
    ) {
      const trip = await driverTrip(tx, session, tripId);
      if (await previousEvent(tx, tripId, input)) return state(tx, tripId, true);
      assertCanAt(trip, 'gate', occurredAt(input), options);
      const qrCode = input.code.startsWith(GATE_QR_PREFIX)
        ? input.code.slice(GATE_QR_PREFIX.length)
        : input.code;
      const gate = await tx.plantGate.findFirst({
        where: { qrCode, active: true, deletedAt: null },
      });
      if (!gate) throw new BadRequestError('El código no es un QR de puerta de Shiftlane.');
      if (gate.plantId !== trip.plantId) throw new ConflictError('Este QR es de otra planta.');
      if (trip.arrivedAt) return state(tx, tripId, true);
      await tx.trip.update({
        where: { id: trip.id },
        data: { arrivedAt: occurredAt(input), arrivalGateId: gate.id },
      });
      await record(tx, trip, 'gate_arrived', { type: 'driver', id: session.driverId }, input, {
        gateId: gate.id,
        gateName: gate.name,
      });
      return state(tx, tripId);
    },

    async finish(tx: DbTransaction, session: DriverSession, tripId: string, input: ActionInput) {
      const trip = await driverTrip(tx, session, tripId);
      if (await previousEvent(tx, tripId, input)) return state(tx, tripId, true);
      assertCan(trip.status, 'finish');
      const at = occurredAt(input);
      const end = trip.actualStartAt && at < trip.actualStartAt ? trip.actualStartAt : at;
      await tx.trip.update({
        where: { id: trip.id },
        data: { status: 'completed', actualEndAt: end },
      });
      await record(tx, trip, 'finished', { type: 'driver', id: session.driverId }, input, {
        boarded: await tx.boarding.count({ where: { tripId } }),
        gateVerified: trip.arrivedAt !== null,
      });
      await deps.liveStore?.removeTrip(session.tenantId, tripId);
      deps.events?.publish({ type: 'trip.status_changed', tripId: trip.id });
      return state(tx, tripId);
    },
  };
}

export type DriverTripsService = ReturnType<typeof createDriverTripsService>;
