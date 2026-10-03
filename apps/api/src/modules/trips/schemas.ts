import { dateString, optionalText } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { tripSummary } from '../schedule/schemas.ts';

const tripStatus = z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']);
const latLng = {
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
};

/** Campos comunes de toda acción del chofer. */
export const actionFields = {
  ...latLng,
  /** Hora del celular (ISO 8601). */
  occurredAt: z.coerce.date().optional(),
  /** UUID generado por el celular para no duplicar al reenviar. */
  clientEventId: z.uuid().optional(),
};

export const actionBody = z.object(actionFields);

export const driverTripsQuery = z.object({ date: dateString.optional() });

export const tripPhotoParams = z.object({ id: z.uuid(), photoId: z.uuid() });
export const photoKindQuery = z.object({
  kind: z.enum(['checklist', 'incident', 'evidence']).default('evidence'),
});

export const checklistBody = z.object({
  ...actionFields,
  items: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        ok: z.boolean(),
        note: z.string().trim().max(300).optional(),
        photoId: z.uuid().optional(),
      }),
    )
    .min(1, 'Envía el resultado de cada punto del checklist.')
    .max(50),
});

export const arriveStopBody = z.object({ ...actionFields, stopId: z.uuid() });

export const scanBody = z
  .object({
    ...actionFields,
    /** Credencial QR de Shiftlane o gafete (código de barras o QR). */
    code: z.string().trim().min(3).max(1000).optional(),
    codeType: z.enum(['barcode', 'qr']).optional(),
    /** Registro manual si el pasajero no trae credencial. */
    employeeNumber: z.string().trim().min(1).max(40).optional(),
  })
  .refine((body) => (body.code === undefined) !== (body.employeeNumber === undefined), {
    message: 'Escanea un código o escribe el número de empleado.',
  });

export const incidentBody = z.object({
  ...actionFields,
  type: z.enum(['traffic', 'mechanical', 'accident', 'passenger', 'forced_detour', 'other']),
  description: optionalText(1000),
  photoIds: z.array(z.uuid()).max(10).default([]),
});

export const panicBody = z.object({ ...actionFields, tripId: z.uuid().optional() });

export const gateBody = z.object({ ...actionFields, code: z.string().trim().min(3).max(300) });

export const tripState = z.object({
  id: z.uuid(),
  status: tripStatus,
  actualStartAt: z.date().nullable(),
  arrivedAt: z.date().nullable(),
  actualEndAt: z.date().nullable(),
  onboard: z.number().int(),
  capacity: z.number().int().nullable(),
  stopsArrived: z.array(z.uuid()),
  /** La acción ya se había registrado (reenvío del celular). */
  duplicate: z.boolean(),
});

export const checklistResponse = z.object({
  id: z.uuid(),
  passed: z.boolean(),
  failed: z.array(z.string()),
  canStart: z.boolean(),
  duplicate: z.boolean(),
});

export const scanResponse = z.object({
  /** Para el sonido y la vibración del celular. */
  result: z.enum(['ok', 'other_route', 'unregistered', 'already_scanned', 'rejected']),
  message: z.string(),
  passenger: z
    .object({ id: z.uuid(), fullName: z.string(), employeeNumber: z.string() })
    .nullable(),
  provisionalBadgeId: z.uuid().nullable(),
  stop: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  onboard: z.number().int(),
  capacity: z.number().int().nullable(),
  overCapacity: z.boolean(),
  duplicate: z.boolean(),
});

export const incidentResponse = z.object({
  id: z.uuid(),
  status: z.enum(['open', 'resolved']),
  duplicate: z.boolean(),
});

export const panicResponse = z.object({
  id: z.uuid(),
  occurredAt: z.date(),
  duplicate: z.boolean(),
});

export const photoResponse = z.object({
  id: z.uuid(),
  kind: z.enum(['checklist', 'incident', 'evidence']),
  createdAt: z.date(),
});

const checklistItem = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Usa minúsculas, números y guion bajo.'),
  label: z.string().trim().min(2).max(60),
  photoRequired: z.boolean().default(false),
});

export const checklistTemplate = z.object({ items: z.array(checklistItem), custom: z.boolean() });
export const saveTemplateBody = z.object({
  items: z.array(checklistItem).min(1, 'El checklist necesita al menos un punto.').max(30),
});

export const driverTrips = z.object({
  date: z.string(),
  trips: z.array(
    z.object({
      id: z.uuid(),
      status: tripStatus,
      kind: z.enum(['regular', 'extra']),
      direction: z.enum(['inbound', 'outbound']),
      serviceDate: z.string(),
      scheduledStartAt: z.date(),
      scheduledEndAt: z.date(),
      /** Desde cuándo se puede iniciar. */
      canStartFrom: z.date(),
      route: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
      plant: z.object({ id: z.uuid(), name: z.string() }),
      vehicle: z
        .object({ id: z.uuid(), economicNumber: z.string(), capacity: z.number().int() })
        .nullable(),
      expectedPassengers: z.number().int(),
      onboard: z.number().int(),
      checklist: z.object({
        done: z.boolean(),
        passed: z.boolean(),
        exceptionAuthorized: z.boolean(),
      }),
      stops: z.array(
        z.object({
          id: z.uuid(),
          sequence: z.number().int(),
          name: z.string(),
          location: z.object({ lat: z.number(), lng: z.number() }),
          radiusMeters: z.number().int(),
          times: z.array(z.object({ weekdays: z.array(z.number().int()), time: z.string() })),
        }),
      ),
    }),
  ),
});

