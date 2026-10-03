import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import type { ObjectStorage } from '../../lib/storage.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { ScheduleService } from '../schedule/service.ts';
import { DEFAULT_CHECKLIST, parseChecklistItems } from './driver-service.ts';
import type { ChecklistItem } from './driver-service.ts';
import { assertCan } from './lifecycle.ts';

/**
 * Lo que ve y hace el panel sobre la ejecución: detalle con evidencia, excepción de checklist,
 * plantilla del checklist, incidentes y pánico. La planta ve la evidencia de sus viajes.
 */
export function createTripPanelService(deps: {
  schedule: ScheduleService;
  storage: ObjectStorage;
}) {
  return {
    async detail(tx: DbTransaction, tripId: string) {
      const summary = await deps.schedule.tripSummary(tx, tripId);
      const trip = await tx.trip.findFirstOrThrow({
        where: { id: tripId },
        include: {
          arrivalGate: { select: { id: true, name: true } },
          events: { orderBy: [{ occurredAt: 'asc' }, { receivedAt: 'asc' }] },
          boardings: {
            include: {
              passenger: { select: { id: true, fullName: true, employeeNumber: true } },
              stop: { select: { id: true, name: true } },
            },
            orderBy: { scannedAt: 'asc' },
          },
          incidents: { orderBy: { occurredAt: 'asc' } },
          photos: { orderBy: { createdAt: 'asc' } },
        },
      });
      const checklist = trip.vehicleId
        ? await tx.checklistResult.findFirst({
            where: { vehicleId: trip.vehicleId, serviceDate: trip.serviceDate },
            orderBy: { submittedAt: 'desc' },
          })
        : null;
      return {
        ...summary,
        actualStartAt: trip.actualStartAt,
        actualEndAt: trip.actualEndAt,
        arrivedAt: trip.arrivedAt,
        arrivalGate: trip.arrivalGate,
        checklistException: trip.checklistExceptionAt
          ? { at: trip.checklistExceptionAt, reason: trip.checklistExceptionReason }
          : null,
        checklist: checklist
          ? {
              id: checklist.id,
              passed: checklist.passed,
              submittedAt: checklist.submittedAt,
              items: checklist.items as {
                key: string;
                label: string;
                ok: boolean;
                note: string | null;
                photoId: string | null;
              }[],
            }
          : null,
        events: trip.events.map((event) => ({
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt,
          receivedAt: event.receivedAt,
          actorType: event.actorType,
          lat: event.lat,
          lng: event.lng,
          data: (event.data ?? null) as Record<string, unknown> | null,
        })),
        boardings: trip.boardings.map((boarding) => ({
          id: boarding.id,
          passenger: boarding.passenger,
          provisionalBadgeId: boarding.provisionalBadgeId,
          stop: boarding.stop,
          method: boarding.method,
          result: boarding.result,
          scannedAt: boarding.scannedAt,
        })),
        incidents: trip.incidents.map((incident) => ({
          id: incident.id,
          type: incident.type,
          description: incident.description,
          photoIds: incident.photoIds,
          occurredAt: incident.occurredAt,
          status: incident.status,
          resolution: incident.resolution,
        })),
        photos: trip.photos.map((photo) => ({
          id: photo.id,
          kind: photo.kind,
          createdAt: photo.createdAt,
        })),
      };
    },

    async photo(tx: DbTransaction, tripId: string, photoId: string) {
      const photo = await tx.tripPhoto.findFirst({ where: { id: photoId, tripId } });
      if (!photo) throw new NotFoundError('No se encontró la foto.');
      const body = await deps.storage.get(photo.storageKey);
      if (!body) throw new NotFoundError('No se encontró la foto.');
      return { body, contentType: photo.contentType };
    },

    /** El despachador autoriza salir aunque el checklist tenga puntos sin aprobar. */
    async authorizeChecklistException(
      tx: DbTransaction,
      tenantId: string,
      userId: string,
      tripId: string,
      reason: string,
    ) {
      const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId } });
      if (!trip) throw new NotFoundError('No se encontró el viaje.');
      assertCan(trip.status, 'checklist_exception');
      const at = new Date();
      await tx.trip.update({
        where: { id: tripId },
        data: {
          checklistExceptionAt: at,
          checklistExceptionByUserId: userId,
          checklistExceptionReason: reason,
        },
      });
      await tx.tripEvent.create({
        data: {
          tenantId,
          tripId,
          type: 'checklist_exception',
          occurredAt: at,
          actorType: 'user',
          actorId: userId,
          data: { reason },
        },
      });
      return deps.schedule.tripSummary(tx, tripId);
    },

    async template(tx: DbTransaction, tenantId: string) {
      const template = await tx.checklistTemplate.findFirst({ where: { tenantId } });
      return {
        items: template ? parseChecklistItems(template.items) : DEFAULT_CHECKLIST,
        custom: template !== null,
      };
    },

    async saveTemplate(tx: DbTransaction, tenantId: string, items: ChecklistItem[]) {
      if (new Set(items.map((i) => i.key)).size !== items.length) {
        throw new BadRequestError('Cada punto del checklist debe tener una clave distinta.');
      }
      const data = items as unknown as Prisma.InputJsonValue;
      await tx.checklistTemplate.upsert({
        where: { tenantId },
        update: { items: data },
        create: { tenantId, items: data },
      });
      return { items, custom: true };
    },

    async listIncidents(tx: DbTransaction, query: { status?: 'open' | 'resolved' | undefined }) {
      const incidents = await tx.incident.findMany({
        where: query.status ? { status: query.status } : {},
        include: {
          trip: { select: { id: true, serviceDate: true, route: { select: { code: true } } } },
          driver: { select: { id: true, fullName: true } },
        },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      });
      return incidents.map((incident) => ({
        id: incident.id,
        tripId: incident.tripId,
        routeCode: incident.trip.route?.code ?? null,
        driver: incident.driver,
        type: incident.type,
        description: incident.description,
        photoIds: incident.photoIds,
        lat: incident.lat,
        lng: incident.lng,
        occurredAt: incident.occurredAt,
        status: incident.status,
        resolution: incident.resolution,
        resolvedAt: incident.resolvedAt,
      }));
    },

    async resolveIncident(tx: DbTransaction, userId: string, id: string, resolution: string) {
      const incident = await tx.incident.findFirst({ where: { id } });
      if (!incident) throw new NotFoundError('No se encontró el incidente.');
      if (incident.status === 'resolved') throw new ConflictError('El incidente ya está resuelto.');
      await tx.incident.update({
        where: { id },
        data: { status: 'resolved', resolution, resolvedAt: new Date(), resolvedByUserId: userId },
      });
      return (await this.listIncidents(tx, {})).find((i) => i.id === id)!;
    },

    async listPanics(tx: DbTransaction, query: { pending?: boolean | undefined }) {
      const panics = await tx.panicEvent.findMany({
        where: query.pending ? { acknowledgedAt: null } : {},
        include: { driver: { select: { id: true, fullName: true } } },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      });
      return panics.map((panic) => ({
        id: panic.id,
        driver: panic.driver,
        tripId: panic.tripId,
        lat: panic.lat,
        lng: panic.lng,
        occurredAt: panic.occurredAt,
        acknowledgedAt: panic.acknowledgedAt,
      }));
    },

    async acknowledgePanic(tx: DbTransaction, userId: string, id: string) {
      const panic = await tx.panicEvent.findFirst({ where: { id } });
      if (!panic) throw new NotFoundError('No se encontró la alerta de pánico.');
      if (!panic.acknowledgedAt) {
        await tx.panicEvent.update({
          where: { id },
          data: { acknowledgedAt: new Date(), acknowledgedByUserId: userId },
        });
      }
      return (await this.listPanics(tx, {})).find((p) => p.id === id)!;
    },
  };
}
