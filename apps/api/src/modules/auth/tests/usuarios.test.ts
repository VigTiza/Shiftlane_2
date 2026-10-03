import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { cookieValue, fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import type { MailMessage } from '../../../lib/mailer.ts';
import { REFRESH_COOKIE } from '../routes.ts';
import { totpCode, totpStep } from '../totp.ts';

const PASSWORD = 'Transporte2026';

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;

function sentMail(): MailMessage[] {
  return (app.mailer as unknown as { sent: MailMessage[] }).sent;
}

function login(email: string, password = PASSWORD) {
  return request(app.server).post('/auth/login').send({ email, password });
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
});

afterAll(async () => {
  await app.close();
});

describe('inicio de sesión con correo y contraseña', () => {
  it('entrega token de acceso y token de renovación en cookie httpOnly', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['dispatcher'] });
    const response = await login(user.email.toUpperCase()).expect(200);

    expect(response.body).toEqual({ accessToken: expect.any(String), expiresIn: 900 });
    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE}=`)) ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/auth/);

    const me = await request(app.server)
      .get('/auth/me')
      .set('authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ kind: 'user', id: user.id, tenantId, roles: ['dispatcher'] });
  });

  it('responde lo mismo si el correo no existe o la contraseña es incorrecta', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    const wrongPassword = await login(user.email, 'Equivocada2026').expect(401);
    const unknownEmail = await login('nadie@example.com').expect(401);
    expect(wrongPassword.body.error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Correo o contraseña incorrectos.',
    });
    expect(unknownEmail.body.error).toEqual(wrongPassword.body.error);
  });

  it('no deja entrar a cuentas desactivadas', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD, status: 'disabled' });
    await login(user.email).expect(401);
  });

  it('bloquea la cuenta 15 minutos después de 5 intentos fallidos', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(user.email, 'Equivocada2026').expect(401);
    }
    const locked = await login(user.email).expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.error.message).toMatch(/Intenta de nuevo en 1[45] minutos/);
  });

  it('valida el formato de los datos', async () => {
    const response = await request(app.server)
      .post('/auth/login')
      .send({ email: 'no-es-correo', password: '' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('token de acceso', () => {
  it('rechaza tokens ausentes, alterados o firmados con otra llave', async () => {
    await request(app.server).get('/auth/me').expect(401);
    await request(app.server).get('/auth/me').set('authorization', 'Bearer basura').expect(401);

    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    const { accessToken } = (await login(user.email)).body as { accessToken: string };
    const [header, payload, signature] = accessToken.split('.');
    const forged = Buffer.from(payload ?? '', 'base64url')
      .toString()
      .replace(tenantId, '00000000-0000-4000-8000-000000000099');
    const tampered = [header, Buffer.from(forged).toString('base64url'), signature].join('.');
    const response = await request(app.server)
      .get('/auth/me')
      .set('authorization', `Bearer ${tampered}`)
      .expect(401);
    expect(response.body.error.message).toBe(
      'Tu sesión no es válida o expiró. Inicia sesión de nuevo.',
    );
  });
});

describe('renovación con token rotativo', () => {
  it('cada renovación entrega un token nuevo y el anterior deja de servir', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    const first = cookieValue((await login(user.email)).headers['set-cookie'], REFRESH_COOKIE);

    const refreshed = await request(app.server)
      .post('/auth/refresh')
      .set('cookie', `${REFRESH_COOKIE}=${first}`)
      .expect(200);
    const second = cookieValue(refreshed.headers['set-cookie'], REFRESH_COOKIE);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).toBeUndefined();

    // Reusar el token viejo es señal de robo: se revoca toda la familia.
    const reuse = await request(app.server)
      .post('/auth/refresh')
      .set('cookie', `${REFRESH_COOKIE}=${first}`)
      .expect(401);
    expect(reuse.body.error.message).toMatch(/uso indebido/);
    await request(app.server)
      .post('/auth/refresh')
      .set('cookie', `${REFRESH_COOKIE}=${second}`)
      .expect(401);
  });

  it('sin cookie ni token responde 401', async () => {
    await request(app.server).post('/auth/refresh').expect(401);
  });
});

describe('cierre de sesiones', () => {
  it('cerrar sesión invalida el token de renovación', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    const token = cookieValue((await login(user.email)).headers['set-cookie'], REFRESH_COOKIE);
    await request(app.server)
      .post('/auth/logout')
      .set('cookie', `${REFRESH_COOKIE}=${token}`)
      .expect(204);
    await request(app.server)
      .post('/auth/refresh')
      .set('cookie', `${REFRESH_COOKIE}=${token}`)
      .expect(401);
  });

  it('lista sesiones abiertas, cierra una y luego todas', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    const a = await login(user.email);
    const b = await login(user.email);
    const tokenA = cookieValue(a.headers['set-cookie'], REFRESH_COOKIE);
    const auth = `Bearer ${b.body.accessToken}`;

    const list = await request(app.server)
      .get('/auth/sessions')
      .set('authorization', auth)
      .expect(200);
    expect(list.body).toHaveLength(2);

    const oldest = list.body[1] as { id: string };
    await request(app.server)
      .delete(`/auth/sessions/${oldest.id}`)
      .set('authorization', auth)
      .expect(204);
    await request(app.server)
      .post('/auth/refresh')
      .set('cookie', `${REFRESH_COOKIE}=${tokenA}`)
      .expect(401);

    await request(app.server).post('/auth/logout-all').set('authorization', auth).expect(204);
    const after = await request(app.server)
      .get('/auth/sessions')
      .set('authorization', auth)
      .expect(200);
    expect(after.body).toEqual([]);
  });

  it('no puede cerrar sesiones de otro usuario', async () => {
    const owner = await fx.carrierUser({ tenantId, password: PASSWORD });
    const intruder = await fx.carrierUser({ tenantId, password: PASSWORD });
    const ownerSession = await login(owner.email);
    const ownerList = await request(app.server)
      .get('/auth/sessions')
      .set('authorization', `Bearer ${ownerSession.body.accessToken}`);
    const intruderToken = (await login(intruder.email)).body.accessToken as string;
    await request(app.server)
      .delete(`/auth/sessions/${(ownerList.body[0] as { id: string }).id}`)
      .set('authorization', `Bearer ${intruderToken}`)
      .expect(404);
  });
});

describe('recuperación de contraseña por correo', () => {
  it('envía un enlace de un solo uso y cierra las sesiones al cambiarla', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    const session = cookieValue((await login(user.email)).headers['set-cookie'], REFRESH_COOKIE);

    const forgot = await request(app.server)
      .post('/auth/password/forgot')
      .send({ email: user.email })
      .expect(202);
    expect(forgot.body.message).toMatch(/Si el correo está registrado/);

    const mail = sentMail().find((m) => m.to === user.email);
    expect(mail?.subject).toBe('Restablece tu contraseña de Shiftlane');
    const token = new URL(
      /https?:\/\/\S+/.exec(mail?.text ?? '')?.[0] ?? 'http://x',
    ).searchParams.get('token');
    expect(token).toBeTruthy();

    await request(app.server)
      .post('/auth/password/reset')
      .send({ token, password: 'NuevaClave2026' })
      .expect(200);

    await login(user.email, PASSWORD).expect(401);
    await login(user.email, 'NuevaClave2026').expect(200);
    await request(app.server)
      .post('/auth/refresh')
      .set('cookie', `${REFRESH_COOKIE}=${session}`)
      .expect(401);

    const reused = await request(app.server)
      .post('/auth/password/reset')
      .send({ token, password: 'OtraClave2026' })
      .expect(400);
    expect(reused.body.error.message).toMatch(/no es válido o ya venció/);
  });

  it('responde igual con un correo desconocido y no envía nada', async () => {
    const before = sentMail().length;
    await request(app.server)
      .post('/auth/password/forgot')
      .send({ email: 'nadie@example.com' })
      .expect(202);
    expect(sentMail()).toHaveLength(before);
  });

  it('exige una contraseña nueva segura', async () => {
    const response = await request(app.server)
      .post('/auth/password/reset')
      .send({ token: 'x'.repeat(30), password: 'corta' })
      .expect(400);
    expect(response.body.error.details[0].message).toMatch(/al menos 10 caracteres/);
  });
});

describe('verificación en dos pasos (TOTP)', () => {
  it('se activa con un código, se exige al entrar y no acepta códigos repetidos', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    const access = `Bearer ${(await login(user.email)).body.accessToken}`;

    const setup = await request(app.server)
      .post('/auth/2fa/setup')
      .set('authorization', access)
      .expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Shiftlane/);
    const secret = setup.body.secret as string;

    await request(app.server)
      .post('/auth/2fa/enable')
      .set('authorization', access)
      .send({ code: '000000' })
      .expect(400);
    const enableStep = totpStep(Date.now());
    await request(app.server)
      .post('/auth/2fa/enable')
      .set('authorization', access)
      .send({ code: totpCode(secret, enableStep) })
      .expect(200);

    const challenge = await login(user.email).expect(200);
    expect(challenge.body).toEqual({ twoFactorRequired: true, challengeToken: expect.any(String) });
    expect(challenge.headers['set-cookie']).toBeUndefined();

    // El código usado para activar ya no sirve; el del siguiente paso sí.
    await request(app.server)
      .post('/auth/login/2fa')
      .send({ challengeToken: challenge.body.challengeToken, code: totpCode(secret, enableStep) })
      .expect(401);
    const nextCode = totpCode(secret, enableStep + 1);
    const done = await request(app.server)
      .post('/auth/login/2fa')
      .send({ challengeToken: challenge.body.challengeToken, code: nextCode })
      .expect(200);
    expect(cookieValue(done.headers['set-cookie'], REFRESH_COOKIE)).toBeTruthy();

    await request(app.server)
      .post('/auth/login/2fa')
      .send({ challengeToken: challenge.body.challengeToken, code: nextCode })
      .expect(401);

    const stored = await app.db.system.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.totpSecret).not.toContain(secret);
  });

  it('desactivarla exige contraseña y código', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    const access = `Bearer ${(await login(user.email)).body.accessToken}`;
    const { secret } = (
      await request(app.server).post('/auth/2fa/setup').set('authorization', access)
    ).body as {
      secret: string;
    };
    const step = totpStep(Date.now());
    await request(app.server)
      .post('/auth/2fa/enable')
      .set('authorization', access)
      .send({ code: totpCode(secret, step) })
      .expect(200);

    await request(app.server)
      .post('/auth/2fa/disable')
      .set('authorization', access)
      .send({ password: 'Equivocada2026', code: totpCode(secret, step + 1) })
      .expect(401);
    await request(app.server)
      .post('/auth/2fa/disable')
      .set('authorization', access)
      .send({ password: PASSWORD, code: totpCode(secret, step + 1) })
      .expect(200);
    await login(user.email)
      .expect(200)
      .expect((response) => {
        expect(response.body.accessToken).toEqual(expect.any(String));
      });
  });

  it('un código 2FA falso con un desafío inválido no entra', async () => {
    await request(app.server)
      .post('/auth/login/2fa')
      .send({ challengeToken: 'desafio-falso', code: '123456' })
      .expect(401);
  });
});

describe('límite de intentos en endpoints de acceso', () => {
  it('limita el inicio de sesión por IP', async () => {
    const limited = await buildTestApp({ env: { AUTH_RATE_LIMIT_MAX: '3' } });
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await request(limited.server)
          .post('/auth/login')
          .send({ email: 'x@example.com', password: 'x' })
          .expect(401);
      }
      const response = await request(limited.server)
        .post('/auth/login')
        .send({ email: 'x@example.com', password: 'x' })
        .expect(429);
      expect(response.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
