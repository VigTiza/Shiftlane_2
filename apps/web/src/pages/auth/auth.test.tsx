import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { dispatcher, fakeApi, owner, renderApp, unauthorized } from '@/test/helpers';

const token = { accessToken: 'token-de-acceso', expiresIn: 900 };

describe('acceso al panel', () => {
  it('sin sesión lleva a entrar y valida el formulario en español', async () => {
    fakeApi({ 'POST /auth/refresh': () => unauthorized });
    const user = userEvent.setup();
    const { router } = renderApp('/rutas');

    expect(await screen.findByRole('heading', { name: 'Entrar al panel' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?siguiente=%2Frutas');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Escribe un correo válido.')).toBeInTheDocument();
    expect(screen.getByText('Escribe tu contraseña.')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toHaveAttribute('aria-invalid', 'true');
  });

  it('entra, ve las secciones de su rol y vuelve a donde iba', async () => {
    const api = fakeApi({
      'POST /auth/refresh': () => unauthorized,
      'POST /auth/login': () => ({ body: token }),
      'GET /auth/me': () => ({ body: dispatcher }),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/programacion');

    await user.type(await screen.findByLabelText('Correo'), 'luis@transportes.mx');
    await user.type(screen.getByLabelText('Contraseña'), 'Secreta-123456');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: 'Programación' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/programacion');
    const nav = screen.getAllByRole('navigation', { name: 'Secciones' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Monitoreo en vivo' })).toBeInTheDocument();
    // El despachador no ve la configuración ni la facturación.
    expect(within(nav).queryByRole('link', { name: 'Configuración' })).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole('link', { name: 'Conciliación y facturas' }),
    ).not.toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/auth/me')?.auth).toBe('Bearer token-de-acceso');
  });

  it('contraseña incorrecta: muestra el mensaje de la API', async () => {
    fakeApi({
      'POST /auth/refresh': () => unauthorized,
      'POST /auth/login': () => ({
        status: 401,
        body: {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'El correo o la contraseña no son correctos.',
          },
        },
      }),
    });
    const user = userEvent.setup();
    renderApp('/entrar');
    await user.type(await screen.findByLabelText('Correo'), 'ana@transportes.mx');
    await user.type(screen.getByLabelText('Contraseña'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El correo o la contraseña no son correctos.',
    );
  });

  it('verificación en dos pasos', async () => {
    const api = fakeApi({
      'POST /auth/refresh': () => unauthorized,
      'POST /auth/login': () => ({ body: { twoFactorRequired: true, challengeToken: 'reto-123' } }),
      'POST /auth/login/2fa': (body) =>
        (body as { code: string }).code === '123456'
          ? { body: token }
          : {
              status: 401,
              body: { error: { code: 'INVALID_CODE', message: 'El código no es correcto.' } },
            },
      'GET /auth/me': () => ({ body: { ...owner, twoFactorEnabled: true } }),
    });
    const user = userEvent.setup();
    renderApp('/entrar');
    await user.type(await screen.findByLabelText('Correo'), 'ana@transportes.mx');
    await user.type(screen.getByLabelText('Contraseña'), 'Secreta-123456');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(
      await screen.findByRole('heading', { name: 'Verificación en dos pasos' }),
    ).toBeInTheDocument();
    await user.keyboard('654321');
    expect(await screen.findByText('El código no es correcto.')).toBeInTheDocument();
    await user.keyboard('123456');
    expect(await screen.findByText(/Ana$/)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === '/auth/login/2fa').map((c) => c.body)).toEqual([
      { challengeToken: 'reto-123', code: '654321' },
      { challengeToken: 'reto-123', code: '123456' },
    ]);
  });

  it('una cuenta de chofer no entra al panel', async () => {
    fakeApi({
      'POST /auth/refresh': () => unauthorized,
      'POST /auth/login': () => ({ body: token }),
      'GET /auth/me': () => ({
        body: { kind: 'driver', id: 'd1', fullName: 'Juan', tenantId: 't1' },
      }),
      'POST /auth/logout': () => ({ status: 204 }),
    });
    const user = userEvent.setup();
    renderApp('/entrar');
    await user.type(await screen.findByLabelText('Correo'), 'juan@transportes.mx');
    await user.type(screen.getByLabelText('Contraseña'), 'Secreta-123456');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta cuenta es de la app del chofer',
    );
  });

  it('con la cookie vigente entra sin pedir contraseña', async () => {
    fakeApi({
      'POST /auth/refresh': () => ({ body: token }),
      'GET /auth/me': () => ({ body: owner }),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: /, Ana$/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: /Unidades/ }),
    ).toBeInTheDocument();
  });

  it('recuperar contraseña', async () => {
    const api = fakeApi({
      'POST /auth/refresh': () => unauthorized,
      'POST /auth/password/forgot': () => ({
        body: { message: 'Si el correo está registrado, te enviamos instrucciones.' },
      }),
    });
    const user = userEvent.setup();
    renderApp('/recuperar-contrasena');
    await user.type(screen.getByLabelText('Correo'), 'ana@transportes.mx');
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(
      await screen.findByText('Si el correo está registrado, te enviamos instrucciones.'),
    ).toBeInTheDocument();
    expect(api.calls.at(-1)?.body).toEqual({ email: 'ana@transportes.mx' });
  });

  it('contraseña nueva: confirma y aplica las reglas', async () => {
    const api = fakeApi({
      'POST /auth/refresh': () => unauthorized,
      'POST /auth/password/reset': () => ({ status: 204 }),
    });
    const user = userEvent.setup();
    renderApp('/restablecer-contrasena?token=token-del-correo-1234567890');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'corta');
    await user.type(screen.getByLabelText('Escríbela otra vez'), 'otra');
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(
      await screen.findByText('La contraseña debe tener al menos 10 caracteres.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Contraseña nueva'));
    await user.clear(screen.getByLabelText('Escríbela otra vez'));
    await user.type(screen.getByLabelText('Contraseña nueva'), 'Nueva-clave-2026');
    await user.type(screen.getByLabelText('Escríbela otra vez'), 'Nueva-clave-2026');
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByText(/tu contraseña cambió/)).toBeInTheDocument();
    await waitFor(() =>
      expect(api.calls.at(-1)?.body).toEqual({
        token: 'token-del-correo-1234567890',
        password: 'Nueva-clave-2026',
      }),
    );
  });
});
