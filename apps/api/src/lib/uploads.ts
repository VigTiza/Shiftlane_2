import { randomUUID } from 'node:crypto';

import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';

import { BadRequestError } from './errors.ts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadKind = 'document' | 'image' | 'spreadsheet';

const SIGNATURES: {
  type: string;
  ext: string;
  kinds: UploadKind[];
  matches: (b: Buffer) => boolean;
}[] = [
  {
    type: 'application/pdf',
    ext: 'pdf',
    kinds: ['document'],
    matches: (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  },
  {
    type: 'image/jpeg',
    ext: 'jpg',
    kinds: ['document', 'image'],
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: 'image/png',
    ext: 'png',
    kinds: ['document', 'image'],
    matches: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: 'image/webp',
    ext: 'webp',
    kinds: ['document', 'image'],
    matches: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  {
    // .xlsx es un ZIP (PK\x03\x04).
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    kinds: ['spreadsheet'],
    matches: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
];

const KIND_LABELS: Record<UploadKind, string> = {
  document: 'PDF, JPG, PNG o WebP',
  image: 'JPG, PNG o WebP',
  spreadsheet: 'Excel (.xlsx)',
};

export interface UploadedFile {
  buffer: Buffer;
  contentType: string;
  extension: string;
  fileName: string;
}

/**
 * Lee el único archivo de una petición multipart y comprueba su tipo por los primeros bytes,
 * no por lo que declara el navegador.
 */
export async function readUpload(request: FastifyRequest, kind: UploadKind): Promise<UploadedFile> {
  if (!request.isMultipart()) {
    throw new BadRequestError('Envía el archivo como formulario (multipart/form-data).');
  }
  let file: MultipartFile | undefined;
  try {
    file = await request.file();
  } catch {
    throw new BadRequestError('No se pudo leer el archivo enviado.');
  }
  if (!file) throw new BadRequestError('No se recibió ningún archivo.');

  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch {
    throw new BadRequestError('El archivo pesa más de 10 MB.');
  }
  if (buffer.length === 0) throw new BadRequestError('El archivo está vacío.');

  const signature = SIGNATURES.find((s) => s.kinds.includes(kind) && s.matches(buffer));
  if (!signature) {
    throw new BadRequestError(`Formato no permitido. Sube un archivo ${KIND_LABELS[kind]}.`);
  }
  const fileName = (file.filename || `archivo.${signature.ext}`)
    .replace(/[^\p{L}\p{N} ._-]/gu, '_')
    .slice(0, 120);
  return { buffer, contentType: signature.type, extension: signature.ext, fileName };
}

/** Llave de almacenamiento: siempre bajo la carpeta del tenant, con nombre aleatorio. */
export function storageKey(tenantId: string, folder: string, extension: string): string {
  return `${tenantId}/${folder}/${randomUUID()}.${extension}`;
}
