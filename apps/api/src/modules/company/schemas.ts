import { optionalText } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';

const rfc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'El RFC no tiene un formato válido.');

export const companyResponse = z.object({
  id: z.uuid(),
  name: z.string(),
  legalName: z.string().nullable(),
  rfc: z.string().nullable(),
  hasLogo: z.boolean(),
});

export const updateCompanyBody = z
  .object({
    name: z.string().trim().min(2, 'Escribe el nombre comercial.').max(120).optional(),
    legalName: optionalText(200),
    rfc: rfc.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

/** Pasos del asistente de configuración inicial, en orden. */
export const ONBOARDING_STEPS = [
  'company',
  'operation',
  'fleet',
  'clients',
  'routes',
  'plant_invite',
  'devices',
  'test_trip',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const onboardingStep = z.enum(ONBOARDING_STEPS);

export const onboardingResponse = z.object({
  steps: z.array(
    z.object({
      key: onboardingStep,
      /** Hecho por los datos de la cuenta o marcado a mano. */
      done: z.boolean(),
      /** Lo que ya hay (para mostrar el avance del paso). */
      count: z.number().int(),
      markedManually: z.boolean(),
    }),
  ),
  completed: z.number().int(),
  total: z.number().int(),
  dismissed: z.boolean(),
});

export const markStepBody = z.object({ done: z.boolean() });
export const dismissBody = z.object({ dismissed: z.boolean() });
