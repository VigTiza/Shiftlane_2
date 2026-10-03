import { createPublicKey, verify } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import { buildSpreadsheet } from '../../../lib/excel.ts';
import { PASSENGER_COLUMNS } from '../schemas.ts';

const PASSWORD = 'Transporte2026';

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let clientOrgId: string;
let plantId: string;
let hrAuth: string;
let carrierAuth: string;
let driverAuth: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

/** Token de chofer emitido directamente (el flujo de QR+PIN ya tiene sus propias pruebas). */
async function driverToken(forTenantId: string): Promise<string> {
  const driver = await fx.driver({ tenantId: forTenantId });
  const device = await app.db.system.device.create({
    data: { tenantId: forTenantId, secretHash: 'x' },
  });
  const token = await app.tokens.signAccess({
    kind: 'driver',
    sub: driver.id,
    sid: '00000000-0000-4000-8000-0000000000aa',
    tenantId: forTenantId,
    deviceId: device.id,
  });
  return `Bearer ${token}`;
}

async function createPassenger(body: Record<string, unknown> = {}) {
  const response = await request(app.server)
    .post('/passengers')
    .set('authorization', hrAuth)
    .send({
      plantId,
      employeeNumber: `E-${Math.random().toString(36).slice(2, 8)}`,
      fullName: 'Empleado de Prueba',
      ...body,
    })
    .expect(201);
  return response.body as { id: string; employeeNumber: string };
}

function verifyCode(code: string, auth = driverAuth) {
  return request(app.server)
    .post('/credentials/verify')
    .set('authorization', auth)
    .send({ code })
    .expect(200);
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  const created = await fx.clientOrgWithPlant({ tenantId });
  clientOrgId = created.org.id;
  plantId = created.plant.id;
  hrAuth = await tokenFor(
    (await fx.plantUser({ clientOrgId, password: PASSWORD, roles: ['plant_hr'] })).email,
  );
  carrierAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['dispatcher'] })).email,
  );
  driverAuth = await driverToken(tenantId);
});

afterAll(async () => {
  await app.close();
});

describe('empleados de la planta', () => {
  it('RH da de alta empleados; la transportista con acuerdo los ve; otra no', async () => {
    const passenger = await createPassenger({
      employeeNumber: 'E-ALTA-1',
      shiftName: 'Primer turno',
    });
    const carrierList = await request(app.server)
      .get('/passengers')
      .query({ search: 'E-ALTA-1' })
      .set('authorization', carrierAuth)
      .expect(200);
    expect(carrierList.body.items[0]).toMatchObject({
      id: passenger.id,
      shiftName: 'Primer turno',
      activated: false,
    });

    const otherTenant = await fx.tenant();
    const outsider = await tokenFor(
      (await fx.carrierUser({ tenantId: otherTenant.id, password: PASSWORD, roles: ['owner'] }))
        .email,
    );
    const outsiderList = await request(app.server)
      .get('/passengers')
      .query({ search: 'E-ALTA-1' })
      .set('authorization', outsider)
      .expect(200);
    expect(outsiderList.body.total).toBe(0);
  });

  it('no repite números de empleado y solo RH administra la lista', async () => {
    await createPassenger({ employeeNumber: 'E-DUP' });
    const duplicate = await request(app.server)
      .post('/passengers')
      .set('authorization', hrAuth)
      .send({ plantId, employeeNumber: 'E-DUP', fullName: 'Otro' })
      .expect(409);
    expect(duplicate.body.error.message).toBe('Ya existe un empleado con ese número.');
    await request(app.server)
      .post('/passengers')
      .set('authorization', carrierAuth)
      .send({ plantId, employeeNumber: 'X', fullName: 'X' })
      .expect(403);
    const logistics = await tokenFor(
      (await fx.plantUser({ clientOrgId, password: PASSWORD, roles: ['plant_logistics'] })).email,
    );
    await request(app.server)
      .post('/passengers')
      .set('authorization', logistics)
      .send({ plantId, employeeNumber: 'X', fullName: 'X' })
      .expect(403);
  });
});

describe('credencial QR firmada', () => {
  it('se emite, el chofer la valida y al reemitirla la anterior deja de servir', async () => {
    const passenger = await createPassenger();
    const first = await request(app.server)
      .post(`/passengers/${passenger.id}/credential`)
      .set('authorization', hrAuth)
      .expect(201);
    expect(first.body.qrPayload).toMatch(/^SL1\.[\w-]+\.[\w-]+$/);
    const valid = await verifyCode(first.body.qrPayload as string);
    expect(valid.body).toMatchObject({
      valid: true,
      source: 'shiftlane_qr',
      passenger: { id: passenger.id },
    });

    await request(app.server)
      .post(`/passengers/${passenger.id}/credential`)
      .set('authorization', hrAuth)
      .expect(201);
    expect((await verifyCode(first.body.qrPayload as string)).body).toMatchObject({
      valid: false,
      reason: 'revoked',
    });
  });

  it('un QR alterado no pasa la firma', async () => {
    const passenger = await createPassenger();
    const { body } = await request(app.server)
      .post(`/passengers/${passenger.id}/credential`)
      .set('authorization', hrAuth)
      .expect(201);
    const [prefix, data, signature] = (body.qrPayload as string).split('.');
    const forged = JSON.parse(Buffer.from(data!, 'base64url').toString()) as Record<string, string>;
    forged.p = '00000000-0000-4000-8000-000000000999';
    const tampered = [
      prefix,
      Buffer.from(JSON.stringify(forged)).toString('base64url'),
      signature,
    ].join('.');
    expect((await verifyCode(tampered)).body).toMatchObject({
      valid: false,
      reason: 'invalid_signature',
    });
  });

  it('la app del chofer puede verificar la firma sin señal con la llave pública', async () => {
    const passenger = await createPassenger();
    const { body } = await request(app.server)
      .post(`/passengers/${passenger.id}/credential`)
      .set('authorization', hrAuth)
      .expect(201);
    const keyResponse = await request(app.server).get('/credentials/public-key').expect(200);
    const publicKey = createPublicKey(keyResponse.body.publicKeyPem as string);
    const [prefix, data, signature] = (body.qrPayload as string).split('.');
    expect(
      verify(
        null,
        Buffer.from(`${prefix}.${data}`),
        publicKey,
        Buffer.from(signature!, 'base64url'),
      ),
    ).toBe(true);
  });

  it('un empleado dado de baja ya no puede abordar', async () => {
    const passenger = await createPassenger();
    const { body } = await request(app.server)
      .post(`/passengers/${passenger.id}/credential`)
      .set('authorization', hrAuth)
      .expect(201);
    await request(app.server)
      .patch(`/passengers/${passenger.id}`)
      .set('authorization', hrAuth)
      .send({ status: 'inactive' })
      .expect(200);
    expect((await verifyCode(body.qrPayload as string)).body).toMatchObject({
      valid: false,
      reason: 'inactive',
    });
  });

  it('el pasajero ve su credencial en la app', async () => {
    const passenger = await createPassenger({ employeeNumber: 'E-APP-1' });
    const plant = await app.db.system.plant.findUniqueOrThrow({ where: { id: plantId } });
    const activation = await request(app.server)
      .post('/auth/passenger/activate')
      .send({ plantCode: plant.passengerActivationCode, employeeNumber: 'E-APP-1' })
      .expect(200);
    const credential = await request(app.server)
      .get('/me/credential')
      .set('authorization', `Bearer ${activation.body.accessToken as string}`)
      .expect(200);
    expect((await verifyCode(credential.body.qrPayload as string)).body).toMatchObject({
      valid: true,
      passenger: { id: passenger.id },
    });
  });

  it('el chofer de otra transportista no identifica a los pasajeros', async () => {
    const passenger = await createPassenger();
    const { body } = await request(app.server)
      .post(`/passengers/${passenger.id}/credential`)
      .set('authorization', hrAuth)
      .expect(201);
    const otherTenant = await fx.tenant();
    const otherDriver = await driverToken(otherTenant.id);
    expect((await verifyCode(body.qrPayload as string, otherDriver)).body).toMatchObject({
      valid: false,
      reason: 'unknown',
    });
  });
});

describe('gafetes de la planta y provisionales', () => {
  it('registra el gafete existente y el chofer lo reconoce; no se repite entre empleados', async () => {
    const passenger = await createPassenger();
    await request(app.server)
      .post(`/passengers/${passenger.id}/badges`)
      .set('authorization', hrAuth)
      .send({ kind: 'badge_barcode', value: 'GAF-0001' })
      .expect(200);
    expect((await verifyCode('GAF-0001')).body).toMatchObject({ valid: true, source: 'badge' });

    const other = await createPassenger();
    const conflict = await request(app.server)
      .post(`/passengers/${other.id}/badges`)
      .set('authorization', hrAuth)
      .send({ kind: 'badge_barcode', value: 'GAF-0001' })
      .expect(409);
    expect(conflict.body.error.message).toBe('Ese gafete ya pertenece a Empleado de Prueba.');
    expect((await verifyCode('GAF-NO-EXISTE')).body).toMatchObject({
      valid: false,
      reason: 'unknown',
    });
  });

  it('el gafete desconocido queda provisional y RH lo asigna después', async () => {
    const register = () =>
      request(app.server)
        .post('/provisional-badges')
        .set('authorization', driverAuth)
        .send({ plantId, value: 'NUEVO-777', kind: 'barcode' })
        .expect(201);
    await register();
    const again = await register();
    expect(again.body).toMatchObject({ status: 'pending', seenCount: 2 });

    const pending = await request(app.server)
      .get('/provisional-badges')
      .set('authorization', hrAuth)
      .expect(200);
    expect(pending.body.map((b: { value: string }) => b.value)).toContain('NUEVO-777');

    const passenger = await createPassenger();
    const resolved = await request(app.server)
      .post(`/provisional-badges/${again.body.id as string}/resolve`)
      .set('authorization', hrAuth)
      .send({ passengerId: passenger.id })
      .expect(200);
    expect(resolved.body).toMatchObject({ status: 'resolved', resolvedPassengerId: passenger.id });
    expect((await verifyCode('NUEVO-777')).body).toMatchObject({
      valid: true,
      passenger: { id: passenger.id },
    });
  });

  it('se puede descartar un provisional; un chofer sin acuerdo no puede registrar', async () => {
    const badge = await request(app.server)
      .post('/provisional-badges')
      .set('authorization', driverAuth)
      .send({ plantId, value: 'BASURA-1', kind: 'qr' })
      .expect(201);
    await request(app.server)
      .post(`/provisional-badges/${badge.body.id as string}/dismiss`)
      .set('authorization', hrAuth)
      .expect(200);

    const otherTenant = await fx.tenant();
    await request(app.server)
      .post('/provisional-badges')
      .set('authorization', await driverToken(otherTenant.id))
      .send({ plantId, value: 'AJENO-1', kind: 'qr' })
      .expect(404);
  });
});

describe('carga de Excel con vista previa', () => {
  type Row = Partial<Record<(typeof PASSENGER_COLUMNS)[number]['key'], string | number | null>>;

  async function preview(rows: Row[], mode: 'changes' | 'full' = 'changes', forPlant = plantId) {
    const buffer = await buildSpreadsheet(PASSENGER_COLUMNS, rows, 'Empleados');
    return request(app.server)
      .post('/passenger-imports')
      .query({ plantId: forPlant, mode })
      .set('authorization', hrAuth)
      .attach('file', buffer, { filename: 'empleados.xlsx' })
      .expect(201);
  }

  it('muestra errores fila por fila y no deja aplicar una carga con errores', async () => {
    await createPassenger({ employeeNumber: 'IMP-OWNER' });
    const owner = await app.db.system.passenger.findFirstOrThrow({
      where: { employeeNumber: 'IMP-OWNER' },
    });
    await request(app.server)
      .post(`/passengers/${owner.id}/badges`)
      .set('authorization', hrAuth)
      .send({ kind: 'badge_barcode', value: 'IMP-BADGE-X' });

    const result = await preview([
      { employeeNumber: 'IMP-1', fullName: 'Persona Uno' },
      { employeeNumber: 'IMP-1', fullName: 'Persona Repetida' },
      { employeeNumber: 'IMP-2', fullName: 'Al' },
      { employeeNumber: 'IMP-3', fullName: 'Persona Tres', badge: 'IMP-BADGE-X' },
      { employeeNumber: 'IMP-4', fullName: 'Persona Cuatro', status: 'Vacaciones' },
    ]);
    const errors = result.body.errors as { row: number; column: string; message: string }[];
    expect(errors).toEqual(
      expect.arrayContaining([
        {
          row: 3,
          column: 'Número de empleado',
          message: 'Está repetido en el archivo (también en la fila 2).',
        },
        { row: 4, column: 'Nombre completo', message: 'Escribe el nombre completo.' },
        {
          row: 5,
          column: 'Gafete',
          message: 'El gafete ya pertenece a IMP-OWNER (Empleado de Prueba).',
        },
        { row: 6, column: 'Estado', message: 'Estado desconocido. Usa: Activo o Baja.' },
      ]),
    );
    const apply = await request(app.server)
      .post(`/passenger-imports/${result.body.id as string}/apply`)
      .set('authorization', hrAuth)
      .expect(409);
    expect(apply.body.error.message).toMatch(/tiene errores/);
  });

  it('altas, cambios, bajas y reactivaciones en un solo archivo', async () => {
    const changed = await createPassenger({
      employeeNumber: 'MIX-CHANGE',
      fullName: 'Nombre Viejo',
    });
    await createPassenger({ employeeNumber: 'MIX-LEAVE' });
    const back = await createPassenger({ employeeNumber: 'MIX-BACK' });
    await request(app.server)
      .patch(`/passengers/${back.id}`)
      .set('authorization', hrAuth)
      .send({ status: 'inactive' })
      .expect(200);
    await createPassenger({ employeeNumber: 'MIX-SAME', fullName: 'Sin Cambios' });

    const result = await preview([
      { employeeNumber: 'MIX-NEW', fullName: 'Persona Nueva', badge: 'MIX-B-1', badgeKind: 'QR' },
      { employeeNumber: 'MIX-CHANGE', fullName: 'Nombre Nuevo', shiftName: 'Segundo turno' },
      { employeeNumber: 'MIX-LEAVE', fullName: 'Se Va', status: 'Baja' },
      { employeeNumber: 'MIX-BACK', fullName: 'Empleado de Prueba', status: 'Activo' },
      { employeeNumber: 'MIX-SAME', fullName: 'Sin Cambios' },
    ]);
    expect(result.body).toMatchObject({
      status: 'previewed',
      created: 1,
      updated: 1,
      deactivated: 1,
      reactivated: 1,
      unchanged: 1,
      errors: [],
    });
    const change = (
      result.body.changes as { employeeNumber: string; changes?: Record<string, unknown> }[]
    ).find((c) => c.employeeNumber === 'MIX-CHANGE');
    expect(change?.changes).toMatchObject({
      'Nombre completo': { from: 'Nombre Viejo', to: 'Nombre Nuevo' },
    });

    // La vista previa no cambia nada todavía.
    expect(
      (await app.db.system.passenger.findUniqueOrThrow({ where: { id: changed.id } })).fullName,
    ).toBe('Nombre Viejo');

    const applied = await request(app.server)
      .post(`/passenger-imports/${result.body.id as string}/apply`)
      .set('authorization', hrAuth)
      .expect(200);
    expect(applied.body).toMatchObject({ status: 'applied', created: 1, deactivated: 1 });
    expect(
      (await app.db.system.passenger.findUniqueOrThrow({ where: { id: changed.id } })).fullName,
    ).toBe('Nombre Nuevo');
    expect((await verifyCode('MIX-B-1')).body).toMatchObject({ valid: true });

    const stored = await app.db.system.passengerImport.findUniqueOrThrow({
      where: { id: result.body.id as string },
    });
    expect(stored.rows).toBeNull();
    await request(app.server)
      .post(`/passenger-imports/${result.body.id as string}/apply`)
      .set('authorization', hrAuth)
      .expect(409);
  });

  it('en modo lista completa da de baja a quien no aparece en el archivo', async () => {
    const tenant = await fx.tenant();
    const { org, plant } = await fx.clientOrgWithPlant({ tenantId: tenant.id });
    const hr = await tokenFor(
      (await fx.plantUser({ clientOrgId: org.id, password: PASSWORD })).email,
    );
    for (const number of ['FULL-1', 'FULL-2', 'FULL-3']) {
      await request(app.server)
        .post('/passengers')
        .set('authorization', hr)
        .send({ plantId: plant.id, employeeNumber: number, fullName: `Persona ${number}` })
        .expect(201);
    }
    const buffer = await buildSpreadsheet(
      PASSENGER_COLUMNS,
      [{ employeeNumber: 'FULL-1', fullName: 'Persona FULL-1' }],
      'Empleados',
    );
    const result = await request(app.server)
      .post('/passenger-imports')
      .query({ plantId: plant.id, mode: 'full' })
      .set('authorization', hr)
      .attach('file', buffer, { filename: 'lista.xlsx' })
      .expect(201);
    expect(result.body).toMatchObject({ deactivated: 2, unchanged: 1 });
    await request(app.server)
      .post(`/passenger-imports/${result.body.id as string}/apply`)
      .set('authorization', hr)
      .expect(200);
    const active = await app.db.system.passenger.count({
      where: { clientOrgId: org.id, status: 'active' },
    });
    expect(active).toBe(1);
  });

  it('si la lista cambió desde la vista previa y hay conflicto, pide subir de nuevo', async () => {
    const result = await preview([
      { employeeNumber: 'STALE-1', fullName: 'Persona Tarde', badge: 'STALE-BADGE' },
    ]);
    const intruder = await createPassenger();
    await request(app.server)
      .post(`/passengers/${intruder.id}/badges`)
      .set('authorization', hrAuth)
      .send({ kind: 'badge_barcode', value: 'STALE-BADGE' })
      .expect(200);
    const apply = await request(app.server)
      .post(`/passenger-imports/${result.body.id as string}/apply`)
      .set('authorization', hrAuth)
      .expect(409);
    expect(apply.body.error.message).toMatch(/La lista cambió/);
  });
});
