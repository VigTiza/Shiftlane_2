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
