import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';

import type { DbContext } from '../lib/db.ts';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.ts';
import type { AccessClaims } from '../modules/auth/tokens.ts';

type Kind = AccessClaims['kind'];
type ClaimsOf<K extends Kind> = Extract<AccessClaims, { kind: K }>;

declare module 'fastify' {
  interface FastifyRequest {
    /** Datos del token de acceso verificado; null si la ruta no exige sesión. */
    auth: AccessClaims | null;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Datos de la sesión con el tipo ya comprobado por requireAuth. */
export function authOf<K extends Kind>(request: FastifyRequest, ..._kinds: K[]): ClaimsOf<K> {
  if (!request.auth) throw new UnauthorizedError();
  return request.auth as ClaimsOf<K>;
}

/** Contexto de base de datos de la sesión: siempre sale del token, nunca de la petición. */
export function dbContextOf(claims: AccessClaims): DbContext {
  switch (claims.kind) {
    case 'user':
      return { tenantId: claims.tenantId, clientOrgId: claims.clientOrgId, userId: claims.sub };
    case 'driver':
      return { tenantId: claims.tenantId };
    case 'passenger':
      return { clientOrgId: claims.clientOrgId };
  }
}

export const authPlugin = fp(
  (app: FastifyInstance) => {
    app.decorateRequest('auth', null);
  },
  { name: 'auth' },
);

/**
 * Exige un token de acceso válido. Opcionalmente limita el tipo de sesión y, para usuarios
 * web, los roles permitidos (los permisos finos llegan en F01-P04).
 */
export function requireAuth(
  app: FastifyInstance,
  options: { kinds?: Kind[]; roles?: string[] } = {},
): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = bearerToken(request);
    const claims = token ? await app.tokens.verifyAccess(token) : null;
    if (!claims) {
      throw new UnauthorizedError('Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
    }
    if (options.kinds && !options.kinds.includes(claims.kind)) {
      throw new ForbiddenError();
    }
    if (options.roles) {
      const allowed = options.roles;
      if (claims.kind !== 'user' || !claims.roles.some((role) => allowed.includes(role))) {
        throw new ForbiddenError();
      }
    }
    request.auth = claims;
  };
}
