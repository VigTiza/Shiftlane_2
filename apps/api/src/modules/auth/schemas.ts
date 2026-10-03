import { z } from '../../lib/zod.ts';
import { passwordSchema, pinSchema } from './passwords.ts';

const email = z.email({ message: 'Escribe un correo válido.' }).max(254);
const totpCode = z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.');
const refreshTokenField = z.string().min(20).max(200);

export const loginBody = z.object({ email, password: z.string().min(1).max(128) });
export const twoFactorLoginBody = z.object({ challengeToken: z.string().min(1), code: totpCode });
export const refreshBody = z.object({ refreshToken: refreshTokenField.optional() }).nullish();
export const forgotPasswordBody = z.object({ email });
export const resetPasswordBody = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const enableTwoFactorBody = z.object({ code: totpCode });
export const disableTwoFactorBody = z.object({
  password: z.string().min(1).max(128),
  code: totpCode,
});
export const sessionParams = z.object({ sessionId: z.uuid() });

const deviceCredentials = {
  deviceId: z.uuid(),
  deviceSecret: z.string().min(20).max(200),
};

export const driverEnrollBody = z.object({
  code: z.string().min(20).max(200),
  pin: pinSchema.optional(),
  device: z
    .object({
      deviceId: z.uuid().optional(),
      deviceSecret: z.string().min(20).max(200).optional(),
      platform: z.string().max(40).optional(),
      model: z.string().max(80).optional(),
      appVersion: z.string().max(40).optional(),
    })
    .optional(),
});
export const deviceCredentialsBody = z.object(deviceCredentials);
export const driverLoginBody = z.object({
  ...deviceCredentials,
  driverId: z.uuid(),
  pin: pinSchema,
});

export const passengerActivateBody = z.object({
  plantCode: z.string().min(4).max(20),
  employeeNumber: z.string().min(1).max(40),
});

// --- Respuestas -------------------------------------------------------------

export const tokenResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  /** Solo para clientes sin cookies (app del chofer). */
  refreshToken: z.string().optional(),
});

export const loginResponse = z.union([
  tokenResponse,
  z.object({ twoFactorRequired: z.literal(true), challengeToken: z.string() }),
]);

export const meResponse = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    id: z.uuid(),
    fullName: z.string(),
    email: z.string(),
    tenantId: z.uuid().nullable(),
    clientOrgId: z.uuid().nullable(),
    roles: z.array(z.string()),
    twoFactorEnabled: z.boolean(),
  }),
  z.object({ kind: z.literal('driver'), id: z.uuid(), fullName: z.string(), tenantId: z.uuid() }),
  z.object({
    kind: z.literal('passenger'),
    id: z.uuid(),
    fullName: z.string(),
    clientOrgId: z.uuid(),
    plantId: z.uuid(),
  }),
]);

export const sessionsResponse = z.array(
  z.object({
    id: z.uuid(),
    userAgent: z.string().nullable(),
    ip: z.string().nullable(),
    createdAt: z.date(),
    expiresAt: z.date(),
  }),
);

export const messageResponse = z.object({ message: z.string() });

export const twoFactorSetupResponse = z.object({ secret: z.string(), otpauthUrl: z.string() });

export const driverEnrollResponse = tokenResponse.extend({
  refreshToken: z.string(),
  driver: z.object({ id: z.uuid(), fullName: z.string() }),
  device: z.object({ id: z.uuid(), secret: z.string().nullable() }),
});

export const driverTokensResponse = tokenResponse.extend({ refreshToken: z.string() });

export const deviceDriversResponse = z.array(
  z.object({ id: z.uuid(), fullName: z.string(), pinSet: z.boolean() }),
);

export const passengerActivateResponse = tokenResponse.extend({
  passenger: z.object({ id: z.uuid(), fullName: z.string() }),
});

export const noContent = z.null().describe('Sin contenido');
