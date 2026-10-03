import { dateString } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { CONFLICT_TYPES } from './conflicts.ts';

export const MAX_GENERATION_DAYS = 62;
export const MAX_LIST_DAYS = 62;
export const MAX_CONFLICT_DAYS = 31;

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
  /** Viajes a los que se asignaron chofer y unidad habituales. */
  assigned: z.number().int(),
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
  driverId: z.uuid().nullable(),
  driverName: z.string().nullable(),
  vehicleId: z.uuid().nullable(),
  vehicleNumber: z.string().nullable(),
  /** habitual (programación), manual (usuario) o copied (semana anterior). */
  assignmentSource: z.enum(['habitual', 'manual', 'copied']).nullable(),
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

// --- Asignación y conflictos -------------------------------------------------------------

export const assignmentBody = z
  .object({
    /** null quita el chofer; omitido lo conserva. */
    driverId: z.uuid().nullable().optional(),
    vehicleId: z.uuid().nullable().optional(),
    /** Confirma la asignación aunque tenga conflictos que bloquean. */
    force: z.boolean().default(false),
  })
  .refine((body) => body.driverId !== undefined || body.vehicleId !== undefined, {
    message: 'Indica el chofer o la unidad.',
  });

const severitySchema = z.enum(['error', 'warning']);

export const conflictSchema = z.object({
  tripId: z.uuid(),
  type: z.enum(CONFLICT_TYPES),
  severity: severitySchema,
  message: z.string(),
  otherTripId: z.uuid().optional(),
  suggestion: z
    .object({
      message: z.string(),
      options: z.array(
        z.object({ kind: z.enum(['driver', 'vehicle']), id: z.uuid(), label: z.string() }),
      ),
    })
    .optional(),
});

export const assignmentResponse = z.object({
  trip: tripSummary,
  conflicts: z.array(conflictSchema),
});

export const conflictsQuery = z
  .object({
    /** Por omisión, hoy y los seis días siguientes. */
    from: dateString.optional(),
    to: dateString.optional(),
    plantId: z.uuid().optional(),
    routeId: z.uuid().optional(),
    severity: severitySchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'La fecha final no puede ser anterior a la inicial.',
    path: ['to'],
  });

export const conflictsResponse = z.object({
  from: z.string(),
  to: z.string(),
  total: z.number().int(),
  errors: z.number().int(),
  items: z.array(
    conflictSchema.extend({
      plantId: z.uuid(),
      routeId: z.uuid().nullable(),
      routeCode: z.string().nullable(),
      serviceDate: z.string(),
      scheduledStartAt: z.iso.datetime(),
    }),
  ),
});

export const autoAssignBody = z
  .object({
    from: dateString,
    to: dateString,
    plantId: z.uuid().optional(),
    routeId: z.uuid().optional(),
  })
  .refine((body) => body.from <= body.to, {
    message: 'La fecha final no puede ser anterior a la inicial.',
    path: ['to'],
  });

const skippedAssignment = z.object({
  tripId: z.uuid(),
  routeCode: z.string().nullable(),
  serviceDate: z.string(),
  reasons: z.array(z.string()),
});

export const autoAssignResponse = z.object({
  assigned: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.array(skippedAssignment),
});

const monday = dateString.refine(
  (date) => new Date(`${date}T12:00:00Z`).getUTCDay() === 1,
  'La semana debe empezar en lunes.',
);

export const copyWeekBody = z.object({
  sourceWeekStart: monday,
  /** Por omisión, la semana siguiente a la de origen. */
  targetWeekStart: monday.optional(),
  plantId: z.uuid().optional(),
  routeId: z.uuid().optional(),
  /** Reemplaza también las asignaciones manuales de la semana destino. */
  overwrite: z.boolean().default(false),
});

export const copyWeekResponse = z.object({
  sourceWeekStart: z.string(),
  targetWeekStart: z.string(),
  /** Viajes que se generaron en la semana destino antes de copiar. */
  generated: z.number().int(),
  copied: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.array(skippedAssignment),
});
