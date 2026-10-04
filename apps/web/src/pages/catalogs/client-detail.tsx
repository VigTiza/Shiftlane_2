import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  DoorIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  QrCodeIcon,
  TrashIcon,
  UserPlusIcon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { ConfirmDialog, downloadQrSvg, errorMessage, QrCard } from '@/components/catalog';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONTACT_AREA_LABELS, keys } from '@/lib/resources';
import type {
  ClientOrgDetail,
  ContactArea,
  Gate,
  Invitation,
  Plant,
  PlantDetail,
} from '@/lib/resources';
import { z } from '@/lib/zod';

import { rfcRule } from './clients';

// --- Formularios pequeños ---------------------------------------------------------------

const orgSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la empresa.').max(120),
  legalName: z.string().trim().max(200),
  rfc: rfcRule,
});

const plantSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la planta.').max(120),
  address: z.string().trim().max(300),
});

const gateSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la puerta.').max(80),
});

const inviteSchema = z.object({
  fullName: z.string().trim().min(3, 'Escribe el nombre completo.').max(120),
  email: z.email({ message: 'Escribe un correo válido.' }).max(254),
  role: z.enum(['plant_logistics', 'plant_hr']),
});

const contactSchema = z.object({
  fullName: z.string().trim().min(3, 'Escribe el nombre del contacto.').max(120),
  area: z.enum(Object.keys(CONTACT_AREA_LABELS) as [ContactArea, ...ContactArea[]]),
  position: z.string().trim().max(80),
  email: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || z.email().safeParse(value).success,
      'Escribe un correo válido.',
    ),
  phone: z.string().trim().max(20),
});

const roleLabels = {
  plant_logistics: 'Logística de planta',
  plant_hr: 'Recursos humanos de planta',
};
const invitationStatus: Record<
  Invitation['status'],
  { label: string; variant: 'info' | 'success' | 'neutral' | 'warning' }
> = {
  pending: { label: 'Pendiente', variant: 'info' },
  accepted: { label: 'Aceptada', variant: 'success' },
  revoked: { label: 'Cancelada', variant: 'neutral' },
  expired: { label: 'Vencida', variant: 'warning' },
};

function useInvalidate(clientId: string) {
  const queryClient = useQueryClient();
  return async (...extra: (readonly unknown[])[]) => {
    await queryClient.invalidateQueries({ queryKey: keys.client(clientId) });
    await queryClient.invalidateQueries({ queryKey: keys.clients });
    await queryClient.invalidateQueries({ queryKey: keys.onboarding });
    for (const key of extra) await queryClient.invalidateQueries({ queryKey: key });
  };
}

