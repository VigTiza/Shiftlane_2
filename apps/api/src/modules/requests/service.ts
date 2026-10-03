import { CLIENT_REQUEST_TYPE_LABELS, todayIn } from '@shiftlane/shared';
import type { ClientRequestType } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { fromDbDate, toDbDate } from '../../lib/http-schemas.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { ScheduleService } from '../schedule/service.ts';

type ExtraReason = 'overtime' | 'shift_change' | 'event' | 'other';

const include = {
  tenant: { select: { id: true, name: true } },
  plant: { select: { id: true, name: true } },
  route: { select: { id: true, code: true, name: true } },
  trips: {
    select: {
      id: true,
      status: true,
      serviceDate: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
    },
    orderBy: { scheduledStartAt: 'asc' },
  },
} satisfies Prisma.ClientRequestInclude;

type RequestRow = Prisma.ClientRequestGetPayload<{ include: typeof include }>;

function mapRequest(row: RequestRow) {
  return {
    id: row.id,
    carrier: row.tenant,
    clientOrgId: row.clientOrgId,
    plant: row.plant,
    type: row.type,
    status: row.status,
    title: row.title,
    description: row.description,
    serviceDate: fromDbDate(row.serviceDate),
    direction: row.direction,
    plantTime: row.plantTime,
    passengers: row.passengers,
    route: row.route,
    extraReason: row.extraReason,
    response: row.response,
    respondedAt: row.respondedAt,
    createdAt: row.createdAt,
    trips: row.trips.map((trip) => ({ ...trip, serviceDate: fromDbDate(trip.serviceDate)! })),
  };
}

/**
 * Solicitudes de la planta a su transportista: viajes extra, cambios de horario o de ruta.
 * La planta crea y cancela; la transportista aprueba (un viaje extra crea el viaje) o rechaza.
 */
