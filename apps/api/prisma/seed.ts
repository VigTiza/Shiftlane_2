// Datos de ejemplo para desarrollo: 2 transportistas, 2 empresas cliente con una planta cada
// una y usuarios de cada tipo. Se puede correr varias veces (usa identificadores fijos).
// Uso: pnpm db:seed
import { existsSync } from 'node:fs';

import { createDatabase } from '../src/lib/db.ts';
import type { DbClient } from '../src/lib/db.ts';
import { hashSecret } from '../src/modules/auth/passwords.ts';

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
      activationCode: 'ALFANORTE',
    },
    betaSalvarcar: {
      id: '00000000-0000-4000-8000-000000000202',
      name: 'Planta Beta Salvárcar',
      address: 'Parque Industrial Salvárcar, Ciudad Juárez, Chih.',
      lat: 31.647,
      lng: -106.3735,
      activationCode: 'BETASALV',
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
  vehicles: {
    u001: {
      id: '00000000-0000-4000-8000-000000000601',
      economicNumber: 'U-001',
      plates: 'EFR1234',
      make: 'Mercedes-Benz',
      model: 'Sprinter 516',
      year: 2022,
      capacity: 19,
    },
    u002: {
      id: '00000000-0000-4000-8000-000000000602',
      economicNumber: 'U-002',
      plates: 'EFR5678',
      make: 'Toyota',
      model: 'Hiace',
      year: 2021,
      capacity: 15,
    },
  },
  drivers: {
    norteJuan: {
      id: '00000000-0000-4000-8000-000000000401',
      fullName: 'Juan Hernández',
      employeeNumber: 'CH-001',
    },
    norteMaria: {
      id: '00000000-0000-4000-8000-000000000402',
      fullName: 'María Gómez',
      employeeNumber: 'CH-002',
    },
  },
  passengers: [
    {
      id: '00000000-0000-4000-8000-000000000501',
      employeeNumber: 'A-1001',
      fullName: 'Rosa Martínez',
    },
    {
      id: '00000000-0000-4000-8000-000000000502',
      employeeNumber: 'A-1002',
      fullName: 'Luis Chávez',
    },
    {
      id: '00000000-0000-4000-8000-000000000503',
      employeeNumber: 'A-1003',
      fullName: 'Karla Reyes',
    },
  ],
} as const;

/**
 * Siembra los datos con un cliente que se salta la seguridad por filas (db.system).
 * Si se pasa `userPassword`, los usuarios de ejemplo pueden iniciar sesión con ella.
 */
export async function seed(db: DbClient, options: { userPassword?: string } = {}): Promise<void> {
  const { tenants, clientOrgs, plants, users, vehicles, drivers, passengers } = SEED;
  const passwordHash = options.userPassword ? await hashSecret(options.userPassword) : null;

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
      create: {
        id: plant.id,
        name: plant.name,
        address: plant.address,
        clientOrgId,
        passengerActivationCode: plant.activationCode,
      },
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
    await db.user.upsert({
      where: { id: person.id },
      update: passwordHash ? { passwordHash } : {},
      create: { ...person, passwordHash },
    });
    const roleRow = await db.role.findUniqueOrThrow({ where: { key: role } });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: person.id, roleId: roleRow.id } },
      update: {},
      create: { userId: person.id, roleId: roleRow.id },
    });
  }

  for (const vehicle of Object.values(vehicles)) {
    await db.vehicle.upsert({
      where: { id: vehicle.id },
      update: {},
      create: { ...vehicle, tenantId: tenants.norte.id },
    });
  }
  // Documentos: uno vigente, uno por vencer y uno vencido, relativos a la fecha de siembra.
  const inDays = (days: number) => new Date(Date.UTC(2026, 9, 1) + days * 86_400_000);
  const vehicleDocuments = [
    {
      id: '00000000-0000-4000-8000-000000000701',
      vehicleId: vehicles.u001.id,
      type: 'insurance',
      expiresOn: inDays(200),
    },
    {
      id: '00000000-0000-4000-8000-000000000702',
      vehicleId: vehicles.u001.id,
      type: 'emissions_verification',
      expiresOn: inDays(20),
    },
    {
      id: '00000000-0000-4000-8000-000000000703',
      vehicleId: vehicles.u002.id,
      type: 'insurance',
      expiresOn: inDays(-5),
    },
  ] as const;
  for (const doc of vehicleDocuments) {
    await db.vehicleDocument.upsert({
      where: { id: doc.id },
      update: {},
      create: { ...doc, tenantId: tenants.norte.id },
    });
  }

  const habitual = [vehicles.u001.id, vehicles.u002.id];
  for (const [index, driver] of Object.values(drivers).entries()) {
    await db.driver.upsert({
      where: { id: driver.id },
      update: {},
      create: { ...driver, tenantId: tenants.norte.id, habitualVehicleId: habitual[index] ?? null },
    });
  }

  for (const passenger of passengers) {
    await db.passenger.upsert({
      where: { id: passenger.id },
      update: {},
      create: { ...passenger, clientOrgId: clientOrgs.alfa.id, plantId: plants.alfaNorte.id },
    });
  }
}

if (import.meta.main) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL para sembrar los datos de ejemplo.');
  const database = createDatabase(url);
  try {
    const userPassword = process.env.SEED_USER_PASSWORD;
    await seed(database.system, userPassword ? { userPassword } : {});
    console.log(
      'Datos de ejemplo listos: 2 transportistas, 2 plantas, 6 usuarios, 2 unidades, 2 choferes y 3 pasajeros.' +
        (userPassword
          ? ' Los usuarios entran con SEED_USER_PASSWORD.'
          : ' Usuarios sin contraseña (define SEED_USER_PASSWORD).'),
    );
  } finally {
    await database.close();
  }
}
