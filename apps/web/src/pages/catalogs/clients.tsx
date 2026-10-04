import { zodResolver } from '@hookform/resolvers/zod';
import { BuildingsIcon, PlusIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { errorMessage } from '@/components/catalog';
import { DataTable } from '@/components/data-table/data-table';
import { ErrorState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useClientOrgs } from '@/lib/resources';
import type { ClientOrg, PlantDetail } from '@/lib/resources';
import { z } from '@/lib/zod';

export const rfcRule = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (value) => value === '' || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(value),
    'El RFC no tiene un formato válido.',
  );

const clientSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la empresa.').max(120),
  legalName: z.string().trim().max(200),
  rfc: rfcRule,
  plantName: z.string().trim().max(120),
  plantAddress: z.string().trim().max(300),
});

type ClientForm = z.infer<typeof clientSchema>;

const empty: ClientForm = { name: '', legalName: '', rfc: '', plantName: '', plantAddress: '' };

/** Alta de cliente con su primera planta (lo más común: una maquiladora con una planta). */
export function NewClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (client: ClientOrg) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<ClientForm>({ resolver: zodResolver(clientSchema), defaultValues: empty });

  useEffect(() => {
    if (open) form.reset(empty);
  }, [open, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const client = await api<ClientOrg>('/client-orgs', {
        method: 'POST',
        body: { name: values.name, legalName: values.legalName, rfc: values.rfc || null },
      });
      if (values.plantName) {
        await api<PlantDetail>(`/client-orgs/${client.id}/plants`, {
          method: 'POST',
          body: { name: values.plantName, address: values.plantAddress },
        });
      }
      toast.success(`${client.name} dado de alta`);
      await queryClient.invalidateQueries({ queryKey: keys.clients });
      await queryClient.invalidateQueries({ queryKey: keys.onboarding });
      onOpenChange(false);
      onCreated?.(client);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
          <DialogDescription>La empresa y, si quieres, su primera planta.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="client-form"
            onSubmit={(event) => void submit(event)}
            className="grid gap-4"
            noValidate
          >
            <TextField
              control={form.control}
              name="name"
              label="Nombre de la empresa"
              placeholder="Maquiladora del Norte"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="legalName" label="Razón social" />
              <TextField
                control={form.control}
                name="rfc"
                label="RFC"
                className="[&_input]:font-mono [&_input]:uppercase"
              />
            </div>
            <fieldset className="grid gap-4 rounded-md border border-border p-4">
              <legend className="px-1 text-[13px] font-medium">Primera planta (opcional)</legend>
              <TextField
                control={form.control}
                name="plantName"
                label="Nombre de la planta"
                placeholder="Planta Juárez 2"
              />
              <TextField control={form.control} name="plantAddress" label="Dirección" />
            </fieldset>
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="client-form" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Guardando…' : 'Dar de alta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const columns: ColumnDef<ClientOrg, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Cliente',
    cell: ({ row }) => (
      <span>
        <span className="font-medium">{row.original.name}</span>
        {row.original.legalName && (
          <span className="ml-2 text-muted-foreground">{row.original.legalName}</span>
        )}
      </span>
    ),
  },
  {
    accessorKey: 'rfc',
    header: 'RFC',
    cell: ({ row }) => <span className="font-mono">{row.original.rfc ?? '—'}</span>,
  },
  {
    id: 'plants',
    accessorFn: (client) => client.plants.map((plant) => plant.name).join(', '),
    header: 'Plantas',
    cell: ({ row }) =>
      row.original.plants.length === 0 ? (
        <span className="text-muted-foreground">Sin plantas</span>
      ) : (
        row.original.plants.map((plant) => plant.name).join(', ')
      ),
  },
  {
    id: 'managed',
    header: 'Cuenta',
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row }) =>
      row.original.managed ? (
        <Badge variant="neutral">La administras tú</Badge>
      ) : (
        <Badge variant="info">Tiene usuarios propios</Badge>
      ),
  },
];

export function ClientsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const clients = useClientOrgs();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Clientes y plantas"
        description="Las empresas que atiendes, sus plantas, puertas de llegada y contactos."
        actions={
          can('clients.write') && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon className="size-4" />
              Nuevo cliente
            </Button>
          )
        }
      />
      {clients.isError ? (
        <ErrorState message={errorMessage(clients.error)} onRetry={() => void clients.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={clients.data ?? []}
          loading={clients.isLoading}
          searchPlaceholder="Buscar por empresa, RFC o planta…"
          onRowClick={(client) => void navigate(`/clientes/${client.id}`)}
          empty={{
            icon: BuildingsIcon,
            title: 'Todavía no hay clientes',
            description: 'Da de alta la primera empresa que atiendes y su planta.',
          }}
        />
      )}
      <NewClientDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(client) => void navigate(`/clientes/${client.id}`)}
      />
    </>
  );
}
