import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ClientOrg, Driver, Vehicle } from '@/lib/resources';
import { fakeApi, page, renderApp, signedInHandlers } from '@/test/helpers';

const vehicle: Vehicle = {
  id: '10000000-0000-4000-8000-000000000001',
  economicNumber: 'U-014',
  plates: 'EFR1234',
  make: 'Mercedes-Benz',
  model: 'Sprinter 516',
  year: 2022,
  capacity: 19,
  requiredLicenseType: null,
  status: 'available',
  odometerKm: 85400,
  hasPhoto: false,
  notes: null,
  documents: { expired: 1, expiring: 0 },
};

const driver: Driver = {
  id: '20000000-0000-4000-8000-000000000001',
  fullName: 'Juan Pérez Soto',
  employeeNumber: 'CH-07',
  phone: '656 123 4567',
  status: 'active',
  licenseNumber: 'CHH123',
  licenseType: 'Federal B',
  emergencyContactName: null,
  emergencyContactPhone: null,
  habitualVehicle: { id: vehicle.id, economicNumber: 'U-014' },
  hasPhoto: false,
  notes: null,
  access: { pinSet: false, devices: 0 },
  documents: { expired: 0, expiring: 0 },
};

const client: ClientOrg = {
  id: '30000000-0000-4000-8000-000000000001',
  name: 'Maquiladora del Norte',
  legalName: 'Maquiladora del Norte SA de CV',
  rfc: 'MNO010203AB1',
  managed: true,
  plants: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      clientOrgId: '30000000-0000-4000-8000-000000000001',
      name: 'Planta Juárez 2',
      address: 'Av. Tecnológico 1500',
      timezone: 'America/Ciudad_Juarez',
      location: null,
      served: true,
      passengerActivationCode: 'MNJ2-48',
    },
  ],
};

describe('unidades', () => {
  it('lista, filtra y da de alta con validación en español', async () => {
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /vehicles': () => ({ body: page([vehicle]) }),
      'POST /vehicles': (body) => ({
        status: 201,
        body: { ...vehicle, ...(body as object), id: 'nuevo' },
      }),
    });
    const user = userEvent.setup();
    renderApp('/unidades');
    expect(await screen.findByText('U-014')).toBeInTheDocument();
    expect(screen.getByText('1 vencido')).toBeInTheDocument();
    expect(screen.getByText('85,400')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nueva unidad' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva unidad' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Escribe el número económico.')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Número económico'), 'U-020');
    await user.type(within(dialog).getByLabelText('Placas'), 'ABC1234');
    await user.type(within(dialog).getByLabelText('Modelo'), 'Hiace');
    await user.type(within(dialog).getByLabelText('Año'), '2023');
    await user.type(within(dialog).getByLabelText('Capacidad'), '15');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === 'POST' && c.path === '/vehicles')).toBe(true),
    );
    expect(
      api.calls.find((c) => c.method === 'POST' && c.path === '/vehicles')?.body,
    ).toMatchObject({
      economicNumber: 'U-020',
      plates: 'ABC1234',
      model: 'Hiace',
      year: 2023,
      capacity: 15,
      status: 'available',
    });
    expect(await screen.findByText('Unidad U-020 dada de alta')).toBeInTheDocument();
  });

  it('editar usa PATCH', async () => {
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /vehicles': () => ({ body: page([vehicle]) }),
      [`PATCH /vehicles/${vehicle.id}`]: (body) => ({ body: { ...vehicle, ...(body as object) } }),
    });
    const user = userEvent.setup();
    renderApp('/unidades');
    await user.click(await screen.findByText('U-014'));
    const dialog = await screen.findByRole('dialog', { name: 'Unidad U-014' });
    const capacity = within(dialog).getByLabelText('Capacidad');
    await user.clear(capacity);
    await user.type(capacity, '20');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ capacity: 20 }),
    );
  });

  it('importar: primero la vista previa; con errores no deja guardar', async () => {
    let dryRuns = 0;
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /vehicles': () => ({ body: page([vehicle]) }),
      'POST /vehicles/import': (_body, url) => {
        if (url.searchParams.get('dryRun') === 'true') {
          dryRuns += 1;
          return {
            body:
              dryRuns === 1
                ? {
                    totalRows: 3,
                    created: 2,
                    updated: 0,
                    errors: [
                      {
                        row: 4,
                        column: 'Capacidad',
                        message: 'La capacidad no puede ser mayor a 120.',
                      },
                    ],
                    applied: false,
                  }
                : { totalRows: 3, created: 2, updated: 1, errors: [], applied: false },
          };
        }
        return { body: { totalRows: 3, created: 2, updated: 1, errors: [], applied: true } };
      },
    });
    const user = userEvent.setup();
    renderApp('/unidades');
    await user.click(await screen.findByRole('button', { name: 'Importar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Importar unidades' });
    const file = new File(['excel'], 'unidades.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(within(dialog).getByLabelText('Archivo de Excel'), file);
    expect(
      await within(dialog).findByText('La capacidad no puede ser mayor a 120.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Corrige el archivo para importar' }),
    ).toBeDisabled();

    await user.upload(within(dialog).getByLabelText('Archivo de Excel'), file);
    expect(await within(dialog).findByText('El archivo no tiene errores.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Importar 3 filas' }));
    expect(await screen.findByText('Listo: 2 nuevos y 1 actualizados.')).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === '/vehicles/import')).toHaveLength(3);
  });
});

