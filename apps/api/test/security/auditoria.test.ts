import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { App } from '../../src/app.ts';
import { buildTestApp } from '../helpers/app.ts';
import { fixtures } from '../helpers/fixtures.ts';

const PASSWORD = 'Transporte2026';

/** Tablas que no se auditan a propósito. Toda tabla nueva debe auditarse o agregarse aquí. */
const AUDIT_EXEMPT = [
  'route_stop_times',
  'stops',

  'audit_log',
  'passenger_imports',
  'password_reset_tokens',
  'roles',
  'routing_cache',
  'sessions',
];

let app: App;
let fx: ReturnType<typeof fixtures>;
let tenantId: string;
let ownerId: string;
let ownerAuth: string;

interface AuditRow {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | null;
}

async function auditFor(
  entityType: string,
  entityId: string,
  auth = ownerAuth,
): Promise<AuditRow[]> {
  const response = await request(app.server)
    .get('/audit-log')
    .query({ entityType, entityId })
    .set('authorization', auth)
    .expect(200);
  return response.body as AuditRow[];
}

beforeAll(async () => {
  app = await buildTestApp();
  fx = fixtures(app.db.system);
  tenantId = (await fx.tenant()).id;
  const owner = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['owner'] });
  ownerId = owner.id;
  const login = await request(app.server)
    .post('/auth/login')
    .send({ email: owner.email, password: PASSWORD })
    .expect(200);
  ownerAuth = `Bearer ${login.body.accessToken as string}`;
});

afterAll(async () => {
  await app.close();
});

describe('bitácora automática de cambios', () => {
  it('toda tabla de la aplicación se audita, salvo las exentas', async () => {
    const rows = await app.db.system.$queryRaw<{ table: string; audited: boolean }[]>`
      SELECT c.relname AS table,
             EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'audit_row') AS audited
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    const missing = rows
      .filter((r) => !r.audited && !AUDIT_EXEMPT.includes(r.table))
      .map((r) => r.table);
    expect(missing).toEqual([]);
  });

  it('registra quién cambió qué, el antes, el después y la petición', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['planner'] });
    const response = await request(app.server)
      .patch(`/users/${user.id}`)
      .set('authorization', ownerAuth)
      .send({ fullName: 'Nombre Corregido' })
      .expect(200);

    const [entry] = await auditFor('users', user.id);
    expect(entry).toMatchObject({
      actorType: 'user',
      actorId: ownerId,
      action: 'update',
      entityType: 'users',
      entityId: user.id,
      requestId: response.headers['x-request-id'],
    });
    expect(entry?.before?.full_name).toBe('Usuario de Prueba');
    expect(entry?.after?.full_name).toBe('Nombre Corregido');
  });

  it('registra altas y bajas (roles asignados y retirados)', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['planner'] });
    await request(app.server)
      .put(`/users/${user.id}/roles`)
      .set('authorization', ownerAuth)
      .send({ roles: ['dispatcher'] })
      .expect(200);

    const response = await request(app.server)
      .get('/audit-log')
      .query({ entityType: 'user_roles' })
      .set('authorization', ownerAuth)
      .expect(200);
    const forUser = (response.body as AuditRow[]).filter(
      (row) => (row.after ?? row.before)?.user_id === user.id && row.actorId === ownerId,
    );
    expect(forUser.map((row) => row.action).sort()).toEqual(['create', 'delete']);
  });

  it('nunca guarda hashes ni secretos; solo anota qué secreto cambió', async () => {
    const driver = await fx.driver({ tenantId });
    await app.db.system.driverPin.create({
      data: { driverId: driver.id, tenantId, pinHash: '$argon2id$hash-falso' },
    });
    await request(app.server)
      .post(`/drivers/${driver.id}/pin-reset`)
      .set('authorization', ownerAuth)
      .expect(200);

    const [entry] = await auditFor('driver_pins', driver.id);
    expect(entry?.action).toBe('update');
    expect(entry?.after?._secretos_cambiados).toEqual(['pin_hash']);
    expect(JSON.stringify(entry)).not.toContain('argon2id');
    expect(entry?.after).not.toHaveProperty('pin_hash');
  });

  it('no registra cambios sin importancia, como la fecha del último acceso', async () => {
    const user = await fx.carrierUser({ tenantId, password: PASSWORD, roles: ['planner'] });
    const before = (await auditFor('users', user.id)).length;
    await request(app.server)
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    await request(app.server)
      .post('/auth/login')
      .send({ email: user.email, password: 'Mala2026xx' })
      .expect(401);
    expect(await auditFor('users', user.id)).toHaveLength(before);
  });

  it('los cambios del sistema se registran como sistema', async () => {
    const driver = await fx.driver({ tenantId });
    const [entry] = await auditFor('drivers', driver.id);
    expect(entry).toMatchObject({ action: 'create', actorType: 'system', actorId: null });
  });

  it('cada transportista solo ve su propia bitácora', async () => {
    const otherTenant = await fx.tenant();
    const otherOwner = await fx.carrierUser({
      tenantId: otherTenant.id,
      password: PASSWORD,
      roles: ['owner'],
    });
    const login = await request(app.server)
      .post('/auth/login')
      .send({ email: otherOwner.email, password: PASSWORD })
      .expect(200);
    const otherAuth = `Bearer ${login.body.accessToken as string}`;

    const driver = await fx.driver({ tenantId });
    expect(await auditFor('drivers', driver.id, otherAuth)).toEqual([]);
    expect((await auditFor('drivers', driver.id)).length).toBeGreaterThan(0);
  });
});
