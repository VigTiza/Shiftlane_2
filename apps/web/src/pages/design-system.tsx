import { zodResolver } from '@hookform/resolvers/zod';
import {
  BusIcon,
  CheckCircleIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { DataTable, inValues } from '@/components/data-table/data-table';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/controls';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/overlays';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Switch,
} from '@/components/ui/primitives';
import type { BadgeVariant } from '@/components/ui/primitives';
import { z } from '@/lib/zod';

// --- Fundamentos -------------------------------------------------------------------------

const colorGroups: { title: string; tokens: { name: string; role: string }[] }[] = [
  {
    title: 'Marca',
    tokens: [
      { name: 'sidebar', role: 'Azul marino de carretera: marco del panel' },
      { name: 'primary', role: 'Ámbar de carril: la única acción principal' },
      { name: 'primary-foreground', role: 'Texto sobre ámbar' },
    ],
  },
  {
    title: 'Superficies',
    tokens: [
      { name: 'background', role: 'Fondo de la página' },
      { name: 'card', role: 'Tarjetas, tablas y formularios' },
      { name: 'muted', role: 'Zonas secundarias y encabezados de tabla' },
      { name: 'border', role: 'Separadores y bordes' },
      { name: 'foreground', role: 'Texto principal' },
      { name: 'muted-foreground', role: 'Texto de apoyo' },
    ],
  },
  {
    title: 'Estado (solo para estados)',
    tokens: [
      { name: 'success', role: 'En orden, a tiempo' },
      { name: 'warning', role: 'Atención: retraso, por vencer' },
      { name: 'danger', role: 'Problema: pánico, vencido, rechazado' },
      { name: 'info', role: 'Informativo' },
    ],
  },
];

function Swatch({ name, role }: { name: string; role: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className="size-10 shrink-0 rounded-md border border-border"
        style={{ backgroundColor: `var(--${name})` }}
      />
      <span className="min-w-0">
        <span className="block font-mono text-[13px]">--{name}</span>
        <span className="block text-[13px] text-muted-foreground">{role}</span>
      </span>
    </li>
  );
}

const typeScale = [
  {
    label: 'Título de pantalla',
    className: 'text-2xl font-semibold tracking-tight',
    sample: 'Programación de la semana',
  },
  {
    label: 'Título de sección',
    className: 'text-[17px] font-semibold',
    sample: 'Viajes sin chofer',
  },
  {
    label: 'Texto',
    className: 'text-[15px]',
    sample: 'La unidad U-014 salió 8 minutos tarde de la primera parada.',
  },
  {
    label: 'Tablas y controles',
    className: 'text-sm',
    sample: 'Ruta R-01 · Riberas · 24 pasajeros',
  },
  {
    label: 'Apoyo',
    className: 'text-[13px] text-muted-foreground',
    sample: 'Actualizado hace 2 minutos',
  },
  {
    label: 'Etiqueta',
    className: 'text-[11px] font-semibold tracking-wider uppercase text-muted-foreground',
    sample: 'Estado',
  },
  {
    label: 'Datos (mono, tabulares)',
    className: 'font-mono text-sm tabular',
    sample: 'U-014  ABC-12-34  05:45  $1,280.00',
  },
];

// --- Tabla de ejemplo ----------------------------------------------------------------------

type VehicleStatus = 'active' | 'maintenance' | 'out';

interface DemoVehicle {
  id: string;
  number: string;
  plates: string;
  type: string;
  capacity: number;
  status: VehicleStatus;
  nextService: string;
}

const statusInfo: Record<VehicleStatus, { label: string; variant: BadgeVariant }> = {
  active: { label: 'En servicio', variant: 'success' },
  maintenance: { label: 'En taller', variant: 'warning' },
  out: { label: 'Fuera de servicio', variant: 'danger' },
};

const types = ['Sprinter', 'Autobús', 'Van'];

