import { z } from '../../lib/zod.ts';

export const driverParams = z.object({ driverId: z.uuid() });

export const enrollmentResponse = z.object({
  code: z.string(),
  qrPayload: z.string(),
  expiresAt: z.date(),
});

export const messageResponse = z.object({ message: z.string() });
