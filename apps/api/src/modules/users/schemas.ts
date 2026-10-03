import { z } from '../../lib/zod.ts';

export const userParams = z.object({ userId: z.uuid() });

export const userSummary = z.object({
  id: z.uuid(),
  kind: z.enum(['carrier', 'plant', 'platform']),
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  status: z.enum(['invited', 'active', 'disabled']),
  roles: z.array(z.string()),
  grantedPermissions: z.array(z.string()),
  revokedPermissions: z.array(z.string()),
  lastLoginAt: z.date().nullable(),
});

export const usersResponse = z.array(userSummary);

export const updateUserBody = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No hay cambios que guardar.' });

export const setRolesBody = z.object({
  roles: z.array(z.string()).min(1, 'Asigna al menos un rol.').max(10),
});

export const setPermissionsBody = z.object({
  grants: z.array(z.string()).max(60).default([]),
  revokes: z.array(z.string()).max(60).default([]),
});

export const myPermissionsResponse = z.object({
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});
