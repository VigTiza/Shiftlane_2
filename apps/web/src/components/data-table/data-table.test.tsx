import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';

import { DataTable, inValues } from './data-table';

interface Row {
  name: string;
  status: string;
  seats: number;
}

const rows: Row[] = [
  { name: 'José Ramírez', status: 'activo', seats: 19 },
  { name: 'María López', status: 'baja', seats: 15 },
  { name: 'Jose Antonio Pérez', status: 'activo', seats: 44 },
  ...Array.from({ length: 22 }, (_, i) => ({
    name: `Chofer ${i + 1}`,
    status: i % 2 ? 'activo' : 'baja',
    seats: 10 + i,
  })),
];

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Nombre' },
  { accessorKey: 'status', header: 'Estado', filterFn: inValues, enableGlobalFilter: false },
  { accessorKey: 'seats', header: 'Asientos', enableGlobalFilter: false },
];

function renderTable(data = rows) {
  return render(
    <DataTable
      columns={columns}
      data={data}
      pageSize={10}
      searchPlaceholder="Buscar choferes…"
      filters={[
        {
          columnId: 'status',
          title: 'Estado',
          options: [
            { value: 'activo', label: 'Activo' },
            { value: 'baja', label: 'De baja' },
          ],
        },
      ]}
      empty={{ title: 'Todavía no hay choferes', description: 'Da de alta al primero.' }}
    />,
  );
}

const bodyRows = () => within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row');

describe('tabla con filtros', () => {
  it('pagina y dice cuántos hay', async () => {
    const user = userEvent.setup();
    renderTable();
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText('1–10 de 25')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('11–20 de 25')).toBeInTheDocument();
  });

  it('la búsqueda ignora acentos y mayúsculas', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.type(screen.getByLabelText('Buscar choferes…'), 'JOSE');
    expect(bodyRows().map((row) => within(row).getAllByRole('cell')[0]!.textContent)).toEqual([
      'José Ramírez',
      'Jose Antonio Pérez',
    ]);
  });

  it('filtra por estado con conteos y se puede limpiar', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('button', { name: /^Estado/ }));
    await user.click(await screen.findByText('De baja'));
    expect(screen.getByText('1–10 de 12')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(screen.getByText('1–10 de 25')).toBeInTheDocument();
  });

  it('ordena al tocar el encabezado', async () => {
    const user = userEvent.setup();
    renderTable(rows.slice(0, 3));
    await user.click(screen.getByRole('button', { name: 'Ordenar por Asientos' }));
    expect(bodyRows().map((row) => within(row).getAllByRole('cell')[2]!.textContent)).toEqual([
      '15',
      '19',
      '44',
    ]);
  });

  it('estado vacío y sin coincidencias', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTable([]);
    expect(screen.getByText('Todavía no hay choferes')).toBeInTheDocument();
    unmount();
    renderTable();
    await user.type(screen.getByLabelText('Buscar choferes…'), 'zzz');
    expect(screen.getByText('Nada coincide con la búsqueda')).toBeInTheDocument();
  });
});
