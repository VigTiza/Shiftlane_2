/** Detalle de un campo inválido dentro de una respuesta de error. */
export interface ErrorDetail {
  path: string;
  message: string;
}

/** Cuerpo de toda respuesta de error de la API. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
  requestId: string;
}

/**
 * Error esperado de negocio. El mensaje se muestra tal cual al usuario, así que debe
 * estar en español y no revelar datos internos.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ErrorDetail[] | undefined;

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'La petición no es válida.', details?: ErrorDetail[]) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Necesitas iniciar sesión.') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tienes permiso para realizar esta acción.') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'No se encontró el recurso solicitado.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'La operación entra en conflicto con el estado actual.') {
    super(409, 'CONFLICT', message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'El servicio no está disponible en este momento.') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}
