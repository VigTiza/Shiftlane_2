import { z } from '../../lib/zod.ts';

export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    uptimeSeconds: z.number().nonnegative(),
  })
  .describe('El proceso de la API está vivo.');

export const readyResponseSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.object({
      database: z.enum(['ok', 'error']),
    }),
  })
  .describe('Estado de las dependencias necesarias para atender peticiones.');

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
