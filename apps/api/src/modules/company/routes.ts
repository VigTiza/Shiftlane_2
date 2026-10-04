import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { sendFile } from '../../lib/files.ts';
import { withDbContext } from '../../lib/db.ts';
import { readUpload } from '../../lib/uploads.ts';
import { z } from '../../lib/zod.ts';
import { dbContextOf, requirePermission, tenantIdOf } from '../../plugins/auth.ts';
import {
  companyResponse,
  dismissBody,
  markStepBody,
  onboardingResponse,
  onboardingStep,
  updateCompanyBody,
} from './schemas.ts';
import { createCompanyService } from './service.ts';

const TAGS = ['Empresa'];
const noContent = z.null();

export const companyRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createCompanyService({ storage: app.storage });
  const canManage = requirePermission(app, 'settings.manage');
  // Cualquier usuario de la transportista ve el nombre y el logo de su empresa.
  const canView = requirePermission(app, 'dashboard.view', 'settings.manage', 'users.read');

  app.get(
    '/company',
    {
      onRequest: canView,
      schema: { tags: TAGS, summary: 'Datos de la empresa', response: { 200: companyResponse } },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) => service.get(tx, tenantIdOf(request))),
  );

  app.put(
    '/company',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Actualiza el nombre comercial, la razón social y el RFC',
        body: updateCompanyBody,
        response: { 200: companyResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.update(tx, tenantIdOf(request), request.body),
      ),
  );

  app.post(
    '/company/logo',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Sube el logo de la empresa (JPG, PNG o WebP)',
        response: { 204: noContent },
      },
    },
    async (request, reply) => {
      const file = await readUpload(request, 'image');
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.setLogo(tx, tenantIdOf(request), file),
      );
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/company/logo',
    { onRequest: canView, schema: { tags: TAGS, summary: 'Logo de la empresa' } },
    async (request, reply) => {
      const logo = await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.getLogo(tx, tenantIdOf(request)),
      );
      return sendFile(reply, logo);
    },
  );

  app.delete(
    '/company/logo',
    {
      onRequest: canManage,
      schema: { tags: TAGS, summary: 'Quita el logo', response: { 204: noContent } },
    },
    async (request, reply) => {
      await withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.deleteLogo(tx, tenantIdOf(request)),
      );
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/onboarding',
    {
      onRequest: canView,
      schema: {
        tags: TAGS,
        summary: 'Avance del asistente de configuración inicial',
        description:
          'Cada paso se da por hecho con los datos de la cuenta (unidades, choferes, plantas, rutas…) o si se marcó a mano.',
        response: { 200: onboardingResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.onboarding(tx, tenantIdOf(request)),
      ),
  );

  app.put(
    '/onboarding/steps/:step',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Marca o desmarca un paso del asistente',
        params: z.object({ step: onboardingStep }),
        body: markStepBody,
        response: { 200: onboardingResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.markStep(tx, tenantIdOf(request), request.params.step, request.body.done),
      ),
  );

  app.put(
    '/onboarding/dismissed',
    {
      onRequest: canManage,
      schema: {
        tags: TAGS,
        summary: 'Oculta o vuelve a mostrar el asistente en el inicio',
        body: dismissBody,
        response: { 200: onboardingResponse },
      },
    },
    (request) =>
      withDbContext(app.db.app, dbContextOf(request), (tx) =>
        service.dismiss(tx, tenantIdOf(request), request.body.dismissed),
      ),
  );

  done();
};
