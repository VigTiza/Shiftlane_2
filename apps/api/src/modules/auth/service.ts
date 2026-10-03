import type { Cipher } from '../../lib/crypto.ts';
import { randomToken, sha256 } from '../../lib/crypto.ts';
import type { DbClient } from '../../lib/db.ts';
import { AppError, BadRequestError, ConflictError, UnauthorizedError } from '../../lib/errors.ts';
import type { Mailer } from '../../lib/mailer.ts';
import type { Session } from '../../generated/prisma/client.ts';
import { burnVerifyTime, hashSecret, verifySecret } from './passwords.ts';
import type { RequestMeta, SessionService } from './sessions.ts';
import type { AccessClaims, TokenService } from './tokens.ts';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.ts';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;

const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos.';

export interface AuthDeps {
  db: DbClient;
  sessions: SessionService;
  tokens: TokenService;
  cipher: Cipher;
  mailer: Mailer;
  appUrl: string;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export function lockedError(lockedUntil: Date): AppError {
  const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
  return new AppError(
    423,
    'ACCOUNT_LOCKED',
    `Bloqueamos el acceso temporalmente por varios intentos fallidos. Intenta de nuevo en ${minutes} minutos.`,
  );
}

export function createAuthService(deps: AuthDeps) {
  const { db, sessions, tokens, cipher, mailer } = deps;

  async function userClaims(userId: string, sessionId: string): Promise<AccessClaims> {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (user.status !== 'active' || user.deletedAt) {
      throw new UnauthorizedError('Tu cuenta no está activa.');
    }
    return {
      kind: 'user',
      sub: user.id,
      sid: sessionId,
      tenantId: user.tenantId,
      clientOrgId: user.clientOrgId,
      roles: user.roles.map((assignment) => assignment.role.key).sort(),
    };
  }

  async function issueUserTokens(userId: string, meta: RequestMeta): Promise<IssuedTokens> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const { session, refreshToken } = await sessions.start(
      { principal: 'user', userId, tenantId: user.tenantId, clientOrgId: user.clientOrgId },
      meta,
    );
    await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const accessToken = await tokens.signAccess(await userClaims(userId, session.id));
    return { accessToken, expiresIn: tokens.accessTtlSeconds, refreshToken };
  }

  async function registerFailure(userId: string, failedLoginCount: number): Promise<void> {
    const attempts = failedLoginCount + 1;
    await db.user.update({
      where: { id: userId },
      data:
        attempts >= MAX_FAILED_ATTEMPTS
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
          : { failedLoginCount: attempts },
    });
  }

  async function findLoginUser(email: string) {
    const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    return user && user.status === 'active' && !user.deletedAt && user.passwordHash ? user : null;
  }

  /** Construye el token de acceso que corresponde a una sesión (usuario, chofer o pasajero). */
  async function claimsForSession(session: Session): Promise<AccessClaims> {
    if (session.principal === 'user' && session.userId) {
      return userClaims(session.userId, session.id);
    }
    if (
      session.principal === 'driver' &&
      session.driverId &&
      session.deviceId &&
      session.tenantId
    ) {
      const driver = await db.driver.findUnique({ where: { id: session.driverId } });
      const device = await db.device.findUnique({ where: { id: session.deviceId } });
      if (
        !driver ||
        driver.status !== 'active' ||
        driver.deletedAt ||
        !device ||
        device.revokedAt
      ) {
        throw new UnauthorizedError('Tu acceso ya no está activo. Habla con el despachador.');
      }
      return {
        kind: 'driver',
        sub: driver.id,
        sid: session.id,
        tenantId: driver.tenantId,
        deviceId: device.id,
      };
    }
    if (session.principal === 'passenger' && session.passengerId) {
      const passenger = await db.passenger.findUnique({ where: { id: session.passengerId } });
      if (!passenger || passenger.status !== 'active' || passenger.deletedAt) {
        throw new UnauthorizedError('Tu acceso ya no está activo. Acude a Recursos Humanos.');
      }
      return {
        kind: 'passenger',
        sub: passenger.id,
        sid: session.id,
        clientOrgId: passenger.clientOrgId,
        plantId: passenger.plantId,
      };
    }
    throw new UnauthorizedError('La sesión no es válida. Inicia sesión de nuevo.');
  }

