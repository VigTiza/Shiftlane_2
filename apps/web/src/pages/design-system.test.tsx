import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeApi, owner, renderApp } from '@/test/helpers';

function open() {
  fakeApi({
    'POST /auth/refresh': () => ({ body: { accessToken: 't', expiresIn: 900 } }),
    'GET /auth/me': () => ({ body: owner }),
  });
  return renderApp('/sistema-de-diseno');
}

describe('sistema de diseño', () => {
  it('muestra los tokens de color y la tipografía', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Sistema de diseño' })).toBeInTheDocument();
    expect(screen.getByText('--primary')).toBeInTheDocument();
    expect(screen.getByText('Ámbar de carril: la única acción principal')).toBeInTheDocument();
  });

  it('formulario: errores en español y aviso al guardar', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('tab', { name: 'Componentes' }));
    await user.click(screen.getByRole('button', { name: 'Guardar unidad' }));
    expect(await screen.findByText('Escribe el número económico.')).toBeInTheDocument();
    expect(
      screen.getByText('Las placas llevan de 5 a 10 letras, números o guiones.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Elige el tipo de unidad.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Número económico'), 'U-015');
    await user.type(screen.getByLabelText('Placas'), 'ABC-12-34');
    await user.type(screen.getByLabelText('Asientos'), '300');
    await user.click(screen.getByRole('combobox', { name: 'Tipo' }));
    await user.click(await screen.findByRole('option', { name: 'Sprinter' }));
    await user.click(screen.getByRole('button', { name: 'Guardar unidad' }));
    expect(await screen.findByText('Máximo 120 asientos.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Asientos'));
    await user.type(screen.getByLabelText('Asientos'), '19');
    await user.click(screen.getByRole('button', { name: 'Guardar unidad' }));
    expect(await screen.findByText('Unidad U-015 guardada')).toBeInTheDocument();
  });

  it('diálogo de confirmación', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('tab', { name: 'Componentes' }));
    await user.click(screen.getByRole('button', { name: /Dar de baja U-014/ }));
    expect(
      await screen.findByRole('dialog', { name: '¿Dar de baja la unidad U-014?' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dar de baja' }));
    expect(await screen.findByText('Unidad U-014 dada de baja')).toBeInTheDocument();
  });
});
