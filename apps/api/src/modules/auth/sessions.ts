import { randomUUID } from 'node:crypto';

import { randomToken, sha256 } from '../../lib/crypto.ts';
import type { DbClient } from '../../lib/db.ts';
import { UnauthorizedError } from '../../lib/errors.ts';
import type { Session, SessionPrincipal } from '../../generated/prisma/client.ts';

export interface SessionOwner {
  principal: SessionPrincipal;
  userId?: string | null;
  driverId?: string | null;
  passengerId?: string | null;
  deviceId?: string | null;
  tenantId?: string | null;
  clientOrgId?: string | null;
}

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface SessionTtlDays {
  user: number;
  driver: number;
  passenger: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sesiones con token de renovación rotativo. Cada uso entrega un token nuevo; si alguien
 * presenta un token ya usado (robado o copiado), se revoca toda la familia de sesiones.
 * Trabaja con db.system: el token de renovación se valida antes de conocer la empresa.
 */
export function createSessionService(deps: { db: DbClient; ttlDays: SessionTtlDays }) {
  const { db, ttlDays } = deps;

  function expiry(principal: SessionPrincipal): Date {
    return new Date(Date.now() + ttlDays[principal] * DAY_MS);
  }

  async function create(owner: SessionOwner, familyId: string, meta: RequestMeta) {
    const refreshToken = randomToken();
    const session = await db.session.create({
      data: {
        principal: owner.principal,
        userId: owner.userId ?? null,
        driverId: owner.driverId ?? null,
        passengerId: owner.passengerId ?? null,
        deviceId: owner.deviceId ?? null,
        tenantId: owner.tenantId ?? null,
        clientOrgId: owner.clientOrgId ?? null,
        familyId,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: expiry(owner.principal),
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        ip: meta.ip ?? null,
      },
    });
    return { session, refreshToken };
  }

  async function revokeFamily(familyId: string): Promise<void> {
    await db.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return {
    /** Inicia una sesión nueva (familia nueva). */
    start(owner: SessionOwner, meta: RequestMeta) {
      return create(owner, randomUUID(), meta);
    },

    /** Cambia el token de renovación por uno nuevo. Lanza UnauthorizedError si no es válido. */
    async rotate(
      refreshToken: string,
      meta: RequestMeta,
    ): Promise<{ session: Session; refreshToken: string }> {
      const current = await db.session.findUnique({
        where: { refreshTokenHash: sha256(refreshToken) },
      });
      if (!current) {
        throw new UnauthorizedError('La sesión no es válida. Inicia sesión de nuevo.');
      }
      if (current.revokedAt) {
        throw new UnauthorizedError('La sesión fue cerrada. Inicia sesión de nuevo.');
      }
      if (current.rotatedAt) {
        await revokeFamily(current.familyId);
        throw new UnauthorizedError(
          'Detectamos un uso indebido de tu sesión. Por seguridad, inicia sesión de nuevo.',
        );
      }
      if (current.expiresAt <= new Date()) {
        throw new UnauthorizedError('Tu sesión expiró. Inicia sesión de nuevo.');
      }

      // Solo una petición puede rotar el token: si dos llegan a la vez, la segunda es reutilización.
      const claimed = await db.session.updateMany({
        where: { id: current.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: new Date() },
      });
      if (claimed.count !== 1) {
        await revokeFamily(current.familyId);
        throw new UnauthorizedError(
          'Detectamos un uso indebido de tu sesión. Por seguridad, inicia sesión de nuevo.',
        );
      }
      return create(current, current.familyId, meta);
    },

    /** Cierra la sesión a la que pertenece el token (toda su familia de rotaciones). */
    async revokeByToken(refreshToken: string): Promise<void> {
      const session = await db.session.findUnique({
        where: { refreshTokenHash: sha256(refreshToken) },
      });
      if (session) await revokeFamily(session.familyId);
    },

    revokeFamily,

    async revokeAll(owner: {
      userId?: string;
      driverId?: string;
      passengerId?: string;
    }): Promise<void> {
      await db.session.updateMany({
        where: { ...owner, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    /** Sesiones abiertas de un usuario web (la más reciente de cada familia). */
    async listActive(userId: string) {
      return db.session.findMany({
        where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          familyId: true,
          userAgent: true,
          ip: true,
          createdAt: true,
          expiresAt: true,
        },
      });
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
