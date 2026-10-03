// Datos de ejemplo para desarrollo: 2 transportistas, 2 empresas cliente con una planta cada
// una y usuarios de cada tipo. Se puede correr varias veces (usa identificadores fijos).
// Uso: pnpm db:seed
import { existsSync } from 'node:fs';

import { createDatabase } from '../src/lib/db.ts';
import type { DbClient } from '../src/lib/db.ts';

export const SEED = {
  tenants: {
    norte: { id: '00000000-0000-4000-8000-000000000001', name: 'Transportes del Norte' },
    juarez: { id: '00000000-0000-4000-8000-000000000002', name: 'Rutas Juárez' },
  },
  clientOrgs: {
    alfa: { id: '00000000-0000-4000-8000-000000000101', name: 'Maquiladora Alfa' },
    beta: { id: '00000000-0000-4000-8000-000000000102', name: 'Electrónica Beta' },
  },
  plants: {
    alfaNorte: {
      id: '00000000-0000-4000-8000-000000000201',
      name: 'Planta Alfa Norte',
      address: 'Parque Industrial Antonio J. Bermúdez, Ciudad Juárez, Chih.',
      lat: 31.7256,
      lng: -106.4136,
    },
    betaSalvarcar: {
      id: '00000000-0000-4000-8000-000000000202',
      name: 'Planta Beta Salvárcar',
      address: 'Parque Industrial Salvárcar, Ciudad Juárez, Chih.',
      lat: 31.647,
      lng: -106.3735,
    },
  },
  users: {
    norteOwner: {
      id: '00000000-0000-4000-8000-000000000301',
      email: 'dueno@transportes-norte.example',
    },
    norteDispatcher: {
      id: '00000000-0000-4000-8000-000000000302',
      email: 'despacho@transportes-norte.example',
    },
    juarezOwner: {
      id: '00000000-0000-4000-8000-000000000303',
      email: 'dueno@rutas-juarez.example',
    },
    alfaLogistics: {
      id: '00000000-0000-4000-8000-000000000304',
      email: 'logistica@maquiladora-alfa.example',
    },
    betaHr: { id: '00000000-0000-4000-8000-000000000305', email: 'rh@electronica-beta.example' },
    platformAdmin: { id: '00000000-0000-4000-8000-000000000306', email: 'admin@shiftlane.example' },
  },
} as const;

/** Siembra los datos con un cliente que se salta la seguridad por filas (db.system). */
export async function seed(db: DbClient): Promise<void> {
  const { tenants, clientOrgs, plants, users } = SEED;

  for (const tenant of Object.values(tenants)) {
    await db.tenant.upsert({ where: { id: tenant.id }, update: {}, create: tenant });
  }

  const claimedAt = new Date('2026-10-01T00:00:00Z');
  await db.clientOrg.upsert({
    where: { id: clientOrgs.alfa.id },
    update: {},
    create: { ...clientOrgs.alfa, createdByTenantId: tenants.norte.id, claimedAt },
  });
  await db.clientOrg.upsert({
    where: { id: clientOrgs.beta.id },
    update: {},
    create: { ...clientOrgs.beta, createdByTenantId: tenants.juarez.id, claimedAt },
  });

  const plantOrgs = [
    [plants.alfaNorte, clientOrgs.alfa.id],
    [plants.betaSalvarcar, clientOrgs.beta.id],
  ] as const;
  for (const [plant, clientOrgId] of plantOrgs) {
    await db.plant.upsert({
      where: { id: plant.id },
      update: {},
      create: { id: plant.id, name: plant.name, address: plant.address, clientOrgId },
    });
    await db.$executeRaw`
      UPDATE plants SET location = ST_SetSRID(ST_MakePoint(${plant.lng}, ${plant.lat}), 4326)::geography
      WHERE id = ${plant.id}::uuid`;
  }

  // Rutas Juárez también da servicio a Maquiladora Alfa: una planta con dos transportistas.
  const agreements = [
    [tenants.norte.id, plants.alfaNorte.id, clientOrgs.alfa.id],
    [tenants.juarez.id, plants.betaSalvarcar.id, clientOrgs.beta.id],
    [tenants.juarez.id, plants.alfaNorte.id, clientOrgs.alfa.id],
  ] as const;
  for (const [tenantId, plantId, clientOrgId] of agreements) {
    await db.serviceAgreement.upsert({
      where: { tenantId_plantId: { tenantId, plantId } },
      update: {},
      create: { tenantId, plantId, clientOrgId, status: 'active' },
    });
  }

  const people = [
    {
      ...users.norteOwner,
      fullName: 'Laura Méndez',
      kind: 'carrier',
      tenantId: tenants.norte.id,
      role: 'owner',
    },
    {
      ...users.norteDispatcher,
      fullName: 'Jorge Ruiz',
      kind: 'carrier',
      tenantId: tenants.norte.id,
      role: 'dispatcher',
    },
    {
      ...users.juarezOwner,
      fullName: 'Ana Torres',
      kind: 'carrier',
      tenantId: tenants.juarez.id,
      role: 'owner',
    },
    {
      ...users.alfaLogistics,
      fullName: 'Ricardo Salas',
      kind: 'plant',
      clientOrgId: clientOrgs.alfa.id,
      role: 'plant_logistics',
    },
    {
      ...users.betaHr,
      fullName: 'Patricia León',
      kind: 'plant',
      clientOrgId: clientOrgs.beta.id,
      role: 'plant_hr',
    },
    {
      ...users.platformAdmin,
      fullName: 'Administración Shiftlane',
      kind: 'platform',
      role: 'platform_admin',
    },
  ] as const;
  for (const { role, ...person } of people) {
    await db.user.upsert({ where: { id: person.id }, update: {}, create: person });
    const roleRow = await db.role.findUniqueOrThrow({ where: { key: role } });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: person.id, roleId: roleRow.id } },
      update: {},
      create: { userId: person.id, roleId: roleRow.id },
    });
  }
}

if (import.meta.main) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL para sembrar los datos de ejemplo.');
  const database = createDatabase(url);
  try {
    await seed(database.system);
    console.log('Datos de ejemplo listos: 2 transportistas, 2 plantas, 6 usuarios.');
  } finally {
    await database.close();
  }
}
