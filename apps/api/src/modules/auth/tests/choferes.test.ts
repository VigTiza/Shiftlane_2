import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let dispatcherToken: string;

async function loginAs(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return response.body.accessToken as string;
}

async function newEnrollment(driverId: string, token = dispatcherToken): Promise<string> {
  const response = await request(app.server)
    .post(`/drivers/${driverId}/enrollment`)
    .set('authorization', `Bearer ${token}`)
    .expect(201);
  expect(response.body.qrPayload).toBe(`shiftlane-chofer://vincular?codigo=${response.body.code}`);
  return response.body.code as string;
}

interface Enrolled {
  accessToken: string;
  refreshToken: string;
  device: { id: string; secret: string | null };
}

async function enroll(
  code: string,
  body: Record<string, unknown> = { pin: '4321' },
): Promise<Enrolled> {
  const response = await request(app.server)
    .post('/auth/driver/enroll')
    .send({ code, device: { platform: 'android', model: 'Moto G', appVersion: '1.0.0' }, ...body })
    .expect(200);
  return response.body as Enrolled;
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  const dispatcher = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['dispatcher'] });
  dispatcherToken = await loginAs(dispatcher.email);
});

afterAll(async () => {
  await app.close();
});

describe('alta del chofer con QR de un solo uso', () => {
  it('el chofer escanea el QR, crea su PIN y queda vinculado al celular', async () => {
    const driver = await fx.driver({ tenantId });
    const enrolled = await enroll(await newEnrollment(driver.id));

    expect(enrolled.device.secret).toEqual(expect.any(String));
    const me = await request(app.server)
      .get('/auth/me')
      .set('authorization', `Bearer ${enrolled.accessToken}`)
      .expect(200);
    expect(me.body).toEqual({ kind: 'driver', id: driver.id, fullName: driver.fullName, tenantId });

    const device = await app.db.system.device.findUniqueOrThrow({
      where: { id: enrolled.device.id },
    });
    expect(device.secretHash).not.toBe(enrolled.device.secret);
    expect(device.model).toBe('Moto G');
  });

  it('el QR no sirve dos veces', async () => {
    const driver = await fx.driver({ tenantId });
    const code = await newEnrollment(driver.id);
    await enroll(code);
    const reused = await request(app.server)
      .post('/auth/driver/enroll')
      .send({ code, pin: '1111' })
      .expect(401);
    expect(reused.body.error.message).toMatch(/no es válido o ya se usó/);
  });

  it('generar un QR nuevo invalida el anterior', async () => {
    const driver = await fx.driver({ tenantId });
    const first = await newEnrollment(driver.id);
    await newEnrollment(driver.id);
    await request(app.server)
      .post('/auth/driver/enroll')
      .send({ code: first, pin: '1111' })
      .expect(401);
  });

  it('un QR vencido no sirve', async () => {
    const driver = await fx.driver({ tenantId });
    const code = await newEnrollment(driver.id);
    await app.db.system.driverEnrollment.updateMany({
      where: { driverId: driver.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.server).post('/auth/driver/enroll').send({ code, pin: '1111' }).expect(401);
  });

  it('pide crear el PIN si el chofer todavía no tiene', async () => {
    const driver = await fx.driver({ tenantId });
    const code = await newEnrollment(driver.id);
    const response = await request(app.server)
      .post('/auth/driver/enroll')
      .send({ code })
      .expect(400);
    expect(response.body.error.message).toBe('Crea un PIN de 4 dígitos para entrar a la app.');
    const badPin = await request(app.server)
      .post('/auth/driver/enroll')
      .send({ code, pin: '12' })
      .expect(400);
    expect(badPin.body.error.details[0].message).toBe('El PIN debe tener exactamente 4 dígitos.');
  });

  it('un despachador de otra transportista no puede generar QR para el chofer', async () => {
    const driver = await fx.driver({ tenantId });
    const otherTenant = await fx.tenant();
    const otherDispatcher = await fx.carrierUser({
      tenantId: otherTenant.id,
      password: PASSWORD,
      roles: ['dispatcher'],
    });
    const otherToken = await loginAs(otherDispatcher.email);
    await request(app.server)
      .post(`/drivers/${driver.id}/enrollment`)
      .set('authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('solo dueños, gerentes y despachadores pueden generar QR', async () => {
    const driver = await fx.driver({ tenantId });
    const billing = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['billing'] });
    const billingToken = await loginAs(billing.email);
    await request(app.server)
      .post(`/drivers/${driver.id}/enrollment`)
      .set('authorization', `Bearer ${billingToken}`)
      .expect(403);
    await request(app.server).post(`/drivers/${driver.id}/enrollment`).expect(401);
  });
});

describe('entrada con PIN ligado al celular', () => {
  it('entra con el PIN correcto y el secreto del celular', async () => {
    const driver = await fx.driver({ tenantId });
    const { device } = await enroll(await newEnrollment(driver.id), { pin: '2468' });
    const response = await request(app.server)
      .post('/auth/driver/login')
      .send({ deviceId: device.id, deviceSecret: device.secret, driverId: driver.id, pin: '2468' })
      .expect(200);
    expect(response.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: 900,
      refreshToken: expect.any(String),
    });

    const refreshed = await request(app.server)
      .post('/auth/refresh')
      .send({ refreshToken: response.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).not.toBe(response.body.refreshToken);
  });

  it('el PIN no sirve sin el secreto del celular', async () => {
    const driver = await fx.driver({ tenantId });
    const { device } = await enroll(await newEnrollment(driver.id), { pin: '2468' });
    const response = await request(app.server)
      .post('/auth/driver/login')
      .send({ deviceId: device.id, deviceSecret: 'x'.repeat(43), driverId: driver.id, pin: '2468' })
      .expect(401);
    expect(response.body.error.message).toMatch(/Este celular no está registrado/);
  });

  it('bloquea el PIN después de 5 intentos fallidos', async () => {
    const driver = await fx.driver({ tenantId });
    const { device } = await enroll(await newEnrollment(driver.id), { pin: '2468' });
    const attempt = (pin: string) =>
      request(app.server)
        .post('/auth/driver/login')
        .send({ deviceId: device.id, deviceSecret: device.secret, driverId: driver.id, pin });
    for (let i = 0; i < 5; i += 1) await attempt('0000').expect(401);
    const locked = await attempt('2468').expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('un celular compartido lista a sus choferes y cada uno entra con su PIN', async () => {
    const first = await fx.driver({ tenantId });
    const second = await fx.driver({ tenantId });
    const { device } = await enroll(await newEnrollment(first.id), { pin: '1357' });
    const secondEnroll = await enroll(await newEnrollment(second.id), {
      pin: '8642',
      device: { deviceId: device.id, deviceSecret: device.secret },
    });
    expect(secondEnroll.device).toEqual({ id: device.id, secret: null });

    const list = await request(app.server)
      .post('/auth/driver/device-drivers')
      .send({ deviceId: device.id, deviceSecret: device.secret })
      .expect(200);
    expect(list.body.map((d: { id: string }) => d.id).sort()).toEqual([first.id, second.id].sort());

    await request(app.server)
      .post('/auth/driver/login')
      .send({ deviceId: device.id, deviceSecret: device.secret, driverId: second.id, pin: '1357' })
      .expect(401);
    await request(app.server)
      .post('/auth/driver/login')
      .send({ deviceId: device.id, deviceSecret: device.secret, driverId: second.id, pin: '8642' })
      .expect(200);
  });

  it('un chofer no vinculado al celular no puede entrar en él', async () => {
    const enrolledDriver = await fx.driver({ tenantId });
    const outsider = await fx.driver({ tenantId });
    const { device } = await enroll(await newEnrollment(enrolledDriver.id), { pin: '1357' });
    await enroll(await newEnrollment(outsider.id), { pin: '9999' });
    await request(app.server)
      .post('/auth/driver/login')
      .send({
        deviceId: device.id,
        deviceSecret: device.secret,
        driverId: outsider.id,
        pin: '9999',
      })
      .expect(401);
  });
});

describe('el despachador restablece el PIN', () => {
  it('cierra las sesiones del chofer y le pide crear un PIN nuevo en su celular', async () => {
    const driver = await fx.driver({ tenantId });
    const enrolled = await enroll(await newEnrollment(driver.id), { pin: '2468' });
    const { device } = enrolled;

    await request(app.server)
      .post(`/drivers/${driver.id}/pin-reset`)
      .set('authorization', `Bearer ${dispatcherToken}`)
      .expect(200);

    await request(app.server)
      .post('/auth/refresh')
      .send({ refreshToken: enrolled.refreshToken })
      .expect(401);

    const notSet = await request(app.server)
      .post('/auth/driver/login')
      .send({ deviceId: device.id, deviceSecret: device.secret, driverId: driver.id, pin: '2468' })
      .expect(409);
    expect(notSet.body.error.code).toBe('PIN_NOT_SET');

    await request(app.server)
      .post('/auth/driver/pin')
      .send({ deviceId: device.id, deviceSecret: device.secret, driverId: driver.id, pin: '1122' })
      .expect(200);
    await request(app.server)
      .post('/auth/driver/login')
      .send({ deviceId: device.id, deviceSecret: device.secret, driverId: driver.id, pin: '1122' })
      .expect(200);

    const again = await request(app.server)
      .post('/auth/driver/pin')
      .send({ deviceId: device.id, deviceSecret: device.secret, driverId: driver.id, pin: '3344' })
      .expect(409);
    expect(again.body.error.code).toBe('PIN_ALREADY_SET');
  });

  it('un chofer inactivo ya no puede renovar su sesión', async () => {
    const driver = await fx.driver({ tenantId });
    const enrolled = await enroll(await newEnrollment(driver.id), { pin: '2468' });
    await app.db.system.driver.update({ where: { id: driver.id }, data: { status: 'inactive' } });
    await request(app.server)
      .post('/auth/refresh')
      .send({ refreshToken: enrolled.refreshToken })
      .expect(401);
  });
});
