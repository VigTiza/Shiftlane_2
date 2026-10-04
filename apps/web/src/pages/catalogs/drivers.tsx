import { zodResolver } from '@hookform/resolvers/zod';
import {
  DownloadSimpleIcon,
  IdentificationCardIcon,
  KeyIcon,
  PlusIcon,
  QrCodeIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { DRIVER_STATUS_LABELS, DRIVER_STATUSES } from '@shiftlane/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  ConfirmDialog,
  DocumentsBadge,
  DriverStatusBadge,
  errorMessage,
  ImportDialog,
  QrCard,
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
import { Badge } from '@/components/ui/primitives';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useDrivers, useVehicles } from '@/lib/resources';
import type { Driver, Enrollment } from '@/lib/resources';
import { z } from '@/lib/zod';

const phone = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^[\d\s+()-]{7,20}$/.test(value),
    'Escribe un teléfono válido.',
  );

const driverSchema = z.object({
  fullName: z.string().trim().min(3, 'Escribe el nombre completo.').max(120),
  employeeNumber: z.string().trim().max(30),
  phone,
  status: z.enum(DRIVER_STATUSES),
  licenseNumber: z.string().trim().max(40),
  licenseType: z.string().trim().max(30),
  emergencyContactName: z.string().trim().max(120),
  emergencyContactPhone: phone,
  habitualVehicleId: z.string(),
  notes: z.string().trim().max(1000),
});

type DriverForm = z.infer<typeof driverSchema>;

const NO_VEHICLE = 'ninguna';

function emptyForm(driver?: Driver): DriverForm {
  return {
    fullName: driver?.fullName ?? '',
    employeeNumber: driver?.employeeNumber ?? '',
    phone: driver?.phone ?? '',
    status: driver?.status ?? 'active',
    licenseNumber: driver?.licenseNumber ?? '',
    licenseType: driver?.licenseType ?? '',
    emergencyContactName: driver?.emergencyContactName ?? '',
    emergencyContactPhone: driver?.emergencyContactPhone ?? '',
    habitualVehicleId: driver?.habitualVehicle?.id ?? NO_VEHICLE,
    notes: driver?.notes ?? '',
  };
}

/** Lo que manda la API: teléfonos vacíos como null y sin unidad habitual como null. */
function toBody(values: DriverForm) {
  return {
    ...values,
    phone: values.phone || null,
    emergencyContactPhone: values.emergencyContactPhone || null,
    habitualVehicleId: values.habitualVehicleId === NO_VEHICLE ? null : values.habitualVehicleId,
  };
}

function minutesLeft(expiresAt: string) {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000));
}

