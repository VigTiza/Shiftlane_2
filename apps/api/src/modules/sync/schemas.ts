import { z } from '../../lib/zod.ts';
import {
  actionBody,
  arriveStopBody,
  checklistBody,
  gateBody,
  incidentBody,
  panicBody,
  scanBody,
} from '../trips/schemas.ts';

export const MAX_BATCH_EVENTS = 1000;

export const SYNC_EVENT_TYPES = [
  'checklist',
  'start',
  'stop_arrived',
  'scan',
  'incident',
  'panic',
  'gate',
  'finish',
] as const;
export type SyncEventType = (typeof SYNC_EVENT_TYPES)[number];

/**
 * Sobre de cada evento. Los datos propios de cada tipo se validan uno por uno al procesar,
 * para que un evento mal formado no rechace el lote completo.
 */
export const syncEvent = z.object({
  /** UUID que generó el celular para este evento. */
  id: z.uuid(),
  type: z.string().trim().min(1).max(40),
  /** Contador del celular: define el orden en que ocurrieron. */
  sequence: z.number().int().min(0).optional(),
  /** Hora del celular cuando ocurrió (se corrige con el desfase de su reloj). */
  occurredAt: z.coerce.date(),
  tripId: z.uuid().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type SyncEvent = z.infer<typeof syncEvent>;

export const syncBatchBody = z.object({
  /** Hora del celular al enviar el lote: con la hora del servidor da el desfase de su reloj. */
  sentAt: z.coerce.date(),
  events: z
    .array(syncEvent)
    .min(1, 'El lote no trae eventos.')
    .max(MAX_BATCH_EVENTS, `Envía como máximo ${MAX_BATCH_EVENTS} eventos por lote.`),
});

const withoutAction = { lat: true, lng: true, occurredAt: true, clientEventId: true } as const;

/** Datos de cada tipo de evento (sin hora ni UUID: vienen en el sobre). */
export const SYNC_DATA = {
  checklist: checklistBody.omit(withoutAction),
  start: actionBody.pick({ lat: true, lng: true }),
  stop_arrived: arriveStopBody.omit({ occurredAt: true, clientEventId: true }),
  scan: scanBody,
  incident: incidentBody.omit({ occurredAt: true, clientEventId: true }),
  panic: panicBody.omit({ occurredAt: true, clientEventId: true, tripId: true }),
  gate: gateBody.omit({ occurredAt: true, clientEventId: true }),
  finish: actionBody.pick({ lat: true, lng: true }),
} satisfies Record<SyncEventType, z.ZodType>;

export const syncResult = z.object({
  id: z.uuid(),
  type: z.string(),
  /**
   * applied: se aplicó; duplicate: ya se había recibido; rejected: no se puede aplicar (no
   * reenviar); retry: todavía no se puede (por ejemplo, falta el inicio del viaje): reenviar.
   */
  status: z.enum(['applied', 'duplicate', 'rejected', 'retry']),
  message: z.string().nullable(),
  result: z.unknown().nullable(),
});

export const syncBatchResponse = z.object({
  receivedAt: z.date(),
  /** Hora del servidor menos hora del celular (0 si la diferencia es menor a 2 segundos). */
  clockOffsetMs: z.number().int(),
  summary: z.object({
    applied: z.number().int(),
    duplicate: z.number().int(),
    rejected: z.number().int(),
    retry: z.number().int(),
  }),
  results: z.array(syncResult),
});