export function createRequestsService(deps: { schedule: ScheduleService }) {
  async function find(tx: DbTransaction, id: string) {
    const row = await tx.clientRequest.findFirst({ where: { id }, include });
    if (!row) throw new NotFoundError('No se encontró la solicitud.');
    return row;
  }

  async function pendingForCarrier(tx: DbTransaction, tenantId: string, id: string) {
    const row = await find(tx, id);
    if (row.tenant.id !== tenantId) throw new NotFoundError('No se encontró la solicitud.');
    if (row.status !== 'pending')
      throw new ConflictError('La solicitud ya fue atendida o cancelada.');
    return row;
  }

  return {
    /** Transportistas con acuerdo activo con la empresa de la planta, y qué plantas atienden. */
    async carriers(tx: DbTransaction, clientOrgId: string) {
      const agreements = await tx.serviceAgreement.findMany({
        where: { clientOrgId, status: 'active', deletedAt: null },
        include: {
          tenant: { select: { id: true, name: true } },
          plant: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      const byTenant = new Map<
        string,
        { id: string; name: string; plants: { id: string; name: string }[] }
      >();
      for (const agreement of agreements) {
        const carrier = byTenant.get(agreement.tenant.id) ?? { ...agreement.tenant, plants: [] };
        carrier.plants.push(agreement.plant);
        byTenant.set(carrier.id, carrier);
      }
      return [...byTenant.values()];
    },

    async list(
      tx: DbTransaction,
      query: {
        status?: 'pending' | 'approved' | 'rejected' | 'cancelled' | undefined;
        type?: ClientRequestType | undefined;
        plantId?: string | undefined;
        page: number;
        pageSize: number;
      },
    ) {
      const where: Prisma.ClientRequestWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.plantId ? { plantId: query.plantId } : {}),
      };
      const total = await tx.clientRequest.count({ where });
      const rows = await tx.clientRequest.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return { items: rows.map(mapRequest), total, page: query.page, pageSize: query.pageSize };
    },

    async get(tx: DbTransaction, id: string) {
      return mapRequest(await find(tx, id));
    },

    async create(
      tx: DbTransaction,
      clientOrgId: string,
      userId: string,
      input: {
        carrierId?: string | undefined;
        plantId: string;
        type: ClientRequestType;
        title?: string | undefined;
        description?: string | null | undefined;
        serviceDate?: string | undefined;
        direction?: 'inbound' | 'outbound' | undefined;
        plantTime?: string | undefined;
        passengers?: number | undefined;
        routeId?: string | undefined;
        extraReason?: ExtraReason | undefined;
      },
    ) {
      const plant = await tx.plant.findFirst({ where: { id: input.plantId, clientOrgId } });
      if (!plant) throw new BadRequestError('La planta no pertenece a tu empresa.');
      const agreements = await tx.serviceAgreement.findMany({
        where: { clientOrgId, plantId: plant.id, status: 'active', deletedAt: null },
      });
      if (agreements.length === 0) {
        throw new BadRequestError('La planta no tiene una transportista con acuerdo activo.');
      }
      let tenantId: string;
      if (input.carrierId) {
        if (!agreements.some((a) => a.tenantId === input.carrierId)) {
          throw new BadRequestError('Esa transportista no da servicio a la planta.');
        }
        tenantId = input.carrierId;
      } else if (agreements.length === 1) {
        tenantId = agreements[0]!.tenantId;
      } else {
        throw new BadRequestError(
          'La planta tiene varias transportistas; indica a cuál va dirigida.',
        );
      }
      if (input.serviceDate && input.serviceDate < todayIn(plant.timezone)) {
        throw new BadRequestError('La fecha de la solicitud no puede ser pasada.');
      }
      if (input.routeId) {
        const route = await tx.route.findFirst({
          where: { id: input.routeId, tenantId, plantId: plant.id, deletedAt: null },
        });
        if (!route) throw new BadRequestError('La ruta no es de esa transportista en esta planta.');
      }

      const isExtra = input.type === 'extra_trip';
      const created = await tx.clientRequest.create({
        data: {
          tenantId,
          clientOrgId,
          plantId: plant.id,
          type: input.type,
          title:
            input.title ??
            [CLIENT_REQUEST_TYPE_LABELS[input.type], input.serviceDate].filter(Boolean).join(' · '),
          description: input.description ?? null,
          serviceDate: input.serviceDate ? toDbDate(input.serviceDate) : null,
          direction: input.direction ?? null,
          plantTime: input.plantTime ?? null,
          passengers: input.passengers ?? null,
          routeId: input.routeId ?? null,
          extraReason: isExtra ? (input.extraReason ?? 'other') : null,
          requestedByUserId: userId,
        },
      });
      return mapRequest(await find(tx, created.id));
    },

    /** La planta cancela una solicitud que todavía no se atiende. */
    async cancel(tx: DbTransaction, clientOrgId: string, id: string) {
      const row = await find(tx, id);
      if (row.clientOrgId !== clientOrgId) throw new NotFoundError('No se encontró la solicitud.');
      if (row.status !== 'pending')
        throw new ConflictError('La solicitud ya fue atendida o cancelada.');
      await tx.clientRequest.update({ where: { id }, data: { status: 'cancelled' } });
      return mapRequest(await find(tx, id));
    },

    /** La transportista aprueba; si es un viaje extra, crea el viaje (y su asignación). */
    async approve(
      tx: DbTransaction,
      tenantId: string,
      userId: string,
      id: string,
      input: {
        response?: string | null | undefined;
        startTime?: string | undefined;
        endTime?: string | undefined;
        driverId?: string | null | undefined;
        vehicleId?: string | null | undefined;
        force: boolean;
      },
    ) {
      const row = await pendingForCarrier(tx, tenantId, id);
      let conflicts: Awaited<ReturnType<ScheduleService['createExtra']>>['conflicts'] = [];
      if (row.type === 'extra_trip') {
        const result = await deps.schedule.createExtra(tx, tenantId, userId, {
          plantId: row.plant.id,
          direction: row.direction!,
          serviceDate: fromDbDate(row.serviceDate)!,
          routeId: row.routeId,
          reason: row.extraReason ?? 'other',
          passengers: row.passengers,
          notes: row.description ? `${row.title}. ${row.description}` : row.title,
          clientRequestId: row.id,
          times:
            input.startTime && input.endTime
              ? { start: input.startTime, end: input.endTime }
              : undefined,
          plantTime: row.plantTime ?? undefined,
          driverId: input.driverId,
          vehicleId: input.vehicleId,
          force: input.force,
        });
        conflicts = result.conflicts;
      }
      await tx.clientRequest.update({
        where: { id },
        data: {
          status: 'approved',
          response: input.response ?? null,
          respondedByUserId: userId,
          respondedAt: new Date(),
        },
      });
      return { request: mapRequest(await find(tx, id)), conflicts };
    },

    async reject(
      tx: DbTransaction,
      tenantId: string,
      userId: string,
      id: string,
      response: string,
    ) {
      await pendingForCarrier(tx, tenantId, id);
      await tx.clientRequest.update({
        where: { id },
        data: { status: 'rejected', response, respondedByUserId: userId, respondedAt: new Date() },
      });
      return mapRequest(await find(tx, id));
    },
  };
}
