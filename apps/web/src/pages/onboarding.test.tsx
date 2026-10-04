import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { Onboarding } from '@/lib/resources';
import { fakeApi, page, renderApp, signedInHandlers } from '@/test/helpers';

const keysInOrder = [
  'company',
  'operation',
  'fleet',
  'clients',
  'routes',
  'plant_invite',
  'devices',
  'test_trip',
] as const;

function progress(done: string[] = [], manual: string[] = []): Onboarding {
  const steps = keysInOrder.map((key) => ({
    key,
    done: done.includes(key) || manual.includes(key),
    count: done.includes(key) ? 1 : 0,
    markedManually: manual.includes(key),
  }));
  return { steps, completed: steps.filter((s) => s.done).length, total: 8, dismissed: false };
}

describe('asistente de configuración inicial', () => {
  it('avance, datos de la empresa y marcar un paso', async () => {
    let state = progress(['fleet']);
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /onboarding': () => ({ body: state }),
      'GET /company': () => ({
        body: { id: 't1', name: 'Transportes Riberas', legalName: null, rfc: null, hasLogo: false },
      }),
      'PUT /company': (body) => {
        state = progress(['fleet', 'company']);
        return { body: { id: 't1', hasLogo: false, ...(body as object) } };
      },
      'PUT /onboarding/steps/operation': () => {
        state = progress(['fleet', 'company'], ['operation']);
        return { body: state };
      },
      'GET /alert-rules': () => ({ body: [] }),
      'GET /shifts': () => ({ body: [] }),
      'GET /client-orgs': () => ({ body: [] }),
    });
    const user = userEvent.setup();
    renderApp('/configuracion-inicial');

    expect(await screen.findByText('1 de 8 pasos listos')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Avance de la configuración' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    // Empieza en el primer paso pendiente: los datos de la empresa.
    expect(screen.getByRole('heading', { name: 'Datos de la empresa' })).toBeInTheDocument();
    expect(screen.getByText('Video de 1 minuto · próximamente')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Transportes Riberas')).toBeInTheDocument();

    await user.type(screen.getByLabelText('RFC'), 'NO-VALE');
    await user.click(screen.getByRole('button', { name: 'Guardar datos' }));
    expect(await screen.findByText('El RFC no tiene un formato válido.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('RFC'));
    await user.type(screen.getByLabelText('RFC'), 'tri010203ab1');
    await user.type(screen.getByLabelText('Razón social'), 'Transportes Riberas SA de CV');
    await user.click(screen.getByRole('button', { name: 'Guardar datos' }));
    expect(await screen.findByText('2 de 8 pasos listos')).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PUT' && c.path === '/company')?.body).toEqual({
      name: 'Transportes Riberas',
      legalName: 'Transportes Riberas SA de CV',
      rfc: 'TRI010203AB1',
    });

    const steps = screen.getByRole('navigation', { name: 'Pasos' });
    await user.click(within(steps).getByRole('button', { name: /Turnos y reglas/ }));
    expect(await screen.findByLabelText('Velocidad máxima (km/h)')).toHaveValue('80');
    await user.click(screen.getByRole('button', { name: /marcar como hecho/ }));
    expect(await screen.findByText('3 de 8 pasos listos')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Unidades y choferes' })).toBeInTheDocument(),
    );
  });

  it('el inicio muestra cuánto falta y se puede ocultar', async () => {
    let state = progress(['fleet', 'clients']);
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /onboarding': () => ({ body: state }),
      'PUT /onboarding/dismissed': () => {
        state = { ...state, dismissed: true };
        return { body: state };
      },
    });
    const user = userEvent.setup();
    renderApp('/');
    expect(
      await screen.findByText('Configura tu cuenta para empezar a operar'),
    ).toBeInTheDocument();
    expect(screen.getByText('2 de 8 pasos listos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ocultar' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Configura tu cuenta para empezar a operar'),
      ).not.toBeInTheDocument(),
    );
    expect(api.calls.find((c) => c.path === '/onboarding/dismissed')?.body).toEqual({
      dismissed: true,
    });
  });
});

describe('contratos', () => {
  it('nuevo contrato y tarifa por ruta (exige la ruta)', async () => {
    const clientId = '30000000-0000-4000-8000-000000000001';
    const contract = {
      id: '50000000-0000-4000-8000-000000000001',
      clientOrgId: clientId,
      clientOrgName: 'Maquiladora del Norte',
      plantId: null,
      name: 'Transporte 2026',
      number: null,
      status: 'draft',
      startsOn: '2026-10-01',
      endsOn: null,
      notes: null,
      rates: [] as unknown[],
      penalties: [],
    };
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /contracts': () => ({ body: [] }),
      'GET /client-orgs': () => ({
        body: [
          {
            id: clientId,
            name: 'Maquiladora del Norte',
            legalName: null,
            rfc: null,
            managed: true,
            plants: [],
          },
        ],
      }),
      'POST /contracts': () => ({ status: 201, body: contract }),
      [`GET /contracts/${contract.id}`]: () => ({ body: contract }),
      'GET /routes': () => ({ body: [{ id: 'r1', code: 'R-01', name: 'Riberas', plantId: 'p1' }] }),
      [`POST /contracts/${contract.id}/rates`]: (body) => {
        contract.rates = [{ id: 'rate1', priority: 0, weekdays: [], ...(body as object) }];
        return { status: 201, body: contract.rates[0] };
      },
      'GET /vehicles': () => ({ body: page([]) }),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/contratos');
    await user.click(await screen.findByRole('button', { name: 'Nuevo contrato' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo contrato' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Cliente' }));
    await user.click(await screen.findByRole('option', { name: 'Maquiladora del Norte' }));
    await user.type(within(dialog).getByLabelText('Nombre'), 'Transporte 2026');
    await user.click(within(dialog).getByRole('button', { name: 'Crear contrato' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/contratos/${contract.id}`));

    await user.click(await screen.findByRole('button', { name: 'Tarifa' }));
    const rate = await screen.findByRole('dialog', { name: 'Nueva tarifa' });
    await user.click(within(rate).getByRole('combobox', { name: 'Cobro' }));
    await user.click(await screen.findByRole('option', { name: 'Por viaje en una ruta' }));
    await user.type(within(rate).getByLabelText('Monto (MXN)'), '1250.50');
    await user.click(within(rate).getByRole('button', { name: 'Agregar tarifa' }));
    expect(
      await within(rate).findByText('Una tarifa por ruta necesita la ruta.'),
    ).toBeInTheDocument();
    await user.click(within(rate).getByRole('combobox', { name: 'Ruta' }));
    await user.click(await screen.findByRole('option', { name: 'R-01 · Riberas' }));
    await user.click(within(rate).getByRole('button', { name: 'Agregar tarifa' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.path.endsWith('/rates'))?.body).toMatchObject({
        basis: 'per_route',
        amount: 1250.5,
        routeId: 'r1',
        startTime: null,
        priority: 0,
      }),
    );
    expect(await screen.findByText('$1,250.50')).toBeInTheDocument();
  });
});
