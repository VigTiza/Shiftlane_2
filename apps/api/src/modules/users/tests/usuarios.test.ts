import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerId: string;
let ownerAuth: string;

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  const owner = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
  ownerId = owner.id;
  ownerAuth = await tokenFor(owner.email);
});

afterAll(async () => {
  await app.close();
});

describe('usuarios de la cuenta', () => {
  it('lista solo los usuarios de su transportista, con roles y permisos', async () => {
    const dispatcher = await fx.carrierUser({
      tenantId,
      password: PASSWORD,
      roles: ['dispatcher'],
    });
    const otherTenant = await fx.tenant();
    const outsider = await fx.carrierUser({ tenantId: otherTenant.id, password: PASSWORD });

    const response = await request(app.server)
      .get('/users')
      .set('authorization', ownerAuth)
      .expect(200);
    const ids = (response.body as { id: string }[]).map((user) => user.id);
    expect(ids).toContain(dispatcher.id);
    expect(ids).not.toContain(outsider.id);
    const listed = (response.body as { id: string; roles: string[] }[]).find(
      (u) => u.id === dispatcher.id,
    );
    expect(listed?.roles).toEqual(['dispatcher']);
  });

  it('cambia roles y valida que existan y sean del ámbito del usuario', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['planner'] });
    const updated = await request(app.server)
      .put(`/users/${user.id}/roles`)
      .set('authorization', ownerAuth)
      .send({ roles: ['planner', 'dispatcher'] })
      .expect(200);
    expect(updated.body.roles).toEqual(['dispatcher', 'planner']);

    const unknown = await request(app.server)
      .put(`/users/${user.id}/roles`)
      .set('authorization', ownerAuth)
      .send({ roles: ['jefe_supremo'] })
      .expect(400);
    expect(unknown.body.error.message).toBe('El rol «jefe_supremo» no existe.');

    await request(app.server)
      .put(`/users/${user.id}/roles`)
      .set('authorization', ownerAuth)
      .send({ roles: ['plant_hr'] })
      .expect(400);
    await request(app.server)
      .put(`/users/${user.id}/roles`)
      .set('authorization', ownerAuth)
      .send({ roles: ['platform_admin'] })
      .expect(400);
  });

  it('no permite dejar a la cuenta sin dueño ni desactivarse a sí mismo', async () => {
    const soloTenant = await fx.tenant();
    const soloOwner = await fx.carrierUser({
      tenantId: soloTenant.id,
      password: PASSWORD,
      roles: ['owner'],
    });
    const soloAuth = await tokenFor(soloOwner.email);

    const lastOwner = await request(app.server)
      .put(`/users/${soloOwner.id}/roles`)
      .set('authorization', soloAuth)
      .send({ roles: ['manager'] })
      .expect(409);
    expect(lastOwner.body.error.message).toBe('La cuenta debe tener al menos un dueño activo.');

    const self = await request(app.server)
      .patch(`/users/${soloOwner.id}`)
      .set('authorization', soloAuth)
      .send({ status: 'disabled' })
      .expect(400);
    expect(self.body.error.message).toBe('No puedes desactivar tu propia cuenta.');
  });

  it('valida los permisos otorgados o quitados', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['billing'] });
    const send = (body: object) =>
      request(app.server)
        .put(`/users/${user.id}/permissions`)
        .set('authorization', ownerAuth)
        .send(body);

    expect((await send({ grants: ['no.existe'] }).expect(400)).body.error.message).toBe(
      'El permiso «no.existe» no existe.',
    );
    expect((await send({ grants: ['plant.employees'] }).expect(400)).body.error.message).toBe(
      'El permiso «plant.employees» no aplica a este usuario.',
    );
    await send({ grants: ['routes.read'], revokes: ['routes.read'] }).expect(400);

    const ok = await send({ grants: ['routes.read'], revokes: ['reports.finance'] }).expect(200);
    expect(ok.body.grantedPermissions).toEqual(['routes.read']);
    expect(ok.body.revokedPermissions).toEqual(['reports.finance']);
  });

  it('desactiva usuarios, que ya no pueden entrar', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['planner'] });
    await request(app.server)
      .patch(`/users/${user.id}`)
      .set('authorization', ownerAuth)
      .send({ status: 'disabled', fullName: 'Ex Programador' })
      .expect(200);
    await request(app.server)
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(401);
  });

  it('no puede administrar usuarios de otra transportista', async () => {
    const otherTenant = await fx.tenant();
    const outsider = await fx.carrierUser({ tenantId: otherTenant.id, password: PASSWORD });
    await request(app.server)
      .put(`/users/${outsider.id}/roles`)
      .set('authorization', ownerAuth)
      .send({ roles: ['owner'] })
      .expect(404);
    await request(app.server)
      .patch(`/users/${outsider.id}`)
      .set('authorization', ownerAuth)
      .send({ fullName: 'Hackeado' })
      .expect(404);
  });

  it('el dueño sigue activo después de las pruebas', async () => {
    const owner = await app.db.system.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(owner.status).toBe('active');
  });
});
