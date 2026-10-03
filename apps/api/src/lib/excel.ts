import { readSheet } from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';

import { BadRequestError } from './errors.ts';
import type { z } from './zod.ts';

/** Columna de una plantilla de Excel. El encabezado es lo que ve el usuario. */
export interface ExcelColumn<K extends string = string> {
  key: K;
  header: string;
  required?: boolean;
  width?: number;
  /** Valor de ejemplo para la plantilla. */
  example?: string | number;
}

export interface ImportRowError {
  row: number;
  column?: string;
  message: string;
}

export interface ImportReport {
  totalRows: number;
  created: number;
  updated: number;
  errors: ImportRowError[];
  /** false si fue vista previa o si hubo errores (no se guarda nada a medias). */
  applied: boolean;
}

export interface ParsedRow<T> {
  row: number;
  data: T;
}

type CellValue = string | number | boolean | Date | null;

function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*()]/g, '').trim().toLowerCase();
}

function cellToString(value: CellValue | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

/**
 * Lee la primera hoja de un .xlsx y valida cada fila con el esquema. Devuelve las filas
 * válidas y los errores por fila y columna (las filas empiezan en 2: la 1 es el encabezado).
 */
export async function parseSpreadsheet<K extends string, S extends z.ZodType>(
  buffer: Buffer,
  columns: ExcelColumn<K>[],
  schema: S,
): Promise<{ rows: ParsedRow<z.infer<S>>[]; errors: ImportRowError[]; totalRows: number }> {
  let data: CellValue[][];
  try {
    data = (await readSheet(buffer)) as CellValue[][];
  } catch {
    throw new BadRequestError('No se pudo leer el archivo. Usa la plantilla de Excel (.xlsx).');
  }
  const [headerRow, ...body] = data;
  if (!headerRow) throw new BadRequestError('El archivo está vacío.');

  const headerIndex = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const text = cellToString(cell);
    if (text) headerIndex.set(normalizeHeader(text), index);
  });
  const missing = columns.filter((c) => c.required && !headerIndex.has(normalizeHeader(c.header)));
  if (missing.length > 0) {
    throw new BadRequestError(
      `Faltan columnas obligatorias: ${missing.map((c) => c.header).join(', ')}. Usa la plantilla.`,
    );
  }

  const headerOf = new Map(columns.map((c) => [c.key as string, c.header]));
  const rows: ParsedRow<z.infer<S>>[] = [];
  const errors: ImportRowError[] = [];
  let totalRows = 0;

  body.forEach((cells, index) => {
    const rowNumber = index + 2;
    const raw: Record<string, string | undefined> = {};
    for (const column of columns) {
      const position = headerIndex.get(normalizeHeader(column.header));
      raw[column.key] = position === undefined ? undefined : cellToString(cells[position]);
    }
    if (Object.values(raw).every((value) => value === undefined)) return;
    totalRows += 1;

    const result = schema.safeParse(raw);
    if (result.success) {
      rows.push({ row: rowNumber, data: result.data });
    } else {
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? '');
        errors.push({ row: rowNumber, column: headerOf.get(key) ?? key, message: issue.message });
      }
    }
  });

  return { rows, errors, totalRows };
}

/** Marca como error las filas que repiten un valor que debe ser único dentro del archivo. */
export function findDuplicates<T>(
  rows: ParsedRow<T>[],
  valueOf: (data: T) => string | undefined,
  column: string,
): ImportRowError[] {
  const seen = new Map<string, number>();
  const errors: ImportRowError[] = [];
  for (const { row, data } of rows) {
    const value = valueOf(data)?.toUpperCase();
    if (!value) continue;
    const first = seen.get(value);
    if (first !== undefined) {
      errors.push({
        row,
        column,
        message: `Está repetido en el archivo (también en la fila ${first}).`,
      });
    } else {
      seen.set(value, row);
    }
  }
  return errors;
}

/** Genera un .xlsx con encabezados en negritas. */
export async function buildSpreadsheet<K extends string>(
  columns: ExcelColumn<K>[],
  records: Partial<Record<K, string | number | null>>[],
  sheetName: string,
): Promise<Buffer> {
  const header = columns.map((column) => ({
    value: column.required ? `${column.header}*` : column.header,
    fontWeight: 'bold' as const,
  }));
  const rows = records.map((record) =>
    columns.map((column) => {
      const value = record[column.key];
      return value === null || value === undefined ? null : { value };
    }),
  );
  return writeXlsxFile([header, ...rows], {
    sheet: sheetName,
    columns: columns.map((column) => ({ width: column.width ?? 18 })),
  }).toBuffer();
}

/** Plantilla con una fila de ejemplo. */
export function buildTemplate<K extends string>(
  columns: ExcelColumn<K>[],
  sheetName: string,
): Promise<Buffer> {
  const example = Object.fromEntries(columns.map((c) => [c.key, c.example ?? null])) as Partial<
    Record<K, string | number | null>
  >;
  return buildSpreadsheet(columns, [example], sheetName);
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