function SimpleFormDialog<T extends Record<string, unknown>>({
  open,
  onOpenChange,
  title,
  description,
  schema,
  defaults,
  submitLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  schema: z.ZodType<T, T>;
  defaults: T;
  submitLabel: string;
  onSubmit: (values: T) => Promise<void>;
  children: (form: ReturnType<typeof useForm<T>>) => ReactNode;
}) {
  const form = useForm<T>({
    resolver: zodResolver(schema as never) as never,
    defaultValues: defaults as never,
  });
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open]);
  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Form {...form}>
          <form
            id={`form-${title}`}
            onSubmit={(event) => void submit(event)}
            className="grid gap-4"
            noValidate
          >
            {children(form)}
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={`form-${title}`} disabled={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Puertas con QR fijo de llegada ---------------------------------------------------------

function GateQrDialog({
  gate,
  plantName,
  onOpenChange,
  onRotate,
  canWrite,
}: {
  gate: Gate | null;
  plantName: string;
  onOpenChange: (open: boolean) => void;
  onRotate: (gate: Gate) => void;
  canWrite: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={!!gate} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>QR de llegada · {gate?.name}</DialogTitle>
          <DialogDescription>
            Imprímelo y pégalo en la puerta. El chofer lo escanea al llegar a {plantName} para
            cerrar el viaje.
          </DialogDescription>
        </DialogHeader>
        {gate && (
          <div ref={card} className="flex justify-center">
            <QrCard value={gate.qrPayload} label={`${plantName} · ${gate.name}`} />
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          {gate && canWrite ? (
            <Button variant="ghost" onClick={() => onRotate(gate)}>
              <ArrowsClockwiseIcon className="size-4" />
              Cambiar código
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="outline"
            onClick={() => gate && downloadQrSvg(card.current, `qr-${plantName}-${gate.name}.svg`)}
          >
            <DownloadSimpleIcon className="size-4" />
            Descargar para imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlantCard({ plant, clientId }: { plant: Plant; clientId: string }) {
  const { can } = useAuth();
  const canWrite = can('clients.write');
  const invalidate = useInvalidate(clientId);
  const detail = useQuery({
    queryKey: keys.plant(plant.id),
    queryFn: () => api<PlantDetail>(`/plants/${plant.id}`),
  });
  const invitations = useQuery({
    queryKey: keys.invitations(plant.id),
    queryFn: () => api<Invitation[]>(`/plants/${plant.id}/invitations`),
  });
  const [qrGate, setQrGate] = useState<Gate | null>(null);
  const [rotating, setRotating] = useState<Gate | null>(null);
  const [adding, setAdding] = useState<'gate' | 'invite' | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{plant.name}</CardTitle>
          <CardDescription>{plant.address ?? 'Sin dirección'}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {plant.served ? <Badge variant="success">La atiendes</Badge> : <Badge>Sin acuerdo</Badge>}
          {plant.passengerActivationCode && (
            <Badge variant="outline" title="Código para activar la app del pasajero">
              Código pasajeros: <span className="font-mono">{plant.passengerActivationCode}</span>
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <section>
          <div className="flex items-center justify-between pb-2">
            <h3 className="text-[13px] font-semibold">Puertas de llegada</h3>
            {canWrite && (
              <Button variant="ghost" size="sm" onClick={() => setAdding('gate')}>
                <PlusIcon className="size-4" />
                Puerta
              </Button>
            )}
          </div>
          {detail.isLoading ? (
            <LoadingRows rows={2} columns={2} />
          ) : (detail.data?.gates.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Agrega la puerta donde llegan las unidades para tener su QR de llegada.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {detail.data?.gates.map((gate) => (
                <li key={gate.id}>
                  <Button variant="outline" size="sm" onClick={() => setQrGate(gate)}>
                    <DoorIcon className="size-4" />
                    {gate.name}
                    <QrCodeIcon className="size-4 text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between pb-2">
            <h3 className="text-[13px] font-semibold">Usuarios de la planta</h3>
            {canWrite && (
              <Button variant="ghost" size="sm" onClick={() => setAdding('invite')}>
                <UserPlusIcon className="size-4" />
                Invitar
              </Button>
            )}
          </div>
          {(invitations.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Invita a logística o recursos humanos: ellos cargan a sus empleados y ven el
              transporte en vivo.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {invitations.data?.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <EnvelopeSimpleIcon className="size-4 text-muted-foreground" />
                  <span className="font-medium">{invitation.fullName}</span>
                  <span className="text-muted-foreground">{invitation.email}</span>
                  <Badge variant={invitationStatus[invitation.status].variant}>
                    {invitationStatus[invitation.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>

      <GateQrDialog
        gate={qrGate}
        plantName={plant.name}
        canWrite={canWrite}
        onOpenChange={(next) => !next && setQrGate(null)}
        onRotate={(gate) => setRotating(gate)}
      />
      <ConfirmDialog
        open={!!rotating}
        onOpenChange={(next) => !next && setRotating(null)}
        title="¿Cambiar el código de esta puerta?"
        description="El QR impreso dejará de servir; tendrás que imprimir y pegar el nuevo."
        confirmLabel="Cambiar código"
        onConfirm={async () => {
          if (!rotating) return;
          const updated = await api<Gate>(`/plant-gates/${rotating.id}/rotate-qr`, {
            method: 'POST',
          });
          setQrGate(updated);
          toast.success('Código cambiado: imprime el nuevo QR');
          await invalidate(keys.plant(plant.id));
        }}
      />
      <SimpleFormDialog
        open={adding === 'gate'}
        onOpenChange={(next) => !next && setAdding(null)}
        title="Nueva puerta"
        description={`Puerta de llegada de ${plant.name}.`}
        schema={gateSchema}
        defaults={{ name: '' }}
        submitLabel="Agregar puerta"
        onSubmit={async (values) => {
          const gate = await api<Gate>(`/plants/${plant.id}/gates`, {
            method: 'POST',
            body: values,
          });
          toast.success(`Puerta ${gate.name} agregada`);
          await invalidate(keys.plant(plant.id));
          setQrGate(gate);
        }}
      >
        {(form) => (
          <TextField
            control={form.control}
            name="name"
            label="Nombre"
            placeholder="Puerta 1 · Caseta norte"
          />
        )}
      </SimpleFormDialog>
      <SimpleFormDialog
        open={adding === 'invite'}
        onOpenChange={(next) => !next && setAdding(null)}
        title="Invitar a la planta"
        description="Le llega un correo para crear su contraseña."
        schema={inviteSchema}
        defaults={{ fullName: '', email: '', role: 'plant_logistics' as const }}
        submitLabel="Enviar invitación"
        onSubmit={async (values) => {
          await api(`/plants/${plant.id}/invitations`, { method: 'POST', body: values });
          toast.success(`Invitación enviada a ${values.email}`);
          await invalidate(keys.invitations(plant.id));
        }}
      >
        {(form) => (
          <>
            <TextField control={form.control} name="fullName" label="Nombre completo" />
            <TextField control={form.control} name="email" label="Correo" type="email" />
            <SelectField
              control={form.control}
              name="role"
              label="Rol"
              options={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))}
            />
          </>
        )}
      </SimpleFormDialog>
    </Card>
  );
}

// --- Página ---------------------------------------------------------------------------------

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const canWrite = can('clients.write');
  const invalidate = useInvalidate(id);
  const client = useQuery({
    queryKey: keys.client(id),
    queryFn: () => api<ClientOrgDetail>(`/client-orgs/${id}`),
  });
  const [dialog, setDialog] = useState<'org' | 'plant' | 'contact' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (client.isLoading) return <LoadingRows rows={6} />;
  if (client.isError || !client.data) {
    return (
      <ErrorState message={errorMessage(client.error)} onRetry={() => void client.refetch()} />
    );
  }
  const data = client.data;

  return (
    <>
      <Link
        to="/clientes"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Clientes y plantas
      </Link>
      <PageHeader
        title={data.name}
        description={[data.legalName, data.rfc].filter(Boolean).join(' · ') || 'Sin datos fiscales'}
        actions={
          canWrite && (
            <>
              {data.managed && (
                <Button variant="outline" onClick={() => setDialog('org')}>
                  <PencilSimpleIcon className="size-4" />
                  Editar
                </Button>
              )}
              <Button onClick={() => setDialog('plant')}>
                <PlusIcon className="size-4" />
                Nueva planta
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          {data.plants.length === 0 ? (
            <EmptyState
              icon={DoorIcon}
              title="Este cliente no tiene plantas"
              description="Agrega la planta que atiendes para registrar sus puertas y rutas."
            />
          ) : (
            data.plants.map((plant) => <PlantCard key={plant.id} plant={plant} clientId={id} />)
          )}
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Contactos</CardTitle>
              {canWrite && (
                <Button variant="ghost" size="sm" onClick={() => setDialog('contact')}>
                  <PlusIcon className="size-4" />
                  Contacto
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {data.contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin contactos todavía.</p>
              ) : (
                <ul className="grid gap-3">
                  {data.contacts.map((contact) => (
                    <li key={contact.id} className="flex items-start justify-between gap-2 text-sm">
                      <span>
                        <span className="block font-medium">{contact.fullName}</span>
                        <span className="block text-muted-foreground">
                          {[CONTACT_AREA_LABELS[contact.area], contact.position]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <span className="block text-muted-foreground">
                          {[contact.email, contact.phone].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Quitar a ${contact.fullName}`}
                          onClick={() => setRemoving(contact.id)}
                        >
                          <TrashIcon className="size-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contratos</CardTitle>
            </CardHeader>
            <CardContent>
              {data.contracts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin contratos.{' '}
                  <Link to="/contratos" className="underline underline-offset-4">
                    Crear uno
                  </Link>
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Desde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.contracts.map((contract) => (
                      <TableRow key={contract.id}>
                        <TableCell>
                          <Link
                            to={`/contratos/${contract.id}`}
                            className="font-medium hover:underline"
                          >
                            {contract.name}
                          </Link>
                        </TableCell>
                        <TableCell className="tabular">{contract.startsOn}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <SimpleFormDialog
        open={dialog === 'org'}
        onOpenChange={(next) => !next && setDialog(null)}
        title="Editar cliente"
        schema={orgSchema}
        defaults={{ name: data.name, legalName: data.legalName ?? '', rfc: data.rfc ?? '' }}
        submitLabel="Guardar"
        onSubmit={async (values) => {
          await api(`/client-orgs/${id}`, {
            method: 'PATCH',
            body: { ...values, rfc: values.rfc || null },
          });
          toast.success('Cliente actualizado');
          await invalidate();
        }}
      >
        {(form) => (
          <>
            <TextField control={form.control} name="name" label="Nombre de la empresa" />
            <TextField control={form.control} name="legalName" label="Razón social" />
            <TextField
              control={form.control}
              name="rfc"
              label="RFC"
              className="[&_input]:font-mono [&_input]:uppercase"
            />
          </>
        )}
      </SimpleFormDialog>
      <SimpleFormDialog
        open={dialog === 'plant'}
        onOpenChange={(next) => !next && setDialog(null)}
        title="Nueva planta"
        schema={plantSchema}
        defaults={{ name: '', address: '' }}
        submitLabel="Agregar planta"
        onSubmit={async (values) => {
          await api(`/client-orgs/${id}/plants`, { method: 'POST', body: values });
          toast.success(`Planta ${values.name} agregada`);
          await invalidate();
        }}
      >
        {(form) => (
          <>
            <TextField control={form.control} name="name" label="Nombre de la planta" />
            <TextField control={form.control} name="address" label="Dirección" />
          </>
        )}
      </SimpleFormDialog>
      <SimpleFormDialog
        open={dialog === 'contact'}
        onOpenChange={(next) => !next && setDialog(null)}
        title="Nuevo contacto"
        schema={contactSchema}
        defaults={{ fullName: '', area: 'logistics', position: '', email: '', phone: '' }}
        submitLabel="Agregar contacto"
        onSubmit={async (values) => {
          await api(`/client-orgs/${id}/contacts`, {
            method: 'POST',
            body: { ...values, email: values.email || null },
          });
          toast.success(`${values.fullName} agregado`);
          await invalidate();
        }}
      >
        {(form) => (
          <>
            <TextField control={form.control} name="fullName" label="Nombre completo" />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="area"
                label="Área"
                options={Object.entries(CONTACT_AREA_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <TextField control={form.control} name="position" label="Puesto" />
              <TextField control={form.control} name="email" label="Correo" type="email" />
              <TextField control={form.control} name="phone" label="Teléfono" type="tel" />
            </div>
          </>
        )}
      </SimpleFormDialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="¿Quitar este contacto?"
        description="Se borra de la lista de contactos del cliente."
        confirmLabel="Quitar"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await api(`/client-contacts/${removing}`, { method: 'DELETE' });
          toast.success('Contacto quitado');
          await invalidate();
        }}
      />
    </>
  );
}
