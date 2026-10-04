import { todayIn } from '@shiftlane/shared';
import { readSheet } from 'read-excel-file/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { buildSpreadsheet } from '../../../lib/excel.ts';
import { VEHICLE_COLUMNS } from '../schemas.ts';

const PASSWORD = 'Transporte2026';
const PDF = Buffer.from('%PDF-1.4\n%prueba de documento\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

/** Fecha de negocio a N días de hoy, en la zona horaria de la empresa (como el servidor). */
function isoDate(daysFromToday: number): string {
  const today = Date.parse(`${todayIn(app.config.DEFAULT_TIME_ZONE)}T12:00:00Z`);
  return new Date(today + daysFromToday * 86_400_000).toISOString().slice(0, 10);
}

async function createVehicle(body: Record<string, unknown> = {}, auth = ownerAuth) {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  const response = await request(app.server)
    .post('/vehicles')
    .set('authorization', auth)
    .send({
      economicNumber: `U-${suffix}`,
      plates: `P${suffix}X`,
      model: 'Sprinter 516',
      year: 2022,
      capacity: 19,
      ...body,
    });
  return response;
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  const owner = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
  ownerAuth = await tokenFor(owner.email);
});

afterAll(async () => {
  await app.close();
});

describe('alta y edición de unidades', () => {
  it('crea una unidad con los valores por omisión', async () => {
    const response = await createVehicle({ plates: 'efr 1234', economicNumber: 'U-001' }).then(
      (r) => r,
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      economicNumber: 'U-001',
      plates: 'EFR1234',
      status: 'available',
      odometerKm: 0,
      hasPhoto: false,
      documents: { expired: 0, expiring: 0 },
      documentList: [],
    });
  });

  it('valida los datos con mensajes en español', async () => {
    const response = await createVehicle({ year: 1970, capacity: 0, plates: 'AB' });
    expect(response.status).toBe(400);
    const messages = (response.body.error.details as { message: string }[]).map((d) => d.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'El año debe ser 1980 o posterior.',
        'La capacidad debe ser al menos 1.',
        'Las placas deben tener al menos 5 caracteres.',
      ]),
    );
  });

  it('no permite números económicos ni placas repetidos', async () => {
    await createVehicle({ economicNumber: 'U-REP', plates: 'REP1111' });
    const sameNumber = await createVehicle({ economicNumber: 'U-REP', plates: 'REP2222' });
    expect(sameNumber.status).toBe(409);
    expect(sameNumber.body.error.message).toBe('Ya existe una unidad con ese número económico.');
    const samePlates = await createVehicle({ economicNumber: 'U-REP2', plates: 'REP1111' });
    expect(samePlates.status).toBe(409);
    expect(samePlates.body.error.message).toBe('Ya existe una unidad con esas placas.');
  });

  it('edita, cambia de estado y da de baja', async () => {
    const { body } = await createVehicle();
    const updated = await request(app.server)
      .patch(`/vehicles/${body.id as string}`)
      .set('authorization', ownerAuth)
      .send({ status: 'maintenance', odometerKm: 120500 })
      .expect(200);
    expect(updated.body).toMatchObject({ status: 'maintenance', odometerKm: 120500 });

    await request(app.server)
      .delete(`/vehicles/${body.id as string}`)
      .set('authorization', ownerAuth)
      .expect(204);
    await request(app.server)
      .get(`/vehicles/${body.id as string}`)
      .set('authorization', ownerAuth)
      .expect(404);
  });
});

describe('búsqueda, filtros y paginación', () => {
  it('busca por número económico, placas o modelo y filtra por estado', async () => {
    await createVehicle({ economicNumber: 'BUS-01', model: 'Hiace Ventanas' });
    await createVehicle({
      economicNumber: 'BUS-02',
      model: 'Hiace Ventanas',
      status: 'out_of_service',
    });

    const byModel = await request(app.server)
      .get('/vehicles')
      .query({ search: 'hiace' })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(byModel.body.items.map((v: { economicNumber: string }) => v.economicNumber)).toEqual([
      'BUS-01',
      'BUS-02',
    ]);

    const outOfService = await request(app.server)
      .get('/vehicles')
      .query({ search: 'BUS-', status: 'out_of_service' })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(outOfService.body.total).toBe(1);

    const page = await request(app.server)
      .get('/vehicles')
      .query({ search: 'BUS-', page: 2, pageSize: 1 })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(page.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page.body.items[0].economicNumber).toBe('BUS-02');
  });
});