describe('choferes', () => {
  it('QR de alta y restablecer PIN', async () => {
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /drivers': () => ({ body: page([driver]) }),
      'GET /vehicles': () => ({ body: page([vehicle]) }),
      [`POST /drivers/${driver.id}/enrollment`]: () => ({
        status: 201,
        body: {
          code: 'CODIGO-DE-ALTA-1234567890',
          qrPayload: 'shiftlane-chofer://vincular?codigo=CODIGO-DE-ALTA-1234567890',
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
      }),
      [`POST /drivers/${driver.id}/pin-reset`]: () => ({
        body: { message: 'Listo: Juan Pérez Soto creará un PIN nuevo al entrar.' },
      }),
    });
    const user = userEvent.setup();
    renderApp('/choferes');
    expect(await screen.findByText('Sin vincular')).toBeInTheDocument();
    await user.click(screen.getByText('Juan Pérez Soto'));
    const dialog = await screen.findByRole('dialog', { name: 'Juan Pérez Soto' });
    await user.click(within(dialog).getByRole('button', { name: 'QR de alta' }));
    const qr = await screen.findByRole('dialog', { name: 'QR de alta de Juan Pérez Soto' });
    expect(within(qr).getByRole('img', { name: /Código QR/ })).toBeInTheDocument();
    expect(within(qr).getByText('CODIGO-DE-ALTA-1234567890')).toBeInTheDocument();
    await user.click(within(qr).getByRole('button', { name: 'Listo' }));

    await user.click(within(dialog).getByRole('button', { name: 'Restablecer PIN' }));
    await user.click(await screen.findByRole('button', { name: 'Restablecer PIN', hidden: false }));
    expect(
      await screen.findByText('Listo: Juan Pérez Soto creará un PIN nuevo al entrar.'),
    ).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === `/drivers/${driver.id}/pin-reset`)).toBe(true);
  });
});

