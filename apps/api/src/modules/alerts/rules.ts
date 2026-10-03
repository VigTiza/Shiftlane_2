import type { DbClient, DbTransaction } from '../../lib/db.ts';
import { z } from '../../lib/zod.ts';

export const ALERT_TYPES = [
  'trip_not_started',
  'delay',
  'off_route',
  'speeding',
  'unscheduled_stop',
  'overcapacity',
  'panic',
  'checklist_failed',
  'device_silent',
  'expired_documents_on_assign',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertSeverity = 'info' | 'warning' | 'critical';

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  trip_not_started: 'Viaje no iniciado',
  delay: 'Retraso',
  off_route: 'Desvío',
  speeding: 'Exceso de velocidad',
  unscheduled_stop: 'Parada no programada',
  overcapacity: 'Sobrecupo',
  panic: 'Pánico',
  checklist_failed: 'Falla de checklist',
  device_silent: 'Unidad sin reportar',
  expired_documents_on_assign: 'Documento vencido al asignar',
};

const minutes = (fallback: number) => z.number().int().min(1).max(240).default(fallback);

/** Umbrales de cada tipo de alerta, con sus valores por omisión. */
export const RULE_PARAMS = {
  trip_not_started: z.object({ toleranceMinutes: minutes(5) }),
  delay: z.object({ toleranceMinutes: minutes(10) }),
  off_route: z.object({ thresholdMeters: z.number().int().min(30).max(5000).default(150) }),
  speeding: z.object({ limitKmh: z.number().int().min(20).max(160).default(80) }),
  unscheduled_stop: z.object({
    minutes: minutes(5),
    radiusMeters: z.number().int().min(10).max(500).default(50),
  }),
  overcapacity: z.object({}),
  panic: z.object({}),
  checklist_failed: z.object({}),
  device_silent: z.object({ minutes: minutes(5) }),
  expired_documents_on_assign: z.object({}),
} satisfies Record<AlertType, z.ZodType>;

export type RuleParams<T extends AlertType> = z.infer<(typeof RULE_PARAMS)[T]>;

const DEFAULTS: Record<AlertType, { severity: AlertSeverity; escalateAfterMinutes: number }> = {
  trip_not_started: { severity: 'warning', escalateAfterMinutes: 10 },
  delay: { severity: 'warning', escalateAfterMinutes: 15 },
  off_route: { severity: 'warning', escalateAfterMinutes: 10 },
  speeding: { severity: 'warning', escalateAfterMinutes: 15 },
  unscheduled_stop: { severity: 'warning', escalateAfterMinutes: 10 },
  overcapacity: { severity: 'warning', escalateAfterMinutes: 15 },
  panic: { severity: 'critical', escalateAfterMinutes: 2 },
  checklist_failed: { severity: 'warning', escalateAfterMinutes: 15 },
  device_silent: { severity: 'warning', escalateAfterMinutes: 10 },
  expired_documents_on_assign: { severity: 'warning', escalateAfterMinutes: 60 },
};

export interface Rule<T extends AlertType = AlertType> {
  type: T;
  enabled: boolean;
  severity: AlertSeverity;
  params: RuleParams<T>;
  escalateAfterMinutes: number;
  notifyPlant: boolean;
  /** La transportista la configuró (si no, son los valores por omisión). */
  custom: boolean;
}

export type RuleSet = { [T in AlertType]: Rule<T> };

function defaultRule<T extends AlertType>(type: T): Rule<T> {
  return {
    type,
    enabled: true,
    severity: DEFAULTS[type].severity,
    params: RULE_PARAMS[type].parse({}) as RuleParams<T>,
    escalateAfterMinutes: DEFAULTS[type].escalateAfterMinutes,
    notifyPlant: false,
    custom: false,
  };
}

/** Reglas de una transportista: lo configurado encima de los valores por omisión. */
export async function rulesFor(db: DbClient | DbTransaction, tenantId: string): Promise<RuleSet> {
  const rows = await db.alertRule.findMany({ where: { tenantId } });
  const rules = Object.fromEntries(ALERT_TYPES.map((type) => [type, defaultRule(type)])) as RuleSet;
  for (const row of rows) {
    const type = row.type;
    const parsed = RULE_PARAMS[type].safeParse(row.params ?? {});
    (rules as Record<AlertType, Rule>)[type] = {
      type,
      enabled: row.enabled,
      severity: row.severity,
      params: parsed.success ? parsed.data : defaultRule(type).params,
      escalateAfterMinutes: row.escalateAfterMinutes,
      notifyPlant: row.notifyPlant,
      custom: true,
    };
  }
  return rules;
}