describe('documentos con vencimiento y archivo', () => {
  it('calcula el estado de cada documento y lo resume en la unidad', async () => {
    const { body: vehicle } = await createVehicle();
    const id = vehicle.id as string;
    const add = (body: object) =>
      request(app.server)
        .post(`/vehicles/${id}/documents`)
        .set('authorization', ownerAuth)
        .send(body)
        .expect(201);

    const insurance = await add({ type: 'insurance', number: 'POL-123', expiresOn: isoDate(200) });
    expect(insurance.body.status).toBe('valid');
    const permit = await add({ type: 'permit', expiresOn: isoDate(10) });
    expect(permit.body.status).toBe('expiring');
    const verification = await add({ type: 'emissions_verification', expiresOn: isoDate(-3) });
    expect(verification.body.status).toBe('expired');

    const detail = await request(app.server)
      .get(`/vehicles/${id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.documents).toEqual({ expired: 1, expiring: 1 });
    expect(detail.body.documentList).toHaveLength(3);
  });

  it('rechaza fechas incongruentes', async () => {
    const { body: vehicle } = await createVehicle();
    const response = await request(app.server)
      .post(`/vehicles/${vehicle.id as string}/documents`)
      .set('authorization', ownerAuth)
      .send({ type: 'insurance', issuedOn: '2026-05-01', expiresOn: '2026-01-01' })
      .expect(400);
    expect(response.body.error.details[0].message).toBe(
      'La fecha de vencimiento no puede ser anterior a la de expedición.',
    );
  });

  it('adjunta y descarga el archivo; rechaza archivos que no son PDF o imagen', async () => {
    const { body: vehicle } = await createVehicle();
    const doc = await request(app.server)
      .post(`/vehicles/${vehicle.id as string}/documents`)
      .set('authorization', ownerAuth)
      .send({ type: 'insurance', expiresOn: isoDate(100) })
      .expect(201);

    const attached = await request(app.server)
      .put(`/vehicle-documents/${doc.body.id as string}/file`)
      .set('authorization', ownerAuth)
      .attach('file', PDF, { filename: 'póliza seguro.pdf', contentType: 'application/pdf' })
      .expect(200);
    expect(attached.body).toMatchObject({ hasFile: true, fileName: 'póliza seguro.pdf' });

    const download = await request(app.server)
      .get(`/vehicle-documents/${doc.body.id as string}/file`)
      .set('authorization', ownerAuth)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);

    const fake = await request(app.server)
      .put(`/vehicle-documents/${doc.body.id as string}/file`)
      .set('authorization', ownerAuth)
      .attach('file', Buffer.from('MZ ejecutable disfrazado'), {
        filename: 'virus.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(fake.body.error.message).toBe(
      'Formato no permitido. Sube un archivo PDF, JPG, PNG o WebP.',
    );
  });

  it('sube la foto de la unidad', async () => {
    const { body: vehicle } = await createVehicle();
    await request(app.server)
      .put(`/vehicles/${vehicle.id as string}/photo`)
      .set('authorization', ownerAuth)
      .attach('file', PNG, { filename: 'unidad.png', contentType: 'image/png' })
      .expect(204);
    const detail = await request(app.server)
      .get(`/vehicles/${vehicle.id as string}`)
      .set('authorization', ownerAuth);
    expect(detail.body.hasPhoto).toBe(true);
    const photo = await request(app.server)
      .get(`/vehicles/${vehicle.id as string}/photo`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(photo.headers['content-type']).toBe('image/png');
  });
});

describe('historial de cambios', () => {
  it('muestra los cambios de la unidad y de sus documentos', async () => {
    const { body: vehicle } = await createVehicle();
    const id = vehicle.id as string;
    await request(app.server)
      .patch(`/vehicles/${id}`)
      .set('authorization', ownerAuth)
      .send({ capacity: 15 })
      .expect(200);
    await request(app.server)
      .post(`/vehicles/${id}/documents`)
      .set('authorization', ownerAuth)
      .send({ type: 'permit', expiresOn: isoDate(50) })
      .expect(201);

    const history = await request(app.server)
      .get(`/vehicles/${id}/history`)
      .set('authorization', ownerAuth)
      .expect(200);
    const summary = (history.body as { entityType: string; action: string }[]).map(
      (h) => `${h.entityType}:${h.action}`,
    );
    expect(summary).toEqual(['vehicle_documents:create', 'vehicles:update', 'vehicles:create']);
  });
});

describe('importación y exportación en Excel', () => {
  type Row = Partial<Record<(typeof VEHICLE_COLUMNS)[number]['key'], string | number | null>>;
  async function upload(rows: Row[], dryRun: boolean) {
    const buffer = await buildSpreadsheet(VEHICLE_COLUMNS, rows, 'Unidades');
    return request(app.server)
      .post('/vehicles/import')
      .query({ dryRun })
      .set('authorization', ownerAuth)
      .attach('file', buffer, { filename: 'unidades.xlsx' });
  }

  it('valida fila por fila y no guarda nada si hay errores', async () => {
    const response = await upload(
      [
        {
          economicNumber: 'IMP-01',
          plates: 'IMP0001',
          model: 'Urvan',
          year: 2021,
          capacity: 15,
          status: 'Disponible',
        },
        {
          economicNumber: 'IMP-02',
          plates: 'IMP0002',
          model: 'Urvan',
          year: 1950,
          capacity: 15,
          status: 'Volando',
        },
        { economicNumber: 'IMP-01', plates: 'IMP0003', model: 'Urvan', year: 2021, capacity: 15 },
        { economicNumber: null, plates: 'IMP0004', model: 'Urvan', year: 2021, capacity: 15 },
      ],
      false,
    ).then((r) => r);
    expect(response.status).toBe(200);
    expect(response.body.applied).toBe(false);
    expect(response.body.totalRows).toBe(4);
    const errors = response.body.errors as { row: number; column: string; message: string }[];
    expect(errors).toEqual(
      expect.arrayContaining([
        { row: 3, column: 'Año', message: 'El año debe ser 1980 o posterior.' },
        expect.objectContaining({ row: 3, column: 'Estado' }),
        {
          row: 4,
          column: 'Número económico',
          message: 'Está repetido en el archivo (también en la fila 2).',
        },
        { row: 5, column: 'Número económico', message: 'Escribe el número económico.' },
      ]),
    );
    const list = await request(app.server)
      .get('/vehicles')
      .query({ search: 'IMP-' })
      .set('authorization', ownerAuth);
    expect(list.body.total).toBe(0);
  });

  it('vista previa sin guardar y luego aplica altas y actualizaciones', async () => {
    await createVehicle({ economicNumber: 'IMP-10', plates: 'IMP0010', capacity: 10 });
    const rows = [
      {
        economicNumber: 'IMP-10',
        plates: 'IMP0010',
        model: 'Sprinter',
        year: 2023,
        capacity: 20,
        status: 'Mantenimiento',
      },
      {
        economicNumber: 'IMP-11',
        plates: 'IMP0011',
        model: 'Sprinter',
        year: 2023,
        capacity: 20,
        odometerKm: 1500,
      },
    ];
    const preview = await upload(rows, true);
    expect(preview.body).toEqual({
      totalRows: 2,
      created: 1,
      updated: 1,
      errors: [],
      applied: false,
    });
    expect(
      (
        await request(app.server)
          .get('/vehicles')
          .query({ search: 'IMP-11' })
          .set('authorization', ownerAuth)
      ).body.total,
    ).toBe(0);

    const applied = await upload(rows, false);
    expect(applied.body).toMatchObject({ created: 1, updated: 1, applied: true });
    const updated = await request(app.server)
      .get('/vehicles')
      .query({ search: 'IMP-10' })
      .set('authorization', ownerAuth);
    expect(updated.body.items[0]).toMatchObject({ capacity: 20, status: 'maintenance' });
  });

  it('rechaza placas que ya tiene otra unidad', async () => {
    await createVehicle({ economicNumber: 'IMP-20', plates: 'IMP0020' });
    const response = await upload(
      [
        {
          economicNumber: 'IMP-21',
          plates: 'IMP0020',
          model: 'Sprinter',
          year: 2023,
          capacity: 20,
        },
      ],
      false,
    );
    expect(response.body.errors).toEqual([
      { row: 2, column: 'Placas', message: 'Las placas ya pertenecen a la unidad IMP-20.' },
    ]);
  });

  it('rechaza archivos que no son Excel o sin las columnas de la plantilla', async () => {
    const notExcel = await request(app.server)
      .post('/vehicles/import')
      .set('authorization', ownerAuth)
      .attach('file', PDF, { filename: 'unidades.xlsx' })
      .expect(400);
    expect(notExcel.body.error.message).toBe(
      'Formato no permitido. Sube un archivo Excel (.xlsx).',
    );

    const wrong = await buildSpreadsheet(
      [{ key: 'x', header: 'Columna rara' }],
      [{ x: 'a' }],
      'Hoja',
    );
    const missing = await request(app.server)
      .post('/vehicles/import')
      .set('authorization', ownerAuth)
      .attach('file', wrong, { filename: 'otra.xlsx' })
      .expect(400);
    expect(missing.body.error.message).toMatch(
      /^Faltan columnas obligatorias: Número económico, Placas/,
    );
  });

  it('exporta las unidades y entrega la plantilla', async () => {
    await createVehicle({ economicNumber: 'EXP-01', plates: 'EXP0001' });
    const exported = await request(app.server)
      .get('/vehicles/export')
      .set('authorization', ownerAuth)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(exported.headers['content-disposition']).toMatch(/unidades\.xlsx/);
    const sheet = await readSheet(exported.body as Buffer);
    expect(sheet[0]?.[0]).toBe('Número económico*');
    expect(sheet.some((row) => row[0] === 'EXP-01')).toBe(true);

    await request(app.server)
      .get('/vehicles/import/template')
      .set('authorization', ownerAuth)
      .expect(200);
  });
});

describe('permisos y aislamiento', () => {
  it('mantenimiento edita unidades; administración solo puede verlas si tiene permiso', async () => {
    const maintenance = await fx.carrierUser({
      tenantId,
      password: PASSWORD,
      roles: ['maintenance'],
    });
    const billing = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['billing'] });
    const maintenanceAuth = await tokenFor(maintenance.email);
    const billingAuth = await tokenFor(billing.email);

    expect((await createVehicle({}, maintenanceAuth)).status).toBe(201);
    expect((await createVehicle({}, billingAuth)).status).toBe(403);
    await request(app.server).get('/vehicles').set('authorization', billingAuth).expect(403);
  });

  it('otra transportista no ve ni modifica las unidades', async () => {
    const { body: vehicle } = await createVehicle();
    const otherTenant = await fx.tenant();
    const otherOwner = await fx.carrierUser({
      tenantId: otherTenant.id,
      password: PASSWORD,
      roles: ['owner'],
    });
    const otherAuth = await tokenFor(otherOwner.email);

    await request(app.server)
      .get(`/vehicles/${vehicle.id as string}`)
      .set('authorization', otherAuth)
      .expect(404);
    await request(app.server)
      .patch(`/vehicles/${vehicle.id as string}`)
      .set('authorization', otherAuth)
      .send({ capacity: 1 })
      .expect(404);
    const list = await request(app.server)
      .get('/vehicles')
      .set('authorization', otherAuth)
      .expect(200);
    expect(list.body.total).toBe(0);
  });
});
