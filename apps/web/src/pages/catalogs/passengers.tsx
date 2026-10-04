import {
  CaretLeftIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/components/catalog';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/controls';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/primitives';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { keys, useClientOrgs } from '@/lib/resources';
import type { Paginated, Passenger } from '@/lib/resources';

const PAGE_SIZE = 25;
const ALL = 'todas';

/** Espera a que dejen de escribir para no pedir una página por letra. */
function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Empleados de las plantas que atiendes. La planta carga y actualiza su lista desde su portal;
 * aquí se consulta (por ejemplo, para saber a qué ruta y turno pertenece alguien).
 */
export function PassengersPage() {
  const clients = useClientOrgs();
  const [plantId, setPlantId] = useState(ALL);
  const [status, setStatus] = useState<'active' | 'inactive' | typeof ALL>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search.trim());

  useEffect(() => setPage(1), [plantId, status, term]);

  const filters = { plantId, status, term, page };
  const passengers = useQuery({
    queryKey: keys.passengers(filters),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (plantId !== ALL) params.set('plantId', plantId);
      if (status !== ALL) params.set('status', status);
      if (term) params.set('search', term);
      return api<Paginated<Passenger>>(`/passengers?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const plants = (clients.data ?? []).flatMap((client) =>
    client.plants.map((plant) => ({ ...plant, clientName: client.name })),
  );
  const plantName = new Map(
    plants.map((plant) => [plant.id, `${plant.clientName} · ${plant.name}`]),
  );
  const total = passengers.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Pasajeros"
        description="Empleados de las plantas que atiendes. Cada planta carga y actualiza su lista desde su portal."
      />
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre o número…"
            aria-label="Buscar pasajeros"
            className="pl-8"
          />
        </div>
        <Select value={plantId} onValueChange={setPlantId}>
          <SelectTrigger className="w-auto min-w-48" aria-label="Planta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las plantas</SelectItem>
            {plants.map((plant) => (
              <SelectItem key={plant.id} value={plant.id}>
                {plant.clientName} · {plant.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger className="w-auto min-w-36" aria-label="Estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">De baja</SelectItem>
            <SelectItem value={ALL}>Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {passengers.isError ? (
        <ErrorState
          message={errorMessage(passengers.error)}
          onRetry={() => void passengers.refetch()}
        />
      ) : passengers.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <LoadingRows columns={4} />
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={UsersThreeIcon}
          title={term ? 'Nadie coincide con la búsqueda' : 'Todavía no hay pasajeros'}
          description={
            term ? (
              'Prueba con otro nombre o número de empleado.'
            ) : (
              <>
                Invita a la planta para que cargue a sus empleados desde{' '}
                <Link to="/clientes" className="underline underline-offset-4">
                  Clientes y plantas
                </Link>
                .
              </>
            )
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Empleado</TableHead>
                  <TableHead>Planta</TableHead>
                  <TableHead>Turno</TableHead>
                  <TableHead>Credencial</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {passengers.data?.items.map((passenger) => {
                  const credentials = passenger.credentials.filter((c) => !c.revokedAt);
                  return (
                    <TableRow key={passenger.id}>
                      <TableCell>
                        <span className="font-medium">{passenger.fullName}</span>
                        <span className="ml-2 font-mono text-[13px] text-muted-foreground">
                          {passenger.employeeNumber}
                        </span>
                      </TableCell>
                      <TableCell>{plantName.get(passenger.plantId) ?? '—'}</TableCell>
                      <TableCell>{passenger.shiftName ?? '—'}</TableCell>
                      <TableCell>
                        {credentials.length === 0 ? (
                          <span className="text-muted-foreground">Sin credencial</span>
                        ) : (
                          credentials
                            .map((c) =>
                              c.kind === 'shiftlane_qr'
                                ? 'QR Shiftlane'
                                : `Gafete ${c.value ?? ''}`,
                            )
                            .join(', ')
                        )}
                      </TableCell>
                      <TableCell>
                        {passenger.status === 'active' ? (
                          <Badge variant={passenger.activated ? 'success' : 'neutral'}>
                            {passenger.activated ? 'Usa la app' : 'Activo'}
                          </Badge>
                        ) : (
                          <Badge variant="outline">De baja</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between pt-3 text-[13px] text-muted-foreground">
            <span className="tabular">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(total, page * PAGE_SIZE)} de {total}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
                aria-label="Página anterior"
              >
                <CaretLeftIcon className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page >= pages}
                onClick={() => setPage((current) => current + 1)}
                aria-label="Página siguiente"
              >
                <CaretRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
