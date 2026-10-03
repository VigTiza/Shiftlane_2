import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { buildSpreadsheet } from '../../../lib/excel.ts';
import { DRIVER_COLUMNS } from '../schemas.ts';

const PASSWORD = 'Transporte2026';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let vehicleId: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

function isoDate(daysFromToday: number): string {
  return new Date(Date.now() + daysFromToday * 86_400_000).toISOString().slice(0, 10);
}

function createDriver(body: Record<string, unknown> = {}, auth = ownerAuth) {
  return request(app.server)
    .post('/drivers')
    .set('authorization', auth)
    .send({ fullName: 'Pedro Sánchez Ruiz', ...body });
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  const owner = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
  ownerAuth = await tokenFor(owner.email);
  const vehicle = await request(app.server)
    .post('/vehicles')
    .set('authorization', ownerAuth)
    .send({ economicNumber: 'CH-U01', plates: 'CHU0001', model: 'Urvan', year: 2022, capacity: 15 })
    .expect(201);
  vehicleId = vehicle.body.id as string;
});

afterAll(async () => {
  await app.close();
});

describe('catálogo de choferes', () => {
  it('da de alta un chofer con unidad habitual y contacto de emergencia', async () => {
    const response = await createDriver({
      employeeNumber: 'CH-100',
      phone: '656 111 2233',
      licenseNumber: 'CHH998877',
      licenseType: 'C',
      emergencyContactName: 'María Ruiz',
      emergencyContactPhone: '656 444 5566',
      habitualVehicleId: vehicleId,
    }).expect(201);
    expect(response.body).toMatchObject({
      employeeNumber: 'CH-100',
      status: 'active',
      habitualVehicle: { id: vehicleId, economicNumber: 'CH-U01' },
      access: { pinSet: false, devices: 0 },
      documents: { expired: 0, expiring: 0 },
    });
  });

  it('no repite números de empleado y valida la unidad habitual', async () => {
    await createDriver({ employeeNumber: 'CH-200' }).expect(201);
    const duplicate = await createDriver({ employeeNumber: 'CH-200' }).expect(409);
    expect(duplicate.body.error.message).toBe('Ya existe un chofer con ese número de empleado.');

    const otherTenant = await fx.tenant();
    const foreignVehicle = await app.db.system.vehicle.create({
      data: {
        tenantId: otherTenant.id,
        economicNumber: 'X-1',
        plates: 'XXX0001',
        model: 'X',
        year: 2020,
        capacity: 10,
      },
    });
    const invalid = await createDriver({ habitualVehicleId: foreignVehicle.id }).expect(400);
    expect(invalid.body.error.message).toBe('La unidad habitual no existe.');
  });

  it('busca por nombre o número y pagina', async () => {
    await createDriver({ fullName: 'Zacarías Búsqueda Uno', employeeNumber: 'BQ-1' }).expect(201);
    await createDriver({
      fullName: 'Zacarías Búsqueda Dos',
      employeeNumber: 'BQ-2',
      status: 'inactive',
    }).expect(201);
    const all = await request(app.server)
      .get('/drivers')
      .query({ search: 'zacarías' })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(all.body.total).toBe(2);
    const inactive = await request(app.server)
      .get('/drivers')
      .query({ search: 'BQ-', status: 'inactive' })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(inactive.body.items.map((d: { employeeNumber: string }) => d.employeeNumber)).toEqual([
      'BQ-2',
    ]);
  });

  it('registra licencia, examen médico y antidoping con su vencimiento', async () => {
    const { body: driver } = await createDriver({ employeeNumber: 'DOC-1' }).expect(201);
    const id = driver.id as string;
    const add = (body: object) =>
      request(app.server)
        .post(`/drivers/${id}/documents`)
        .set('authorization', ownerAuth)
        .send(body)
        .expect(201);
    await add({ type: 'license', number: 'CHH123', expiresOn: isoDate(5) });
    await add({ type: 'medical_exam', expiresOn: isoDate(-1) });
    const drugTest = await add({ type: 'drug_test', expiresOn: isoDate(120) });

    const attached = await request(app.server)
      .put(`/driver-documents/${drugTest.body.id as string}/file`)
      .set('authorization', ownerAuth)
      .attach('file', JPG, { filename: 'antidoping.jpg', contentType: 'image/jpeg' })
      .expect(200);
    expect(attached.body.hasFile).toBe(true);

    const detail = await request(app.server)
      .get(`/drivers/${id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.documents).toEqual({ expired: 1, expiring: 1 });
  });

  it('sube su foto, guarda historial y al darlo de baja lo desvincula de sus celulares', async () => {
    const { body: driver } = await createDriver({ employeeNumber: 'HIS-1' }).expect(201);
    const id = driver.id as string;
    await request(app.server)
      .put(`/drivers/${id}/photo`)
      .set('authorization', ownerAuth)
      .attach('file', JPG, { filename: 'foto.jpg', contentType: 'image/jpeg' })
      .expect(204);
    await request(app.server)
      .patch(`/drivers/${id}`)
      .set('authorization', ownerAuth)
      .send({ phone: '656 999 0000' })
      .expect(200);
    await request(app.server)
      .post(`/drivers/${id}/pin-reset`)
      .set('authorization', ownerAuth)
      .expect(200);

    const device = await app.db.system.device.create({ data: { tenantId, secretHash: 'x' } });
    await app.db.system.driverDevice.create({
      data: { driverId: id, deviceId: device.id, tenantId },
    });

    const history = await request(app.server)
      .get(`/drivers/${id}/history`)
      .set('authorization', ownerAuth)
      .expect(200);
    const kinds = (history.body as { entityType: string }[]).map((h) => h.entityType);
    expect(kinds).toEqual(expect.arrayContaining(['drivers', 'driver_pins']));

    await request(app.server).delete(`/drivers/${id}`).set('authorization', ownerAuth).expect(204);
    const link = await app.db.system.driverDevice.findFirstOrThrow({ where: { driverId: id } });
    expect(link.revokedAt).not.toBeNull();
  });
});

describe('importación de choferes en Excel', () => {
  type Row = Partial<Record<(typeof DRIVER_COLUMNS)[number]['key'], string | number | null>>;
  async function upload(rows: Row[], dryRun: boolean) {
    const buffer = await buildSpreadsheet(DRIVER_COLUMNS, rows, 'Choferes');
    return request(app.server)
      .post('/drivers/import')
      .query({ dryRun })
      .set('authorization', ownerAuth)
      .attach('file', buffer, { filename: 'choferes.xlsx' });
  }

  it('relaciona la unidad habitual por número económico y reporta las que no existen', async () => {
    const bad = await upload(
      [
        {
          employeeNumber: 'IMPCH-1',
          fullName: 'Chofer Uno',
          habitualVehicle: 'CH-U01',
          status: 'Activo',
        },
        { employeeNumber: 'IMPCH-2', fullName: 'Chofer Dos', habitualVehicle: 'NO-EXISTE' },
        { employeeNumber: 'IMPCH-3', fullName: 'Al', phone: 'abc' },
      ],
      false,
    );
    expect(bad.body.applied).toBe(false);
    expect(bad.body.errors).toEqual(
      expect.arrayContaining([
        {
          row: 3,
          column: 'Unidad habitual (número económico)',
          message: 'No existe la unidad NO-EXISTE.',
        },
        { row: 4, column: 'Nombre completo', message: 'Escribe el nombre completo.' },
        { row: 4, column: 'Teléfono', message: 'Escribe un teléfono válido.' },
      ]),
    );

    const good = await upload(
      [
        {
          employeeNumber: 'IMPCH-1',
          fullName: 'Chofer Uno',
          habitualVehicle: 'ch-u01',
          phone: '656 000 1111',
        },
      ],
      false,
    );
    expect(good.body).toMatchObject({ created: 1, updated: 0, applied: true });
    const list = await request(app.server)
      .get('/drivers')
      .query({ search: 'IMPCH-1' })
      .set('authorization', ownerAuth);
    expect(list.body.items[0].habitualVehicle).toEqual({ id: vehicleId, economicNumber: 'CH-U01' });
  });

  it('exporta los choferes', async () => {
    await request(app.server).get('/drivers/export').set('authorization', ownerAuth).expect(200);
    await request(app.server)
      .get('/drivers/import/template')
      .set('authorization', ownerAuth)
      .expect(200);
  });
});

describe('permisos y aislamiento de choferes', () => {
  it('el despachador da de alta choferes; el programador solo los ve; mantenimiento no', async () => {
    const dispatcher = await tokenFor(
      (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['dispatcher'] })).email,
    );
    const planner = await tokenFor(
      (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['planner'] })).email,
    );
    const maintenance = await tokenFor(
      (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['maintenance'] })).email,
    );

    await createDriver({}, dispatcher).expect(201);
    await createDriver({}, planner).expect(403);
    await request(app.server).get('/drivers').set('authorization', planner).expect(200);
    await request(app.server).get('/drivers').set('authorization', maintenance).expect(403);
  });

  it('otra transportista no ve los choferes', async () => {
    const { body: driver } = await createDriver({ employeeNumber: 'ISO-1' }).expect(201);
    const otherTenant = await fx.tenant();
    const other = await tokenFor(
      (await fx.carrierUser({ tenantId: otherTenant.id, password: PASSWORD })).email,
    );
    await request(app.server)
      .get(`/drivers/${driver.id as string}`)
      .set('authorization', other)
      .expect(404);
    await request(app.server)
      .delete(`/drivers/${driver.id as string}`)
      .set('authorization', other)
      .expect(404);
  });
});
