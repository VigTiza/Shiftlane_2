import { dateString, optionalText } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato de 24 horas HH:MM.');
const latLng = z.object({
  lat: z
    .number()
    .min(14, 'La latitud está fuera de México.')
    .max(33, 'La latitud está fuera de México.'),
  lng: z
    .number()
    .min(-119, 'La longitud está fuera de México.')
    .max(-86, 'La longitud está fuera de México.'),
});

export const directionSchema = z.enum(['inbound', 'outbound']);

// --- Turnos -----------------------------------------------------------------------

export const listShiftsQuery = z.object({ plantId: z.uuid().optional() });

export const createShiftBody = z.object({
  plantId: z.uuid(),
  name: z.string().trim().min(2, 'Escribe el nombre del turno.').max(60),
  startsAt: time,
  endsAt: time,
});

export const updateShiftBody = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    startsAt: time.optional(),
    endsAt: time.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const shiftSummary = z.object({
  id: z.uuid(),
  plantId: z.uuid(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  active: z.boolean(),
});

// --- Versiones y paradas -------------------------------------------------------------

export const stopTimeInput = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  time,
});

export const stopInput = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la parada.').max(120),
  address: optionalText(300),
  location: latLng,
  radiusMeters: z.number().int().min(10).max(1000).default(80),
  notes: optionalText(500),
  times: z.array(stopTimeInput).min(1, 'Cada parada necesita su horario.').max(8),
});

export const versionInput = z
  .object({
    validFrom: dateString,
    /** Trazo como [lng, lat] (orden GeoJSON). Si no se envía, se une la secuencia de paradas. */
    path: z
      .array(z.tuple([z.number(), z.number()]))
      .min(2)
      .max(5000)
      .optional(),
    stops: z.array(stopInput).min(1, 'La ruta necesita al menos una parada.').max(80),
    notes: optionalText(1000),
  })
  .superRefine((version, ctx) => {
    // Los horarios generales deben ir en orden a lo largo de la ruta.
    let previous: string | null = null;
    version.stops.forEach((stop, index) => {
      const general = stop.times.find((t) => t.weekdays.length === 0)?.time;
      if (!general) return;
      if (previous && general < previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['stops', index, 'times'],
          message: `La parada ${index + 1} tiene un horario anterior a la parada previa.`,
        });
      }
      previous = general;
    });
  });

export const createRouteBody = z.object({
  plantId: z.uuid(),
  shiftId: z.uuid().nullable().optional(),
  code: z.string().trim().min(1, 'Escribe la clave de la ruta.').max(20),
  name: z.string().trim().min(2, 'Escribe el nombre de la ruta.').max(120),
  direction: directionSchema,
  notes: optionalText(1000),
  version: versionInput,
});

export const updateRouteBody = z
  .object({
    shiftId: z.uuid().nullable().optional(),
    code: z.string().trim().min(1).max(20).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    direction: directionSchema.optional(),
    active: z.boolean().optional(),
    notes: optionalText(1000),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const listRoutesQuery = z.object({
  plantId: z.uuid().optional(),
  direction: directionSchema.optional(),
  search: z.string().trim().max(60).optional(),
  active: z.stringbool().optional(),
});

export const restoreBody = z.object({ validFrom: dateString });
export const effectiveQuery = z.object({ date: dateString.optional() });
export const routeVersionParams = z.object({ id: z.uuid(), versionId: z.uuid() });

// --- Respuestas ------------------------------------------------------------------

export const stopOutput = z.object({
  id: z.uuid(),
  stopKey: z.uuid(),
  sequence: z.number().int(),
  name: z.string(),
  address: z.string().nullable(),
  location: z.object({ lat: z.number(), lng: z.number() }),
  radiusMeters: z.number().int(),
  notes: z.string().nullable(),
  times: z.array(z.object({ weekdays: z.array(z.number().int()), time: z.string() })),
});

export const versionSummary = z.object({
  id: z.uuid(),
  number: z.number().int(),
  kind: z.enum(['regular', 'temporary']),
  validFrom: z.string(),
  distanceKm: z.number().nullable(),
  durationMinutes: z.number().int().nullable(),
  stopsCount: z.number().int(),
  basedOnId: z.uuid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.date(),
  /** Es la versión regular vigente hoy. */
  current: z.boolean(),
});

export const versionDetail = versionSummary.extend({
  path: z.array(z.tuple([z.number(), z.number()])).nullable(),
  stops: z.array(stopOutput),
});

export const routeSummary = z.object({
  id: z.uuid(),
  plantId: z.uuid(),
  shiftId: z.uuid().nullable(),
  code: z.string(),
  name: z.string(),
  direction: directionSchema,
  active: z.boolean(),
  notes: z.string().nullable(),
  current: versionSummary.nullable(),
});

export const routeDetail = routeSummary.extend({
  versions: z.array(versionSummary),
  temporaryChanges: z.array(
    z.object({
      id: z.uuid(),
      versionId: z.uuid(),
      startsOn: z.string(),
      endsOn: z.string(),
      reason: z.string(),
      cancelled: z.boolean(),
    }),
  ),
});

export const effectiveResponse = z.object({
  date: z.string(),
  temporaryChangeId: z.uuid().nullable(),
  version: versionDetail.nullable(),
});
