import { dateString } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';

export const MAX_GENERATION_DAYS = 62;
export const MAX_LIST_DAYS = 62;

export const generateBody = z
  .object({ from: dateString, to: dateString })
  .refine((body) => body.from <= body.to, {
    message: 'La fecha final no puede ser anterior a la inicial.',
    path: ['to'],
  });

export const generationResult = z.object({
  from: z.string(),
  to: z.string(),
  created: z.number().int(),
  updated: z.number().int(),
  cancelled: z.number().int(),
  unchanged: z.number().int(),
});

export const tripStatusSchema = z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']);
export const tripKindSchema = z.enum(['regular', 'extra']);

export const listTripsQuery = z
  .object({
    /** Por omisión, hoy. */
    from: dateString.optional(),
    /** Por omisión, seis días después de from (una semana). */
    to: dateString.optional(),
    plantId: z.uuid().optional(),
    routeId: z.uuid().optional(),
    status: tripStatusSchema.optional(),
    kind: tripKindSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'La fecha final no puede ser anterior a la inicial.',
    path: ['to'],
  });

export const tripSummary = z.object({
  id: z.uuid(),
  plantId: z.uuid(),
  plantName: z.string().nullable(),
  routeId: z.uuid().nullable(),
  routeCode: z.string().nullable(),
  routeName: z.string().nullable(),
  routeVersionId: z.uuid().nullable(),
  shiftId: z.uuid().nullable(),
  shiftName: z.string().nullable(),
  temporaryChangeId: z.uuid().nullable(),
  kind: tripKindSchema,
  status: tripStatusSchema,
  direction: z.enum(['inbound', 'outbound']),
  serviceDate: z.string(),
  scheduledStartAt: z.iso.datetime(),
  scheduledEndAt: z.iso.datetime(),
  isHoliday: z.boolean(),
  cancelReason: z.string().nullable(),
});

export const tripPage = z.object({
  from: z.string(),
  to: z.string(),
  items: z.array(tripSummary),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

// --- Días festivos -------------------------------------------------------------------

export const listHolidaysQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  plantId: z.uuid().optional(),
});

export const createHolidayBody = z.object({
  date: dateString,
  name: z.string().trim().min(2, 'Escribe el nombre del día festivo.').max(80),
  /** Nulo u omitido: aplica a todas las plantas. */
  plantId: z.uuid().nullable().optional(),
  /** true: hay servicio y se marca como festivo; false: no se programan viajes. */
  serviceRuns: z.boolean().default(true),
});

export const updateHolidayBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    serviceRuns: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const importOfficialBody = z.object({
  year: z.number().int().min(2000).max(2100),
  /** Por omisión hay servicio y los viajes se marcan como festivos. */
  serviceRuns: z.boolean().default(true),
});

export const holidaySummary = z.object({
  id: z.uuid(),
  plantId: z.uuid().nullable(),
  date: z.string(),
  name: z.string(),
  serviceRuns: z.boolean(),
});

export const importOfficialResult = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  holidays: z.array(holidaySummary),
});