/** QR de alta: el chofer lo escanea con la app para vincular su celular. */
function EnrollmentDialog({
  driver,
  enrollment,
  onOpenChange,
}: {
  driver: Driver;
  enrollment: Enrollment | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!enrollment} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>QR de alta de {driver.fullName}</DialogTitle>
          <DialogDescription>
            En su celular, abre Shiftlane Chofer y toca «Vincular celular». Si es su primer celular,
            creará su PIN de 4 dígitos.
          </DialogDescription>
        </DialogHeader>
        {enrollment && (
          <div className="grid justify-items-center gap-3">
            <QrCard value={enrollment.qrPayload} />
            <p className="text-center text-[13px] text-muted-foreground">
              Vence en {minutesLeft(enrollment.expiresAt)} minutos. Sirve una sola vez.
            </p>
            <details className="w-full text-[13px]">
              <summary className="cursor-pointer text-muted-foreground">
                ¿No puede escanear? Código para escribir
              </summary>
              <code className="mt-2 block rounded-md bg-muted p-2 font-mono break-all">
                {enrollment.code}
              </code>
            </details>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DriverDialog({
  driver,
  open,
  onOpenChange,
}: {
  driver: Driver | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canWrite = can('drivers.write');
  const vehicles = useVehicles();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [confirm, setConfirm] = useState<'pin' | 'delete' | null>(null);
  const form = useForm<DriverForm>({
    resolver: zodResolver(driverSchema),
    defaultValues: emptyForm(driver ?? undefined),
  });

  useEffect(() => {
    if (open) form.reset(emptyForm(driver ?? undefined));
  }, [open, driver, form]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.drivers });
    await queryClient.invalidateQueries({ queryKey: keys.onboarding });
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      if (driver) {
        await api(`/drivers/${driver.id}`, { method: 'PATCH', body: toBody(values) });
        toast.success(`${values.fullName}: datos guardados`);
      } else {
        await api('/drivers', { method: 'POST', body: toBody(values) });
        toast.success(`${values.fullName} dado de alta`);
      }
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  const vehicleOptions = [
    { value: NO_VEHICLE, label: 'Sin unidad habitual' },
    ...(vehicles.data ?? []).map((v) => ({
      value: v.id,
      label: `${v.economicNumber} · ${v.model}`,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{driver ? driver.fullName : 'Nuevo chofer'}</DialogTitle>
          <DialogDescription>
            El chofer entra a la app con un QR de alta y su PIN, sin contraseña.
          </DialogDescription>
        </DialogHeader>

        {driver && can('drivers.enroll') && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 p-3">
            <span className="mr-auto text-sm">
              {driver.access.pinSet ? 'Ya creó su PIN' : 'Aún no crea su PIN'} ·{' '}
              {driver.access.devices === 1 ? '1 celular' : `${driver.access.devices} celulares`}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void api<Enrollment>(`/drivers/${driver.id}/enrollment`, { method: 'POST' })
                  .then(setEnrollment)
                  .catch((error: unknown) => toast.error(errorMessage(error)))
              }
            >
              <QrCodeIcon className="size-4" />
              QR de alta
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirm('pin')}>
              <KeyIcon className="size-4" />
              Restablecer PIN
            </Button>
          </div>
        )}

        <Form {...form}>
          <form
            id="driver-form"
            onSubmit={(event) => void submit(event)}
            className="grid gap-4 sm:grid-cols-2"
            noValidate
          >
            <fieldset disabled={!canWrite} className="contents">
              <TextField
                control={form.control}
                name="fullName"
                label="Nombre completo"
                className="sm:col-span-2"
              />
              <TextField control={form.control} name="employeeNumber" label="Número de empleado" />
              <TextField control={form.control} name="phone" label="Teléfono" type="tel" />
              <TextField control={form.control} name="licenseNumber" label="Número de licencia" />
              <TextField
                control={form.control}
                name="licenseType"
                label="Tipo de licencia"
                placeholder="Federal B"
              />
              <SelectField
                control={form.control}
                name="habitualVehicleId"
                label="Unidad habitual"
                options={vehicleOptions}
              />
              <SelectField
                control={form.control}
                name="status"
                label="Estado"
                options={DRIVER_STATUSES.map((value) => ({
                  value,
                  label: DRIVER_STATUS_LABELS[value],
                }))}
              />
              <TextField
                control={form.control}
                name="emergencyContactName"
                label="Contacto de emergencia"
              />
              <TextField
                control={form.control}
                name="emergencyContactPhone"
                label="Teléfono de emergencia"
                type="tel"
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
          {driver && canWrite ? (
            <Button variant="ghost" className="text-danger" onClick={() => setConfirm('delete')}>
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
              <Button type="submit" form="driver-form" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando…' : 'Guardar'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      {driver && (
        <>
          <EnrollmentDialog
            driver={driver}
            enrollment={enrollment}
            onOpenChange={(next) => !next && setEnrollment(null)}
          />
          <ConfirmDialog
            open={confirm === 'pin'}
            onOpenChange={(next) => !next && setConfirm(null)}
            title={`¿Restablecer el PIN de ${driver.fullName}?`}
            description="La próxima vez que entre, la app le pedirá crear un PIN nuevo."
            confirmLabel="Restablecer PIN"
            onConfirm={async () => {
              const result = await api<{ message: string }>(`/drivers/${driver.id}/pin-reset`, {
                method: 'POST',
              });
              toast.success(result.message);
              await refresh();
            }}
          />
          <ConfirmDialog
            open={confirm === 'delete'}
            onOpenChange={(next) => !next && setConfirm(null)}
            title={`¿Dar de baja a ${driver.fullName}?`}
            description="Ya no podrá entrar a la app ni recibir viajes. Su historial se conserva."
            confirmLabel="Dar de baja"
            destructive
            onConfirm={async () => {
              await api(`/drivers/${driver.id}`, { method: 'DELETE' });
              toast.success(`${driver.fullName} dado de baja`);
              await refresh();
              onOpenChange(false);
            }}
          />
        </>
      )}
    </Dialog>
  );
}

const statusOptions = DRIVER_STATUSES.map((value) => ({
  value,
  label: DRIVER_STATUS_LABELS[value],
}));

const columns: ColumnDef<Driver, unknown>[] = [
  {
    accessorKey: 'fullName',
    header: 'Chofer',
    cell: ({ row }) => (
      <span>
        <span className="font-medium">{row.original.fullName}</span>
        {row.original.employeeNumber && (
          <span className="ml-2 font-mono text-[13px] text-muted-foreground">
            {row.original.employeeNumber}
          </span>
        )}
      </span>
    ),
  },
  { accessorKey: 'phone', header: 'Teléfono', cell: ({ row }) => row.original.phone ?? '—' },
  {
    accessorKey: 'licenseType',
    header: 'Licencia',
    enableGlobalFilter: false,
    cell: ({ row }) => row.original.licenseType ?? '—',
  },
  {
    id: 'vehicle',
    accessorFn: (driver) => driver.habitualVehicle?.economicNumber ?? '',
    header: 'Unidad',
    cell: ({ row }) =>
      row.original.habitualVehicle ? (
        <span className="font-mono">{row.original.habitualVehicle.economicNumber}</span>
      ) : (
        '—'
      ),
  },
  {
    id: 'access',
    header: 'App',
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row }) =>
      row.original.access.pinSet ? (
        <Badge variant="success">Con PIN</Badge>
      ) : (
        <Badge variant="neutral">Sin vincular</Badge>
      ),
  },
  {
    id: 'documents',
    header: 'Documentos',
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row }) => <DocumentsBadge {...row.original.documents} />,
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    filterFn: inValues,
    enableGlobalFilter: false,
    cell: ({ row }) => <DriverStatusBadge status={row.original.status} />,
  },
];