export const exceptionBody = z.object({
  reason: z.string().trim().min(3, 'Escribe por qué autorizas la salida.').max(300),
});

export const tripDetail = tripSummary.extend({
  actualStartAt: z.date().nullable(),
  actualEndAt: z.date().nullable(),
  arrivedAt: z.date().nullable(),
  arrivalGate: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  checklistException: z.object({ at: z.date(), reason: z.string().nullable() }).nullable(),
  checklist: z
    .object({
      id: z.uuid(),
      passed: z.boolean(),
      submittedAt: z.date(),
      items: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          ok: z.boolean(),
          note: z.string().nullable(),
          photoId: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
  events: z.array(
    z.object({
      id: z.uuid(),
      type: z.string(),
      occurredAt: z.date(),
      receivedAt: z.date(),
      actorType: z.string(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      data: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  boardings: z.array(
    z.object({
      id: z.uuid(),
      passenger: z
        .object({ id: z.uuid(), fullName: z.string(), employeeNumber: z.string() })
        .nullable(),
      provisionalBadgeId: z.uuid().nullable(),
      stop: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      method: z.enum(['shiftlane_qr', 'badge', 'manual']),
      result: z.enum(['ok', 'other_route', 'unregistered']),
      scannedAt: z.date(),
    }),
  ),
  incidents: z.array(
    z.object({
      id: z.uuid(),
      type: z.string(),
      description: z.string().nullable(),
      photoIds: z.array(z.string()),
      occurredAt: z.date(),
      status: z.enum(['open', 'resolved']),
      resolution: z.string().nullable(),
    }),
  ),
  photos: z.array(photoResponse),
});

export const incidentsQuery = z.object({ status: z.enum(['open', 'resolved']).optional() });
export const incidentSummary = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  routeCode: z.string().nullable(),
  driver: z.object({ id: z.uuid(), fullName: z.string() }).nullable(),
  type: z.string(),
  description: z.string().nullable(),
  photoIds: z.array(z.string()),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  occurredAt: z.date(),
  status: z.enum(['open', 'resolved']),
  resolution: z.string().nullable(),
  resolvedAt: z.date().nullable(),
});
export const resolveIncidentBody = z.object({
  resolution: z.string().trim().min(3, 'Escribe qué se hizo para resolverlo.').max(1000),
});

export const panicsQuery = z.object({ pending: z.stringbool().optional() });
export const panicSummary = z.object({
  id: z.uuid(),
  driver: z.object({ id: z.uuid(), fullName: z.string() }),
  tripId: z.uuid().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  occurredAt: z.date(),
  acknowledgedAt: z.date().nullable(),
});

// --- Posiciones GPS --------------------------------------------------------------------

export const MAX_POSITIONS = 2000;

export const positionsBody = z.object({
  /** Hora del celular al enviar: corrige el desfase de su reloj. */
  sentAt: z.coerce.date(),
  points: z
    .array(
      z.object({
        tripId: z.uuid(),
        recordedAt: z.coerce.date(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        speedKmh: z.number().min(0).max(300).optional(),
        heading: z.number().min(0).max(360).optional(),
        accuracyM: z.number().min(0).max(10_000).optional(),
        battery: z.number().int().min(0).max(100).optional(),
      }),
    )
    .min(1, 'El lote no trae posiciones.')
    .max(MAX_POSITIONS, `Envía como máximo ${MAX_POSITIONS} posiciones por lote.`),
});

const etaSchema = z
  .object({
    stops: z.array(z.object({ stopId: z.uuid(), eta: z.string(), distanceMeters: z.number() })),
    destination: z.object({ eta: z.string(), distanceMeters: z.number() }).nullable(),
    /** Minutos de retraso (negativo: adelanto) contra la llegada programada. */
    delayMinutes: z.number().int().nullable(),
  })
  .nullable();

export const positionsResponse = z.object({
  receivedAt: z.date(),
  clockOffsetMs: z.number().int(),
  accepted: z.number().int(),
  duplicates: z.number().int(),
  rejected: z.object({
    /** El viaje no existe o no es del chofer. */
    trip_not_found: z.number().int(),
    /** Fuera del viaje: la ubicación solo se guarda entre el inicio y el fin. */
    outside_trip: z.number().int(),
  }),
  trips: z.array(
    z.object({
      tripId: z.uuid(),
      autoArrivals: z.array(z.object({ stopId: z.uuid(), stopName: z.string(), at: z.date() })),
      eta: etaSchema,
    }),
  ),
});

export const historyQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(20_000).default(5_000),
});

export const historyResponse = z.array(
  z.object({
    recordedAt: z.date(),
    lat: z.number(),
    lng: z.number(),
    speedKmh: z.number().nullable(),
    heading: z.number().nullable(),
    accuracyM: z.number().nullable(),
  }),
);

export const livePosition = z.object({
  tripId: z.uuid(),
  plantId: z.uuid(),
  routeId: z.uuid().nullable(),
  driverId: z.uuid(),
  vehicleId: z.uuid().nullable(),
  lat: z.number(),
  lng: z.number(),
  speedKmh: z.number().nullable(),
  heading: z.number().nullable(),
  recordedAt: z.string(),
  eta: etaSchema,
});
