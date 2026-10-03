import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { SEED, seed } from '../../prisma/seed.ts';
import { APP_DB_ROLE, createDatabase, withDbContext } from '../../src/lib/db.ts';
import type { Database, DbContext, DbTransaction } from '../../src/lib/db.ts';

const { tenants, clientOrgs, plants, users } = SEED;

const NORTE: DbContext = { tenantId: tenants.norte.id, userId: users.norteOwner.id };
const JUAREZ: DbContext = { tenantId: tenants.juarez.id, userId: users.juarezOwner.id };
const ALFA: DbContext = { clientOrgId: clientOrgs.alfa.id, userId: users.alfaLogistics.id };
const BETA: DbContext = { clientOrgId: clientOrgs.beta.id, userId: users.betaHr.id };

const RLS_ERROR = /row-level security/i;
const PERMISSION_ERROR = /permission denied/i;

let db: Database;

function as<T>(context: DbContext, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return withDbContext(db.app, context, fn);
}

beforeAll(async () => {
  db = createDatabase(inject('databaseUrl'));
  await seed(db.system);
});

afterAll(async () => {
  await db.close();
});

describe('configuración de seguridad por filas', () => {
  it('toda tabla de la aplicación tiene RLS activa y políticas para el rol de la API', async () => {
    // Tablas que solo usa el sistema (db.system): RLS activa y ninguna política = acceso denegado.
    const SYSTEM_ONLY = ['password_reset_tokens'];
    const tables = await db.system.$queryRaw<{ table: string; rls: boolean; policies: number }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    expect(tables.length).toBeGreaterThanOrEqual(16);
    expect(tables.filter((t) => !t.rls).map((t) => t.table)).toEqual([]);
    const withoutPolicies = tables.filter((t) => t.policies === 0).map((t) => t.table);
    expect(withoutPolicies.sort()).toEqual(SYSTEM_ONLY);
  });

  it('el rol de la API no tiene acceso a las tablas solo del sistema', async () => {
    await expect(as(NORTE, (tx) => tx.passwordResetToken.findMany())).rejects.toThrow(
      PERMISSION_ERROR,
    );
  });

  it('el rol de la API no puede saltarse la seguridad por filas', async () => {
    const [role] = await db.system.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ${APP_DB_ROLE}`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('las conexiones de la API usan el rol restringido', async () => {
    const [row] = await db.app.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(row?.current_user).toBe(APP_DB_ROLE);
  });

  it('sin contexto no se ve ninguna fila', async () => {
    expect(await db.app.user.findMany()).toEqual([]);
    expect(await db.app.tenant.findMany()).toEqual([]);
    expect(await as({}, (tx) => tx.serviceAgreement.findMany())).toEqual([]);
    expect(await as({}, (tx) => tx.plant.findMany())).toEqual([]);
  });

  it('el contexto no pasa a la siguiente transacción en la misma conexión', async () => {
    const pool = new pg.Pool({
      connectionString: inject('databaseUrl'),
      max: 1,
      options: `-c role=${APP_DB_ROLE}`,
    });
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenants.norte.id]);
        const inside = await client.query('SELECT count(*)::int AS n FROM users');
        await client.query('COMMIT');
        const after = await client.query('SELECT count(*)::int AS n FROM users');
        expect(inside.rows[0].n).toBeGreaterThan(0);
        expect(after.rows[0].n).toBe(0);
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });
});

describe('una transportista no ve ni modifica datos de otra', () => {
  it('consultas sin filtro solo devuelven sus usuarios', async () => {
    const found = await as(NORTE, (tx) => tx.user.findMany());
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((user) => user.tenantId === tenants.norte.id)).toBe(true);
    expect(found.map((user) => user.id)).not.toContain(users.juarezOwner.id);
  });

  it('SQL directo sin WHERE también queda filtrado', async () => {
    const rows = await as(
      NORTE,
      (tx) => tx.$queryRaw<{ tenant_id: string | null }[]>`SELECT tenant_id FROM users`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set([tenants.norte.id]));
  });

  it('solo ve su propia cuenta', async () => {
    const found = await as(NORTE, (tx) => tx.tenant.findMany());
    expect(found.map((tenant) => tenant.id)).toEqual([tenants.norte.id]);
  });

  it('no encuentra registros de otra transportista aunque conozca su id', async () => {
    const other = await as(NORTE, (tx) =>
      tx.user.findUnique({ where: { id: users.juarezOwner.id } }),
    );
    expect(other).toBeNull();
  });

  it('no puede modificar ni borrar usuarios de otra transportista', async () => {
    await expect(
      as(NORTE, (tx) =>
        tx.user.update({ where: { id: users.juarezOwner.id }, data: { fullName: 'Hackeado' } }),
      ),
    ).rejects.toThrow();

    const updated = await as(NORTE, (tx) => tx.user.updateMany({ data: { phone: '6560000000' } }));
    const norteUsers = await db.system.user.count({ where: { tenantId: tenants.norte.id } });
    expect(updated.count).toBe(norteUsers);

    const deleted = await as(NORTE, (tx) =>
      tx.user.deleteMany({ where: { id: users.juarezOwner.id } }),
    );
    expect(deleted.count).toBe(0);

    const victim = await db.system.user.findUniqueOrThrow({ where: { id: users.juarezOwner.id } });
    expect(victim.fullName).toBe('Ana Torres');
    expect(victim.phone).toBeNull();
  });

  it('no puede crear usuarios dentro de otra transportista', async () => {
    await expect(
      as(NORTE, (tx) =>
        tx.user.create({
          data: {
            kind: 'carrier',
            tenantId: tenants.juarez.id,
            email: `intruso-${randomUUID()}@example.com`,
            fullName: 'Intruso',
          },
        }),
      ),
    ).rejects.toThrow(RLS_ERROR);
  });

  it('solo ve sus acuerdos de servicio y las plantas que atiende', async () => {
    const agreements = await as(NORTE, (tx) => tx.serviceAgreement.findMany());
    expect(agreements.map((a) => a.plantId)).toEqual([plants.alfaNorte.id]);

    const visiblePlants = await as(NORTE, (tx) => tx.plant.findMany());
    expect(visiblePlants.map((plant) => plant.id)).toEqual([plants.alfaNorte.id]);

    const orgs = await as(NORTE, (tx) => tx.clientOrg.findMany());
    expect(orgs.map((org) => org.id)).toEqual([clientOrgs.alfa.id]);

    const juarezPlants = await as(JUAREZ, (tx) => tx.plant.findMany({ orderBy: { name: 'asc' } }));
    expect(juarezPlants.map((plant) => plant.id)).toEqual([
      plants.alfaNorte.id,
      plants.betaSalvarcar.id,
    ]);
  });

  it('no puede crear acuerdos con plantas de empresas que no administra', async () => {
    await expect(
      as(NORTE, (tx) =>
        tx.serviceAgreement.create({
          data: {
            tenantId: tenants.norte.id,
            plantId: plants.betaSalvarcar.id,
            clientOrgId: clientOrgs.beta.id,
          },
        }),
      ),
    ).rejects.toThrow(RLS_ERROR);
  });

  it('no puede cambiar la transportista ni la planta de un acuerdo', async () => {
    await expect(
      as(JUAREZ, (tx) =>
        tx.serviceAgreement.updateMany({
          where: { plantId: plants.betaSalvarcar.id },
          data: { plantId: plants.alfaNorte.id, clientOrgId: clientOrgs.alfa.id },
        }),
      ),
    ).rejects.toThrow(/No se puede cambiar/);
  });

  it('administra a sus clientes nuevos y otra transportista no los ve', async () => {
    const created = await as(NORTE, async (tx) => {
      const org = await tx.clientOrg.create({
        data: { name: 'Ensambles Gamma', createdByTenantId: tenants.norte.id },
      });
      const plant = await tx.plant.create({ data: { name: 'Planta Gamma', clientOrgId: org.id } });
      await tx.serviceAgreement.create({
        data: { tenantId: tenants.norte.id, plantId: plant.id, clientOrgId: org.id },
      });
      return { org, plant };
    });

    const norteSees = await as(NORTE, (tx) => tx.plant.findMany());
    expect(norteSees.map((plant) => plant.id)).toContain(created.plant.id);

    const juarezSees = await as(JUAREZ, (tx) => tx.clientOrg.findMany());
    expect(juarezSees.map((org) => org.id)).not.toContain(created.org.id);

    await expect(
      as(JUAREZ, (tx) =>
        tx.plant.create({ data: { name: 'Planta pirata', clientOrgId: created.org.id } }),
      ),
    ).rejects.toThrow(RLS_ERROR);
  });
});

describe('las plantas solo ven lo que les corresponde por acuerdo de servicio', () => {
  it('una planta con dos transportistas ve a ambas en un solo tablero', async () => {
    const agreements = await as(ALFA, (tx) => tx.serviceAgreement.findMany());
    expect(new Set(agreements.map((a) => a.tenantId))).toEqual(
      new Set([tenants.norte.id, tenants.juarez.id]),
    );
    const carriers = await as(ALFA, (tx) => tx.tenant.findMany({ orderBy: { name: 'asc' } }));
    expect(carriers.map((tenant) => tenant.id)).toEqual([tenants.juarez.id, tenants.norte.id]);
  });

  it('no ve transportistas con las que no tiene acuerdo ni otras plantas', async () => {
    const carriers = await as(BETA, (tx) => tx.tenant.findMany());
    expect(carriers.map((tenant) => tenant.id)).toEqual([tenants.juarez.id]);

    const visiblePlants = await as(BETA, (tx) => tx.plant.findMany());
    expect(visiblePlants.map((plant) => plant.id)).toEqual([plants.betaSalvarcar.id]);

    const orgUsers = await as(BETA, (tx) => tx.user.findMany());
    expect(orgUsers.every((user) => user.clientOrgId === clientOrgs.beta.id)).toBe(true);
  });

  it('no ve los usuarios de las transportistas', async () => {
    const found = await as(ALFA, (tx) => tx.user.findMany());
    expect(found.every((user) => user.tenantId === null)).toBe(true);
  });

  it('no puede cambiar quién administra su empresa', async () => {
    await expect(
      as(ALFA, (tx) =>
        tx.clientOrg.update({
          where: { id: clientOrgs.alfa.id },
          data: { claimedAt: null, createdByTenantId: tenants.juarez.id },
        }),
      ),
    ).rejects.toThrow(/No se puede cambiar quién administra/);
  });
});

describe('asignación de roles', () => {
  async function roleId(key: string) {
    return (await db.system.role.findUniqueOrThrow({ where: { key } })).id;
  }

  it('asigna roles de su ámbito a sus usuarios y copia el tenant', async () => {
    const assigned = await as(NORTE, async (tx) =>
      tx.userRole.create({
        data: { userId: users.norteDispatcher.id, roleId: await roleId('planner') },
      }),
    );
    expect(assigned.tenantId).toBe(tenants.norte.id);
  });

  it('no puede darse el rol de administrador de plataforma', async () => {
    const platformRole = await roleId('platform_admin');
    await expect(
      as(NORTE, (tx) =>
        tx.userRole.create({ data: { userId: users.norteOwner.id, roleId: platformRole } }),
      ),
    ).rejects.toThrow(/El rol no corresponde/);
  });

  it('no puede asignar roles de planta ni a usuarios de otra transportista', async () => {
    const plantRole = await roleId('plant_hr');
    await expect(
      as(NORTE, (tx) =>
        tx.userRole.create({ data: { userId: users.norteOwner.id, roleId: plantRole } }),
      ),
    ).rejects.toThrow(/El rol no corresponde/);

    const dispatcher = await roleId('dispatcher');
    await expect(
      as(NORTE, (tx) =>
        tx.userRole.create({ data: { userId: users.juarezOwner.id, roleId: dispatcher } }),
      ),
    ).rejects.toThrow(/El usuario no existe o no es visible/);
  });
});

describe('bitácora de auditoría', () => {
  it('se puede escribir en la propia cuenta pero nunca modificar ni borrar', async () => {
    const entry = await as(NORTE, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: tenants.norte.id,
          actorUserId: users.norteOwner.id,
          action: 'update',
          entityType: 'user',
          entityId: users.norteDispatcher.id,
        },
      }),
    );

    await expect(
      as(NORTE, (tx) =>
        tx.auditLog.update({ where: { id: entry.id }, data: { action: 'borrado' } }),
      ),
    ).rejects.toThrow(PERMISSION_ERROR);
    await expect(
      as(NORTE, (tx) => tx.auditLog.delete({ where: { id: entry.id } })),
    ).rejects.toThrow(PERMISSION_ERROR);

    await expect(
      as(NORTE, (tx) =>
        tx.auditLog.create({
          data: { tenantId: tenants.juarez.id, action: 'create', entityType: 'user' },
        }),
      ),
    ).rejects.toThrow(RLS_ERROR);

    const juarezLog = await as(JUAREZ, (tx) => tx.auditLog.findMany());
    expect(juarezLog.map((log) => log.id)).not.toContain(entry.id);
  });
});

describe('choferes, celulares y pasajeros', () => {
  it('una transportista no ve los choferes ni celulares de otra', async () => {
    const juarezDriver = await db.system.driver.create({
      data: { tenantId: tenants.juarez.id, fullName: 'Chofer de Rutas Juárez' },
    });
    await db.system.device.create({ data: { tenantId: tenants.juarez.id, secretHash: 'x' } });

    const norteDrivers = await as(NORTE, (tx) => tx.driver.findMany());
    expect(norteDrivers.map((d) => d.id)).not.toContain(juarezDriver.id);
    expect(
      (await as(NORTE, (tx) => tx.device.findMany())).every((d) => d.tenantId === tenants.norte.id),
    ).toBe(true);

    await expect(
      as(NORTE, (tx) =>
        tx.driver.create({ data: { tenantId: tenants.juarez.id, fullName: 'Intruso' } }),
      ),
    ).rejects.toThrow(RLS_ERROR);
  });

  it('la planta administra su lista de pasajeros y la transportista con acuerdo solo la lee', async () => {
    const created = await as(ALFA, (tx) =>
      tx.passenger.create({
        data: {
          clientOrgId: clientOrgs.alfa.id,
          plantId: plants.alfaNorte.id,
          employeeNumber: `A-${randomUUID().slice(0, 6)}`,
          fullName: 'Empleada de Alfa',
        },
      }),
    );

    const norteSees = await as(NORTE, (tx) => tx.passenger.findMany());
    expect(norteSees.map((p) => p.id)).toContain(created.id);

    const changed = await as(NORTE, (tx) =>
      tx.passenger.updateMany({ where: { id: created.id }, data: { fullName: 'Cambiado' } }),
    );
    expect(changed.count).toBe(0);

    const betaSees = await as(BETA, (tx) => tx.passenger.findMany());
    expect(betaSees.map((p) => p.id)).not.toContain(created.id);
  });
});