export function DriversPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const drivers = useDrivers();
  const [selected, setSelected] = useState<Driver | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const open = (driver: Driver | null) => {
    setSelected(driver);
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Choferes"
        description="Datos, licencia y acceso a la app de cada chofer."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                void downloadFile('/drivers/export', 'choferes.xlsx').catch((error: unknown) =>
                  toast.error(errorMessage(error)),
                )
              }
            >
              <DownloadSimpleIcon className="size-4" />
              Exportar
            </Button>
            {can('drivers.write') && (
              <>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <UploadSimpleIcon className="size-4" />
                  Importar
                </Button>
                <Button onClick={() => open(null)}>
                  <PlusIcon className="size-4" />
                  Nuevo chofer
                </Button>
              </>
            )}
          </>
        }
      />
      {drivers.isError ? (
        <ErrorState message={errorMessage(drivers.error)} onRetry={() => void drivers.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={drivers.data ?? []}
          loading={drivers.isLoading}
          searchPlaceholder="Buscar por nombre, número o teléfono…"
          filters={[{ columnId: 'status', title: 'Estado', options: statusOptions }]}
          onRowClick={open}
          empty={{
            icon: IdentificationCardIcon,
            title: 'Todavía no hay choferes',
            description: 'Da de alta a tus choferes o impórtalos desde Excel.',
          }}
        />
      )}
      <DriverDialog driver={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        title="Importar choferes"
        templatePath="/drivers/import/template"
        templateName="plantilla-choferes.xlsx"
        importPath="/drivers/import"
        onImported={() => {
          void queryClient.invalidateQueries({ queryKey: keys.drivers });
          void queryClient.invalidateQueries({ queryKey: keys.onboarding });
        }}
      />
    </>
  );
}
