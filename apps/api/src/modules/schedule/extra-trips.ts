import { todayIn, zonedDateTime } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { fromDbDate, toDbDate } from '../../lib/http-schemas.ts';
import type { ExtraTripReason } from '../../generated/prisma/client.ts';
import { effectiveVersion } from '../routes/versioning.ts';

/** Duración por omisión de un viaje extra sin ruta de referencia ni tiempo calculado. */
export const DEFAULT_EXTRA_MINUTES = 60;

type Direction = 'inbound' | 'outbound';

function plusMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export interface ExtraTripInput {
  plantId: string;
  direction: Direction;
  serviceDate: string;
  routeId?: string | null | undefined;
  reason: ExtraTripReason;
  passengers?: number | null | undefined;
  notes?: string | null | undefined;
  clientRequestId?: string | null | undefined;
  /** Horario explícito HH:MM (si la salida es mayor que la llegada, termina al día siguiente). */
  times?: { start: string; end: string } | undefined;
  /** O la hora en planta: llegada (entrada) o salida (salida); la otra se calcula con la ruta. */
  plantTime?: string | undefined;
}

/** Versión de la ruta para un viaje extra: la vigente, o la regular si el servicio está suspendido. */
async function versionFor(tx: DbTransaction, routeId: string, date: string) {
  const [versions, changes] = [
    await tx.routeVersion.findMany({ where: { routeId, deletedAt: null } }),
    await tx.temporaryChange.findMany({ where: { routeId, cancelledAt: null } }),
  ];
  const forDate = versions.map((v) => ({
    id: v.id,
    kind: v.kind,
    validFrom: fromDbDate(v.validFrom)!,
  }));
  const effective = effectiveVersion(
    forDate,
    changes.map((c) => ({
      id: c.id,
      versionId: c.routeVersionId,
      startsOn: fromDbDate(c.startsOn)!,
      endsOn: fromDbDate(c.endsOn)!,
      cancelled: false,
    })),
    date,
  );
  const regular = effectiveVersion(forDate, [], date);
  const versionId = effective?.versionId ?? regular?.versionId ?? null;
  return versionId ? versions.find((v) => v.id === versionId)! : null;
}

/**
 * Crea un viaje extraordinario (tiempo extra, cambio de turno, evento), manual o desde una
 * solicitud aprobada. Puede basarse en una ruta (usa sus paradas y su tiempo de recorrido) o
 * ir sin ruta con su propio horario.
 */
export async function createExtraTrip(
  tx: DbTransaction,
  tenantId: string,
  userId: string,
  input: ExtraTripInput,
) {
  const agreement = await tx.serviceAgreement.findFirst({
    where: { tenantId, plantId: input.plantId, status: 'active', deletedAt: null },
    include: { plant: { select: { timezone: true } } },
  });
  if (!agreement) {
    throw new BadRequestError('La planta no tiene un acuerdo de servicio activo con tu empresa.');
  }
  const timeZone = agreement.plant.timezone;
  if (input.serviceDate < todayIn(timeZone)) {
    throw new BadRequestError('Un viaje extra no puede ser en una fecha pasada.');
  }

  let routeVersion: Awaited<ReturnType<typeof versionFor>> = null;
  if (input.routeId) {
    const route = await tx.route.findFirst({
      where: { id: input.routeId, tenantId, deletedAt: null },
    });
    if (!route || route.plantId !== input.plantId) {
      throw new BadRequestError('La ruta no pertenece a la planta del viaje.');
    }
    routeVersion = await versionFor(tx, route.id, input.serviceDate);
    if (!routeVersion) throw new BadRequestError('La ruta todavía no tiene una versión vigente.');
  }

  let startAt: Date;
  let endAt: Date;
  if (input.times) {
    startAt = zonedDateTime(input.serviceDate, input.times.start, timeZone);
    endAt = zonedDateTime(input.serviceDate, input.times.end, timeZone);
    if (endAt <= startAt) endAt = plusMinutes(endAt, 24 * 60);
  } else if (input.plantTime) {
    const minutes = routeVersion?.durationMinutes ?? DEFAULT_EXTRA_MINUTES;
    const atPlant = zonedDateTime(input.serviceDate, input.plantTime, timeZone);
    [startAt, endAt] =
      input.direction === 'inbound'
        ? [plusMinutes(atPlant, -minutes), atPlant]
        : [atPlant, plusMinutes(atPlant, minutes)];
  } else {
    throw new BadRequestError('Indica el horario del viaje.');
  }

  return tx.trip.create({
    data: {
      tenantId,
      plantId: input.plantId,
      routeId: input.routeId ?? null,
      routeVersionId: routeVersion?.id ?? null,
      kind: 'extra',
      direction: input.direction,
      serviceDate: toDbDate(input.serviceDate),
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      extraReason: input.reason,
      requestedPassengers: input.passengers ?? null,
      notes: input.notes ?? null,
      clientRequestId: input.clientRequestId ?? null,
      createdByUserId: userId,
    },
  });
}

/** Cancela a mano un viaje programado (la generación automática no lo reactiva). */
export async function cancelTrip(
  tx: DbTransaction,
  tenantId: string,
  tripId: string,
  reason: string,
) {
  const trip = await tx.trip.findFirst({ where: { id: tripId, tenantId } });
  if (!trip) throw new NotFoundError('No se encontró el viaje.');
  if (trip.status !== 'scheduled') {
    throw new ConflictError(
      trip.status === 'cancelled'
        ? 'El viaje ya está cancelado.'
        : 'El viaje ya empezó o terminó; no se puede cancelar.',
    );
  }
  await tx.trip.update({
    where: { id: tripId },
    data: { status: 'cancelled', cancelReason: reason },
  });
}
