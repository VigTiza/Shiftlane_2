import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRightIcon,
  BuildingsIcon,
  CheckCircleIcon,
  CircleIcon,
  ImageIcon,
  PlayCircleIcon,
  PlusIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { errorMessage, ImportDialog } from '@/components/catalog';
import { ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/fields';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { Badge, Card, CardContent, Checkbox } from '@/components/ui/primitives';
import { api, apiBlob, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useClientOrgs, useOnboarding } from '@/lib/resources';
import type { AlertRule, Company, OnboardingStepKey, Shift } from '@/lib/resources';
import { cn } from '@/lib/utils';
import { z } from '@/lib/zod';

import { NewClientDialog, rfcRule } from './catalogs/clients';

interface StepInfo {
  key: OnboardingStepKey;
  title: string;
  summary: string;
  /** Puntos del video de un minuto (se muestran mientras no haya video). */
  points: string[];
}

export const STEPS: StepInfo[] = [
  {
    key: 'company',
    title: 'Datos de la empresa',
    summary: 'Razón social, RFC y logo: aparecen en prefacturas, reportes y la app del pasajero.',
    points: ['Escribe la razón social y el RFC.', 'Sube tu logo en PNG o JPG.'],
  },
  {
    key: 'operation',
    title: 'Turnos y reglas de operación',
    summary: 'Cuándo avisar de un retraso, la velocidad máxima y los horarios de cada planta.',
    points: [
      'La tolerancia de retraso decide cuándo se levanta una alerta.',
      'Los turnos se registran por planta: entrada y salida.',
    ],
  },
  {
    key: 'fleet',
    title: 'Unidades y choferes',
    summary: 'Tu flota y tus choferes, de uno en uno o desde las plantillas de Excel.',
    points: [
      'Descarga la plantilla, llénala y súbela.',
      'Antes de guardar verás qué se va a cargar.',
    ],
  },
  {
    key: 'clients',
    title: 'Clientes y plantas',
    summary: 'Las empresas que atiendes, sus plantas y las puertas donde llegan las unidades.',
    points: ['Cada puerta tiene un QR fijo de llegada.', 'Imprímelo y pégalo en la caseta.'],
  },
  {
    key: 'routes',
    title: 'Rutas y paradas',
    summary: 'El trazo de cada ruta en el mapa, con sus paradas y horarios por turno.',
    points: ['Dibuja la ruta en el mapa.', 'Ordena las paradas y ponles horario.'],
  },
  {
    key: 'plant_invite',
    title: 'Invitar a la planta',
    summary: 'La planta carga a sus empleados y ve el transporte en vivo desde su portal.',
    points: [
      'Invita a logística o a recursos humanos.',
      'Les llega un correo para crear su contraseña.',
    ],
  },
  {
    key: 'devices',
    title: 'Celulares de los choferes',
    summary: 'Instala Shiftlane Chofer y vincula cada celular con su QR de alta.',
    points: ['Instala el APK en el celular.', 'Genera el QR de alta del chofer y que lo escanee.'],
  },
  {
    key: 'test_trip',
    title: 'Viaje de prueba',
    summary: 'Un viaje completo con un chofer: checklist, escaneos y llegada por la puerta.',
    points: [
      'Programa un viaje extra.',
      'El chofer lo inicia, escanea y termina con el QR de la puerta.',
    ],
  },
];

/** Video de un minuto por paso; mientras no se graba, sus puntos clave. */
const VIDEOS: Partial<Record<OnboardingStepKey, string>> = {};

function VideoCard({ step }: { step: StepInfo }) {
  const src = VIDEOS[step.key];
  if (src) {
    return (
      <video
        controls
        preload="metadata"
        className="aspect-video w-full rounded-lg border border-border bg-black"
        src={src}
      >
        <track kind="captions" />
      </video>
    );
  }
  return (
    <div className="flex aspect-video w-full flex-col justify-between rounded-lg border border-border bg-sidebar p-5 text-sidebar-foreground">
      <span className="flex items-center gap-2 text-[13px] text-sidebar-muted">
        <PlayCircleIcon className="size-5" weight="fill" />
        Video de 1 minuto · próximamente
      </span>
      <ul className="grid gap-1.5 text-[15px]">
        {step.points.map((point) => (
          <li key={point} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Paso 1: empresa -------------------------------------------------------------------------

const companySchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre comercial.').max(120),
  legalName: z.string().trim().max(200),
  rfc: rfcRule,
});

function CompanyStep({ onSaved }: { onSaved: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const company = useQuery({ queryKey: keys.company, queryFn: () => api<Company>('/company') });
  const logo = useQuery({
    queryKey: [...keys.company, 'logo'],
    queryFn: async () => URL.createObjectURL((await apiBlob('/company/logo')).blob),
    enabled: !!company.data?.hasLogo,
  });
  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: { name: '', legalName: '', rfc: '' },
  });
  useEffect(() => {
    if (company.data) {
      form.reset({
        name: company.data.name,
        legalName: company.data.legalName ?? '',
        rfc: company.data.rfc ?? '',
      });
    }
  }, [company.data, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await api('/company', { method: 'PUT', body: { ...values, rfc: values.rfc || null } });
      toast.success('Datos de la empresa guardados');
      await queryClient.invalidateQueries({ queryKey: keys.company });
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  const uploadLogo = async (file: File) => {
    try {
      await apiUpload('/company/logo', file);
      toast.success('Logo guardado');
      await queryClient.invalidateQueries({ queryKey: keys.company });
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (company.isLoading) return <LoadingRows rows={3} columns={2} />;
  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-4 sm:grid-cols-2"
        noValidate
      >
        <TextField
          control={form.control}
          name="name"
          label="Nombre comercial"
          className="sm:col-span-2"
        />
        <TextField
          control={form.control}
          name="legalName"
          label="Razón social"
          placeholder="Transportes Riberas SA de CV"
        />
        <TextField
          control={form.control}
          name="rfc"
          label="RFC"
          className="[&_input]:font-mono [&_input]:uppercase"
        />
        <div className="flex items-center gap-3 sm:col-span-2">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
            {logo.data ? (
              <img src={logo.data} alt="Logo de la empresa" className="size-full object-contain" />
            ) : (
              <ImageIcon className="size-6 text-muted-foreground" />
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Logo de la empresa"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadLogo(file);
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            <UploadSimpleIcon className="size-4" />
            {company.data?.hasLogo ? 'Cambiar logo' : 'Subir logo'}
          </Button>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Guardar datos
          </Button>
        </div>
      </form>
    </Form>
  );
}

// --- Paso 2: reglas y turnos -----------------------------------------------------------------

const rulesSchema = z.object({
  delay: z.coerce.number<string>().int().min(1, 'Mínimo 1 minuto.').max(240, 'Máximo 240 minutos.'),
  notStarted: z.coerce
    .number<string>()
    .int()
    .min(1, 'Mínimo 1 minuto.')
    .max(240, 'Máximo 240 minutos.'),
  speed: z.coerce.number<string>().int().min(20, 'Mínimo 20 km/h.').max(160, 'Máximo 160 km/h.'),
  offRoute: z.coerce
    .number<string>()
    .int()
    .min(30, 'Mínimo 30 metros.')
    .max(5000, 'Máximo 5,000 metros.'),
});

const shiftSchema = z.object({
  plantId: z.string().min(1, 'Elige la planta.'),
  name: z.string().trim().min(2, 'Escribe el nombre del turno.').max(60),
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato de 24 horas HH:MM.'),
  endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato de 24 horas HH:MM.'),
  weekdays: z.array(z.number()).min(1, 'Elige al menos un día.'),
});

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function param(rules: AlertRule[] | undefined, type: string, name: string, fallback: number) {
  const value = rules?.find((rule) => rule.type === type)?.params[name];
  return String(typeof value === 'number' ? value : fallback);
}

function OperationStep({ onSaved }: { onSaved: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const clients = useClientOrgs();
  const rules = useQuery({
    queryKey: keys.alertRules,
    queryFn: () => api<AlertRule[]>('/alert-rules'),
  });
  const shifts = useQuery({ queryKey: keys.shifts, queryFn: () => api<Shift[]>('/shifts') });
  const [addingShift, setAddingShift] = useState(false);
  const form = useForm<z.input<typeof rulesSchema>, unknown, z.output<typeof rulesSchema>>({
    resolver: zodResolver(rulesSchema),
    defaultValues: { delay: '10', notStarted: '5', speed: '80', offRoute: '150' },
  });
  const shiftForm = useForm<z.infer<typeof shiftSchema>>({
    resolver: zodResolver(shiftSchema),
    defaultValues: {
      plantId: '',
      name: '',
      startsAt: '06:00',
      endsAt: '15:00',
      weekdays: [1, 2, 3, 4, 5],
    },
  });
  useEffect(() => {
    if (rules.data) {
      form.reset({
        delay: param(rules.data, 'delay', 'toleranceMinutes', 10),
        notStarted: param(rules.data, 'trip_not_started', 'toleranceMinutes', 5),
        speed: param(rules.data, 'speeding', 'limitKmh', 80),
        offRoute: param(rules.data, 'off_route', 'thresholdMeters', 150),
      });
    }
  }, [rules.data, form]);

  const plants = (clients.data ?? []).flatMap((client) =>
    client.plants.map((plant) => ({ value: plant.id, label: `${client.name} · ${plant.name}` })),
  );
  const plantLabel = new Map(plants.map((plant) => [plant.value, plant.label]));

  const saveRules = form.handleSubmit(async (values) => {
    try {
      await api('/alert-rules/delay', {
        method: 'PUT',
        body: { params: { toleranceMinutes: values.delay } },
      });
      await api('/alert-rules/trip_not_started', {
        method: 'PUT',
        body: { params: { toleranceMinutes: values.notStarted } },
      });
      await api('/alert-rules/speeding', {
        method: 'PUT',
        body: { params: { limitKmh: values.speed } },
      });
      await api('/alert-rules/off_route', {
        method: 'PUT',
        body: { params: { thresholdMeters: values.offRoute } },
      });
      toast.success('Reglas de operación guardadas');
      await queryClient.invalidateQueries({ queryKey: keys.alertRules });
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  const saveShift = shiftForm.handleSubmit(async (values) => {
    try {
      await api('/shifts', { method: 'POST', body: values });
      toast.success(`Turno ${values.name} agregado`);
      await queryClient.invalidateQueries({ queryKey: keys.shifts });
      await onSaved();
      setAddingShift(false);
      shiftForm.reset();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <div className="grid gap-6">
      <Form {...form}>
        <form
          onSubmit={(event) => void saveRules(event)}
          className="grid gap-4 sm:grid-cols-2"
          noValidate
        >
          <TextField
            control={form.control}
            name="delay"
            label="Alerta de retraso después de (min)"
            inputMode="numeric"
          />
          <TextField
            control={form.control}
            name="notStarted"
            label="Viaje sin iniciar después de (min)"
            inputMode="numeric"
          />
          <TextField
            control={form.control}
            name="speed"
            label="Velocidad máxima (km/h)"
            inputMode="numeric"
          />
          <TextField
            control={form.control}
            name="offRoute"
            label="Desvío a partir de (metros)"
            inputMode="numeric"
          />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Guardar reglas
            </Button>
          </div>
        </form>
      </Form>

      <section>
        <div className="flex items-center justify-between pb-2">
          <h3 className="text-sm font-semibold">Turnos por planta</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={plants.length === 0}
            onClick={() => setAddingShift(true)}
          >
            <PlusIcon className="size-4" />
            Turno
          </Button>
        </div>
        {plants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Los turnos son de cada planta: registra primero tus clientes y plantas (paso 4).
          </p>
        ) : (shifts.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Sin turnos todavía.</p>
        ) : (
          <ul className="grid gap-1.5 text-sm">
            {shifts.data?.map((shift) => (
              <li key={shift.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{shift.name}</span>
                <span className="font-mono tabular">
                  {shift.startsAt}–{shift.endsAt}
                </span>
                <span className="text-muted-foreground">{plantLabel.get(shift.plantId)}</span>
                <span className="text-muted-foreground">
                  {shift.weekdays.map((day) => WEEKDAYS[day]).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={addingShift} onOpenChange={setAddingShift}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo turno</DialogTitle>
            <DialogDescription>Hora de entrada y de salida de la planta.</DialogDescription>
          </DialogHeader>
          <Form {...shiftForm}>
            <form
              id="shift-form"
              onSubmit={(event) => void saveShift(event)}
              className="grid gap-4 sm:grid-cols-2"
              noValidate
            >
              <SelectField
                control={shiftForm.control}
                name="plantId"
                label="Planta"
                options={plants}
                className="sm:col-span-2"
              />
              <TextField
                control={shiftForm.control}
                name="name"
                label="Nombre"
                placeholder="Primer turno"
                className="sm:col-span-2"
              />
              <TextField control={shiftForm.control} name="startsAt" label="Entrada (HH:MM)" />
              <TextField control={shiftForm.control} name="endsAt" label="Salida (HH:MM)" />
              <FormField
                control={shiftForm.control}
                name="weekdays"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Días</FormLabel>
                    <FormControl>
                      <div className="flex flex-wrap gap-3">
                        {WEEKDAYS.map((label, day) => (
                          <label key={label} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={field.value.includes(day)}
                              onCheckedChange={(checked) =>
                                field.onChange(
                                  checked
                                    ? [...field.value, day].sort()
                                    : field.value.filter((value) => value !== day),
                                )
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddingShift(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="shift-form" disabled={shiftForm.formState.isSubmitting}>
              Agregar turno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Paso 3: flota -----------------------------------------------------------------------------

function FleetStep({ onSaved }: { onSaved: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState<'vehicles' | 'drivers' | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.vehicles });
    await queryClient.invalidateQueries({ queryKey: keys.drivers });
    await onSaved();
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          { kind: 'vehicles', title: 'Unidades', path: '/unidades' },
          { kind: 'drivers', title: 'Choferes', path: '/choferes' },
        ] as const
      ).map((item) => (
        <Card key={item.kind}>
          <CardContent className="grid gap-3 pt-5">
            <p className="font-semibold">{item.title}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setImporting(item.kind)}>
                <UploadSimpleIcon className="size-4" />
                Importar desde Excel
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to={item.path}>Dar de alta una por una</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <ImportDialog
        open={importing === 'vehicles'}
        onOpenChange={(next) => !next && setImporting(null)}
        title="Importar unidades"
        templatePath="/vehicles/import/template"
        templateName="plantilla-unidades.xlsx"
        importPath="/vehicles/import"
        onImported={() => void refresh()}
      />
      <ImportDialog
        open={importing === 'drivers'}
        onOpenChange={(next) => !next && setImporting(null)}
        title="Importar choferes"
        templatePath="/drivers/import/template"
        templateName="plantilla-choferes.xlsx"
        importPath="/drivers/import"
        onImported={() => void refresh()}
      />
    </div>
  );
}

// --- Paso 4: clientes --------------------------------------------------------------------------

function ClientsStep({ onSaved }: { onSaved: () => Promise<void> }) {
  const clients = useClientOrgs();
  const [creating, setCreating] = useState(false);
  return (
    <div className="grid gap-4">
      {(clients.data?.length ?? 0) > 0 && (
        <ul className="grid gap-2">
          {clients.data?.map((client) => (
            <li key={client.id}>
              <Link
                to={`/clientes/${client.id}`}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 hover:border-ring/70"
              >
                <BuildingsIcon className="size-5 text-muted-foreground" />
                <span className="flex-1">
                  <span className="font-medium">{client.name}</span>
                  <span className="ml-2 text-[13px] text-muted-foreground">
                    {client.plants.length === 1 ? '1 planta' : `${client.plants.length} plantas`}
                  </span>
                </span>
                <span className="text-[13px] text-muted-foreground">Puertas y QR</span>
                <ArrowRightIcon className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon className="size-4" />
          Nuevo cliente con su planta
        </Button>
      </div>
      <NewClientDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => void onSaved()}
      />
    </div>
  );
}

// --- Paso 6: invitar a la planta -------------------------------------------------------------

const inviteSchema = z.object({
  plantId: z.string().min(1, 'Elige la planta.'),
  fullName: z.string().trim().min(3, 'Escribe el nombre completo.').max(120),
  email: z.email({ message: 'Escribe un correo válido.' }).max(254),
  role: z.enum(['plant_logistics', 'plant_hr']),
});

function InviteStep({ onSaved }: { onSaved: () => Promise<void> }) {
  const clients = useClientOrgs();
  const plants = (clients.data ?? []).flatMap((client) =>
    client.plants.map((plant) => ({ value: plant.id, label: `${client.name} · ${plant.name}` })),
  );
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { plantId: '', fullName: '', email: '', role: 'plant_logistics' },
  });
  const submit = form.handleSubmit(async ({ plantId, ...body }) => {
    try {
      await api(`/plants/${plantId}/invitations`, { method: 'POST', body });
      toast.success(`Invitación enviada a ${body.email}`);
      form.reset({ plantId, fullName: '', email: '', role: body.role });
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });
  if (plants.length === 0) {
    return <p className="text-sm text-muted-foreground">Primero registra la planta (paso 4).</p>;
  }
  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-4 sm:grid-cols-2"
        noValidate
      >
        <SelectField
          control={form.control}
          name="plantId"
          label="Planta"
          options={plants}
          className="sm:col-span-2"
        />
        <TextField control={form.control} name="fullName" label="Nombre completo" />
        <TextField control={form.control} name="email" label="Correo" type="email" />
        <SelectField
          control={form.control}
          name="role"
          label="Rol"
          options={[
            { value: 'plant_logistics', label: 'Logística de planta' },
            { value: 'plant_hr', label: 'Recursos humanos de planta' },
          ]}
        />
        <div className="flex items-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Enviar invitación
          </Button>
        </div>
      </form>
    </Form>
  );
}

// --- Pasos 5, 7 y 8: guías -------------------------------------------------------------------

function DevicesStep() {
  const version = useQuery({
    queryKey: ['driver-app-version'],
    queryFn: () => api<{ downloadUrl: string | null }>('/driver/app-version', { anonymous: true }),
  });
  return (
    <ol className="grid gap-3 text-[15px]">
      <li>
        <span className="font-medium">1. Instala la app.</span>{' '}
        {version.data?.downloadUrl ? (
          <a href={version.data.downloadUrl} className="underline underline-offset-4">
            Descargar Shiftlane Chofer (APK)
          </a>
        ) : (
          'Pide el APK de Shiftlane Chofer a soporte (en la versión publicada aparece aquí el enlace).'
        )}
      </li>
      <li>
        <span className="font-medium">2. Genera el QR de alta</span> en{' '}
        <Link to="/choferes" className="underline underline-offset-4">
          Choferes
        </Link>{' '}
        (botón «QR de alta» en cada chofer).
      </li>
      <li>
        <span className="font-medium">3. El chofer lo escanea</span> desde «Vincular celular» y crea
        su PIN. La app revisa permisos, batería y GPS antes de su primer viaje.
      </li>
    </ol>
  );
}

function GuideStep({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 text-[15px]">{children}</div>;
}

// --- Página ----------------------------------------------------------------------------------

export function OnboardingPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const onboarding = useOnboarding();
  const [active, setActive] = useState<OnboardingStepKey | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.onboarding });

  if (onboarding.isLoading) return <LoadingRows rows={8} />;
  if (onboarding.isError || !onboarding.data) {
    return (
      <ErrorState
        message={errorMessage(onboarding.error)}
        onRetry={() => void onboarding.refetch()}
      />
    );
  }
  const { steps, completed, total } = onboarding.data;
  const firstPending = steps.find((step) => !step.done)?.key ?? 'test_trip';
  const current = active ?? firstPending;
  const info = STEPS.find((step) => step.key === current)!;
  const status = steps.find((step) => step.key === current)!;
  const index = STEPS.findIndex((step) => step.key === current);
  const percent = Math.round((completed / total) * 100);

  const mark = async (done: boolean) => {
    try {
      await api(`/onboarding/steps/${current}`, { method: 'PUT', body: { done } });
      await refresh();
      if (done && index < STEPS.length - 1) setActive(STEPS[index + 1]!.key);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const body: Record<OnboardingStepKey, ReactNode> = {
    company: <CompanyStep onSaved={refresh} />,
    operation: <OperationStep onSaved={refresh} />,
    fleet: <FleetStep onSaved={refresh} />,
    clients: <ClientsStep onSaved={refresh} />,
    routes: (
      <GuideStep>
        <p>Traza cada ruta en el mapa, ordena sus paradas y ponles horario por turno.</p>
        <div>
          <Button asChild variant="outline">
            <Link to="/rutas">Ir a Rutas</Link>
          </Button>
        </div>
      </GuideStep>
    ),
    plant_invite: <InviteStep onSaved={refresh} />,
    devices: <DevicesStep />,
    test_trip: (
      <GuideStep>
        <p>
          Programa un viaje extra para hoy en{' '}
          <Link to="/programacion" className="underline underline-offset-4">
            Programación
          </Link>
          , asígnale una unidad y un chofer con la app vinculada.
        </p>
        <p>
          El chofer hace el checklist, inicia el viaje, escanea a un pasajero y lo termina con el QR
          de la puerta. Cuando el viaje quede terminado, este paso se marca solo.
        </p>
      </GuideStep>
    ),
  };

  return (
    <>
      <PageHeader
        title="Configuración inicial"
        description="De cero a operar en ocho pasos. Puedes hacerlos en cualquier orden y volver cuando quieras."
      />
      <div className="mb-6">
        <div className="flex items-center justify-between pb-1.5 text-sm">
          <span className="font-medium">
            {completed} de {total} pasos listos
          </span>
          <span className="tabular text-muted-foreground">{percent}%</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Avance de la configuración"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Pasos">
          <ol className="grid gap-1">
            {STEPS.map((step, position) => {
              const state = steps.find((item) => item.key === step.key)!;
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => setActive(step.key)}
                    aria-current={step.key === current ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent',
                      step.key === current && 'bg-accent font-medium',
                    )}
                  >
                    {state.done ? (
                      <CheckCircleIcon
                        className="size-5 shrink-0 text-success"
                        weight="fill"
                        aria-label="Listo"
                      />
                    ) : (
                      <CircleIcon
                        className="size-5 shrink-0 text-muted-foreground"
                        aria-label="Pendiente"
                      />
                    )}
                    <span className="flex-1">
                      {position + 1}. {step.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <Card>
          <CardContent className="grid gap-5 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Paso {index + 1} de {total}
                </p>
                <h2 className="text-xl font-semibold tracking-tight">{info.title}</h2>
                <p className="mt-1 max-w-[65ch] text-muted-foreground">{info.summary}</p>
              </div>
              {status.done && (
                <Badge variant="success">
                  <CheckCircleIcon weight="fill" />
                  {status.markedManually ? 'Marcado como hecho' : 'Listo'}
                </Badge>
              )}
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <div className="min-w-0">{body[current]}</div>
              <VideoCard step={info} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              {can('settings.manage') &&
                (status.markedManually ? (
                  <Button variant="ghost" size="sm" onClick={() => void mark(false)}>
                    Desmarcar
                  </Button>
                ) : status.done ? (
                  <span />
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void mark(true)}>
                    Lo haré después (marcar como hecho)
                  </Button>
                ))}
              {index < STEPS.length - 1 ? (
                <Button onClick={() => setActive(STEPS[index + 1]!.key)}>
                  Siguiente paso
                  <ArrowRightIcon className="size-4" />
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/">Ir al inicio</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
