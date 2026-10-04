import { z } from '../../lib/zod.ts';

export const MAX_HEALTH_REPORTS = 200;

export const healthReport = z.object({
  recordedAt: z.coerce.date(),
  tripId: z.uuid().optional(),
  batteryPct: z.number().int().min(0).max(100).optional(),
  charging: z.boolean().optional(),
  networkType: z.enum(['wifi', 'cellular', 'none']).optional(),
  /** 0 (sin señal) a 4. */
  signalLevel: z.number().int().min(0).max(4).optional(),
  mobileDataEnabled: z.boolean().optional(),
  locationPermission: z.enum(['always', 'while_in_use', 'denied']).optional(),
  gpsEnabled: z.boolean().optional(),
  backgroundAllowed: z.boolean().optional(),
  /** true: la app está fuera del ahorro de batería. */
  batteryOptimizationIgnored: z.boolean().optional(),
  cameraPermission: z.boolean().optional(),
  appVersion: z.string().trim().max(30).optional(),
  osVersion: z.string().trim().max(60).optional(),
  platform: z.string().trim().max(30).optional(),
  deviceModel: z.string().trim().max(80).optional(),
});

export const pushTokenBody = z.object({
  /** Token de Firebase Cloud Messaging del celular (vacío para dejar de recibir avisos). */
  token: z.string().trim().max(4096).nullable(),
});

export const pushTokenResponse = z.object({ saved: z.boolean() });

export const appVersionResponse = z.object({
  /** Con una versión menor la app pide actualizar y no deja seguir. */
  minVersion: z.string().nullable(),
  /** Si hay una más nueva, la app sugiere actualizar (sin obligar). */
  latestVersion: z.string().nullable(),
  downloadUrl: z.string().nullable(),
});

export const healthBody = z.object({
  /** Hora del celular al enviar: con la del servidor da el desfase de su reloj. */
  sentAt: z.coerce.date(),
  reports: z
    .array(healthReport)
    .min(1, 'Envía al menos un reporte.')
    .max(MAX_HEALTH_REPORTS, `Envía como máximo ${MAX_HEALTH_REPORTS} reportes por lote.`),
});

const issue = z.object({
  code: z.string(),
  severity: z.enum(['block', 'warn']),
  message: z.string(),
});
const status = z.enum(['ok', 'warning', 'problem']);

export const healthResponse = z.object({
  accepted: z.number().int(),
  clockOffsetMs: z.number().int(),
  status,
  issues: z.array(issue),
  /** El último reporte permite iniciar un viaje (sin problemas que bloqueen). */
  canStartTrip: z.boolean(),
});

const reportSummary = z.object({
  id: z.uuid(),
  recordedAt: z.date(),
  tripId: z.uuid().nullable(),
  batteryPct: z.number().int().nullable(),
  charging: z.boolean().nullable(),
  networkType: z.string().nullable(),
  signalLevel: z.number().int().nullable(),
  locationPermission: z.string().nullable(),
  gpsEnabled: z.boolean().nullable(),
  backgroundAllowed: z.boolean().nullable(),
  batteryOptimizationIgnored: z.boolean().nullable(),
  appVersion: z.string().nullable(),
  clockOffsetMs: z.number().int().nullable(),
  status: z.string(),
  issues: z.array(issue),
});

export const deviceList = z.array(
  z.object({
    id: z.uuid(),
    platform: z.string().nullable(),
    model: z.string().nullable(),
    appVersion: z.string().nullable(),
    lastSeenAt: z.date().nullable(),
    lastSyncAt: z.date().nullable(),
    driver: z.object({ id: z.uuid(), fullName: z.string() }).nullable(),
    health: reportSummary.nullable(),
  }),
);

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const historyResponse = z.array(reportSummary);

export const diagnosisResponse = z.object({
  cause: z.enum([
    'permission_revoked',
    'low_battery',
    'known_dead_zone',
    'no_data',
    'app_closed',
    'unknown',
  ]),
  message: z.string(),
  suggestedAction: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  silentSince: z.date(),
  lastPosition: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});
