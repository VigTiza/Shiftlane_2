import { zodResolver } from '@hookform/resolvers/zod';
import { HandshakeIcon, PlusIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { errorMessage } from '@/components/catalog';
import { DataTable, inValues } from '@/components/data-table/data-table';
import { ErrorState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
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
import type { BadgeVariant } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useClientOrgs } from '@/lib/resources';
import type { Contract, ContractDetail, ContractStatus } from '@/lib/resources';
import { z } from '@/lib/zod';

export const contractStatusInfo: Record<ContractStatus, { label: string; variant: BadgeVariant }> =
  {
    draft: { label: 'Borrador', variant: 'neutral' },
    active: { label: 'Vigente', variant: 'success' },
    ended: { label: 'Terminado', variant: 'outline' },
  };

export const contractStatusOptions = Object.entries(contractStatusInfo).map(([value, info]) => ({
  value,
  label: info.label,
}));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una fecha válida.');

export const contractSchema = z
  .object({
    clientOrgId: z.string().min(1, 'Elige el cliente.'),
    plantId: z.string(),
    name: z.string().trim().min(3, 'Escribe el nombre del contrato.').max(120),
    number: z.string().trim().max(60),
    status: z.enum(['draft', 'active', 'ended']),
    startsOn: isoDate,
    endsOn: z
      .string()
      .refine(
        (value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value),
        'Usa una fecha válida.',
      ),
    notes: z.string().trim().max(2000),
  })
  .refine((body) => !body.endsOn || body.endsOn >= body.startsOn, {
    message: 'La fecha de fin no puede ser anterior a la de inicio.',
    path: ['endsOn'],
  });

export type ContractForm = z.infer<typeof contractSchema>;
export const ALL_PLANTS = 'todas';

export function contractBody(values: ContractForm) {
  return {
    ...values,
    plantId: values.plantId === ALL_PLANTS ? null : values.plantId,
    endsOn: values.endsOn || null,
  };
}

export function ContractFields({ form }: { form: ReturnType<typeof useForm<ContractForm>> }) {
  const clients = useClientOrgs();
  const clientOrgId = useWatch({ control: form.control, name: 'clientOrgId' });
  const plants = clients.data?.find((client) => client.id === clientOrgId)?.plants ?? [];
  return (
    <>
      <SelectField
        control={form.control}
        name="clientOrgId"
        label="Cliente"
        options={(clients.data ?? []).map((client) => ({ value: client.id, label: client.name }))}
        placeholder={
          clients.data?.length === 0 ? 'Primero da de alta un cliente' : 'Elige el cliente'
        }
      />
      <SelectField
        control={form.control}
        name="plantId"
        label="Planta"
        options={[
          { value: ALL_PLANTS, label: 'Todas sus plantas' },
          ...plants.map((plant) => ({ value: plant.id, label: plant.name })),
        ]}
      />
      <TextField
        control={form.control}
        name="name"
        label="Nombre"
        placeholder="Transporte de personal 2026"
        className="sm:col-span-2"
      />
      <TextField control={form.control} name="number" label="Número de contrato" />
      <SelectField
        control={form.control}
        name="status"
        label="Estado"
        options={contractStatusOptions}
      />
      <TextField control={form.control} name="startsOn" label="Inicio" type="date" />
      <TextField control={form.control} name="endsOn" label="Fin (opcional)" type="date" />
      <TextAreaField control={form.control} name="notes" label="Notas" className="sm:col-span-2" />
    </>
  );
}

function NewContractDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const defaults: ContractForm = {
    clientOrgId: '',
    plantId: ALL_PLANTS,
    name: '',
    number: '',
    status: 'draft',
    startsOn: new Date().toISOString().slice(0, 10),
    endsOn: '',
    notes: '',
  };
  const form = useForm<ContractForm>({
    resolver: zodResolver(contractSchema),
    defaultValues: defaults,
  });
  // Al abrir, el formulario empieza limpio.
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const contract = await api<ContractDetail>('/contracts', {
        method: 'POST',
        body: contractBody(values),
      });
      toast.success(`Contrato «${contract.name}» creado`);
      await queryClient.invalidateQueries({ queryKey: keys.contracts });
      onOpenChange(false);
      void navigate(`/contratos/${contract.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo contrato</DialogTitle>
          <DialogDescription>Después le agregas las tarifas y penalizaciones.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="contract-form"
            onSubmit={(event) => void submit(event)}
            className="grid gap-4 sm:grid-cols-2"
            noValidate
          >
            <ContractFields form={form} />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="contract-form" disabled={form.formState.isSubmitting}>
            Crear contrato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const columns: ColumnDef<Contract, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Contrato',
    cell: ({ row }) => (
      <span>
        <span className="font-medium">{row.original.name}</span>
        {row.original.number && (
          <span className="ml-2 font-mono text-[13px] text-muted-foreground">
            {row.original.number}
          </span>
        )}
      </span>
    ),
  },
  { accessorKey: 'clientOrgName', header: 'Cliente' },
  {
    accessorKey: 'status',
    header: 'Estado',
    filterFn: inValues,
    enableGlobalFilter: false,
    cell: ({ row }) => {
      const info = contractStatusInfo[row.original.status];
      return <Badge variant={info.variant}>{info.label}</Badge>;
    },
  },
  {
    id: 'validity',
    accessorFn: (contract) => contract.startsOn,
    header: 'Vigencia',
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <span className="tabular">
        {row.original.startsOn} → {row.original.endsOn ?? 'sin fin'}
      </span>
    ),
  },
];

export function ContractsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const contracts = useQuery({
    queryKey: keys.contracts,
    queryFn: () => api<Contract[]>('/contracts'),
  });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Contratos y tarifas"
        description="Lo que cobras a cada cliente: tarifas por viaje, ruta, kilómetro, unidad o pasajero, y penalizaciones."
        actions={
          can('contracts.write') && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon className="size-4" />
              Nuevo contrato
            </Button>
          )
        }
      />
      {contracts.isError ? (
        <ErrorState
          message={errorMessage(contracts.error)}
          onRetry={() => void contracts.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={contracts.data ?? []}
          loading={contracts.isLoading}
          searchPlaceholder="Buscar por contrato o cliente…"
          filters={[{ columnId: 'status', title: 'Estado', options: contractStatusOptions }]}
          onRowClick={(contract) => void navigate(`/contratos/${contract.id}`)}
          empty={{
            icon: HandshakeIcon,
            title: 'Todavía no hay contratos',
            description: 'Crea el contrato de un cliente para registrar sus tarifas.',
          }}
        />
      )}
      <NewContractDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
