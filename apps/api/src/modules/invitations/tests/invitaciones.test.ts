import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { cookieValue, fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';
import type { MailMessage } from '../../../lib/mailer.ts';
import { hashSecret } from '../../auth/passwords.ts';
import { REFRESH_COOKIE } from '../../auth/routes.ts';

const PASSWORD = 'Transporte2026';

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;

async function tokenFor(email: string, password = PASSWORD): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

function invitationToken(email: string): string {
  const sent = (app.mailer as unknown as { sent: MailMessage[] }).sent.filter(
    (m) => m.to === email,
  );
  const text = sent.at(-1)?.text ?? '';
  return new URL(/https?:\/\/\S+/.exec(text)?.[0] ?? 'http://x').searchParams.get('token') ?? '';
}

async function managedPlant(auth = ownerAuth) {
  const org = await request(app.server)
    .post('/client-orgs')
    .set('authorization', auth)
    .send({ name: `Planta ${Date.now()}` })
    .expect(201);
  const plant = await request(app.server)
    .post(`/client-orgs/${org.body.id as string}/plants`)
    .set('authorization', auth)
    .send({ name: 'Planta Principal' })
    .expect(201);
  return { orgId: org.body.id as string, plantId: plant.body.id as string };
}

function invite(plantId: string, email: string, auth = ownerAuth) {
  return request(app.server)
    .post(`/plants/${plantId}/invitations`)
    .set('authorization', auth)
    .send({ email, fullName: 'Gerente de Logística', role: 'plant_logistics' });
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant('Transportes Invitadores')).id;
  ownerAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
  );
});

afterAll(async () => {
  await app.close();
});

