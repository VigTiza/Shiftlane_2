import { effectivePermissions } from '@shiftlane/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { navigationFor } from '@/navigation';
import { fakeApi, owner, renderApp } from '@/test/helpers';

const token = { accessToken: 'token-de-acceso', expiresIn: 900 };

function signedIn(me: Record<string, unknown> = owner) {
  return fakeApi({
    'POST /auth/refresh': () => ({ body: token }),
    'GET /auth/me': () => ({ body: me }),
    'POST /auth/logout': () => ({ status: 204 }),
  });
}

describe('menú por ámbito y rol', () => {
  const labels = (scope: 'carrier' | 'plant' | 'platform', roles: string[]) =>
    navigationFor(scope, effectivePermissions(scope, roles)).flatMap((g) =>
      g.items.map((i) => i.label),
    );

  it('el dueño ve todo lo de la transportista', () => {
    expect(labels('carrier', ['owner'])).toEqual(
      expect.arrayContaining([
        'Inicio',
        'Monitoreo en vivo',
        'Configuración',
        'Conciliación y facturas',
      ]),
    );
  });

  it('mantenimiento solo ve lo suyo', () => {
    const items = labels('carrier', ['maintenance']);
    expect(items).toContain('Mantenimiento');
    expect(items).not.toContain('Programación');
  });

  it('la planta y la plataforma tienen su propio menú', () => {
    expect(labels('plant', ['plant_logistics'])).toContain('Tablero en vivo');
    expect(labels('plant', ['plant_logistics'])).not.toContain('Unidades');
    expect(labels('platform', ['platform_admin'])).toContain('Cuentas');
  });
});

describe('marco del panel', () => {
  it('búsqueda global con Ctrl+K lleva a la sección', async () => {
    signedIn();
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: /, Ana$/ });

    await user.keyboard('{Control>}k{/Control}');
    const search = await screen.findByPlaceholderText('Buscar secciones y acciones…');
    await user.type(search, 'placas');
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByText('Unidades'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/unidades'));
    expect(screen.getByRole('heading', { name: 'Unidades' })).toBeInTheDocument();
  });

  it('tema oscuro desde el menú de cuenta (se recuerda)', async () => {
    signedIn();
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Mi cuenta' }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Oscuro/ }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('shiftlane.theme')).toBe('dark');
  });

  it('cambiar de cuenta cierra la sesión y abre el acceso con el correo', async () => {
    localStorage.setItem(
      'shiftlane.recent-accounts',
      JSON.stringify([{ email: 'luis@transportes.mx', fullName: 'Luis Méndez' }]),
    );
    const api = signedIn();
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Mi cuenta' }));
    await user.click(await screen.findByRole('menuitem', { name: /Luis Méndez/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(api.calls.some((c) => c.path === '/auth/logout')).toBe(true);
    expect(await screen.findByLabelText('Correo')).toHaveValue('luis@transportes.mx');
  });

  it('una dirección que no existe muestra cómo volver', async () => {
    signedIn();
    renderApp('/no-existe');
    expect(await screen.findByText('No encontramos esta página')).toBeInTheDocument();
  });
});
