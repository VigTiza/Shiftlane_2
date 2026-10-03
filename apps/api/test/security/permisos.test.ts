import { ROLE_KEYS, ROLES } from '@shiftlane/shared';
import type { RoleDefinition } from '@shiftlane/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { App } from '../../src/app.ts';
import { buildTestApp } from '../helpers/app.ts';
import { fixtures } from '../helpers/fixtures.ts';

const PASSWORD = 'Transporte2026';

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let driverId: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return response.body.accessToken as string;
}

async function carrierToken(roles: string[]): Promise<{ token: string; userId: string }> {
  const user = await fx.carrierUser({ tenantId, password: PASSWORD, roles });
  return { token: await tokenFor(user.email), userId: user.id };
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
  driverId = (await fx.driver({ tenantId })).id;
});

afterAll(async () => {
  await app.close();
});

describe('catálogo de roles', () => {
  it('los roles de la base de datos coinciden con la matriz de packages/shared', async () => {
    const rows = await app.db.system.role.findMany({ orderBy: { key: 'asc' } });
    expect(rows.map((role) => [role.key, role.scope])).toEqual(
      [...ROLE_KEYS].sort().map((key) => [key, (ROLES[key] as RoleDefinition).scope]),
    );
  });
});

describe('permisos por acción en los endpoints', () => {
  // [rol, ver usuarios, ver bitácora, generar QR de chofer]
  const matrix: [string, boolean, boolean, boolean][] = [
    ['owner', true, true, true],
    ['manager', true, true, true],
    ['dispatcher', false, false, true],
    ['planner', false, false, false],
    ['billing', false, false, false],
    ['maintenance', false, false, false],
  ];

  for (const [role, canReadUsers, canReadAudit, canEnroll] of matrix) {
    it(`${role}: usuarios ${canReadUsers ? 'sí' : 'no'}, bitácora ${canReadAudit ? 'sí' : 'no'}, QR ${canEnroll ? 'sí' : 'no'}`, async () => {
      const { token } = await carrierToken([role]);
      const auth = `Bearer ${token}`;
      await request(app.server)
        .get('/users')
        .set('authorization', auth)
        .expect(canReadUsers ? 200 : 403);
      await request(app.server)
        .get('/audit-log')
        .set('authorization', auth)
        .expect(canReadAudit ? 200 : 403);
      await request(app.server)
        .post(`/drivers/${driverId}/enrollment`)
        .set('authorization', auth)
        .expect(canEnroll ? 201 : 403);
    });
  }

  it('la respuesta 403 está en español', async () => {
    const { token } = await carrierToken(['billing']);
    const response = await request(app.server)
      .get('/users')
      .set('authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'No tienes permiso para realizar esta acción.',
    });
  });

  it('GET /me/permissions devuelve los permisos efectivos', async () => {
    const { token } = await carrierToken(['dispatcher']);
    const response = await request(app.server)
      .get('/me/permissions')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.roles).toEqual(['dispatcher']);
    expect(response.body.permissions).toContain('drivers.enroll');
    expect(response.body.permissions).not.toContain('users.manage');
  });

  it('los permisos otorgados o quitados a un usuario cambian lo que puede hacer', async () => {
    const owner = await carrierToken(['owner']);
    const billing = await carrierToken(['billing']);
    const dispatcher = await carrierToken(['dispatcher']);

    await request(app.server)
      .put(`/users/${billing.userId}/permissions`)
      .set('authorization', `Bearer ${owner.token}`)
      .send({ grants: ['drivers.enroll'] })
      .expect(200);
    await request(app.server)
      .put(`/users/${dispatcher.userId}/permissions`)
      .set('authorization', `Bearer ${owner.token}`)
      .send({ revokes: ['drivers.enroll'] })
      .expect(200);

    // El cambio se aplica al emitir un token nuevo.
    const billingUser = await app.db.system.user.findUniqueOrThrow({
      where: { id: billing.userId },
    });
    const dispatcherUser = await app.db.system.user.findUniqueOrThrow({
      where: { id: dispatcher.userId },
    });
    const billingToken = await tokenFor(billingUser.email);
    const dispatcherToken = await tokenFor(dispatcherUser.email);
    await request(app.server)
      .post(`/drivers/${driverId}/enrollment`)
      .set('authorization', `Bearer ${billingToken}`)
      .expect(201);
    await request(app.server)
      .post(`/drivers/${driverId}/enrollment`)
      .set('authorization', `Bearer ${dispatcherToken}`)
      .expect(403);
  });

  it('choferes, pasajeros y la plataforma no usan endpoints de la transportista', async () => {
    const admin = await app.db.system.user.create({
      data: {
        kind: 'platform',
        email: `admin-${Date.now()}@example.com`,
        fullName: 'Admin',
        passwordHash: (await app.db.system.user.findFirstOrThrow({ where: { tenantId } }))
          .passwordHash,
      },
    });
    const platformRole = await app.db.system.role.findUniqueOrThrow({
      where: { key: 'platform_admin' },
    });
    await app.db.system.userRole.create({ data: { userId: admin.id, roleId: platformRole.id } });
    const adminToken = await tokenFor(admin.email);

    await request(app.server)
      .get('/users')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(403);
    await request(app.server)
      .post(`/drivers/${driverId}/enrollment`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(403);
  });
});
