import { optionalText } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';
import { ALERT_TYPES } from './rules.ts';

export const alertTypeSchema = z.enum(ALERT_TYPES);
const severity = z.enum(['info', 'warning', 'critical']);
const status = z.enum(['open', 'acknowledged', 'resolved']);

export const alertSummary = z.object({
  id: z.uuid(),
  type: alertTypeSchema,
  typeLabel: z.string(),
  severity,
  status,
  cause: z.string(),
  suggestedAction: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  tripId: z.uuid().nullable(),
  plantId: z.uuid().nullable(),
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  notifyPlant: z.boolean(),
  openedAt: z.date(),
  acknowledgedAt: z.date().nullable(),
  resolvedAt: z.date().nullable(),
  escalatedAt: z.date().nullable(),
  autoResolved: z.boolean(),
  resolution: z.string().nullable(),
  minutesToAcknowledge: z.number().int().nullable(),
  minutesToResolve: z.number().int().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
});

export const alertDetail = alertSummary.extend({
  actions: z.array(
    z.object({
      action: z.string(),
      userId: z.uuid().nullable(),
      note: z.string().nullable(),
      at: z.date(),
    }),
  ),
});

export const listAlertsQuery = z.object({
  status: status.optional(),
  type: alertTypeSchema.optional(),
  tripId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const acknowledgeBody = z.object({ note: optionalText(500) });
export const resolveBody = z.object({
  resolution: z.string().trim().min(3, 'Escribe qué se hizo para resolverla.').max(1000),
});
export const noteBody = z.object({ note: z.string().trim().min(1, 'Escribe la nota.').max(1000) });

export const ruleSchema = z.object({
  type: alertTypeSchema,
  label: z.string(),
  enabled: z.boolean(),
  severity,
  params: z.record(z.string(), z.unknown()),
  escalateAfterMinutes: z.number().int(),
  notifyPlant: z.boolean(),
  custom: z.boolean(),
});

export const ruleParams = z.object({ type: alertTypeSchema });
export const saveRuleBody = z
  .object({
    enabled: z.boolean().optional(),
    severity: severity.optional(),
    /** Umbrales del tipo (minutos, metros, km/h); se combinan con los actuales. */
    params: z.record(z.string(), z.unknown()).optional(),
    escalateAfterMinutes: z.number().int().min(1).max(1440).optional(),
    notifyPlant: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });
