import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';
const MONDAY = '2026-10-05';
const SUNDAY = '2026-10-04';

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;
let clientOrgId: string;
let plantId: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

async function newContract(body: Record<string, unknown> = {}) {
  const response = await request(app.server)
    .post('/contracts')
    .set('authorization', ownerAuth)
    .send({
      clientOrgId,
      plantId,
      name: 'Contrato de transporte 2026',
      status: 'active',
      startsOn: '2026-01-01',
      ...body,
    })
    .expect(201);
  return response.body as { id: string };
}

function addRate(contractId: string, body: Record<string, unknown>) {
  return request(app.server)
    .post(`/contracts/${contractId}/rates`)
    .set('authorization', ownerAuth)
    .send(body);
}

function quote(contractId: string, body: Record<string, unknown>) {
  return request(app.server)
    .post(`/contracts/${contractId}/quote`)
    .set('authorization', ownerAuth)
    .send({ date: MONDAY, time: '05:30', ...body })
    .expect(200);
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  ownerAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
  );
  const { org, plant } = await fx.clientOrgWithPlant({ tenantId });
  clientOrgId = org.id;
  plantId = plant.id;
});

afterAll(async () => {
  await app.close();
});

describe('contratos', () => {
  it('crea un contrato con una empresa que atiende y valida fechas', async () => {
    const contract = await newContract();
    const detail = await request(app.server)
      .get(`/contracts/${contract.id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body).toMatchObject({
      clientOrgId,
      plantId,
      status: 'active',
      startsOn: '2026-01-01',
      rates: [],
      penalties: [],
    });

    const bad = await request(app.server)
      .post('/contracts')
      .set('authorization', ownerAuth)
      .send({ clientOrgId, name: 'Fechas mal', startsOn: '2026-05-01', endsOn: '2026-01-01' })
      .expect(400);
    expect(bad.body.error.details[0].message).toBe(
      'La fecha de fin no puede ser anterior a la de inicio.',
    );
  });

  it('no puede crear contratos con empresas de otra transportista', async () => {
    const otherTenant = await fx.tenant();
    const { org } = await fx.clientOrgWithPlant({ tenantId: otherTenant.id });
    const response = await request(app.server)
      .post('/contracts')
      .set('authorization', ownerAuth)
      .send({ clientOrgId: org.id, name: 'Contrato pirata', startsOn: '2026-01-01' })
      .expect(400);
    expect(response.body.error.message).toBe('La empresa cliente no existe.');
  });
});

describe('tarifas y cotizador', () => {
  it('valida las tarifas especiales', async () => {
    const contract = await newContract();
    const route = await addRate(contract.id, { basis: 'per_route', amount: 1000 }).expect(400);
    expect(route.body.error.details[0].message).toBe('Una tarifa por ruta necesita la ruta.');
    const window = await addRate(contract.id, {
      basis: 'per_trip',
      amount: 1000,
      startTime: '22:00',
    }).expect(400);
    expect(window.body.error.details[0].message).toBe(
      'Indica hora de inicio y de fin del horario.',
    );
    const decimals = await addRate(contract.id, { basis: 'per_trip', amount: 10.555 }).expect(400);
    expect(decimals.body.error.details[0].message).toBe('Usa máximo dos decimales.');
  });

  it('cotiza con la tarifa general, la de domingo y la nocturna', async () => {
    const contract = await newContract();
    await addRate(contract.id, { name: 'General', basis: 'per_trip', amount: 1500 }).expect(201);
    await addRate(contract.id, {
      name: 'Domingo',
      basis: 'per_trip',
      amount: 1800,
      weekdays: [0],
    }).expect(201);
    await addRate(contract.id, {
      name: 'Nocturno',
      basis: 'per_trip',
      amount: 1700,
      startTime: '22:00',
      endTime: '06:00',
    }).expect(201);

    const weekday = await quote(contract.id, { time: '14:00' });
    expect(weekday.body).toMatchObject({ rate: { name: 'General' }, price: 1500, total: 1500 });
    const sunday = await quote(contract.id, { date: SUNDAY, time: '14:00' });
    expect(sunday.body).toMatchObject({ rate: { name: 'Domingo' }, total: 1800 });
    const night = await quote(contract.id, { time: '23:30' });
    expect(night.body).toMatchObject({ rate: { name: 'Nocturno' }, total: 1700 });
  });

  it('cotiza por kilómetro con mínimo y por pasajero', async () => {
    const perKm = await newContract({ name: 'Por kilómetro' });
    await addRate(perKm.id, { basis: 'per_km', amount: 28.5, minimumCharge: 600 }).expect(201);
    expect((await quote(perKm.id, { distanceKm: 42.3 })).body).toMatchObject({
      total: 1205.55,
      minimumApplied: false,
    });
    expect((await quote(perKm.id, { distanceKm: 10 })).body).toMatchObject({
      total: 600,
      minimumApplied: true,
    });

    const perPassenger = await newContract({ name: 'Por pasajero' });
    await addRate(perPassenger.id, { basis: 'per_passenger', amount: 45 }).expect(201);
    expect((await quote(perPassenger.id, { passengers: 18 })).body).toMatchObject({
      quantity: 18,
      total: 810,
    });
  });

  it('aplica las penalizaciones del contrato', async () => {
    const contract = await newContract();
    await addRate(contract.id, { basis: 'per_trip', amount: 1500 }).expect(201);
    await request(app.server)
      .post(`/contracts/${contract.id}/penalties`)
      .set('authorization', ownerAuth)
      .send({ type: 'late_arrival', amountType: 'percent', amount: 10, graceMinutes: 10 })
      .expect(201);
    await request(app.server)
      .post(`/contracts/${contract.id}/penalties`)
      .set('authorization', ownerAuth)
      .send({ type: 'missed_trip', amountType: 'fixed', amount: 500 })
      .expect(201);

    const late = await quote(contract.id, { outcome: { status: 'completed', delayMinutes: 25 } });
    expect(late.body).toMatchObject({ base: 1500, total: 1350 });
    expect(late.body.penalties[0]).toMatchObject({ type: 'late_arrival', amount: 150 });
    const missed = await quote(contract.id, { outcome: { status: 'missed' } });
    expect(missed.body).toMatchObject({ base: 0, total: -500 });

    const badPercent = await request(app.server)
      .post(`/contracts/${contract.id}/penalties`)
      .set('authorization', ownerAuth)
      .send({ type: 'late_arrival', amountType: 'percent', amount: 150 })
      .expect(400);
    expect(badPercent.body.error.details[0].message).toBe(
      'El porcentaje no puede ser mayor a 100.',
    );
  });

  it('sin tarifa aplicable la cotización lo indica', async () => {
    const contract = await newContract();
    await addRate(contract.id, { basis: 'per_vehicle', amount: 1100, maxCapacity: 20 }).expect(201);
    const response = await quote(contract.id, { vehicleCapacity: 40 });
    expect(response.body).toMatchObject({ rate: null, total: 0 });
  });
});

describe('permisos de contratos', () => {
  it('administración consulta contratos pero no los edita; el despachador no los ve', async () => {
    const billing = await tokenFor(
      (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['billing'] })).email,
    );
    const dispatcher = await tokenFor(
      (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['dispatcher'] })).email,
    );
    await request(app.server).get('/contracts').set('authorization', billing).expect(200);
    await request(app.server).post('/contracts').set('authorization', billing).send({}).expect(403);
    await request(app.server).get('/contracts').set('authorization', dispatcher).expect(403);
  });
});
