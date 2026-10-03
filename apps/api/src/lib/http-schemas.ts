import { z } from './zod.ts';

/** Fecha de negocio AAAA-MM-DD (sin hora). */
export const dateString = z.iso.date({ message: 'Usa el formato AAAA-MM-DD.' });

/** Convierte AAAA-MM-DD a la fecha que guarda PostgreSQL (columna DATE). */
export function toDbDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function toDbDateOrNull(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : toDbDate(value);
}

/** Convierte una columna DATE a AAAA-MM-DD. */
export function fromDbDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
}

export const idParams = z.object({ id: z.uuid() });

export const importQuery = z.object({
  /** true: solo valida y muestra el resultado sin guardar. */
  dryRun: z.stringbool().default(true),
});

export const importReportSchema = z.object({
  totalRows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  errors: z.array(
    z.object({ row: z.number().int(), column: z.string().optional(), message: z.string() }),
  ),
  applied: z.boolean(),
});

export const auditEntrySchema = z.object({
  id: z.string(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  requestId: z.string().nullable(),
  createdAt: z.date(),
});

/** Texto opcional: cadena vacía se guarda como null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
