import type { FastifyReply } from 'fastify';

/** Envía un archivo para descargar o mostrar en el navegador. */
export function sendFile(
  reply: FastifyReply,
  file: { body: Buffer; contentType: string; fileName?: string },
  disposition: 'inline' | 'attachment' = 'inline',
) {
  const name = file.fileName ? `; filename*=UTF-8''${encodeURIComponent(file.fileName)}` : '';
  return reply
    .header('content-type', file.contentType)
    .header('content-disposition', `${disposition}${name}`)
    .header('cache-control', 'private, no-store')
    .send(file.body);
}

/** Tipo de una imagen guardada según su extensión (fotos y logos). */
export function contentTypeOf(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
