import { createPublicKey, generateKeyPairSync, randomUUID, verify } from 'node:crypto';

import { todayIn } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import {
  createFcmPushSender,
  createMemoryPushSender,
  parseServiceAccount,
  serviceAccountAssertion,
} from '../../../lib/push.ts';

const PASSWORD = 'Contrasena-segura-123';
const silentLog = { warn: () => undefined } as never;

function account() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    project_id: 'shiftlane-pruebas',
    client_email: 'avisos@shiftlane-pruebas.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: 'https://oauth2.googleapis.com/token',
  };
}

describe('envío por Firebase Cloud Messaging', () => {
  it('pide el token con un JWT firmado, lo reutiliza y envía el aviso', async () => {
    const sa = account();
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url === sa.token_uri) {
        return Promise.resolve(Response.json({ access_token: 'ya29.token', expires_in: 3600 }));
      }
      return Promise.resolve(Response.json({ name: 'projects/x/messages/1' }));
    }) as typeof fetch;
    const sender = createFcmPushSender({ account: sa, log: silentLog, fetch: fakeFetch });
    const message = { title: 'Viaje cancelado', body: 'Se canceló', data: { tripId: 't1' } };

    expect(await sender.send('token-1', message)).toBe('sent');
    expect(await sender.send('token-2', message)).toBe('sent');
    expect(calls.map((c) => c.url)).toEqual([
      sa.token_uri,
      'https://fcm.googleapis.com/v1/projects/shiftlane-pruebas/messages:send',
      'https://fcm.googleapis.com/v1/projects/shiftlane-pruebas/messages:send',
    ]);
    const assertion = new URLSearchParams(calls[0]!.init.body as string).get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${claims}`),
        createPublicKey(sa.private_key),
        Buffer.from(signature!, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: sa.token_uri,
    });
    const sent = calls[1]!;
    expect((sent.init.headers as Record<string, string>).authorization).toBe('Bearer ya29.token');
    expect(JSON.parse(sent.init.body as string)).toMatchObject({
      message: {
        token: 'token-1',
        notification: { title: 'Viaje cancelado', body: 'Se canceló' },
        data: { tripId: 't1' },
        android: { priority: 'high' },
      },
    });
  });

  it('distingue tokens vencidos y nunca lanza errores', async () => {
    const sa = account();
    let status = 404;
    const fakeFetch = ((url: string) => {
      if (url === sa.token_uri) {
        return Promise.resolve(Response.json({ access_token: 'a', expires_in: 3600 }));
      }
      if (status === 0) return Promise.reject(new Error('sin red'));
      return Promise.resolve(new Response('{"error":{"status":"NOT_FOUND"}}', { status }));
    }) as typeof fetch;
    const sender = createFcmPushSender({ account: sa, log: silentLog, fetch: fakeFetch });
    const message = { title: 't', body: 'b', data: {} };
    expect(await sender.send('viejo', message)).toBe('invalid_token');
    status = 500;
    expect(await sender.send('x', message)).toBe('failed');
    status = 0;
    expect(await sender.send('x', message)).toBe('failed');
  });

  it('lee la cuenta de servicio en JSON o en base64', () => {
    const sa = account();
    const json = JSON.stringify(sa);
    expect(parseServiceAccount(json).project_id).toBe('shiftlane-pruebas');
    expect(parseServiceAccount(Buffer.from(json).toString('base64')).client_email).toBe(
      sa.client_email,
    );
    expect(serviceAccountAssertion(parseServiceAccount(json)).split('.')).toHaveLength(3);
  });
});

describe('avisos al celular del chofer', () => {
  let app: App;
  let push: ReturnType<typeof createMemoryPushSender>;
  let tenantId: string;
  let plantId: string;
  let ownerAuth: string;

  async function tokenFor(email: string) {
    const response = await request(app.server)
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return `Bearer ${response.body.accessToken as string}`;
  }

  /** Chofer con sesión vigente en su celular (como después de escribir su PIN). */
  async function signedInDriver() {
    const fx = fixtures(app.db.system);
    const driver = await fx.driver({ tenantId });
    const device = await app.db.system.device.create({ data: { tenantId, secretHash: 'x' } });
    const session = await app.db.system.session.create({
      data: {
        principal: 'driver',
        driverId: driver.id,
        deviceId: device.id,
        tenantId,
        familyId: randomUUID(),
        refreshTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const token = await app.tokens.signAccess({
      kind: 'driver',
      sub: driver.id,
      sid: session.id,
      tenantId,
      deviceId: device.id,
    });
    return { id: driver.id, deviceId: device.id, sessionId: session.id, auth: `Bearer ${token}` };
  }

  function message(driverId: string, text: string) {
    return request(app.server)
      .post(`/drivers/${driverId}/messages`)
      .set('authorization', ownerAuth)
      .send({ text })
      .expect(202);
  }

  beforeAll(async () => {
    push = createMemoryPushSender();
    app = await buildTestApp({
      push,
      env: {
        MIN_DRIVER_APP_VERSION: '1.2.0',
        LATEST_DRIVER_APP_VERSION: '1.4.1',
        DRIVER_APP_DOWNLOAD_URL: 'https://descargas.shiftlane.mx/chofer.apk',
      },
    });
    const fx = fixtures(app.db.system);
    tenantId = (await fx.tenant()).id;
    plantId = (await fx.clientOrgWithPlant({ tenantId })).plant.id;
    ownerAuth = await tokenFor(
      (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('versión mínima y última de la app, sin sesión', async () => {
    const response = await request(app.server).get('/driver/app-version').expect(200);
    expect(response.body).toEqual({
      minVersion: '1.2.0',
      latestVersion: '1.4.1',
      downloadUrl: 'https://descargas.shiftlane.mx/chofer.apk',
    });
  });

  it('el mensaje del despachador llega al celular con la sesión del chofer', async () => {
    const driver = await signedInDriver();
    await message(driver.id, 'Sin token todavía');
    await app.driverPush.idle();
    expect(push.sent).toHaveLength(0);

    await request(app.server)
      .post('/driver/push-token')
      .set('authorization', driver.auth)
      .send({ token: 'fcm-token-chofer-1' })
      .expect(200, { saved: true });
    await message(driver.id, 'Toma el periférico, hay choque');
    await app.driverPush.idle();
    expect(push.sent).toEqual([
      {
        token: 'fcm-token-chofer-1',
        message: {
          title: 'Mensaje del despachador',
          body: 'Toma el periférico, hay choque',
          data: expect.objectContaining({ type: 'message' }) as unknown,
        },
      },
    ]);

    // Al cerrar sesión (celular compartido) ya no le llegan sus avisos.
    await app.db.system.session.update({
      where: { id: driver.sessionId },
      data: { revokedAt: new Date() },
    });
    await message(driver.id, 'Ya no debe llegar');
    await app.driverPush.idle();
    expect(push.sent).toHaveLength(1);
  });

  it('viaje cancelado y token vencido', async () => {
    const driver = await signedInDriver();
    await request(app.server)
      .post('/driver/push-token')
      .set('authorization', driver.auth)
      .send({ token: 'fcm-token-chofer-2' })
      .expect(200);
    const start = new Date(Date.now() + 3 * 60 * 60_000);
    const trip = await app.db.system.trip.create({
      data: {
        tenantId,
        plantId,
        kind: 'extra',
        extraReason: 'other',
        direction: 'inbound',
        serviceDate: new Date(`${todayIn(app.config.DEFAULT_TIME_ZONE)}T00:00:00Z`),
        scheduledStartAt: start,
        scheduledEndAt: new Date(start.getTime() + 60 * 60_000),
        driverId: driver.id,
        assignmentSource: 'manual',
      },
    });
    push.sent.length = 0;
    await request(app.server)
      .post(`/trips/${trip.id}/cancel`)
      .set('authorization', ownerAuth)
      .send({ reason: 'La planta suspendió el turno' })
      .expect(200);
    await app.driverPush.idle();
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.message.title).toBe('Viaje cancelado');
    expect(push.sent[0]!.message.body).toMatch(
      /^Se canceló el viaje extra de las \d\d:\d\d: La planta suspendió el turno$/,
    );
    expect(push.sent[0]!.message.data).toEqual({ type: 'trip_cancelled', tripId: trip.id });

    // FCM dice que el token ya no existe: se borra y no se vuelve a usar.
    push.invalidTokens.add('fcm-token-chofer-2');
    await message(driver.id, 'Hola');
    await app.driverPush.idle();
    const device = await app.db.system.device.findUniqueOrThrow({
      where: { id: driver.deviceId },
    });
    expect(device.pushToken).toBeNull();
  });

  it('el token se puede quitar y solo lo cambia el chofer de ese celular', async () => {
    const driver = await signedInDriver();
    await request(app.server)
      .post('/driver/push-token')
      .set('authorization', driver.auth)
      .send({ token: null })
      .expect(200, { saved: true });
    await request(app.server)
      .post('/driver/push-token')
      .set('authorization', ownerAuth)
      .send({ token: 'x' })
      .expect(403);
  });
});
