import { randomToken, safeEqual, sha256 } from '../../lib/crypto.ts';
import type { DbClient, DbTransaction } from '../../lib/db.ts';
import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from '../../lib/errors.ts';
import { hashSecret, verifySecret } from './passwords.ts';
import { LOCK_MINUTES, lockedError, MAX_FAILED_ATTEMPTS } from './service.ts';
import type { IssuedTokens } from './service.ts';
import type { RequestMeta, SessionService } from './sessions.ts';
import type { TokenService } from './tokens.ts';

const ENROLLMENT_HOURS = 24;
const UNKNOWN_DEVICE = 'Este celular no está registrado. Pide un código QR al despachador.';

export interface DeviceCredentials {
  deviceId: string;
  deviceSecret: string;
}

export interface DeviceInfo {
  platform?: string | undefined;
  model?: string | undefined;
  appVersion?: string | undefined;
}

/**
 * Acceso de choferes: el despachador genera un QR de un solo uso, el chofer lo escanea y
 * queda vinculado a ese celular con un PIN de 4 dígitos. El PIN solo sirve junto con el
 * secreto del celular, así que no se puede probar desde otro equipo.
 */
export function createDriverAuthService(deps: {
  db: DbClient;
  sessions: SessionService;
  tokens: TokenService;
}) {
  const { db, sessions, tokens } = deps;

  async function issueDriverTokens(
    driver: { id: string; tenantId: string },
    deviceId: string,
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const { session, refreshToken } = await sessions.start(
      { principal: 'driver', driverId: driver.id, deviceId, tenantId: driver.tenantId },
      meta,
    );
    await db.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } });
    const accessToken = await tokens.signAccess({
      kind: 'driver',
      sub: driver.id,
      sid: session.id,
      tenantId: driver.tenantId,
      deviceId,
    });
    return { accessToken, expiresIn: tokens.accessTtlSeconds, refreshToken };
  }

  async function authenticateDevice(credentials: DeviceCredentials) {
    const device = await db.device.findUnique({ where: { id: credentials.deviceId } });
    if (
      !device ||
      device.revokedAt ||
      !safeEqual(device.secretHash, sha256(credentials.deviceSecret))
    ) {
      throw new UnauthorizedError(UNKNOWN_DEVICE);
    }
    return device;
  }

  async function linkedDriver(deviceId: string, driverId: string) {
    const link = await db.driverDevice.findUnique({
      where: { driverId_deviceId: { driverId, deviceId } },
      include: { driver: { include: { pin: true } } },
    });
    const driver = link?.driver;
    if (!link || link.revokedAt || !driver || driver.status !== 'active' || driver.deletedAt) {
      throw new UnauthorizedError(
        'Este chofer no está vinculado a este celular. Pide un código QR al despachador.',
      );
    }
    return driver;
  }

  return {
    /** El despachador genera un QR nuevo; los anteriores sin usar dejan de servir. */
    async createEnrollment(
      tx: DbTransaction,
      input: { driverId: string; createdByUserId: string },
    ) {
      const driver = await tx.driver.findFirst({ where: { id: input.driverId, deletedAt: null } });
      if (!driver) throw new NotFoundError('No se encontró el chofer.');
      if (driver.status !== 'active') throw new BadRequestError('El chofer está inactivo.');

      await tx.driverEnrollment.updateMany({
        where: { driverId: driver.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });
      const code = randomToken(24);
      const expiresAt = new Date(Date.now() + ENROLLMENT_HOURS * 60 * 60_000);
      await tx.driverEnrollment.create({
        data: {
          tenantId: driver.tenantId,
          driverId: driver.id,
          codeHash: sha256(code),
          expiresAt,
          createdByUserId: input.createdByUserId,
        },
      });
      return {
        code,
        qrPayload: `shiftlane-chofer://vincular?codigo=${code}`,
        expiresAt,
      };
    },

    /** El chofer escanea el QR. Si es su primer celular, crea su PIN en el mismo paso. */
    async enroll(
      input: {
        code: string;
        pin?: string | undefined;
        device?: Partial<DeviceCredentials> & DeviceInfo;
      },
      meta: RequestMeta,
    ) {
      const enrollment = await db.driverEnrollment.findUnique({
        where: { codeHash: sha256(input.code) },
        include: { driver: { include: { pin: true } } },
      });
      if (!enrollment || enrollment.usedAt || enrollment.expiresAt <= new Date()) {
        throw new UnauthorizedError(
          'El código QR no es válido o ya se usó. Pide uno nuevo al despachador.',
        );
      }
      const { driver } = enrollment;
      if (driver.status !== 'active' || driver.deletedAt) {
        throw new UnauthorizedError('El chofer está inactivo. Habla con el despachador.');
      }
      const hasPin = Boolean(driver.pin?.pinHash);
      if (!hasPin && !input.pin) {
        throw new BadRequestError('Crea un PIN de 4 dígitos para entrar a la app.');
      }

      // Celular compartido: si ya está registrado en la misma empresa, se reutiliza.
      let deviceId: string;
      let newDeviceSecret: string | null = null;
      if (input.device?.deviceId && input.device.deviceSecret) {
        const device = await authenticateDevice({
          deviceId: input.device.deviceId,
          deviceSecret: input.device.deviceSecret,
        });
        if (device.tenantId !== driver.tenantId) throw new UnauthorizedError(UNKNOWN_DEVICE);
        deviceId = device.id;
      } else {
        newDeviceSecret = randomToken();
        const device = await db.device.create({
          data: {
            tenantId: driver.tenantId,
            secretHash: sha256(newDeviceSecret),
            platform: input.device?.platform ?? null,
            model: input.device?.model ?? null,
            appVersion: input.device?.appVersion ?? null,
          },
        });
        deviceId = device.id;
      }

      const claimed = await db.driverEnrollment.updateMany({
        where: { id: enrollment.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedError(
          'El código QR no es válido o ya se usó. Pide uno nuevo al despachador.',
        );
      }

      await db.driverDevice.upsert({
        where: { driverId_deviceId: { driverId: driver.id, deviceId } },
        update: { revokedAt: null, enrolledAt: new Date() },
        create: { driverId: driver.id, deviceId, tenantId: driver.tenantId },
      });
      if (!hasPin && input.pin) {
        const pinHash = await hashSecret(input.pin);
        await db.driverPin.upsert({
          where: { driverId: driver.id },
          update: { pinHash, failedAttempts: 0, lockedUntil: null },
          create: { driverId: driver.id, tenantId: driver.tenantId, pinHash },
        });
      }

      const issued = await issueDriverTokens(driver, deviceId, meta);
      return {
        ...issued,
        driver: { id: driver.id, fullName: driver.fullName },
        device: { id: deviceId, secret: newDeviceSecret },
      };
    },

    /** Choferes vinculados al celular, para elegir quién entra en un celular compartido. */
    async listDeviceDrivers(credentials: DeviceCredentials) {
      const device = await authenticateDevice(credentials);
      const links = await db.driverDevice.findMany({
        where: {
          deviceId: device.id,
          revokedAt: null,
          driver: { status: 'active', deletedAt: null },
        },
        include: { driver: { include: { pin: true } } },
        orderBy: { driver: { fullName: 'asc' } },
      });
      return links.map(({ driver }) => ({
        id: driver.id,
        fullName: driver.fullName,
        pinSet: Boolean(driver.pin?.pinHash),
      }));
    },

    async login(input: DeviceCredentials & { driverId: string; pin: string }, meta: RequestMeta) {
      const device = await authenticateDevice(input);
      const driver = await linkedDriver(device.id, input.driverId);
      const pin = driver.pin;
      if (!pin?.pinHash) {
        throw new AppError(409, 'PIN_NOT_SET', 'Necesitas crear un PIN nuevo.');
      }
      if (pin.lockedUntil && pin.lockedUntil > new Date()) throw lockedError(pin.lockedUntil);

      if (!(await verifySecret(pin.pinHash, input.pin))) {
        const attempts = pin.failedAttempts + 1;
        await db.driverPin.update({
          where: { driverId: driver.id },
          data:
            attempts >= MAX_FAILED_ATTEMPTS
              ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
              : { failedAttempts: attempts },
        });
        throw new UnauthorizedError('El PIN no es correcto.');
      }
      await db.driverPin.update({
        where: { driverId: driver.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      return issueDriverTokens(driver, device.id, meta);
    },

    /** Después de que el despachador restablece el PIN, el chofer crea uno nuevo en su celular. */
    async setPin(input: DeviceCredentials & { driverId: string; pin: string }, meta: RequestMeta) {
      const device = await authenticateDevice(input);
      const driver = await linkedDriver(device.id, input.driverId);
      if (driver.pin?.pinHash) {
        throw new AppError(
          409,
          'PIN_ALREADY_SET',
          'El chofer ya tiene PIN. Si lo olvidó, pide al despachador que lo restablezca.',
        );
      }
      const pinHash = await hashSecret(input.pin);
      await db.driverPin.upsert({
        where: { driverId: driver.id },
        update: { pinHash, failedAttempts: 0, lockedUntil: null },
        create: { driverId: driver.id, tenantId: driver.tenantId, pinHash },
      });
      return issueDriverTokens(driver, device.id, meta);
    },

    /** El despachador restablece el PIN: se cierran las sesiones del chofer. */
    async resetPin(tx: DbTransaction, driverId: string): Promise<void> {
      const driver = await tx.driver.findFirst({ where: { id: driverId, deletedAt: null } });
      if (!driver) throw new NotFoundError('No se encontró el chofer.');
      await tx.driverPin.upsert({
        where: { driverId: driver.id },
        update: { pinHash: null, failedAttempts: 0, lockedUntil: null },
        create: { driverId: driver.id, tenantId: driver.tenantId, pinHash: null },
      });
      await sessions.revokeAll({ driverId: driver.id });
    },
  };
}

export type DriverAuthService = ReturnType<typeof createDriverAuthService>;
