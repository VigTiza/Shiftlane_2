import { VEHICLE_DOCUMENT_TYPES, VEHICLE_STATUS_LABELS, VEHICLE_STATUSES } from '@shiftlane/shared';

import type { ExcelColumn } from '../../lib/excel.ts';
import { dateString, optionalText, paginated, paginationQuery } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';

const currentYear = new Date().getFullYear();

const economicNumber = z.string().trim().min(1, 'Escribe el número económico.').max(20);
const plates = z
  .string()
  .trim()
  .min(5, 'Las placas deben tener al menos 5 caracteres.')
  .max(12)
  .transform((value) => value.toUpperCase().replace(/\s+/g, ''));
const year = z.coerce
  .number({ error: 'Escribe el año como número.' })
  .int()
  .min(1980, 'El año debe ser 1980 o posterior.')
  .max(currentYear + 1, `El año no puede ser mayor a ${currentYear + 1}.`);
const capacity = z.coerce
  .number({ error: 'Escribe la capacidad como número.' })
  .int()
  .min(1, 'La capacidad debe ser al menos 1.')
  .max(120, 'La capacidad no puede ser mayor a 120.');
const odometerKm = z.coerce
  .number({ error: 'Escribe el kilometraje como número.' })
  .int()
  .min(0, 'El kilometraje no puede ser negativo.');

export const vehicleStatus = z.enum(VEHICLE_STATUSES);
export const vehicleDocumentType = z.enum(VEHICLE_DOCUMENT_TYPES);

export const createVehicleBody = z.object({
  economicNumber,
  plates,
  make: optionalText(60),
  model: z.string().trim().min(1, 'Escribe el modelo.').max(60),
  year,
  capacity,
  status: vehicleStatus.default('available'),
  odometerKm: odometerKm.default(0),
  notes: optionalText(1000),
});

export const updateVehicleBody = createVehicleBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const listVehiclesQuery = z.object({
  ...paginationQuery,
  search: z.string().trim().max(60).optional(),
  status: vehicleStatus.optional(),
});

export const documentSummary = z.object({
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

export const vehicleSummary = z.object({
  id: z.uuid(),
  economicNumber: z.string(),
  plates: z.string(),
  make: z.string().nullable(),
  model: z.string(),
  year: z.number().int(),
  capacity: z.number().int(),
  status: vehicleStatus,
  odometerKm: z.number().int(),
  hasPhoto: z.boolean(),
  notes: z.string().nullable(),
  documents: z.object({ expired: z.number().int(), expiring: z.number().int() }),
});

export const vehicleDetail = vehicleSummary.extend({ documentList: z.array(documentSummary) });

export const vehicleList = paginated(vehicleSummary);

export const createDocumentBody = z
  .object({
    type: vehicleDocumentType,
    number: optionalText(60),
    issuedOn: dateString.nullable().optional(),
    expiresOn: dateString.nullable().optional(),
    notes: optionalText(500),
  })
  .refine((body) => !body.issuedOn || !body.expiresOn || body.expiresOn >= body.issuedOn, {
    message: 'La fecha de vencimiento no puede ser anterior a la de expedición.',
    path: ['expiresOn'],
  });

export const updateDocumentBody = z
  .object({
    number: optionalText(60),
    issuedOn: dateString.nullable().optional(),
    expiresOn: dateString.nullable().optional(),
    notes: optionalText(500),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

// --- Excel --------------------------------------------------------------------

export const VEHICLE_COLUMNS: ExcelColumn<
  | 'economicNumber'
  | 'plates'
  | 'make'
  | 'model'
  | 'year'
  | 'capacity'
  | 'status'
  | 'odometerKm'
  | 'notes'
>[] = [
  { key: 'economicNumber', header: 'Número económico', required: true, example: 'U-014' },
  { key: 'plates', header: 'Placas', required: true, example: 'EFR-1234' },
  { key: 'make', header: 'Marca', example: 'Mercedes-Benz' },
  { key: 'model', header: 'Modelo', required: true, example: 'Sprinter 516' },
  { key: 'year', header: 'Año', required: true, example: 2022 },
  { key: 'capacity', header: 'Capacidad', required: true, example: 19 },
  { key: 'status', header: 'Estado', example: 'Disponible' },
  { key: 'odometerKm', header: 'Kilometraje', example: 85400 },
  { key: 'notes', header: 'Notas', width: 30 },
];

const statusFromLabel = Object.fromEntries(
  VEHICLE_STATUSES.map((status) => [VEHICLE_STATUS_LABELS[status].toLowerCase(), status]),
);

export const vehicleRowSchema = z.object({
  economicNumber: z.string({ error: 'Escribe el número económico.' }).pipe(economicNumber),
  plates: z.string({ error: 'Escribe las placas.' }).pipe(plates),
  make: optionalText(60),
  model: z.string({ message: 'Escribe el modelo.' }).trim().min(1, 'Escribe el modelo.').max(60),
  year,
  capacity,
  status: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return 'available' as const;
      const status =
        statusFromLabel[value.trim().toLowerCase()] ??
        (VEHICLE_STATUSES as readonly string[]).find((s) => s === value);
      if (!status) {
        ctx.addIssue({
          code: 'custom',
          message: `Estado desconocido. Usa: ${Object.values(VEHICLE_STATUS_LABELS).join(', ')}.`,
        });
        return z.NEVER;
      }
      return status as (typeof VEHICLE_STATUSES)[number];
    }),
  odometerKm: odometerKm.optional(),
  notes: optionalText(1000),
});

export type VehicleRow = z.infer<typeof vehicleRowSchema>;