describe('clientes y plantas', () => {
  it('alta de cliente con su primera planta', async () => {
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /client-orgs': () => ({ body: [] }),
      'POST /client-orgs': (body) => ({
        status: 201,
        body: { ...client, ...(body as object), plants: [] },
      }),
      [`POST /client-orgs/${client.id}/plants`]: () => ({
        status: 201,
        body: { ...client.plants[0], gates: [] },
      }),
      [`GET /client-orgs/${client.id}`]: () => ({
        body: { ...client, contacts: [], contracts: [] },
      }),
      [`GET /plants/${client.plants[0]!.id}`]: () => ({ body: { ...client.plants[0], gates: [] } }),
      [`GET /plants/${client.plants[0]!.id}/invitations`]: () => ({ body: [] }),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/clientes');
    expect(await screen.findByText('Todavía no hay clientes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo cliente' });
    await user.type(within(dialog).getByLabelText('Nombre de la empresa'), 'Maquiladora del Norte');
    await user.type(within(dialog).getByLabelText('RFC'), 'mno010203ab1');
    await user.type(within(dialog).getByLabelText('Nombre de la planta'), 'Planta Juárez 2');
    await user.click(within(dialog).getByRole('button', { name: 'Dar de alta' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/clientes/${client.id}`));
    expect(
      api.calls.find((c) => c.path === '/client-orgs' && c.method === 'POST')?.body,
    ).toMatchObject({
      name: 'Maquiladora del Norte',
      rfc: 'MNO010203AB1',
    });
    expect(
      api.calls.find((c) => c.path.endsWith('/plants') && c.method === 'POST')?.body,
    ).toMatchObject({
      name: 'Planta Juárez 2',
    });
    expect(await screen.findByRole('heading', { name: 'Planta Juárez 2' })).toBeInTheDocument();
    expect(screen.getByText('MNJ2-48')).toBeInTheDocument();
  });

  it('nueva puerta: muestra su QR de llegada', async () => {
    const plant = client.plants[0]!;
    fakeApi({
      ...signedInHandlers(),
      [`GET /client-orgs/${client.id}`]: () => ({
        body: { ...client, contacts: [], contracts: [] },
      }),
      [`GET /plants/${plant.id}`]: () => ({ body: { ...plant, gates: [] } }),
      [`GET /plants/${plant.id}/invitations`]: () => ({ body: [] }),
      [`POST /plants/${plant.id}/gates`]: (body) => ({
        status: 201,
        body: {
          id: 'g1',
          active: true,
          location: null,
          qrPayload: 'shiftlane-puerta://GATE123',
          ...(body as object),
        },
      }),
    });
    const user = userEvent.setup();
    renderApp(`/clientes/${client.id}`);
    await user.click(await screen.findByRole('button', { name: 'Puerta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nueva puerta' });
    await user.type(within(dialog).getByLabelText('Nombre'), 'Caseta norte');
    await user.click(within(dialog).getByRole('button', { name: 'Agregar puerta' }));
    const qr = await screen.findByRole('dialog', { name: 'QR de llegada · Caseta norte' });
    expect(within(qr).getByText('Planta Juárez 2 · Caseta norte')).toBeInTheDocument();
    expect(within(qr).getByRole('button', { name: 'Descargar para imprimir' })).toBeInTheDocument();
  });
});

describe('pasajeros', () => {
  it('busca en el servidor y pagina', async () => {
    const api = fakeApi({
      ...signedInHandlers(),
      'GET /client-orgs': () => ({ body: [client] }),
      'GET /passengers': (_body, url) => ({
        body: {
          items: [
            {
              id: 'p1',
              clientOrgId: client.id,
              plantId: client.plants[0]!.id,
              employeeNumber: 'A-123',
              fullName: 'Rosa Medina',
              shiftName: 'Primer turno',
              phone: null,
              status: 'active',
              activated: true,
              credentials: [],
            },
          ],
          total: 60,
          page: Number(url.searchParams.get('page')),
          pageSize: 25,
        },
      }),
    });
    const user = userEvent.setup();
    renderApp('/pasajeros');
    expect(await screen.findByText('Rosa Medina')).toBeInTheDocument();
    expect(screen.getByText('Usa la app')).toBeInTheDocument();
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(await screen.findByText('26–50 de 60')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Buscar pasajeros'), 'rosa');
    await waitFor(() => expect(api.calls.at(-1)?.path).toBe('/passengers'));
    await waitFor(() => {
      const last = api.fetchMock.mock.calls.at(-1)?.[0] as string | undefined;
      expect(last).toContain('search=rosa');
    });
  });
});
