import type { ExcelColumn } from '../../lib/excel.ts';
import { optionalText, paginated, paginationQuery } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';

const employeeNumber = z.string().trim().min(1, 'Escribe el número de empleado.').max(40);
const fullName = z.string().trim().min(3, 'Escribe el nombre completo.').max(120);
const phone = z
  .string()
  .trim()
  .regex(/^[\d\s+()-]{7,20}$/, 'Escribe un teléfono válido.');
const badgeValue = z.string().trim().min(3, 'El código del gafete es muy corto.').max(200);

export const passengerStatus = z.enum(['active', 'inactive']);
export const badgeKind = z.enum(['badge_barcode', 'badge_qr']);

export const listPassengersQuery = z.object({
  ...paginationQuery,
  search: z.string().trim().max(60).optional(),
  status: passengerStatus.optional(),
  plantId: z.uuid().optional(),
});

export const createPassengerBody = z.object({
  plantId: z.uuid(),
  employeeNumber,
  fullName,
  shiftName: optionalText(60),
  phone: phone.nullable().optional(),
  status: passengerStatus.default('active'),
});

export const updatePassengerBody = createPassengerBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const addBadgeBody = z.object({ kind: badgeKind, value: badgeValue });

export const credentialSummary = z.object({
  id: z.uuid(),
  kind: z.enum(['shiftlane_qr', 'badge_barcode', 'badge_qr']),
  /** Código del gafete; para la credencial de Shiftlane no se muestra. */
  value: z.string().nullable(),
  issuedAt: z.date(),
  revokedAt: z.date().nullable(),
});

export const passengerSummary = z.object({
  id: z.uuid(),
  clientOrgId: z.uuid(),
  plantId: z.uuid(),
  employeeNumber: z.string(),
  fullName: z.string(),
  shiftName: z.string().nullable(),
  phone: z.string().nullable(),
  status: passengerStatus,
  activated: z.boolean(),
  credentials: z.array(credentialSummary),
});

export const passengerList = paginated(passengerSummary);

export const issuedCredential = z.object({
  credentialId: z.uuid(),
  qrPayload: z.string(),
  issuedAt: z.date(),
});

export const verifyBody = z.object({ code: z.string().trim().min(3).max(1000) });

export const verifyResponse = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(true),
    source: z.enum(['shiftlane_qr', 'badge']),
    passenger: z.object({
      id: z.uuid(),
      fullName: z.string(),
      employeeNumber: z.string(),
      plantId: z.uuid(),
    }),
  }),
  z.object({
    valid: z.literal(false),
    reason: z.enum(['invalid_signature', 'revoked', 'inactive', 'unknown']),
    message: z.string(),
  }),
]);

export const provisionalBody = z.object({
  plantId: z.uuid(),
  value: badgeValue,
  kind: z.enum(['barcode', 'qr']),
});

export const provisionalSummary = z.object({
  id: z.uuid(),
  plantId: z.uuid(),
  value: z.string(),
  kind: z.enum(['barcode', 'qr']),
  status: z.enum(['pending', 'resolved', 'dismissed']),
  seenCount: z.number().int(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  resolvedPassengerId: z.uuid().nullable(),
});

export const listProvisionalQuery = z.object({
  status: z.enum(['pending', 'resolved', 'dismissed']).default('pending'),
  plantId: z.uuid().optional(),
});

export const resolveBody = z.object({ passengerId: z.uuid() });

// --- Carga de Excel ---------------------------------------------------------------

export const PASSENGER_COLUMNS: ExcelColumn<
  'employeeNumber' | 'fullName' | 'shiftName' | 'phone' | 'badge' | 'badgeKind' | 'status'
>[] = [
  { key: 'employeeNumber', header: 'Número de empleado', required: true, example: 'E-1001' },
  {
    key: 'fullName',
    header: 'Nombre completo',
    required: true,
    example: 'Rosa Martínez López',
    width: 28,
  },
  { key: 'shiftName', header: 'Turno', example: 'Primer turno' },
  { key: 'phone', header: 'Teléfono', example: '656 123 4567' },
  { key: 'badge', header: 'Gafete', example: '0012345678' },
  { key: 'badgeKind', header: 'Tipo de gafete', example: 'Código de barras' },
  { key: 'status', header: 'Estado', example: 'Activo' },
];

const BADGE_KIND_LABELS: Record<string, 'badge_barcode' | 'badge_qr'> = {
  'codigo de barras': 'badge_barcode',
  'código de barras': 'badge_barcode',
  barras: 'badge_barcode',
  qr: 'badge_qr',
};

export const passengerRowSchema = z
  .object({
    employeeNumber: z.string({ error: 'Escribe el número de empleado.' }).pipe(employeeNumber),
    fullName: z.string({ error: 'Escribe el nombre completo.' }).pipe(fullName),
    shiftName: optionalText(60),
    phone: phone.optional(),
    badge: badgeValue.optional(),
    badgeKind: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (!value) return undefined;
        const kind = BADGE_KIND_LABELS[value.trim().toLowerCase()];
        if (!kind) {
          ctx.addIssue({
            code: 'custom',
            message: 'Tipo de gafete desconocido. Usa: Código de barras o QR.',
          });
          return z.NEVER;
        }
        return kind;
      }),
    status: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (!value) return 'active' as const;
        const normalized = value.trim().toLowerCase();
        if (normalized === 'activo') return 'active' as const;
        if (normalized === 'baja' || normalized === 'inactivo') return 'inactive' as const;
        ctx.addIssue({ code: 'custom', message: 'Estado desconocido. Usa: Activo o Baja.' });
        return z.NEVER;
      }),
  })
  .transform((row) => ({
    ...row,
    badgeKind: row.badge ? (row.badgeKind ?? 'badge_barcode') : undefined,
  }));

export type PassengerRow = z.infer<typeof passengerRowSchema>;

export const importQuery = z.object({
  plantId: z.uuid(),
  mode: z.enum(['changes', 'full']).default('changes'),
});

const fieldChange = z.object({ from: z.string().nullable(), to: z.string().nullable() });

export const importChange = z.object({
  row: z.number().int().nullable(),
  employeeNumber: z.string(),
  fullName: z.string(),
  action: z.enum(['create', 'update', 'deactivate', 'reactivate']),
  changes: z.record(z.string(), fieldChange).optional(),
});

export const importSummary = z.object({
  id: z.uuid(),
  plantId: z.uuid(),
  fileName: z.string(),
  mode: z.enum(['changes', 'full']),
  status: z.enum(['previewed', 'applied', 'discarded']),
  totalRows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  deactivated: z.number().int(),
  reactivated: z.number().int(),
  unchanged: z.number().int(),
  errors: z.array(
    z.object({ row: z.number().int(), column: z.string().optional(), message: z.string() }),
  ),
  changes: z.array(importChange),
  createdAt: z.date(),
  appliedAt: z.date().nullable(),
});
