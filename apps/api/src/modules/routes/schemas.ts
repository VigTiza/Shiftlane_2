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
  /** Identidad de una parada existente (para conservarla entre versiones). */
  stopKey: z.uuid().optional(),
  name: z.string().trim().min(2, 'Escribe el nombre de la parada.').max(120),
  address: optionalText(300),
  location: latLng,
  radiusMeters: z.number().int().min(10).max(1000).default(80),
  notes: optionalText(500),
  times: z.array(stopTimeInput).min(1, 'Cada parada necesita su horario.').max(8),
});

const versionFields = {
  /** Trazo como [lng, lat] (orden GeoJSON). Si no se envía, se calcula por calles. */
  path: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .max(5000)
    .optional(),
  stops: z.array(stopInput).min(1, 'La ruta necesita al menos una parada.').max(80),
  notes: optionalText(1000),
};

function checkStopOrder(
  version: { stops: { times: { weekdays: number[]; time: string }[] }[] },
  ctx: z.RefinementCtx,
) {
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
}

/** Paradas, horarios y trazo de una versión sin fecha (cambios temporales y simulación). */
export const versionContent = z.object(versionFields).superRefine(checkStopOrder);

export const versionInput = z
  .object({ validFrom: dateString, ...versionFields })
  .superRefine(checkStopOrder);

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
  /** osrm (por calles), straight_line (respaldo) o manual (trazo dibujado). */
  routingSource: z.string().nullable(),
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
      versionId: z.uuid().nullable(),
      suspendsService: z.boolean(),
      startsOn: z.string(),
      endsOn: z.string(),
      reason: z.string(),
      cancelled: z.boolean(),
    }),
  ),
});

const latLngQuery = {
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
};

export const nearestStopQuery = z.object({
  ...latLngQuery,
  maxMeters: z.coerce.number().int().min(5).max(5000).optional(),
});
export const distanceToPathQuery = z.object({
  ...latLngQuery,
  thresholdMeters: z.coerce.number().int().min(10).max(5000).optional(),
});
export const previewBody = z.object({
  points: z.array(latLng).min(2, 'Indica al menos dos puntos.').max(80),
});

export const nearestStopResponse = z.object({
  stop: z.object({ id: z.uuid(), name: z.string(), sequence: z.number().int() }).nullable(),
  distanceMeters: z.number().nullable(),
});
export const distanceToPathResponse = z.object({
  distanceMeters: z.number(),
  thresholdMeters: z.number(),
  offRoute: z.boolean(),
});
export const previewResponse = z.object({
  distanceKm: z.number(),
  durationMinutes: z.number().int(),
  path: z.array(z.tuple([z.number(), z.number()])),
  source: z.enum(['osrm', 'straight_line']),
});

export const temporaryChangeSummary = z.object({
  id: z.uuid(),
  versionId: z.uuid().nullable(),
  suspendsService: z.boolean(),
  startsOn: z.string(),
  endsOn: z.string(),
  reason: z.string(),
  cancelled: z.boolean(),
});

export const createTemporaryChangeBody = z
  .object({
    startsOn: dateString,
    endsOn: dateString,
    reason: z.string().trim().min(5, 'Explica el motivo del cambio.').max(300),
    suspendService: z.boolean().default(false),
    version: versionContent.optional(),
  })
  .refine((body) => body.endsOn >= body.startsOn, {
    message: 'La fecha de fin no puede ser anterior a la de inicio.',
    path: ['endsOn'],
  });

export const simulateBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('temporary'),
    startsOn: dateString,
    endsOn: dateString,
    suspendService: z.boolean().default(false),
    version: versionContent.optional(),
  }),
  z.object({ kind: z.literal('version'), validFrom: dateString, version: versionContent }),
]);

const stopRef = z.object({ stopKey: z.uuid(), name: z.string() });

export const simulationResponse = z.object({
  period: z.object({
    from: z.string(),
    to: z.string().nullable(),
    days: z.number().int().nullable(),
  }),
  suspended: z.boolean(),
  stops: z.object({
    added: z.array(z.object({ name: z.string() })),
    removed: z.array(stopRef),
    moved: z.array(stopRef.extend({ distanceMeters: z.number() })),
    retimed: z.array(stopRef.extend({ from: z.string().nullable(), to: z.string().nullable() })),
  }),
  distanceKm: z.object({ from: z.number().nullable(), to: z.number().nullable() }),
  durationMinutes: z.object({ from: z.number().nullable(), to: z.number().nullable() }),
  passengers: z.array(
    z.object({
      id: z.uuid(),
      fullName: z.string(),
      employeeNumber: z.string(),
      stopName: z.string().nullable(),
      reason: z.enum(['service_suspended', 'stop_removed', 'stop_moved', 'time_changed']),
    }),
  ),
  trips: z.array(z.object({ id: z.uuid(), date: z.string(), driverName: z.string().nullable() })),
  drivers: z.array(z.object({ id: z.uuid(), fullName: z.string() })),
});

export const routePassengersBody = z.object({
  assignments: z.array(z.object({ passengerId: z.uuid(), stopKey: z.uuid() })).max(500),
});

export const routePassengersResponse = z.array(
  z.object({
    passengerId: z.uuid(),
    fullName: z.string(),
    employeeNumber: z.string(),
    status: z.enum(['active', 'inactive']),
    stopKey: z.uuid(),
    stopName: z.string().nullable(),
  }),
);

export const effectiveResponse = z.object({
  date: z.string(),
  temporaryChangeId: z.uuid().nullable(),
  /** Un cambio temporal suspende el servicio ese día. */
  suspended: z.boolean(),
  version: versionDetail.nullable(),
});
