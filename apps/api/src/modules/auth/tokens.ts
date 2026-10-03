import { jwtVerify, SignJWT } from 'jose';

import { z } from '../../lib/zod.ts';

/** Datos que viajan en el token de acceso. El contexto de base de datos sale de aquí. */
export const accessClaimsSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    sub: z.uuid(),
    sid: z.uuid(),
    tenantId: z.uuid().nullable(),
    clientOrgId: z.uuid().nullable(),
    roles: z.array(z.string()),
    /** Permisos efectivos (roles + ajustes del usuario) al emitir el token. */
    permissions: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('driver'),
    sub: z.uuid(),
    sid: z.uuid(),
    tenantId: z.uuid(),
    deviceId: z.uuid(),
  }),
  z.object({
    kind: z.literal('passenger'),
    sub: z.uuid(),
    sid: z.uuid(),
    clientOrgId: z.uuid(),
    plantId: z.uuid(),
  }),
]);

export type AccessClaims = z.infer<typeof accessClaimsSchema>;

/** Token corto que se entrega después de la contraseña cuando falta el código 2FA. */
const challengeClaimsSchema = z.object({ purpose: z.literal('2fa'), sub: z.uuid() });

const ISSUER = 'shiftlane-api';

export function createTokenService(options: { secret: string; accessTtlSeconds: number }) {
  const key = new TextEncoder().encode(options.secret);

  async function sign(payload: Record<string, unknown>, audience: string, ttlSeconds: number) {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(key);
  }

  async function verify(token: string, audience: string) {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience,
      algorithms: ['HS256'],
    });
    return payload;
  }

  return {
    accessTtlSeconds: options.accessTtlSeconds,

    signAccess(claims: AccessClaims): Promise<string> {
      return sign(claims, 'access', options.accessTtlSeconds);
    },

    /** Devuelve los datos del token o null si es inválido o expiró. */
    async verifyAccess(token: string): Promise<AccessClaims | null> {
      try {
        const parsed = accessClaimsSchema.safeParse(await verify(token, 'access'));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    signTwoFactorChallenge(userId: string): Promise<string> {
      return sign({ purpose: '2fa', sub: userId }, '2fa', 300);
    },

    async verifyTwoFactorChallenge(token: string): Promise<string | null> {
      try {
        const parsed = challengeClaimsSchema.safeParse(await verify(token, '2fa'));
        return parsed.success ? parsed.data.sub : null;
      } catch {
        return null;
      }
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;