  return {
    async login(
      input: { email: string; password: string },
      meta: RequestMeta,
    ): Promise<IssuedTokens | { twoFactorRequired: true; challengeToken: string }> {
      const user = await findLoginUser(input.email);
      if (!user?.passwordHash) {
        await burnVerifyTime(input.password);
        throw new UnauthorizedError(INVALID_CREDENTIALS);
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw lockedError(user.lockedUntil);
      }
      if (!(await verifySecret(user.passwordHash, input.password))) {
        await registerFailure(user.id, user.failedLoginCount);
        throw new UnauthorizedError(INVALID_CREDENTIALS);
      }
      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      if (user.totpEnabledAt) {
        return {
          twoFactorRequired: true,
          challengeToken: await tokens.signTwoFactorChallenge(user.id),
        };
      }
      return issueUserTokens(user.id, meta);
    },

    async loginTwoFactor(
      input: { challengeToken: string; code: string },
      meta: RequestMeta,
    ): Promise<IssuedTokens> {
      const userId = await tokens.verifyTwoFactorChallenge(input.challengeToken);
      if (!userId) {
        throw new UnauthorizedError('La verificación expiró. Inicia sesión de nuevo.');
      }
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil);
      if (!user.totpSecret || !user.totpEnabledAt) {
        throw new UnauthorizedError('La verificación en dos pasos no está activa.');
      }
      const step = verifyTotp(cipher.decrypt(user.totpSecret), input.code);
      if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) {
        await registerFailure(user.id, user.failedLoginCount);
        throw new UnauthorizedError('El código de verificación no es válido.');
      }
      await db.user.update({
        where: { id: user.id },
        data: { totpLastStep: step, failedLoginCount: 0, lockedUntil: null },
      });
      return issueUserTokens(user.id, meta);
    },

    /** Entrega un token de acceso nuevo y rota el de renovación. Sirve para todos los tipos. */
    async refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedTokens> {
      const rotated = await sessions.rotate(refreshToken, meta);
      let claims: AccessClaims;
      try {
        claims = await claimsForSession(rotated.session);
      } catch (error) {
        await sessions.revokeFamily(rotated.session.familyId);
        throw error;
      }
      return {
        accessToken: await tokens.signAccess(claims),
        expiresIn: tokens.accessTtlSeconds,
        refreshToken: rotated.refreshToken,
      };
    },

    logout(refreshToken: string) {
      return sessions.revokeByToken(refreshToken);
    },

    logoutEverywhere(userId: string) {
      return sessions.revokeAll({ userId });
    },

    listSessions(userId: string) {
      return sessions.listActive(userId);
    },

    async revokeSession(userId: string, sessionId: string): Promise<void> {
      const session = await db.session.findFirst({ where: { id: sessionId, userId } });
      if (!session) throw new AppError(404, 'NOT_FOUND', 'No se encontró la sesión.');
      await sessions.revokeFamily(session.familyId);
    },

    async me(claims: AccessClaims) {
      if (claims.kind === 'user') {
        const user = await db.user.findUniqueOrThrow({ where: { id: claims.sub } });
        return {
          kind: 'user' as const,
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          tenantId: user.tenantId,
          clientOrgId: user.clientOrgId,
          roles: claims.roles,
          twoFactorEnabled: user.totpEnabledAt !== null,
        };
      }
      if (claims.kind === 'driver') {
        const driver = await db.driver.findUniqueOrThrow({ where: { id: claims.sub } });
        return {
          kind: 'driver' as const,
          id: driver.id,
          fullName: driver.fullName,
          tenantId: driver.tenantId,
        };
      }
      const passenger = await db.passenger.findUniqueOrThrow({ where: { id: claims.sub } });
      return {
        kind: 'passenger' as const,
        id: passenger.id,
        fullName: passenger.fullName,
        clientOrgId: passenger.clientOrgId,
        plantId: passenger.plantId,
      };
    },

    /** Siempre responde igual, exista o no el correo, para no revelar qué cuentas existen. */
    async forgotPassword(email: string): Promise<void> {
      const user = await findLoginUser(email);
      if (!user) return;
      const token = randomToken();
      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
        },
      });
      const link = `${deps.appUrl}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
      await mailer.send({
        to: user.email,
        subject: 'Restablece tu contraseña de Shiftlane',
        text:
          `Hola, ${user.fullName}.\n\n` +
          `Para crear una contraseña nueva entra a este enlace (vence en ${RESET_TOKEN_MINUTES} minutos):\n${link}\n\n` +
          'Si no lo pediste, ignora este correo; tu contraseña no cambiará.',
      });
    },

    async resetPassword(input: { token: string; password: string }): Promise<void> {
      const record = await db.passwordResetToken.findUnique({
        where: { tokenHash: sha256(input.token) },
      });
      if (!record || record.usedAt || record.expiresAt <= new Date()) {
        throw new BadRequestError(
          'El enlace para restablecer la contraseña no es válido o ya venció.',
        );
      }
      const passwordHash = await hashSecret(input.password);
      await db.$transaction([
        db.user.update({
          where: { id: record.userId },
          data: {
            passwordHash,
            passwordChangedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        }),
        db.passwordResetToken.updateMany({
          where: { userId: record.userId, usedAt: null },
          data: { usedAt: new Date() },
        }),
      ]);
      await sessions.revokeAll({ userId: record.userId });
    },

    async setupTwoFactor(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.totpEnabledAt)
        throw new ConflictError('La verificación en dos pasos ya está activa.');
      const secret = generateTotpSecret();
      await db.user.update({ where: { id: userId }, data: { totpSecret: cipher.encrypt(secret) } });
      return { secret, otpauthUrl: totpUri(secret, user.email) };
    },

    async enableTwoFactor(userId: string, code: string): Promise<void> {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.totpEnabledAt)
        throw new ConflictError('La verificación en dos pasos ya está activa.');
      if (!user.totpSecret)
        throw new BadRequestError('Primero genera el código QR de configuración.');
      const step = verifyTotp(cipher.decrypt(user.totpSecret), code);
      if (step === null) throw new BadRequestError('El código de verificación no es válido.');
      await db.user.update({
        where: { id: userId },
        data: { totpEnabledAt: new Date(), totpLastStep: step },
      });
    },

    async disableTwoFactor(
      userId: string,
      input: { password: string; code: string },
    ): Promise<void> {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.totpEnabledAt || !user.totpSecret) {
        throw new BadRequestError('La verificación en dos pasos no está activa.');
      }
      const passwordOk = user.passwordHash
        ? await verifySecret(user.passwordHash, input.password)
        : false;
      const step = verifyTotp(cipher.decrypt(user.totpSecret), input.code);
      if (
        !passwordOk ||
        step === null ||
        (user.totpLastStep !== null && step <= user.totpLastStep)
      ) {
        throw new UnauthorizedError('La contraseña o el código no son válidos.');
      }
      await db.user.update({
        where: { id: userId },
        data: { totpEnabledAt: null, totpSecret: null, totpLastStep: null },
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
