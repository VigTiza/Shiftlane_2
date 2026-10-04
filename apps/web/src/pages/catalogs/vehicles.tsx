import { zodResolver } from '@hookform/resolvers/zod';
import {
  BusIcon,
  DownloadSimpleIcon,
  ImageIcon,
  PlusIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { VEHICLE_STATUS_LABELS, VEHICLE_STATUSES } from '@shiftlane/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  ConfirmDialog,
  DocumentsBadge,
  errorMessage,
  ImportDialog,
  VehicleStatusBadge,
} from '@/components/catalog';
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
import { api, apiBlob, apiUpload, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useVehicles } from '@/lib/resources';
import type { Vehicle } from '@/lib/resources';
import { z } from '@/lib/zod';

const thisYear = new Date().getFullYear();

const vehicleSchema = z.object({
  economicNumber: z.string().trim().min(1, 'Escribe el número económico.').max(20),
  plates: z.string().trim().min(5, 'Las placas deben tener al menos 5 caracteres.').max(12),
  make: z.string().trim().max(60),
  model: z.string().trim().min(1, 'Escribe el modelo.').max(60),
  year: z.coerce
    .number<string>({ message: 'Escribe el año como número.' })
    .int()
    .min(1980, 'El año debe ser 1980 o posterior.')
    .max(thisYear + 1, `El año no puede ser mayor a ${thisYear + 1}.`),
  capacity: z.coerce
    .number<string>({ message: 'Escribe la capacidad como número.' })
    .int()
    .min(1, 'La capacidad debe ser al menos 1.')
    .max(120, 'La capacidad no puede ser mayor a 120.'),
  status: z.enum(VEHICLE_STATUSES),
  odometerKm: z.coerce
    .number<string>({ message: 'Escribe el kilometraje como número.' })
    .int()
    .min(0, 'El kilometraje no puede ser negativo.'),
  requiredLicenseType: z.string().trim().max(40),
  notes: z.string().trim().max(1000),
});

type VehicleFormInput = z.input<typeof vehicleSchema>;
type VehicleForm = z.output<typeof vehicleSchema>;

const statusOptions = VEHICLE_STATUSES.map((value) => ({
  value,
  label: VEHICLE_STATUS_LABELS[value],
}));

function emptyForm(vehicle?: Vehicle): VehicleFormInput {
  return {
    economicNumber: vehicle?.economicNumber ?? '',
    plates: vehicle?.plates ?? '',
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    year: vehicle ? String(vehicle.year) : '',
    capacity: vehicle ? String(vehicle.capacity) : '',
    status: vehicle?.status ?? 'available',
    odometerKm: vehicle ? String(vehicle.odometerKm) : '0',
    requiredLicenseType: vehicle?.requiredLicenseType ?? '',
    notes: vehicle?.notes ?? '',
  };
}

