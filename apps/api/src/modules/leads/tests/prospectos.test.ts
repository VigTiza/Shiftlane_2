import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp } from '../../../../test/helpers/app.ts';
import { fixtures } from '../../../../test/helpers/fixtures.ts';
import type { App } from '../../../app.ts';

const PASSWORD = 'Transporte2026';

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerAuth: string;

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  const owner = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
  const login = await request(app.server)
    .post('/auth/login')
    .send({ email: owner.email, password: PASSWORD });
  ownerAuth = `Bearer ${login.body.accessToken as string}`;
});

afterAll(async () => {
  await app.close();
});

describe('prospectos con etapas', () => {
  it('registra un prospecto y lo avanza por las etapas', async () => {
    const lead = await request(app.server)
      .post('/leads')
      .set('authorization', ownerAuth)
      .send({
        companyName: 'Arneses Zeta',
        contactName: 'Mario Ibarra',
        estimatedVehicles: 12,
        estimatedMonthlyValue: 180000,
      })
      .expect(201);
    expect(lead.body).toMatchObject({
      stage: 'contacted',
      estimatedVehicles: 12,
      estimatedMonthlyValue: 180000,
    });

    for (const stage of ['quoted', 'pilot']) {
      await request(app.server)
        .patch(`/leads/${lead.body.id as string}`)
        .set('authorization', ownerAuth)
        .send({ stage })
        .expect(200);
    }
    const piloting = await request(app.server)
      .get('/leads')
      .query({ stage: 'pilot' })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(piloting.body.map((l: { id: string }) => l.id)).toContain(lead.body.id);
  });

  it('perder un prospecto exige el motivo', async () => {
    const lead = await request(app.server)
      .post('/leads')
      .set('authorization', ownerAuth)
      .send({ companyName: 'Cables Eta' })
      .expect(201);
    const missing = await request(app.server)
      .patch(`/leads/${lead.body.id as string}`)
      .set('authorization', ownerAuth)
      .send({ stage: 'lost' })
      .expect(400);
    expect(missing.body.error.details[0].message).toBe('Indica por qué se perdió el prospecto.');
    await request(app.server)
      .patch(`/leads/${lead.body.id as string}`)
      .set('authorization', ownerAuth)
      .send({ stage: 'lost', lostReason: 'Eligió otro proveedor por precio' })
      .expect(200);
  });

  it('convierte un prospecto ganado en empresa cliente con planta y contacto', async () => {
    const lead = await request(app.server)
      .post('/leads')
      .set('authorization', ownerAuth)
      .send({ companyName: 'Moldes Theta', contactName: 'Sara Núñez', email: 'sara@theta.example' })
      .expect(201);
    const converted = await request(app.server)
      .post(`/leads/${lead.body.id as string}/convert`)
      .set('authorization', ownerAuth)
      .send({ plantName: 'Planta Theta 1' })
      .expect(200);
    expect(converted.body.lead).toMatchObject({
      stage: 'won',
      convertedClientOrgId: converted.body.clientOrgId,
    });
    expect(converted.body.plantId).toEqual(expect.any(String));

    const org = await request(app.server)
      .get(`/client-orgs/${converted.body.clientOrgId as string}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(org.body).toMatchObject({ name: 'Moldes Theta', managed: true });
    expect(org.body.plants[0]).toMatchObject({ name: 'Planta Theta 1', served: true });
    expect(org.body.contacts[0]).toMatchObject({
      fullName: 'Sara Núñez',
      email: 'sara@theta.example',
    });

    await request(app.server)
      .post(`/leads/${lead.body.id as string}/convert`)
      .set('authorization', ownerAuth)
      .send({})
      .expect(409);
  });

  it('otra transportista no ve los prospectos', async () => {
    const lead = await request(app.server)
      .post('/leads')
      .set('authorization', ownerAuth)
      .send({ companyName: 'Secreto' })
      .expect(201);
    const otherTenant = await fx.tenant();
    const other = await fx.carrierUser({ tenantId: otherTenant.id, password: PASSWORD });
    const login = await request(app.server)
      .post('/auth/login')
      .send({ email: other.email, password: PASSWORD });
    const otherAuth = `Bearer ${login.body.accessToken as string}`;
    const list = await request(app.server)
      .get('/leads')
      .set('authorization', otherAuth)
      .expect(200);
    expect(list.body.map((l: { id: string }) => l.id)).not.toContain(lead.body.id);
    await request(app.server)
      .patch(`/leads/${lead.body.id as string}`)
      .set('authorization', otherAuth)
      .send({ stage: 'won' })
      .expect(404);
  });

  it('sin permiso responde 403 antes de validar los datos', async () => {
    const dispatcher = await fx.carrierUser({
      tenantId,
      password: PASSWORD,
      roles: ['dispatcher'],
    });
    const login = await request(app.server)
      .post('/auth/login')
      .send({ email: dispatcher.email, password: PASSWORD });
    await request(app.server)
      .post('/leads')
      .set('authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ datos: 'inválidos' })
      .expect(403);
    await request(app.server).post('/leads').send({ datos: 'inválidos' }).expect(401);
  });
});
