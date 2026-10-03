import { DRIVER_DOCUMENT_TYPES, DRIVER_STATUS_LABELS, DRIVER_STATUSES } from '@shiftlane/shared';

import type { ExcelColumn } from '../../lib/excel.ts';
import { dateString, optionalText, paginated, paginationQuery } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';

export const driverParams = z.object({ driverId: z.uuid() });

export const enrollmentResponse = z.object({
  code: z.string(),
  qrPayload: z.string(),
  expiresAt: z.date(),
});

export const messageResponse = z.object({ message: z.string() });

const phone = z
  .string()
  .trim()
  .regex(/^[\d\s+()-]{7,20}$/, 'Escribe un teléfono válido.')
  .transform((value) => value.replace(/\s+/g, ' '));

export const driverStatus = z.enum(DRIVER_STATUSES);
export const driverDocumentType = z.enum(DRIVER_DOCUMENT_TYPES);

export const createDriverBody = z.object({
  fullName: z.string().trim().min(3, 'Escribe el nombre completo.').max(120),
  employeeNumber: optionalText(30),
  phone: phone.nullable().optional(),
  status: driverStatus.default('active'),
  licenseNumber: optionalText(40),
  licenseType: optionalText(30),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: phone.nullable().optional(),
  habitualVehicleId: z.uuid().nullable().optional(),
  notes: optionalText(1000),
});

export const updateDriverBody = createDriverBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const listDriversQuery = z.object({
  ...paginationQuery,
  search: z.string().trim().max(60).optional(),
  status: driverStatus.optional(),
});

export const driverDocumentSummary = z.object({
  id: z.uuid(),
  type: z.string(),
  number: z.string().nullable(),
  issuedOn: z.string().nullable(),
  expiresOn: z.string().nullable(),
  status: z.enum(['valid', 'expiring', 'expired', 'no_expiry']),
  hasFile: z.boolean(),
  fileName: z.string().nullable(),
  notes: z.string().nullable(),
});

export const driverSummary = z.object({
  id: z.uuid(),
  fullName: z.string(),
  employeeNumber: z.string().nullable(),
  phone: z.string().nullable(),
  status: driverStatus,
  licenseNumber: z.string().nullable(),
  licenseType: z.string().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  habitualVehicle: z.object({ id: z.uuid(), economicNumber: z.string() }).nullable(),
  hasPhoto: z.boolean(),
  notes: z.string().nullable(),
  access: z.object({ pinSet: z.boolean(), devices: z.number().int() }),
  documents: z.object({ expired: z.number().int(), expiring: z.number().int() }),
});

export const driverDetail = driverSummary.extend({ documentList: z.array(driverDocumentSummary) });
export const driverList = paginated(driverSummary);

export const createDriverDocumentBody = z
  .object({
    type: driverDocumentType,
    number: optionalText(60),
    issuedOn: dateString.nullable().optional(),
    expiresOn: dateString.nullable().optional(),
    notes: optionalText(500),
  })
  .refine((body) => !body.issuedOn || !body.expiresOn || body.expiresOn >= body.issuedOn, {
    message: 'La fecha de vencimiento no puede ser anterior a la de expedición.',
    path: ['expiresOn'],
  });

export const updateDriverDocumentBody = z
  .object({
    number: optionalText(60),
    issuedOn: dateString.nullable().optional(),
    expiresOn: dateString.nullable().optional(),
    notes: optionalText(500),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

// --- Excel --------------------------------------------------------------------

export const DRIVER_COLUMNS: ExcelColumn<
  | 'employeeNumber'
  | 'fullName'
  | 'phone'
  | 'licenseNumber'
  | 'licenseType'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'habitualVehicle'
  | 'status'
  | 'notes'
>[] = [
  { key: 'employeeNumber', header: 'Número de empleado', required: true, example: 'CH-015' },
  {
    key: 'fullName',
    header: 'Nombre completo',
    required: true,
    example: 'Juan Pérez López',
    width: 28,
  },
  { key: 'phone', header: 'Teléfono', example: '656 123 4567' },
  { key: 'licenseNumber', header: 'Número de licencia', example: 'CHH123456' },
  { key: 'licenseType', header: 'Tipo de licencia', example: 'C' },
  { key: 'emergencyContactName', header: 'Contacto de emergencia', width: 26 },
  { key: 'emergencyContactPhone', header: 'Teléfono de emergencia' },
  {
    key: 'habitualVehicle',
    header: 'Unidad habitual (número económico)',
    width: 30,
    example: 'U-014',
  },
  { key: 'status', header: 'Estado', example: 'Activo' },
  { key: 'notes', header: 'Notas', width: 30 },
];

const statusFromLabel = Object.fromEntries(
  DRIVER_STATUSES.map((status) => [DRIVER_STATUS_LABELS[status].toLowerCase(), status]),
);

export const driverRowSchema = z.object({
  employeeNumber: z.string({ error: 'Escribe el número de empleado.' }).trim().min(1).max(30),
  fullName: z
    .string({ error: 'Escribe el nombre completo.' })
    .trim()
    .min(3, 'Escribe el nombre completo.')
    .max(120),
  phone: phone.optional(),
  licenseNumber: optionalText(40),
  licenseType: optionalText(30),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: phone.optional(),
  habitualVehicle: optionalText(20),
  status: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return 'active' as const;
      const status = statusFromLabel[value.trim().toLowerCase()];
      if (!status) {
        ctx.addIssue({ code: 'custom', message: 'Estado desconocido. Usa: Activo o Inactivo.' });
        return z.NEVER;
      }
      return status;
    }),
  notes: optionalText(1000),
});

export type DriverRow = z.infer<typeof driverRowSchema>;