/** Foto de la unidad (la API pide la sesión, así que se baja como archivo). */
function VehiclePhoto({ vehicle }: { vehicle: Vehicle }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const photo = useQuery({
    queryKey: ['vehicles', vehicle.id, 'photo'],
    queryFn: async () => URL.createObjectURL((await apiBlob(`/vehicles/${vehicle.id}/photo`)).blob),
    enabled: vehicle.hasPhoto,
  });
  useEffect(() => {
    const url = photo.data;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.data]);

  const upload = async (file: File) => {
    try {
      await apiUpload(`/vehicles/${vehicle.id}/photo`, file, { method: 'PUT' });
      toast.success('Foto guardada');
      await queryClient.invalidateQueries({ queryKey: keys.vehicles });
      await queryClient.invalidateQueries({ queryKey: ['vehicles', vehicle.id, 'photo'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        {photo.data ? (
          <img
            src={photo.data}
            alt={`Foto de ${vehicle.economicNumber}`}
            className="size-full object-cover"
          />
        ) : (
          <ImageIcon className="size-7 text-muted-foreground" />
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Foto de la unidad"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
        <UploadSimpleIcon className="size-4" />
        {vehicle.hasPhoto ? 'Cambiar foto' : 'Subir foto'}
      </Button>
    </div>
  );
}

function VehicleDialog({
  vehicle,
  open,
  onOpenChange,
}: {
  vehicle: Vehicle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canWrite = can('vehicles.write');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<VehicleFormInput, unknown, VehicleForm>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: emptyForm(vehicle ?? undefined),
  });

  useEffect(() => {
    if (open) form.reset(emptyForm(vehicle ?? undefined));
  }, [open, vehicle, form]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.vehicles });
    await queryClient.invalidateQueries({ queryKey: keys.onboarding });
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      if (vehicle) {
        await api(`/vehicles/${vehicle.id}`, { method: 'PATCH', body: values });
        toast.success(`Unidad ${values.economicNumber} actualizada`);
      } else {
        await api('/vehicles', { method: 'POST', body: values });
        toast.success(`Unidad ${values.economicNumber} dada de alta`);
      }
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vehicle ? `Unidad ${vehicle.economicNumber}` : 'Nueva unidad'}</DialogTitle>
          <DialogDescription>
            Los documentos y sus vencimientos se administran en Cumplimiento.
          </DialogDescription>
        </DialogHeader>
        {vehicle && <VehiclePhoto vehicle={vehicle} />}
        <Form {...form}>
          <form
            id="vehicle-form"
            onSubmit={(event) => void submit(event)}
            className="grid gap-4 sm:grid-cols-2"
            noValidate
          >
            <fieldset disabled={!canWrite} className="contents">
              <TextField
                control={form.control}
                name="economicNumber"
                label="Número económico"
                placeholder="U-014"
              />
              <TextField
                control={form.control}
                name="plates"
                label="Placas"
                placeholder="EFR-1234"
                className="[&_input]:font-mono [&_input]:uppercase"
              />
              <TextField
                control={form.control}
                name="make"
                label="Marca"
                placeholder="Mercedes-Benz"
              />
              <TextField
                control={form.control}
                name="model"
                label="Modelo"
                placeholder="Sprinter 516"
              />
              <TextField control={form.control} name="year" label="Año" inputMode="numeric" />
              <TextField
                control={form.control}
                name="capacity"
                label="Capacidad"
                inputMode="numeric"
                description="Asientos para pasajeros."
              />
              <SelectField
                control={form.control}
                name="status"
                label="Estado"
                options={statusOptions}
              />
              <TextField
                control={form.control}
                name="odometerKm"
                label="Kilometraje"
                inputMode="numeric"
              />
              <TextField
                control={form.control}
                name="requiredLicenseType"
                label="Licencia que exige"
                placeholder="Federal B"
              />
              <TextAreaField
                control={form.control}
                name="notes"
                label="Notas"
                className="sm:col-span-2"
              />
            </fieldset>
          </form>
        </Form>
        <DialogFooter className="sm:justify-between">
          {vehicle && can('vehicles.write') ? (
            <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>
              <TrashIcon className="size-4" />
              Dar de baja
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {canWrite ? 'Cancelar' : 'Cerrar'}
            </Button>
            {canWrite && (
              <Button type="submit" form="vehicle-form" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando…' : 'Guardar'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
      {vehicle && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`¿Dar de baja la unidad ${vehicle.economicNumber}?`}
          description="Deja de aparecer para asignar viajes. Su historial se conserva."
          confirmLabel="Dar de baja"
          destructive
          onConfirm={async () => {
            await api(`/vehicles/${vehicle.id}`, { method: 'DELETE' });
            toast.success(`Unidad ${vehicle.economicNumber} dada de baja`);
            await refresh();
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}

const columns: ColumnDef<Vehicle, unknown>[] = [
  {
    accessorKey: 'economicNumber',
    header: 'Unidad',
    cell: ({ row }) => (
      <span>
        <span className="font-mono font-medium">{row.original.economicNumber}</span>
        <span className="ml-2 text-muted-foreground">
          {[row.original.make, row.original.model].filter(Boolean).join(' ')}
        </span>
      </span>
    ),
  },
  {
    accessorKey: 'plates',
    header: 'Placas',
    cell: ({ row }) => <span className="font-mono">{row.original.plates}</span>,
  },
  { accessorKey: 'year', header: 'Año', enableGlobalFilter: false },
  {
    accessorKey: 'capacity',
    header: 'Asientos',
    enableGlobalFilter: false,
    meta: { className: 'text-right' },
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    filterFn: inValues,
    enableGlobalFilter: false,
    cell: ({ row }) => <VehicleStatusBadge status={row.original.status} />,
  },
  {
    id: 'documents',
    header: 'Documentos',
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row }) => <DocumentsBadge {...row.original.documents} />,
  },
  {
    accessorKey: 'odometerKm',
    header: 'Kilometraje',
    enableGlobalFilter: false,
    meta: { className: 'text-right' },
    cell: ({ row }) => row.original.odometerKm.toLocaleString('es-MX'),
  },
];

export function VehiclesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const vehicles = useVehicles();
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const open = (vehicle: Vehicle | null) => {
    setSelected(vehicle);
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Unidades"
        description="Tu flota: estado, capacidad y documentos al día."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                void downloadFile('/vehicles/export', 'unidades.xlsx').catch((error: unknown) =>
                  toast.error(errorMessage(error)),
                )
              }
            >
              <DownloadSimpleIcon className="size-4" />
              Exportar
            </Button>
            {can('vehicles.write') && (
              <>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <UploadSimpleIcon className="size-4" />
                  Importar
                </Button>
                <Button onClick={() => open(null)}>
                  <PlusIcon className="size-4" />
                  Nueva unidad
                </Button>
              </>
            )}
          </>
        }
      />
      {vehicles.isError ? (
        <ErrorState
          message={errorMessage(vehicles.error)}
          onRetry={() => void vehicles.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={vehicles.data ?? []}
          loading={vehicles.isLoading}
          searchPlaceholder="Buscar por número, placas o modelo…"
          filters={[{ columnId: 'status', title: 'Estado', options: statusOptions }]}
          onRowClick={open}
          empty={{
            icon: BusIcon,
            title: 'Todavía no hay unidades',
            description: 'Da de alta tu primera unidad o impórtalas desde Excel.',
          }}
        />
      )}
      <VehicleDialog vehicle={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        title="Importar unidades"
        templatePath="/vehicles/import/template"
        templateName="plantilla-unidades.xlsx"
        importPath="/vehicles/import"
        onImported={() => {
          void queryClient.invalidateQueries({ queryKey: keys.vehicles });
          void queryClient.invalidateQueries({ queryKey: keys.onboarding });
        }}
      />
    </>
  );
}
