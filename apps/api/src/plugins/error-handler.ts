import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

import { AppError } from '../lib/errors.ts';
import type { ErrorBody, ErrorDetail } from '../lib/errors.ts';

/** Mensajes en español para los errores de cliente que genera Fastify. */
const FASTIFY_CLIENT_ERRORS: Record<string, string> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'El tipo de contenido de la petición no es compatible.',
  FST_ERR_CTP_BODY_TOO_LARGE: 'El cuerpo de la petición es demasiado grande.',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'El cuerpo de la petición está vacío.',
  FST_ERR_CTP_INVALID_JSON_BODY: 'El cuerpo de la petición no es un JSON válido.',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'La longitud del contenido no es válida.',
};

const INTERNAL_ERROR_MESSAGE = 'Ocurrió un error interno. Intenta de nuevo más tarde.';

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  error: ErrorBody['error'],
) {
  const body: ErrorBody = { error, requestId: request.id };
  return reply.status(statusCode).send(body);
}

function validationDetails(error: FastifyError): ErrorDetail[] {
  const context = error.validationContext ?? 'body';
  return (error.validation ?? []).map((issue) => ({
    path: [context, ...issue.instancePath.split('/').filter(Boolean)].join('.'),
    message: issue.message ?? 'Valor inválido.',
  }));
}

/** Manejo centralizado de errores: toda respuesta de error sale con el mismo formato y en español. */
export const errorHandlerPlugin = fp(
  (app: FastifyInstance) => {
    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (error instanceof AppError) {
        return send(reply, request, error.statusCode, {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
      }

      if (hasZodFastifySchemaValidationErrors(error)) {
        return send(reply, request, 400, {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos.',
          details: validationDetails(error),
        });
      }

      const statusCode = error.statusCode ?? 500;
      if (statusCode >= 400 && statusCode < 500) {
        return send(reply, request, statusCode, {
          code: error.code ?? 'BAD_REQUEST',
          message: FASTIFY_CLIENT_ERRORS[error.code] ?? 'La petición no es válida.',
        });
      }

      request.log.error({ err: error }, 'Error no controlado');
      return send(reply, request, 500, {
        code: 'INTERNAL_ERROR',
        message: INTERNAL_ERROR_MESSAGE,
      });
    });

    app.setNotFoundHandler((request, reply) =>
      send(reply, request, 404, {
        code: 'ROUTE_NOT_FOUND',
        message: 'No existe la ruta solicitada.',
      }),
    );
  },
  { name: 'error-handler' },
);
