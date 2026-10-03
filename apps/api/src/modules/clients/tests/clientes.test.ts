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

async function tokenFor(email: string): Promise<string> {
  const response = await request(app.server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return `Bearer ${response.body.accessToken as string}`;
}

async function newOrg(name = 'Maquiladora Delta', auth = ownerAuth) {
  const response = await request(app.server)
    .post('/client-orgs')
    .set('authorization', auth)
    .send({ name })
    .expect(201);
  return response.body as { id: string; managed: boolean };
}

async function newPlant(orgId: string, body: Record<string, unknown> = {}) {
  const response = await request(app.server)
    .post(`/client-orgs/${orgId}/plants`)
    .set('authorization', ownerAuth)
    .send({
      name: 'Planta Delta Norte',
      address: 'Av. Tecnológico 100',
      location: { lat: 31.72, lng: -106.42 },
      ...body,
    })
    .expect(201);
  return response.body as {
    id: string;
    served: boolean;
    passengerActivationCode: string;
    location: unknown;
  };
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  ownerAuth = await tokenFor(
    (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] })).email,
  );
});

afterAll(async () => {
  await app.close();
});

describe('empresas cliente y plantas', () => {
  it('registra una empresa que la transportista administra', async () => {
    const response = await request(app.server)
      .post('/client-orgs')
      .set('authorization', ownerAuth)
      .send({
        name: 'Ensambles Épsilon',
        rfc: 'eep010101ab1',
        legalName: 'Ensambles Épsilon S.A. de C.V.',
      })
      .expect(201);
    expect(response.body).toMatchObject({
      name: 'Ensambles Épsilon',
      rfc: 'EEP010101AB1',
      managed: true,
      plants: [],
    });
  });

  it('valida el RFC', async () => {
    const response = await request(app.server)
      .post('/client-orgs')
      .set('authorization', ownerAuth)
      .send({ name: 'Mal RFC', rfc: '123' })
      .expect(400);
    expect(response.body.error.details[0].message).toBe('El RFC no tiene un formato válido.');
  });

  it('crea la planta con ubicación, código de activación y acuerdo de servicio', async () => {
    const org = await newOrg();
    const plant = await newPlant(org.id);
    expect(plant).toMatchObject({ served: true, location: { lat: 31.72, lng: -106.42 } });
    expect(plant.passengerActivationCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const agreement = await app.db.system.serviceAgreement.findFirstOrThrow({
      where: { plantId: plant.id },
    });
    expect(agreement).toMatchObject({ tenantId, status: 'active' });

    const list = await request(app.server)
      .get('/client-orgs')
      .query({ search: 'Delta' })
      .set('authorization', ownerAuth)
      .expect(200);
    expect(list.body.length).toBeGreaterThan(0);
  });

  it('rechaza ubicaciones fuera de México', async () => {
    const org = await newOrg();
    const response = await request(app.server)
      .post(`/client-orgs/${org.id}/plants`)
      .set('authorization', ownerAuth)
      .send({ name: 'Planta en Madrid', location: { lat: 40.4, lng: -3.7 } })
      .expect(400);
    expect(response.body.error.details.map((d: { message: string }) => d.message)).toContain(
      'La latitud está fuera de México.',
    );
  });

  it('edita la planta y su ubicación', async () => {
    const org = await newOrg();
    const plant = await newPlant(org.id);
    const updated = await request(app.server)
      .patch(`/plants/${plant.id}`)
      .set('authorization', ownerAuth)
      .send({ name: 'Planta Delta Sur', location: { lat: 31.65, lng: -106.38 } })
      .expect(200);
    expect(updated.body).toMatchObject({
      name: 'Planta Delta Sur',
      location: { lat: 31.65, lng: -106.38 },
    });
  });

  it('una empresa con usuarios propios ya no la edita la transportista', async () => {
    const org = await newOrg('Empresa Reclamada');
    await newPlant(org.id);
    await app.db.system.clientOrg.update({
      where: { id: org.id },
      data: { claimedAt: new Date() },
    });
    const response = await request(app.server)
      .patch(`/client-orgs/${org.id}`)
      .set('authorization', ownerAuth)
      .send({ name: 'Otro nombre' })
      .expect(409);
    expect(response.body.error.message).toMatch(/administra sus propios datos/);
  });
});

describe('puertas con QR fijo', () => {
  it('crea puertas con QR, las rota y desactiva', async () => {
    const org = await newOrg();
    const plant = await newPlant(org.id);
    const gate = await request(app.server)
      .post(`/plants/${plant.id}/gates`)
      .set('authorization', ownerAuth)
      .send({ name: 'Caseta principal', location: { lat: 31.7201, lng: -106.4202 } })
      .expect(201);
    expect(gate.body.qrPayload).toMatch(/^shiftlane-puerta:\/\/[\w-]{20,}$/);

    const rotated = await request(app.server)
      .post(`/plant-gates/${gate.body.id as string}/rotate-qr`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(rotated.body.qrPayload).not.toBe(gate.body.qrPayload);

    const disabled = await request(app.server)
      .patch(`/plant-gates/${gate.body.id as string}`)
      .set('authorization', ownerAuth)
      .send({ active: false })
      .expect(200);
    expect(disabled.body.active).toBe(false);

    const detail = await request(app.server)
      .get(`/plants/${plant.id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.gates).toHaveLength(1);
  });
});

describe('contactos del CRM', () => {
  it('agrega, edita y elimina contactos por área', async () => {
    const org = await newOrg();
    const plant = await newPlant(org.id);
    const contact = await request(app.server)
      .post(`/client-orgs/${org.id}/contacts`)
      .set('authorization', ownerAuth)
      .send({
        fullName: 'Lucía Fernández',
        area: 'logistics',
        email: 'lucia@delta.example',
        plantId: plant.id,
      })
      .expect(201);
    await request(app.server)
      .patch(`/client-contacts/${contact.body.id as string}`)
      .set('authorization', ownerAuth)
      .send({ position: 'Gerente de logística' })
      .expect(200);
    const detail = await request(app.server)
      .get(`/client-orgs/${org.id}`)
      .set('authorization', ownerAuth)
      .expect(200);
    expect(detail.body.contacts[0]).toMatchObject({
      fullName: 'Lucía Fernández',
      position: 'Gerente de logística',
    });
    await request(app.server)
      .delete(`/client-contacts/${contact.body.id as string}`)
      .set('authorization', ownerAuth)
      .expect(204);
  });
});

describe('aislamiento y permisos de clientes', () => {
  it('otra transportista no ve las empresas ni puede agregarles contactos', async () => {
    const org = await newOrg('Solo Mía');
    const otherTenant = await fx.tenant();
    const otherAuth = await tokenFor(
      (await fx.carrierUser({ tenantId: otherTenant.id, password: PASSWORD })).email,
    );
    await request(app.server)
      .get(`/client-orgs/${org.id}`)
      .set('authorization', otherAuth)
      .expect(404);
    await request(app.server)
      .post(`/client-orgs/${org.id}/contacts`)
      .set('authorization', otherAuth)
      .send({ fullName: 'Espía Corporativo' })
      .expect(404);
    const list = await request(app.server)
      .get('/client-orgs')
      .set('authorization', otherAuth)
      .expect(200);
    expect(list.body.map((o: { id: string }) => o.id)).not.toContain(org.id);
  });

  it('el despachador ve clientes pero no los edita', async () => {
    const dispatcher = await tokenFor(
      (await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['dispatcher'] })).email,
    );
    await request(app.server).get('/client-orgs').set('authorization', dispatcher).expect(200);
    await request(app.server)
      .post('/client-orgs')
      .set('authorization', dispatcher)
      .send({ name: 'No' })
      .expect(403);
  });
});
