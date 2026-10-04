// Cuenta nueva para las pruebas de Playwright del panel web: una transportista vacía con su
// dueño y un Excel de unidades listo para importar. Escribe los datos en el archivo indicado.
// Uso: node scripts/e2e/web-account.ts <salida.json>
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { loadEnv } from '../../src/config/env.ts';
import { createDatabase } from '../../src/lib/db.ts';
import { buildSpreadsheet } from '../../src/lib/excel.ts';
import { hashSecret } from '../../src/modules/auth/passwords.ts';
import { VEHICLE_COLUMNS } from '../../src/modules/vehicles/schemas.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const output = resolve(process.argv[2] ?? 'e2e-account.json');
const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);

try {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const password = `Prueba-${randomBytes(6).toString('base64url')}1`;
  const tenant = await database.system.tenant.create({
    data: { name: `Transportes E2E ${stamp}` },
  });
  const user = await database.system.user.create({
    data: {
      kind: 'carrier',
      tenantId: tenant.id,
      email: `e2e+${stamp}@shiftlane.example`,
      fullName: 'Dueña de Prueba',
      status: 'active',
      passwordHash: await hashSecret(password),
    },
  });
  const owner = await database.system.role.findUniqueOrThrow({ where: { key: 'owner' } });
  await database.system.userRole.create({ data: { userId: user.id, roleId: owner.id } });

  const xlsx = resolve(dirname(output), 'unidades-e2e.xlsx');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    xlsx,
    await buildSpreadsheet(
      VEHICLE_COLUMNS,
      [
        {
          economicNumber: 'E2E-01',
          plates: `E2E${stamp.slice(-4)}A`,
          model: 'Sprinter 516',
          year: 2023,
          capacity: 19,
        },
        {
          economicNumber: 'E2E-02',
          plates: `E2E${stamp.slice(-4)}B`,
          model: 'Hiace',
          year: 2022,
          capacity: 15,
        },
      ],
      'Unidades',
    ),
  );
  writeFileSync(
    output,
    JSON.stringify(
      { email: user.email, password, tenantName: tenant.name, vehiclesXlsx: xlsx },
      null,
      2,
    ),
  );
  console.log(`[e2e] Cuenta lista: ${user.email}`);
} finally {
  await database.close();
}
