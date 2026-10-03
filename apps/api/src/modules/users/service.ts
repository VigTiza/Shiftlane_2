import { isPermission, isRoleKey, permissionAllowedIn, ROLES } from '@shiftlane/shared';
import type { RoleDefinition } from '@shiftlane/shared';

import type { DbTransaction } from '../../lib/db.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';

const userInclude = { roles: { include: { role: true } }, permissionOverrides: true } as const;

type UserWithAccess = Awaited<ReturnType<typeof findUser>>;

async function findUser(tx: DbTransaction, userId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: userInclude,
  });
  if (!user) throw new NotFoundError('No se encontró el usuario.');
  return user;
}

function summarize(user: UserWithAccess) {
  const overrides = user.permissionOverrides;
  return {
    id: user.id,
    kind: user.kind,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    status: user.status,
    roles: user.roles.map((assignment) => assignment.role.key).sort(),
    grantedPermissions: overrides
      .filter((o) => o.effect === 'grant')
      .map((o) => o.permission)
      .sort(),
    revokedPermissions: overrides
      .filter((o) => o.effect === 'revoke')
      .map((o) => o.permission)
      .sort(),
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * Usuarios de la cuenta (transportista o planta). Todas las consultas corren dentro de
 * withDbContext, así que la seguridad por filas limita el alcance a la cuenta del usuario.
 */
export function createUsersService() {
  /** Evita que una transportista se quede sin ningún dueño activo. */
  async function ensureAnotherOwner(tx: DbTransaction, user: UserWithAccess) {
    const isOwner = user.roles.some((assignment) => assignment.role.key === 'owner');
    if (!isOwner || !user.tenantId) return;
    const otherOwners = await tx.userRole.count({
      where: {
        role: { key: 'owner' },
        userId: { not: user.id },
        user: { tenantId: user.tenantId, status: 'active', deletedAt: null },
      },
    });
    if (otherOwners === 0) {
      throw new ConflictError('La cuenta debe tener al menos un dueño activo.');
    }
  }

  return {
    async list(tx: DbTransaction) {
      const users = await tx.user.findMany({
        where: { deletedAt: null },
        include: userInclude,
        orderBy: { fullName: 'asc' },
      });
      return users.map(summarize);
    },

    async update(
      tx: DbTransaction,
      actorId: string,
      userId: string,
      changes: {
        fullName?: string | undefined;
        phone?: string | null | undefined;
        status?: 'active' | 'disabled' | undefined;
      },
    ) {
      const user = await findUser(tx, userId);
      if (changes.status === 'disabled') {
        if (userId === actorId) throw new BadRequestError('No puedes desactivar tu propia cuenta.');
        await ensureAnotherOwner(tx, user);
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(changes.fullName !== undefined ? { fullName: changes.fullName } : {}),
          ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
        },
      });
      return summarize(await findUser(tx, userId));
    },

    async setRoles(tx: DbTransaction, userId: string, roleKeys: string[]) {
      const user = await findUser(tx, userId);
      const unique = [...new Set(roleKeys)];
      for (const key of unique) {
        if (!isRoleKey(key)) throw new BadRequestError(`El rol «${key}» no existe.`);
        const role: RoleDefinition = ROLES[key];
        if (role.scope !== user.kind) {
          throw new BadRequestError(`El rol «${key}» no se puede asignar a este usuario.`);
        }
      }
      if (!unique.includes('owner')) await ensureAnotherOwner(tx, user);

      const current = user.roles.map((assignment) => assignment.role.key);
      const toRemove = user.roles.filter((assignment) => !unique.includes(assignment.role.key));
      const toAdd = unique.filter((key) => !current.includes(key));
      if (toRemove.length > 0) {
        await tx.userRole.deleteMany({
          where: { id: { in: toRemove.map((assignment) => assignment.id) } },
        });
      }
      for (const key of toAdd) {
        const role = await tx.role.findUniqueOrThrow({ where: { key } });
        await tx.userRole.create({ data: { userId, roleId: role.id } });
      }
      return summarize(await findUser(tx, userId));
    },

    async setPermissions(
      tx: DbTransaction,
      userId: string,
      input: { grants: string[]; revokes: string[] },
    ) {
      const user = await findUser(tx, userId);
      const grants = [...new Set(input.grants)];
      const revokes = [...new Set(input.revokes)];
      for (const permission of [...grants, ...revokes]) {
        if (!isPermission(permission))
          throw new BadRequestError(`El permiso «${permission}» no existe.`);
        if (!permissionAllowedIn(permission, user.kind)) {
          throw new BadRequestError(`El permiso «${permission}» no aplica a este usuario.`);
        }
      }
      const overlap = grants.filter((permission) => revokes.includes(permission));
      if (overlap.length > 0) {
        throw new BadRequestError(
          `Un permiso no puede otorgarse y quitarse a la vez: ${overlap.join(', ')}.`,
        );
      }

      await tx.userPermissionOverride.deleteMany({ where: { userId } });
      const rows = [
        ...grants.map((permission) => ({ userId, permission, effect: 'grant' as const })),
        ...revokes.map((permission) => ({ userId, permission, effect: 'revoke' as const })),
      ];
      for (const data of rows) {
        await tx.userPermissionOverride.create({ data });
      }
      return summarize(await findUser(tx, userId));
    },
  };
}
