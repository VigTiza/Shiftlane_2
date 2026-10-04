import {
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  TrayIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import {
  flexRender,
  getCoreRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type {
  Column,
  ColumnDef,
  ColumnFiltersState,
  FilterFn,
  SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { EmptyState, LoadingRows } from '../states';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge, Checkbox } from '../ui/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export interface FacetedFilter {
  columnId: string;
  title: string;
  options: { value: string; label: string }[];
}

/** Filtro por varios valores (la columna coincide con cualquiera de los elegidos). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const inValues: FilterFn<any> = (row, columnId, values: string[]) =>
  values.length === 0 || values.includes(String(row.getValue(columnId)));

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function SortHeader<T>({ column, children }: { column: Column<T>; children: ReactNode }) {
  if (!column.getCanSort()) return <>{children}</>;
  const sorted = column.getIsSorted();
  const SortIcon =
    sorted === 'asc' ? CaretUpIcon : sorted === 'desc' ? CaretDownIcon : CaretUpDownIcon;
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 uppercase hover:text-foreground"
      aria-label={`Ordenar por ${typeof children === 'string' ? children : 'columna'}`}
    >
      {children}
      <SortIcon className="size-3" />
    </button>
  );
}

function FacetFilter<T>({ column, filter }: { column: Column<T>; filter: FacetedFilter }) {
  const selected = new Set((column.getFilterValue() as string[] | undefined) ?? []);
  const counts = column.getFacetedUniqueValues();
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    column.setFilterValue(next.size ? [...next] : undefined);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <FunnelIcon className="size-4" />
          {filter.title}
          {selected.size > 0 && (
            <Badge variant="neutral" className="ml-1">
              {selected.size}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1">
        <fieldset>
          <legend className="sr-only">{filter.title}</legend>
          {filter.options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={selected.has(option.value)}
                onCheckedChange={() => toggle(option.value)}
              />
              <span className="flex-1">{option.label}</span>
              <span className="text-xs text-muted-foreground tabular">
                {counts.get(option.value) ?? 0}
              </span>
            </label>
          ))}
        </fieldset>
        {selected.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => column.setFilterValue(undefined)}
          >
            Quitar filtro
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Tabla con búsqueda, filtros por valores, orden y paginación. La búsqueda ignora acentos y
 * mayúsculas en las columnas de texto.
 */
export function DataTable<T>({
  columns,
  data,
  loading = false,
  searchPlaceholder = 'Buscar…',
  filters = [],
  pageSize = 20,
  empty,
  toolbar,
  onRowClick,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  searchPlaceholder?: string;
  filters?: FacetedFilter[];
  pageSize?: number;
  empty?: { icon?: Icon; title: string; description: string; action?: ReactNode };
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, columnId, value: string) =>
      normalize(String(row.getValue(columnId) ?? '')).includes(normalize(value)),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize } },
    // El primer clic siempre ordena de menor a mayor (también en columnas numéricas).
    sortDescFirst: false,
  });

  const filtered = globalFilter !== '' || columnFilters.length > 0;
  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-8"
          />
        </div>
        {filters.map((filter) => {
          const column = table.getColumn(filter.columnId);
          return column ? (
            <FacetFilter key={filter.columnId} column={column} filter={filter} />
          ) : null;
        })}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGlobalFilter('');
              setColumnFilters([]);
            }}
          >
            <XIcon className="size-4" />
            Limpiar
          </Button>
        )}
        {toolbar && <div className="ml-auto flex items-center gap-2">{toolbar}</div>}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="p-4">
            <LoadingRows columns={Math.min(columns.length, 5)} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={empty?.icon ?? TrayIcon}
            title={filtered ? 'Nada coincide con la búsqueda' : (empty?.title ?? 'Sin registros')}
            description={
              filtered
                ? 'Prueba con otras palabras o quita los filtros.'
                : (empty?.description ?? 'Cuando haya registros aparecerán aquí.')
            }
            action={filtered ? undefined : empty?.action}
          />
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn(header.column.columnDef.meta?.className)}
                    >
                      {header.isPlaceholder ? null : (
                        <SortHeader column={header.column}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </SortHeader>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn(cell.column.columnDef.meta?.className)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span className="tabular">
            {from}–{to} de {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Página anterior"
            >
              <CaretLeftIcon className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Página siguiente"
            >
              <CaretRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Clases de la celda (por ejemplo, `text-right` para cifras). */
    className?: string;
  }
}
