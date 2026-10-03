import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { withDbContext } from '../../lib/db.ts';
import { authOf, dbContextOf, requireAuth, requirePermission } from '../../plugins/auth.ts';
import {
  myPermissionsResponse,
  setPermissionsBody,
  setRolesBody,
  updateUserBody,
  userParams,
  userSummary,
  usersResponse,
} from './schemas.ts';
import { createUsersService } from './service.ts';

const TAGS = ['Usuarios'];

export const userRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createUsersService();
  const canRead = requirePermission(app, 'users.read');
  const canManage = requirePermission(app, 'users.manage');

  app.get(
    '/me/permissions',
    {
      onRequest: requireAuth(app, { kinds: ['user'] }),
      schema: {
        tags: TAGS,
        summary: 'Roles y permisos efectivos de la sesión',
        response: { 200: myPermissionsResponse },
      },
    },
    (request) => {
      const { roles, permissions } = authOf(request, 'user');
      return { roles, permissions };
    },
  );

  app.get(
    '/users',
    {
      onRequest: canRead,
      schema: { tags: TAGS, summary: 'Usuarios de la cuenta', response: { 200: usersResponse } },
    },
    (request) => withDbContext(app.db.app, dbContextOf(request), (tx) => service.list(tx)),
  );

  app.patch(
    '/users/:userId',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Cambia nombre, teléfono o estado de un usuario',
        params: userParams,
        body: updateUserBody,
        response: { 200: userSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.update(tx, authOf(request, 'user').sub, request.params.userId, request.body),
      ),
  );

  app.put(
    '/users/:userId/roles',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Reemplaza los roles de un usuario',
        params: userParams,
        body: setRolesBody,
        response: { 200: userSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.setRoles(tx, request.params.userId, request.body.roles),
      ),
  );

  app.put(
    '/users/:userId/permissions',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Reemplaza los permisos otorgados o quitados a un usuario',
        params: userParams,
        body: setPermissionsBody,
        response: { 200: userSummary },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.setPermissions(tx, request.params.userId, request.body),
      ),
  );

  done();
};
