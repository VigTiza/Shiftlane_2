import { randomUUID } from 'node:crypto';

import type { DbClient } from '../../src/lib/db.ts';
import { hashSecret } from '../../src/modules/auth/passwords.ts';

/** Datos de prueba creados con db.system. Cada llamada usa nombres únicos. */
export function fixtures(db: DbClient) {
  const unique = () => randomUUID().slice(0, 8);

  return {
    async tenant(name = `Transportes ${unique()}`) {
      return db.tenant.create({ data: { name } });
    },

    async carrierUser(input: {
      tenantId: string;
      password?: string;
      roles?: string[];
      status?: 'active' | 'disabled';
    }) {
      const user = await db.user.create({
        data: {
          kind: 'carrier',
          tenantId: input.tenantId,
          email: `usuario-${unique()}@example.com`,
          fullName: 'Usuario de Prueba',
          status: input.status ?? 'active',
          passwordHash: input.password ? await hashSecret(input.password) : null,
        },
      });
      for (const key of input.roles ?? ['owner']) {
        const role = await db.role.findUniqueOrThrow({ where: { key } });
        await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      }
      return user;
    },

    async clientOrgWithPlant(input: { tenantId: string; activationCode?: string }) {
      const org = await db.clientOrg.create({
        data: {
          name: `Planta ${unique()}`,
          createdByTenantId: input.tenantId,
          claimedAt: new Date(),
        },
      });
      const plant = await db.plant.create({
        data: {
          name: `Planta ${unique()}`,
          clientOrgId: org.id,
          passengerActivationCode: input.activationCode ?? `P${unique().toUpperCase()}`,
        },
      });
      await db.serviceAgreement.create({
        data: { tenantId: input.tenantId, plantId: plant.id, clientOrgId: org.id },
      });
      return { org, plant };
    },

    async driver(input: { tenantId: string; status?: 'active' | 'inactive' }) {
      return db.driver.create({
        data: {
          tenantId: input.tenantId,
          fullName: `Chofer ${unique()}`,
          status: input.status ?? 'active',
        },
      });
    },

    async passenger(input: {
      clientOrgId: string;
      plantId: string;
      employeeNumber?: string;
      status?: 'active' | 'inactive';
    }) {
      return db.passenger.create({
        data: {
          clientOrgId: input.clientOrgId,
          plantId: input.plantId,
          employeeNumber: input.employeeNumber ?? unique(),
          fullName: 'Pasajero de Prueba',
          status: input.status ?? 'active',
        },
      });
    },
  };
}

/** Valor de una cookie en la respuesta de Supertest. */
export function cookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    const [key, value] = (pair ?? '').split('=');
    if (key === name) return value ?? null;
  }
  return null;
}
