import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { replaceMatrix } from './permissions-doc.ts';
import {
  ALL_PERMISSIONS,
  effectivePermissions,
  permissionAllowedIn,
  PERMISSIONS,
  ROLE_KEYS,
  ROLES,
} from './permissions.ts';
import type { RoleDefinition, Scope } from './permissions.ts';

describe('matriz de permisos', () => {
  it('cada rol solo tiene permisos de su ámbito', () => {
    for (const key of ROLE_KEYS) {
      const role: RoleDefinition = ROLES[key];
      const outside = role.permissions.filter((p) => !permissionAllowedIn(p, role.scope));
      expect(outside, key).toEqual([]);
    }
  });

  it('todo permiso lo tiene al menos un rol', () => {
    const used = new Set(
      ROLE_KEYS.flatMap((key) => [...(ROLES[key] as RoleDefinition).permissions]),
    );
    expect(ALL_PERMISSIONS.filter((p) => !used.has(p))).toEqual([]);
  });

  it('el dueño tiene todo lo de la transportista menos ejecutar viajes', () => {
    const owner = effectivePermissions('carrier', ['owner']);
    expect(owner).toContain('subscription.manage');
    expect(owner).toContain('users.manage');
    expect(owner).not.toContain('trips.execute');
    expect(effectivePermissions('carrier', ['manager'])).not.toContain('subscription.manage');
  });

  it('casos permitidos y prohibidos por rol', () => {
    const cases: [Scope, string, string, boolean][] = [
      ['carrier', 'dispatcher', 'drivers.enroll', true],
      ['carrier', 'dispatcher', 'dispatch.operate', true],
      ['carrier', 'dispatcher', 'invoicing.manage', false],
      ['carrier', 'dispatcher', 'users.manage', false],
      ['carrier', 'planner', 'routes.write', true],
      ['carrier', 'planner', 'drivers.enroll', false],
      ['carrier', 'billing', 'reconciliation.manage', true],
      ['carrier', 'billing', 'schedule.write', false],
      ['carrier', 'maintenance', 'maintenance.write', true],
      ['carrier', 'maintenance', 'clients.read', false],
      ['carrier', 'driver', 'trips.execute', true],
      ['carrier', 'driver', 'monitoring.view', false],
      ['plant', 'plant_logistics', 'plant.prefactures', true],
      ['plant', 'plant_logistics', 'plant.employees', false],
      ['plant', 'plant_hr', 'plant.employees', true],
      ['plant', 'plant_hr', 'plant.prefactures', false],
      ['platform', 'platform_admin', 'platform.billing', true],
      ['platform', 'platform_admin', 'users.manage', false],
    ];
    for (const [scope, role, permission, allowed] of cases) {
      const permissions = effectivePermissions(scope, [role]) as string[];
      expect(permissions.includes(permission), `${role} → ${permission}`).toBe(allowed);
    }
  });

  it('los ajustes por usuario otorgan o quitan permisos dentro de su ámbito', () => {
    const permissions = effectivePermissions('carrier', ['dispatcher'], {
      grants: ['invoicing.manage', 'platform.billing', 'plant.employees', 'no.existe'],
      revokes: ['drivers.enroll'],
    });
    expect(permissions).toContain('invoicing.manage');
    expect(permissions).not.toContain('drivers.enroll');
    expect(permissions).not.toContain('platform.billing');
    expect(permissions).not.toContain('plant.employees');
  });

  it('un rol de otro ámbito no aporta permisos', () => {
    expect(effectivePermissions('carrier', ['platform_admin'])).toEqual([]);
    expect(effectivePermissions('plant', ['owner'])).toEqual([]);
  });

  it('todos los permisos tienen descripción en español', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(PERMISSIONS[permission].description.length).toBeGreaterThan(10);
    }
  });

  it('docs/api.md tiene la matriz al día (pnpm docs:permisos)', () => {
    const file = path.resolve(import.meta.dirname, '../../../docs/api.md');
    const document = readFileSync(file, 'utf8');
    expect(document).toBe(replaceMatrix(document));
  });
});
