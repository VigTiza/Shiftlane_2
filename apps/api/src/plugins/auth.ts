import type { Permission } from '@shiftlane/shared';
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

/** Datos de la sesión con el tipo ya comprobado por requireAuth o requirePermission. */
export function authOf<K extends Kind>(request: FastifyRequest, ..._kinds: K[]): ClaimsOf<K> {
  if (!request.auth) throw new UnauthorizedError();
  return request.auth as ClaimsOf<K>;
}

/** Contexto de base de datos de una sesión: siempre sale del token, nunca de la petición. */
export function contextFromClaims(claims: AccessClaims): DbContext {
  switch (claims.kind) {
    case 'user':
      return {
        tenantId: claims.tenantId,
        clientOrgId: claims.clientOrgId,
        userId: claims.sub,
        actorType: 'user',
        actorId: claims.sub,
      };
    case 'driver':
      return { tenantId: claims.tenantId, actorType: 'driver', actorId: claims.sub };
    case 'passenger':
      return { clientOrgId: claims.clientOrgId, actorType: 'passenger', actorId: claims.sub };
  }
}

/** Contexto de base de datos de la petición, con los datos para la bitácora. */
export function dbContextOf(request: FastifyRequest): DbContext {
  return { ...contextFromClaims(authOf(request)), requestId: request.id, ip: request.ip };
}

export const authPlugin = fp(
  (app: FastifyInstance) => {
    app.decorateRequest('auth', null);
  },
  { name: 'auth' },
);

async function verifyRequest(app: FastifyInstance, request: FastifyRequest): Promise<AccessClaims> {
  const token = bearerToken(request);
  const claims = token ? await app.tokens.verifyAccess(token) : null;
  if (!claims) {
    throw new UnauthorizedError('Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
  }
  return claims;
}

/** Exige un token de acceso válido y, opcionalmente, un tipo de sesión. */
export function requireAuth(
  app: FastifyInstance,
  options: { kinds?: Kind[] } = {},
): preHandlerAsyncHookHandler {
  return async (request) => {
    const claims = await verifyRequest(app, request);
    if (options.kinds && !options.kinds.includes(claims.kind)) {
      throw new ForbiddenError();
    }
    request.auth = claims;
  };
}

/**
 * Exige una sesión de usuario web con al menos uno de los permisos indicados (permisos por
 * acción, docs/api.md). Los choferes y pasajeros tienen sus propias rutas.
 */
export function requirePermission(
  app: FastifyInstance,
  ...permissions: Permission[]
): preHandlerAsyncHookHandler {
  return async (request) => {
    const claims = await verifyRequest(app, request);
    if (claims.kind !== 'user' || !permissions.some((p) => claims.permissions.includes(p))) {
      throw new ForbiddenError();
    }
    request.auth = claims;
  };
}