const demoVehicles: DemoVehicle[] = Array.from({ length: 36 }, (_, i) => {
  const status: VehicleStatus = i % 9 === 4 ? 'out' : i % 5 === 2 ? 'maintenance' : 'active';
  const day = ((i * 7) % 27) + 1;
  return {
    id: `v${i}`,
    number: `U-${String(i + 1).padStart(3, '0')}`,
    plates: `${'ABCDEFGH'[i % 8]}${'KLMNPRST'[(i * 3) % 8]}${'WXYZ'[i % 4]}-${String(10 + ((i * 13) % 89)).padStart(2, '0')}-${String(10 + ((i * 7) % 89)).padStart(2, '0')}`,
    type: types[i % 3]!,
    capacity: [19, 44, 15][i % 3]!,
    status,
    nextService: `2026-${String(10 + (i % 3)).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
});

const vehicleColumns: ColumnDef<DemoVehicle, unknown>[] = [
  {
    accessorKey: 'number',
    header: 'Unidad',
    cell: ({ row }) => <span className="font-mono font-medium">{row.original.number}</span>,
  },
  {
    accessorKey: 'plates',
    header: 'Placas',
    cell: ({ row }) => <span className="font-mono">{row.original.plates}</span>,
  },
  { accessorKey: 'type', header: 'Tipo', filterFn: inValues },
  {
    accessorKey: 'capacity',
    header: 'Asientos',
    meta: { className: 'text-right' },
    enableGlobalFilter: false,
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    filterFn: inValues,
    enableGlobalFilter: false,
    cell: ({ row }) => {
      const info = statusInfo[row.original.status];
      return <Badge variant={info.variant}>{info.label}</Badge>;
    },
  },
  {
    accessorKey: 'nextService',
    header: 'Próximo servicio',
    enableGlobalFilter: false,
    cell: ({ row }) => <span className="tabular">{row.original.nextService}</span>,
  },
];

// --- Formulario de ejemplo -----------------------------------------------------------------

const vehicleFormSchema = z.object({
  number: z.string().trim().min(1, 'Escribe el número económico.').max(20),
  plates: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{5,10}$/i, 'Las placas llevan de 5 a 10 letras, números o guiones.'),
  capacity: z.coerce
    .number<string>({ message: 'Escribe un número.' })
    .int('Escribe un número entero.')
    .min(1, 'Debe tener al menos 1 asiento.')
    .max(120, 'Máximo 120 asientos.'),
  type: z.string().min(1, 'Elige el tipo de unidad.'),
  gps: z.boolean(),
});

type VehicleFormInput = z.input<typeof vehicleFormSchema>;
type VehicleForm = z.output<typeof vehicleFormSchema>;

function DemoForm() {
  const form = useForm<VehicleFormInput, unknown, VehicleForm>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: { number: '', plates: '', capacity: '', type: '', gps: true },
  });
  const submit = form.handleSubmit((values) => {
    toast.success(`Unidad ${values.number} guardada`, {
      description: `${values.type}, ${values.capacity} asientos.`,
    });
    form.reset();
  });
  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-4 sm:grid-cols-2"
        noValidate
      >
        <FormField
          control={form.control}
          name="number"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Número económico</FormLabel>
              <FormControl>
                <Input placeholder="U-015" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="plates"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Placas</FormLabel>
              <FormControl>
                <Input placeholder="ABC-12-34" className="font-mono uppercase" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Elige uno" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {types.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Asientos</FormLabel>
              <FormControl>
                <Input inputMode="numeric" {...field} />
              </FormControl>
              <FormDescription>Sin contar al chofer.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="gps"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 sm:col-span-2">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="!mt-0">Rastrear con el celular del chofer</FormLabel>
            </FormItem>
          )}
        />
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit">
            <PlusIcon className="size-4" />
            Guardar unidad
          </Button>
          <Button type="button" variant="ghost" onClick={() => form.reset()}>
            Limpiar
          </Button>
        </div>
      </form>
    </Form>
  );
}

// --- Página ------------------------------------------------------------------------------

export function DesignSystemPage() {
  return (
    <>
      <PageHeader
        title="Sistema de diseño"
        description="Colores, tipografía y componentes del panel. Cada pantalla nueva se arma con estas piezas."
      />
      <Tabs defaultValue="fundamentos">
        <TabsList>
          <TabsTrigger value="fundamentos">Fundamentos</TabsTrigger>
          <TabsTrigger value="componentes">Componentes</TabsTrigger>
          <TabsTrigger value="tabla">Tabla con filtros</TabsTrigger>
          <TabsTrigger value="estados">Estados</TabsTrigger>
        </TabsList>

        <TabsContent value="fundamentos" className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Color</CardTitle>
              <CardDescription>
                Un solo color de acción (ámbar). Los colores de estado solo indican estado.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {colorGroups.map((group) => (
                <div key={group.title}>
                  <p className="pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {group.title}
                  </p>
                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {group.tokens.map((token) => (
                      <Swatch key={token.name} {...token} />
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tipografía</CardTitle>
              <CardDescription>
                IBM Plex Sans para leer rápido; Plex Mono con cifras tabulares para placas, horas e
                importes.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {typeScale.map((item) => (
                <div key={item.label} className="border-b border-border pb-3 last:border-0">
                  <p className="pb-1 text-xs text-muted-foreground">{item.label}</p>
                  <p className={item.className}>{item.sample}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="componentes" className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Botones</CardTitle>
              <CardDescription>
                Una acción principal por pantalla; el resto, secundarias.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button>Guardar</Button>
              <Button variant="secondary">Exportar</Button>
              <Button variant="outline">Filtrar</Button>
              <Button variant="ghost">Cancelar</Button>
              <Button variant="destructive">Dar de baja</Button>
              <Button variant="link">Ver detalle</Button>
              <Button size="sm">Chico</Button>
              <Button size="lg">Grande</Button>
              <Button disabled>Deshabilitado</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Insignias de estado</CardTitle>
              <CardDescription>Siempre con texto: el color solo refuerza.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="success">
                <CheckCircleIcon weight="fill" /> A tiempo
              </Badge>
              <Badge variant="warning">
                <WarningIcon weight="fill" /> 12 min tarde
              </Badge>
              <Badge variant="danger">
                <XCircleIcon weight="fill" /> Licencia vencida
              </Badge>
              <Badge variant="info">Programado</Badge>
              <Badge>Borrador</Badge>
              <Badge variant="outline">Extra</Badge>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Formulario</CardTitle>
              <CardDescription>
                React Hook Form + Zod: los errores salen en español junto a cada campo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DemoForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Diálogo de confirmación</CardTitle>
              <CardDescription>Para acciones que no se pueden deshacer.</CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <TrashIcon className="size-4" />
                    Dar de baja U-014
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>¿Dar de baja la unidad U-014?</DialogTitle>
                    <DialogDescription>
                      Sus viajes programados quedarán sin unidad y aparecerán en conflictos.
                    </DialogDescription>
                  </DialogHeader>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox defaultChecked /> Avisar al despachador de turno
                  </label>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="ghost">Cancelar</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button
                        variant="destructive"
                        onClick={() => toast.success('Unidad U-014 dada de baja')}
                      >
                        Dar de baja
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Avisos</CardTitle>
              <CardDescription>Confirman lo que pasó, sin interrumpir.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => toast.success('Viaje asignado a U-014')}>
                Éxito
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  toast.error('No se pudo asignar', {
                    description: 'El chofer ya tiene un viaje a esa hora.',
                  })
                }
              >
                Error
              </Button>
              <Button variant="outline" onClick={() => toast('La ruta R-01 cambió')}>
                Informativo
              </Button>
              <div className="flex items-center gap-2 pl-2">
                <Checkbox id="demo-check" />
                <Label htmlFor="demo-check">Casilla</Label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tabla">
          <DataTable
            columns={vehicleColumns}
            data={demoVehicles}
            searchPlaceholder="Buscar por unidad o placas…"
            pageSize={10}
            filters={[
              {
                columnId: 'status',
                title: 'Estado',
                options: Object.entries(statusInfo).map(([value, info]) => ({
                  value,
                  label: info.label,
                })),
              },
              {
                columnId: 'type',
                title: 'Tipo',
                options: types.map((type) => ({ value: type, label: type })),
              },
            ]}
            toolbar={
              <Button size="sm">
                <PlusIcon className="size-4" />
                Nueva unidad
              </Button>
            }
          />
        </TabsContent>

        <TabsContent value="estados" className="grid gap-6 lg:grid-cols-3">
          <EmptyState
            icon={BusIcon}
            title="Todavía no hay unidades"
            description="Da de alta tu primera unidad o impórtalas desde Excel."
            action={<Button size="sm">Nueva unidad</Button>}
          />
          <Card>
            <CardHeader>
              <CardTitle>Cargando</CardTitle>
              <CardDescription>La forma de lo que viene.</CardDescription>
            </CardHeader>
            <CardContent>
              <LoadingRows rows={4} columns={3} />
            </CardContent>
          </Card>
          <ErrorState
            message="No hay conexión con el servidor. Revisa tu internet."
            onRetry={() => toast('Reintentando…')}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
