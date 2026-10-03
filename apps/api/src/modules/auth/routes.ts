import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { UnauthorizedError } from '../../lib/errors.ts';
import { authOf, requireAuth } from '../../plugins/auth.ts';
import {
  deviceCredentialsBody,
  deviceDriversResponse,
  disableTwoFactorBody,
  driverEnrollBody,
  driverEnrollResponse,
  driverLoginBody,
  driverTokensResponse,
  enableTwoFactorBody,
  forgotPasswordBody,
  loginBody,
  loginResponse,
  meResponse,
  messageResponse,
  noContent,
  passengerActivateBody,
  passengerActivateResponse,
  refreshBody,
  resetPasswordBody,
  sessionParams,
  sessionsResponse,
  tokenResponse,
  twoFactorLoginBody,
  twoFactorSetupResponse,
} from './schemas.ts';
import type { RequestMeta } from './sessions.ts';

export const REFRESH_COOKIE = 'shiftlane_rt';
const TAGS = ['Autenticación'];

function metaOf(request: FastifyRequest): RequestMeta {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

export const authRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const { auth, drivers, passengers } = app.authServices;
  const env = app.config;
  const cookieSecure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
  const strictLimit = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: 60_000 } };
  const userOnly = requireAuth(app, { kinds: ['user'] });

  function setRefreshCookie(reply: FastifyReply, token: string, days: number) {
    void reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'strict',
      path: '/auth',
      maxAge: days * 24 * 60 * 60,
    });
  }

  function clearRefreshCookie(reply: FastifyReply) {
    void reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }

  // --- Usuarios web -----------------------------------------------------------

  app.post(
    '/auth/login',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Inicia sesión con correo y contraseña',
        body: loginBody,
        response: { 200: loginResponse },
      },
    },
    async (request, reply) => {
      const result = await auth.login(request.body, metaOf(request));
      if ('twoFactorRequired' in result) return result;
      setRefreshCookie(reply, result.refreshToken, env.REFRESH_TOKEN_TTL_DAYS);
      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    },
  );

  app.post(
    '/auth/login/2fa',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Completa el inicio de sesión con el código de verificación',
        body: twoFactorLoginBody,
        response: { 200: tokenResponse },
      },
    },
    async (request, reply) => {
      const result = await auth.loginTwoFactor(request.body, metaOf(request));
      setRefreshCookie(reply, result.refreshToken, env.REFRESH_TOKEN_TTL_DAYS);
      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    },
  );

  app.post(
    '/auth/refresh',
    {
      schema: {
        tags: TAGS,
        summary: 'Renueva el token de acceso (cookie o refreshToken en el cuerpo)',
        body: refreshBody,
        response: { 200: tokenResponse },
      },
    },
    async (request, reply) => {
      const fromBody = request.body?.refreshToken;
      const token = fromBody ?? request.cookies[REFRESH_COOKIE];
      if (!token) throw new UnauthorizedError('No hay una sesión activa. Inicia sesión.');
      try {
        const result = await auth.refresh(token, metaOf(request));
        if (fromBody) return result;
        setRefreshCookie(reply, result.refreshToken, env.REFRESH_TOKEN_TTL_DAYS);
        return { accessToken: result.accessToken, expiresIn: result.expiresIn };
      } catch (error) {
        if (!fromBody) clearRefreshCookie(reply);
        throw error;
      }
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: TAGS,
        summary: 'Cierra la sesión actual',
        body: refreshBody,
        response: { 204: noContent },
      },
    },
    async (request, reply) => {
      const token = request.body?.refreshToken ?? request.cookies[REFRESH_COOKIE];
      if (token) await auth.logout(token);
      clearRefreshCookie(reply);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/auth/logout-all',
    {
      preHandler: userOnly,
      schema: {
        tags: TAGS,
        summary: 'Cierra todas las sesiones del usuario',
        response: { 204: noContent },
      },
    },
    async (request, reply) => {
      await auth.logoutEverywhere(authOf(request, 'user').sub);
      clearRefreshCookie(reply);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/auth/sessions',
    {
      preHandler: userOnly,
      schema: {
        tags: TAGS,
        summary: 'Lista las sesiones abiertas del usuario',
        response: { 200: sessionsResponse },
      },
    },
    (request) => auth.listSessions(authOf(request, 'user').sub),
  );

  app.delete(
    '/auth/sessions/:sessionId',
    {
      preHandler: userOnly,
      schema: {
        tags: TAGS,
        summary: 'Cierra una sesión del usuario',
        params: sessionParams,
        response: { 204: noContent },
      },
    },
    async (request, reply) => {
      await auth.revokeSession(authOf(request, 'user').sub, request.params.sessionId);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/auth/me',
    {
      preHandler: requireAuth(app),
      schema: { tags: TAGS, summary: 'Datos de la sesión actual', response: { 200: meResponse } },
    },
    (request) => auth.me(authOf(request)),
  );

  app.post(
    '/auth/password/forgot',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Envía un correo para restablecer la contraseña',
        body: forgotPasswordBody,
        response: { 202: messageResponse },
      },
    },
    async (request, reply) => {
      await auth.forgotPassword(request.body.email);
      return reply.status(202).send({
        message:
          'Si el correo está registrado, te enviamos instrucciones para restablecer tu contraseña.',
      });
    },
  );

  app.post(
    '/auth/password/reset',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Crea una contraseña nueva con el enlace del correo',
        body: resetPasswordBody,
        response: { 200: messageResponse },
      },
    },
    async (request) => {
      await auth.resetPassword(request.body);
      return { message: 'Tu contraseña se cambió. Inicia sesión con la nueva contraseña.' };
    },
  );

  app.post(
    '/auth/2fa/setup',
    {
      preHandler: userOnly,
      schema: {
        tags: TAGS,
        summary: 'Genera el secreto para la verificación en dos pasos',
        response: { 200: twoFactorSetupResponse },
      },
    },
    (request) => auth.setupTwoFactor(authOf(request, 'user').sub),
  );

  app.post(
    '/auth/2fa/enable',
    {
      preHandler: userOnly,
      schema: {
        tags: TAGS,
        summary: 'Activa la verificación en dos pasos',
        body: enableTwoFactorBody,
        response: { 200: messageResponse },
      },
    },
    async (request) => {
      await auth.enableTwoFactor(authOf(request, 'user').sub, request.body.code);
      return { message: 'La verificación en dos pasos quedó activa.' };
    },
  );

  app.post(
    '/auth/2fa/disable',
    {
      preHandler: userOnly,
      schema: {
        tags: TAGS,
        summary: 'Desactiva la verificación en dos pasos',
        body: disableTwoFactorBody,
        response: { 200: messageResponse },
      },
    },
    async (request) => {
      await auth.disableTwoFactor(authOf(request, 'user').sub, request.body);
      return { message: 'La verificación en dos pasos quedó desactivada.' };
    },
  );

  // --- Choferes (app Android) ---------------------------------------------------

  app.post(
    '/auth/driver/enroll',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Vincula al chofer con el celular usando el QR del despachador',
        body: driverEnrollBody,
        response: { 200: driverEnrollResponse },
      },
    },
    (request) => drivers.enroll(request.body, metaOf(request)),
  );

  app.post(
    '/auth/driver/device-drivers',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Choferes vinculados a este celular',
        body: deviceCredentialsBody,
        response: { 200: deviceDriversResponse },
      },
    },
    (request) => drivers.listDeviceDrivers(request.body),
  );

  app.post(
    '/auth/driver/login',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Entrada del chofer con su PIN',
        body: driverLoginBody,
        response: { 200: driverTokensResponse },
      },
    },
    (request) => drivers.login(request.body, metaOf(request)),
  );

  app.post(
    '/auth/driver/pin',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Crea un PIN nuevo después de que el despachador lo restablece',
        body: driverLoginBody,
        response: { 200: driverTokensResponse },
      },
    },
    (request) => drivers.setPin(request.body, metaOf(request)),
  );

  // --- Pasajeros (app web instalable) -------------------------------------------

  app.post(
    '/auth/passenger/activate',
    {
      config: strictLimit,
      schema: {
        tags: TAGS,
        summary: 'Activa la app del pasajero con su número de empleado',
        body: passengerActivateBody,
        response: { 200: passengerActivateResponse },
      },
    },
    async (request, reply) => {
      const result = await passengers.activate(request.body, metaOf(request));
      setRefreshCookie(reply, result.refreshToken, env.PASSENGER_REFRESH_TOKEN_TTL_DAYS);
      return {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        passenger: result.passenger,
      };
    },
  );

  done();
};
