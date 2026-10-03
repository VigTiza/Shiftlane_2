import { PENALTY_TYPES, RATE_BASES } from '@shiftlane/shared';

import { dateString, optionalText } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato de 24 horas HH:MM.');
const money = z
  .number()
  .min(0, 'El monto no puede ser negativo.')
  .max(10_000_000)
  .multipleOf(0.01, 'Usa máximo dos decimales.');

export const contractStatus = z.enum(['draft', 'active', 'ended']);

export const listContractsQuery = z.object({
  clientOrgId: z.uuid().optional(),
  status: contractStatus.optional(),
});

export const createContractBody = z
  .object({
    clientOrgId: z.uuid(),
    plantId: z.uuid().nullable().optional(),
    name: z.string().trim().min(3, 'Escribe el nombre del contrato.').max(120),
    number: optionalText(60),
    status: contractStatus.default('draft'),
    startsOn: dateString,
    endsOn: dateString.nullable().optional(),
    notes: optionalText(2000),
  })
  .refine((body) => !body.endsOn || body.endsOn >= body.startsOn, {
    message: 'La fecha de fin no puede ser anterior a la de inicio.',
    path: ['endsOn'],
  });

export const updateContractBody = z
  .object({
    plantId: z.uuid().nullable().optional(),
    name: z.string().trim().min(3).max(120).optional(),
    number: optionalText(60),
    status: contractStatus.optional(),
    startsOn: dateString.optional(),
    endsOn: dateString.nullable().optional(),
    notes: optionalText(2000),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

const rateFields = {
  name: optionalText(80),
  basis: z.enum(RATE_BASES),
  amount: money,
  routeId: z.uuid().nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startTime: time.nullable().optional(),
  endTime: time.nullable().optional(),
  holidays: z.boolean().nullable().optional(),
  minCapacity: z.number().int().min(1).max(120).nullable().optional(),
  maxCapacity: z.number().int().min(1).max(120).nullable().optional(),
  validFrom: dateString.nullable().optional(),
  validTo: dateString.nullable().optional(),
  minimumCharge: money.nullable().optional(),
  priority: z.number().int().min(-100).max(100).default(0),
};

function checkRate<T extends z.ZodType<Record<string, unknown>>>(schema: T) {
  return schema.superRefine((body, ctx) => {
    const value = body as Record<string, unknown>;
    if (Boolean(value.startTime) !== Boolean(value.endTime)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'Indica hora de inicio y de fin del horario.',
      });
    }
    if (value.basis === 'per_route' && !value.routeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['routeId'],
        message: 'Una tarifa por ruta necesita la ruta.',
      });
    }
    const min = value.minCapacity as number | null | undefined;
    const max = value.maxCapacity as number | null | undefined;
    if (min && max && min > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxCapacity'],
        message: 'La capacidad máxima no puede ser menor a la mínima.',
      });
    }
    const from = value.validFrom as string | null | undefined;
    const to = value.validTo as string | null | undefined;
    if (from && to && from > to) {
      ctx.addIssue({
        code: 'custom',
        path: ['validTo'],
        message: 'La vigencia termina antes de empezar.',
      });
    }
  });
}

export const createRateBody = checkRate(z.object(rateFields));
export const updateRateBody = checkRate(
  z
    .object(rateFields)
    .partial()
    .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' }),
);

export const createPenaltyBody = z
  .object({
    type: z.enum(PENALTY_TYPES),
    description: optionalText(300),
    amountType: z.enum(['fixed', 'percent']),
    amount: money,
    graceMinutes: z.number().int().min(0).max(240).nullable().optional(),
  })
  .refine((body) => body.amountType !== 'percent' || body.amount <= 100, {
    message: 'El porcentaje no puede ser mayor a 100.',
    path: ['amount'],
  });

export const updatePenaltyBody = z
  .object({
    description: optionalText(300),
    amountType: z.enum(['fixed', 'percent']).optional(),
    amount: money.optional(),
    graceMinutes: z.number().int().min(0).max(240).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const quoteBody = z.object({
  date: dateString,
  time,
  routeId: z.uuid().nullable().optional(),
  distanceKm: z.number().min(0).max(2000).nullable().optional(),
  passengers: z.number().int().min(0).max(200).nullable().optional(),
  vehicleCapacity: z.number().int().min(1).max(120).nullable().optional(),
  isHoliday: z.boolean().default(false),
  outcome: z
    .object({
      status: z.enum(['completed', 'incomplete', 'missed', 'cancelled']),
      delayMinutes: z.number().int().min(-600).max(1440).nullable().optional(),
    })
    .default({ status: 'completed' }),
});

// --- Respuestas -------------------------------------------------------------

export const rateSummary = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  basis: z.enum(RATE_BASES),
  amount: z.number(),
  routeId: z.uuid().nullable(),
  weekdays: z.array(z.number().int()),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  holidays: z.boolean().nullable(),
  minCapacity: z.number().int().nullable(),
  maxCapacity: z.number().int().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  minimumCharge: z.number().nullable(),
  priority: z.number().int(),
});

export const penaltySummary = z.object({
  id: z.uuid(),
  type: z.enum(PENALTY_TYPES),
  description: z.string().nullable(),
  amountType: z.enum(['fixed', 'percent']),
  amount: z.number(),
  graceMinutes: z.number().int().nullable(),
});

export const contractSummary = z.object({
  id: z.uuid(),
  clientOrgId: z.uuid(),
  clientOrgName: z.string(),
  plantId: z.uuid().nullable(),
  name: z.string(),
  number: z.string().nullable(),
  status: contractStatus,
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  notes: z.string().nullable(),
});

export const contractDetail = contractSummary.extend({
  rates: z.array(rateSummary),
  penalties: z.array(penaltySummary),
});

export const quoteResponse = z.object({
  /** La tarifa que aplicó, o null si ninguna aplica al viaje. */
  rate: rateSummary.nullable(),
  quantity: z.number(),
  minimumApplied: z.boolean(),
  /** Precio de la tarifa antes de considerar cómo terminó el viaje. */
  price: z.number(),
  /** Lo que se cobra por el servicio según el resultado del viaje. */
  base: z.number(),
  penalties: z.array(
    z.object({ penaltyId: z.uuid(), type: z.enum(PENALTY_TYPES), amount: z.number() }),
  ),
  total: z.number(),
});