describe('invitar a la planta por correo', () => {
  it('la invitación aceptada crea el usuario de planta y la empresa pasa a administrarse sola', async () => {
    const { orgId, plantId } = await managedPlant();
    const email = `logistica-${Date.now()}@planta.example`;
    const invitation = await invite(plantId, email).expect(201);
    expect(invitation.body).toMatchObject({ email, status: 'pending', role: 'plant_logistics' });
    expect(invitation.body.token).toBeUndefined();

    const mail = (app.mailer as unknown as { sent: MailMessage[] }).sent.find(
      (m) => m.to === email,
    );
    expect(mail?.subject).toBe('Transportes Invitadores te invita a Shiftlane');

    const accepted = await request(app.server)
      .post('/invitations/accept')
      .send({ token: invitationToken(email), password: 'PlantaSegura2026' })
      .expect(200);
    expect(cookieValue(accepted.headers['set-cookie'], REFRESH_COOKIE)).toBeTruthy();

    const me = await request(app.server)
      .get('/auth/me')
      .set('authorization', `Bearer ${accepted.body.accessToken as string}`)
      .expect(200);
    expect(me.body).toMatchObject({ kind: 'user', clientOrgId: orgId, roles: ['plant_logistics'] });

    const org = await app.db.system.clientOrg.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.claimedAt).not.toBeNull();
    const conflict = await request(app.server)
      .patch(`/client-orgs/${orgId}`)
      .set('authorization', ownerAuth)
      .send({ name: 'Cambio no permitido' })
      .expect(409);
    expect(conflict.body.error.message).toMatch(/administra sus propios datos/);

    // La transportista sigue viendo a su cliente por el acuerdo de servicio.
    await request(app.server)
      .get(`/client-orgs/${orgId}`)
      .set('authorization', ownerAuth)
      .expect(200);
    const list = await request(app.server)
      .get(`/plants/${plantId}/invitations`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(list.body[0].status).toBe('accepted');
  });

  it('el enlace no sirve dos veces, ni cancelado, ni vencido', async () => {
    const { plantId } = await managedPlant();
    const email = `uno-${Date.now()}@planta.example`;
    await invite(plantId, email).expect(201);
    const token = invitationToken(email);
    await request(app.server)
      .post('/invitations/accept')
      .send({ token, password: 'PlantaSegura2026' })
      .expect(200);
    const reused = await request(app.server)
      .post('/invitations/accept')
      .send({ token, password: 'PlantaSegura2026' })
      .expect(400);
    expect(reused.body.error.message).toMatch(/no es válida o ya venció/);

    const { plantId: other } = await managedPlant();
    const revokedEmail = `cancelada-${Date.now()}@planta.example`;
    const revoked = await invite(other, revokedEmail).expect(201);
    await request(app.server)
      .delete(`/plant-invitations/${revoked.body.id as string}`)
      .set('authorization', ownerAuth)
      .expect(204);
    await request(app.server)
      .post('/invitations/accept')
      .send({ token: invitationToken(revokedEmail), password: 'PlantaSegura2026' })
      .expect(400);

    const expiredEmail = `vencida-${Date.now()}@planta.example`;
    const expired = await invite(other, expiredEmail).expect(201);
    await app.db.system.plantInvitation.update({
      where: { id: expired.body.id as string },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.server)
      .post('/invitations/accept')
      .send({ token: invitationToken(expiredEmail), password: 'PlantaSegura2026' })
      .expect(400);
  });

  it('si el correo ya tiene cuenta, pide aceptar desde la cuenta', async () => {
    const { plantId } = await managedPlant();
    const user = await fx.carrierUser({ tenantId, password: PASSWORD });
    await invite(plantId, user.email).expect(201);
    const response = await request(app.server)
      .post('/invitations/accept')
      .send({ token: invitationToken(user.email), password: 'PlantaSegura2026' })
      .expect(409);
    expect(response.body.error.code).toBe('ACCOUNT_EXISTS');
  });

  it('solo se invita a plantas que la transportista administra', async () => {
    const otherTenant = await fx.tenant();
    const { plant } = await fx.clientOrgWithPlant({ tenantId: otherTenant.id });
    await invite(plant.id, 'x@planta.example').expect(404);
  });
});

describe('planta que ya usa Shiftlane con otra transportista', () => {
  it('acepta desde su cuenta: se crea el acuerdo y los datos capturados pasan a la empresa real', async () => {
    // La planta real ya trabaja con otra transportista y tiene su administradora.
    const otherTenant = await fx.tenant('Transportes Previos');
    const { org: realOrg, plant: realPlant } = await fx.clientOrgWithPlant({
      tenantId: otherTenant.id,
    });
    const adminEmail = `admin-${Date.now()}@real.example`;
    const admin = await app.db.system.user.create({
      data: {
        kind: 'plant',
        clientOrgId: realOrg.id,
        email: adminEmail,
        fullName: 'Admin Real',
        passwordHash: await hashSecret(PASSWORD),
      },
    });
    const logisticsRole = await app.db.system.role.findUniqueOrThrow({
      where: { key: 'plant_logistics' },
    });
    await app.db.system.userRole.create({ data: { userId: admin.id, roleId: logisticsRole.id } });

    // Nuestra transportista la registró por su cuenta, con contrato y contacto.
    const { orgId: placeholderOrg, plantId: placeholderPlant } = await managedPlant();
    const contract = await request(app.server)
      .post('/contracts')
      .set('authorization', ownerAuth)
      .send({
        clientOrgId: placeholderOrg,
        plantId: placeholderPlant,
        name: 'Contrato capturado',
        startsOn: '2026-01-01',
      })
      .expect(201);
    await request(app.server)
      .post(`/client-orgs/${placeholderOrg}/contacts`)
      .set('authorization', ownerAuth)
      .send({ fullName: 'Contacto Capturado', plantId: placeholderPlant })
      .expect(201);
    await invite(placeholderPlant, adminEmail).expect(201);

    const adminAuth = await tokenFor(adminEmail);
    const token = invitationToken(adminEmail);

    const otherPlant = await fx.clientOrgWithPlant({ tenantId: otherTenant.id });
    await request(app.server)
      .post('/invitations/accept-existing')
      .set('authorization', adminAuth)
      .send({ token, plantId: otherPlant.plant.id })
      .expect(400);

    const accepted = await request(app.server)
      .post('/invitations/accept-existing')
      .set('authorization', adminAuth)
      .send({ token, plantId: realPlant.id })
      .expect(200);
    expect(accepted.body).toMatchObject({
      tenantId,
      clientOrgId: realOrg.id,
      plantId: realPlant.id,
    });

    const moved = await request(app.server)
      .get(`/contracts/${contract.body.id as string}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(moved.body).toMatchObject({ clientOrgId: realOrg.id, plantId: realPlant.id });

    const real = await request(app.server)
      .get(`/client-orgs/${realOrg.id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(real.body.managed).toBe(false);
    expect(real.body.contacts.map((c: { fullName: string }) => c.fullName)).toContain(
      'Contacto Capturado',
    );
    expect(real.body.plants.find((p: { id: string }) => p.id === realPlant.id)?.served).toBe(true);

    const placeholder = await app.db.system.clientOrg.findUniqueOrThrow({
      where: { id: placeholderOrg },
    });
    expect(placeholder.deletedAt).not.toBeNull();

    // La planta ve ahora a las dos transportistas.
    const plantLogin = await request(app.server)
      .post('/auth/login')
      .send({ email: adminEmail, password: PASSWORD });
    const carriers = await app.db.system.serviceAgreement.findMany({
      where: { plantId: realPlant.id, deletedAt: null },
    });
    expect(carriers.map((a) => a.tenantId).sort()).toEqual([otherTenant.id, tenantId].sort());
    expect(plantLogin.status).toBe(200);
  });

  it('una invitación para otro correo no se puede aceptar', async () => {
    const otherTenant = await fx.tenant();
    const { org } = await fx.clientOrgWithPlant({ tenantId: otherTenant.id });
    const intruderEmail = `intruso-${Date.now()}@real.example`;
    const intruder = await app.db.system.user.create({
      data: {
        kind: 'plant',
        clientOrgId: org.id,
        email: intruderEmail,
        fullName: 'Intruso',
        passwordHash: await hashSecret(PASSWORD),
      },
    });
    const role = await app.db.system.role.findUniqueOrThrow({ where: { key: 'plant_logistics' } });
    await app.db.system.userRole.create({ data: { userId: intruder.id, roleId: role.id } });

    const { plantId } = await managedPlant();
    const target = `destino-${Date.now()}@planta.example`;
    await invite(plantId, target).expect(201);
    const intruderAuth = await tokenFor(intruderEmail);
    const response = await request(app.server)
      .post('/invitations/accept-existing')
      .set('authorization', intruderAuth)
      .send({ token: invitationToken(target) })
      .expect(403);
    expect(response.body.error.message).toBe('Esta invitación es para otro correo.');
  });
});
