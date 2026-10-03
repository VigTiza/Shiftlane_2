import {
  CLIENT_REQUEST_STATUSES,
  CLIENT_REQUEST_TYPES,
  EXTRA_TRIP_REASONS,
} from '@shiftlane/shared';

import { dateString, optionalText, paginated, paginationQuery } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { conflictSchema, timeSchema } from '../schedule/schemas.ts';

export const requestTypeSchema = z.enum(CLIENT_REQUEST_TYPES);
export const requestStatusSchema = z.enum(CLIENT_REQUEST_STATUSES);
const directionSchema = z.enum(['inbound', 'outbound']);

export const createRequestBody = z
  .object({
    /** Transportista a la que se dirige; si la planta tiene una sola, se toma esa. */
    carrierId: z.uuid().optional(),
    plantId: z.uuid(),
    type: requestTypeSchema,
    /** Por omisión, el tipo de solicitud y la fecha. */
    title: z.string().trim().min(3, 'Escribe un título más descriptivo.').max(120).optional(),
    description: optionalText(2000),
    serviceDate: dateString.optional(),
    direction: directionSchema.optional(),
    /** Hora en planta: llegada si el viaje es de entrada, salida si es de salida. */
    plantTime: timeSchema.optional(),
    passengers: z.number().int().min(1).max(500).optional(),
    routeId: z.uuid().optional(),
    extraReason: z.enum(EXTRA_TRIP_REASONS).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.type !== 'extra_trip') return;
    const required = {
      serviceDate: 'la fecha',
      direction: 'el sentido',
      plantTime: 'la hora en planta',
    };
    for (const [key, label] of Object.entries(required)) {
      if (body[key as keyof typeof required] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: `Indica ${label} del viaje extra.` });
      }
    }
    if (body.passengers === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['passengers'],
        message: 'Indica cuántos pasajeros viajarán.',
      });
    }
  });

export const listRequestsQuery = z.object({
  ...paginationQuery,
  status: requestStatusSchema.optional(),
  type: requestTypeSchema.optional(),
  plantId: z.uuid().optional(),
});

export const approveRequestBody = z
  .object({
    response: optionalText(1000),
    /** Viaje extra: horario HH:MM (por omisión, se calcula con la hora en planta y la ruta). */
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    driverId: z.uuid().nullable().optional(),
    vehicleId: z.uuid().nullable().optional(),
    /** Confirma la asignación aunque tenga conflictos que bloquean. */
    force: z.boolean().default(false),
  })
  .refine((body) => (body.startTime === undefined) === (body.endTime === undefined), {
    message: 'Indica la hora de salida y la de llegada, o ninguna.',
    path: ['endTime'],
  });

export const rejectRequestBody = z.object({
  response: z.string().trim().min(3, 'Explica a la planta por qué se rechaza.').max(1000),
});

export const requestSummary = z.object({
  id: z.uuid(),
  carrier: z.object({ id: z.uuid(), name: z.string() }),
  clientOrgId: z.uuid(),
  plant: z.object({ id: z.uuid(), name: z.string() }),
  type: requestTypeSchema,
  status: requestStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  serviceDate: z.string().nullable(),
  direction: directionSchema.nullable(),
  plantTime: z.string().nullable(),
  passengers: z.number().int().nullable(),
  route: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
  extraReason: z.enum(EXTRA_TRIP_REASONS).nullable(),
  response: z.string().nullable(),
  respondedAt: z.date().nullable(),
  createdAt: z.date(),
  trips: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']),
      serviceDate: z.string(),
      scheduledStartAt: z.date(),
      scheduledEndAt: z.date(),
    }),
  ),
});

export const requestPage = paginated(requestSummary);

export const approveResponse = z.object({
  request: requestSummary,
  /** Conflictos de la asignación del viaje creado (avisos o los confirmados con force). */
  conflicts: z.array(conflictSchema),
});

export const carrierSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  plants: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
