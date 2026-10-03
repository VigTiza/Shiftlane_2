import { optionalText } from '../../lib/http-schemas.ts';
import { z } from '../../lib/zod.ts';

const rfc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'El RFC no tiene un formato válido.');

const latitude = z
  .number()
  .min(14, 'La latitud está fuera de México.')
  .max(33, 'La latitud está fuera de México.');
const longitude = z
  .number()
  .min(-119, 'La longitud está fuera de México.')
  .max(-86, 'La longitud está fuera de México.');

export const location = z.object({ lat: latitude, lng: longitude });

export const listClientOrgsQuery = z.object({ search: z.string().trim().max(80).optional() });

export const createClientOrgBody = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la empresa.').max(120),
  legalName: optionalText(200),
  rfc: rfc.nullable().optional(),
});

export const updateClientOrgBody = createClientOrgBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const createPlantBody = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la planta.').max(120),
  address: optionalText(300),
  location: location.nullable().optional(),
  timezone: z.string().max(60).default('America/Ciudad_Juarez'),
});

export const updatePlantBody = createPlantBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const gateBody = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la puerta.').max(80),
  location: location.nullable().optional(),
});

export const updateGateBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    active: z.boolean().optional(),
    location: location.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const CONTACT_AREAS = [
  'logistics',
  'hr',
  'security',
  'purchasing',
  'finance',
  'management',
  'other',
] as const;

export const contactBody = z.object({
  fullName: z.string().trim().min(3, 'Escribe el nombre del contacto.').max(120),
  area: z.enum(CONTACT_AREAS).default('other'),
  position: optionalText(80),
  email: z.email({ message: 'Escribe un correo válido.' }).max(254).nullable().optional(),
  phone: optionalText(20),
  plantId: z.uuid().nullable().optional(),
  notes: optionalText(1000),
});

export const updateContactBody = contactBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

// --- Respuestas -------------------------------------------------------------

export const gateSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
  qrPayload: z.string(),
  location: location.nullable(),
});

export const plantSummary = z.object({
  id: z.uuid(),
  clientOrgId: z.uuid(),
  name: z.string(),
  address: z.string().nullable(),
  timezone: z.string(),
  location: location.nullable(),
  /** La transportista tiene acuerdo de servicio con esta planta. */
  served: z.boolean(),
  /** Código para activar la app del pasajero (solo si la transportista administra la empresa). */
  passengerActivationCode: z.string().nullable(),
});

export const plantDetail = plantSummary.extend({ gates: z.array(gateSummary) });

export const contactSummary = z.object({
  id: z.uuid(),
  clientOrgId: z.uuid(),
  plantId: z.uuid().nullable(),
  fullName: z.string(),
  area: z.enum(CONTACT_AREAS),
  position: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
});

export const clientOrgSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  legalName: z.string().nullable(),
  rfc: z.string().nullable(),
  /** La transportista puede editarla: la registró y la empresa aún no tiene usuarios propios. */
  managed: z.boolean(),
  plants: z.array(plantSummary),
});

export const clientOrgDetail = clientOrgSummary.extend({
  contacts: z.array(contactSummary),
  contracts: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      status: z.string(),
      startsOn: z.string(),
      endsOn: z.string().nullable(),
    }),
  ),
});
