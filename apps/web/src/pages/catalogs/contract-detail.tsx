import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeftIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import {
  formatMxn,
  PENALTY_TYPE_LABELS,
  PENALTY_TYPES,
  RATE_BASES,
  RATE_BASIS_LABELS,
} from '@shiftlane/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { ConfirmDialog, errorMessage } from '@/components/catalog';
import { ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/fields';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
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
  Checkbox,
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
import { keys } from '@/lib/resources';
import type { ContractDetail, Penalty, Rate } from '@/lib/resources';
import { z } from '@/lib/zod';

import {
  ALL_PLANTS,
  contractBody,
  ContractFields,
  contractSchema,
  contractStatusInfo,
} from './contracts';
import type { ContractForm } from './contracts';

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const optionalNumber = (max: number, message: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        value === '' ||
        (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= max),
      message,
    );

const optionalTime = z
  .string()
  .refine(
    (value) => value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    'Usa el formato de 24 horas HH:MM.',
  );

const rateSchema = z
  .object({
    name: z.string().trim().max(80),
    basis: z.enum(RATE_BASES),
    amount: z
      .string()
      .trim()
      .min(1, 'Escribe el monto.')
      .refine(
        (value) => /^\d+(\.\d{1,2})?$/.test(value),
        'Escribe el monto con máximo dos decimales.',
      ),
    routeId: z.string(),
    weekdays: z.array(z.number()),
    startTime: optionalTime,
    endTime: optionalTime,
    minCapacity: optionalNumber(120, 'Entre 1 y 120 asientos.'),
    maxCapacity: optionalNumber(120, 'Entre 1 y 120 asientos.'),
    minimumCharge: optionalNumber(10_000_000, 'Escribe un monto válido.'),
    priority: z.string().trim(),
  })
  .refine((body) => Boolean(body.startTime) === Boolean(body.endTime), {
    message: 'Indica hora de inicio y de fin del horario.',
    path: ['endTime'],
  })
  .refine((body) => body.basis !== 'per_route' || body.routeId !== '', {
    message: 'Una tarifa por ruta necesita la ruta.',
    path: ['routeId'],
  });

type RateForm = z.infer<typeof rateSchema>;

const penaltySchema = z
  .object({
    type: z.enum(PENALTY_TYPES),
    description: z.string().trim().max(300),
    amountType: z.enum(['fixed', 'percent']),
    amount: z
      .string()
      .trim()
      .refine(
        (value) => /^\d+(\.\d{1,2})?$/.test(value),
        'Escribe el monto con máximo dos decimales.',
      ),
    graceMinutes: optionalNumber(240, 'Entre 0 y 240 minutos.'),
  })
  .refine((body) => body.amountType !== 'percent' || Number(body.amount) <= 100, {
    message: 'El porcentaje no puede ser mayor a 100.',
    path: ['amount'],
  });

type PenaltyForm = z.infer<typeof penaltySchema>;

const toNumber = (value: string) => (value === '' ? null : Number(value));

/** Resumen legible de cuándo aplica una tarifa. */
function rateConditions(rate: Rate, routes: Map<string, string>) {
  const parts: string[] = [];
  if (rate.routeId) parts.push(`Ruta ${routes.get(rate.routeId) ?? ''}`.trim());
  if (rate.weekdays.length > 0 && rate.weekdays.length < 7) {
    parts.push(rate.weekdays.map((day) => WEEKDAYS[day]).join(', '));
  }
  if (rate.startTime && rate.endTime) parts.push(`${rate.startTime}–${rate.endTime}`);
  if (rate.holidays) parts.push('Festivos');
  if (rate.minCapacity || rate.maxCapacity) {
    parts.push(`${rate.minCapacity ?? 1}–${rate.maxCapacity ?? 120} asientos`);
  }
  if (rate.minimumCharge) parts.push(`Mínimo ${formatMxn(rate.minimumCharge)}`);
  return parts.join(' · ') || 'Siempre';
}

function RateDialog({
  contractId,
  open,
  onOpenChange,
  routes,
  onSaved,
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routes: { id: string; code: string; name: string }[];
  onSaved: () => Promise<void>;
}) {
  const defaults: RateForm = {
    name: '',
    basis: 'per_trip',
    amount: '',
    routeId: '',
    weekdays: [],
    startTime: '',
    endTime: '',
    minCapacity: '',
    maxCapacity: '',
    minimumCharge: '',
    priority: '0',
  };
  const form = useForm<RateForm>({ resolver: zodResolver(rateSchema), defaultValues: defaults });
  const basis = useWatch({ control: form.control, name: 'basis' });
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await api(`/contracts/${contractId}/rates`, {
        method: 'POST',
        body: {
          name: values.name,
          basis: values.basis,
          amount: Number(values.amount),
          routeId: values.basis === 'per_route' ? values.routeId : null,
          weekdays: values.weekdays,
          startTime: values.startTime || null,
          endTime: values.endTime || null,
          minCapacity: toNumber(values.minCapacity),
          maxCapacity: toNumber(values.maxCapacity),
          minimumCharge: toNumber(values.minimumCharge),
          priority: Number(values.priority || 0),
        },
      });
      toast.success('Tarifa agregada');
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva tarifa</DialogTitle>
          <DialogDescription>
            Si varias tarifas aplican a un viaje, gana la de mayor prioridad (y luego la más
            específica).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="rate-form"
            onSubmit={(event) => void submit(event)}
            className="grid gap-4 sm:grid-cols-2"
            noValidate
          >
            <SelectField
              control={form.control}
              name="basis"
              label="Cobro"
              options={RATE_BASES.map((value) => ({ value, label: RATE_BASIS_LABELS[value] }))}
            />
            <TextField
              control={form.control}
              name="amount"
              label="Monto (MXN)"
              inputMode="decimal"
              placeholder="1250.00"
            />
            {basis === 'per_route' && (
              <SelectField
                control={form.control}
                name="routeId"
                label="Ruta"
                className="sm:col-span-2"
                options={routes.map((route) => ({
                  value: route.id,
                  label: `${route.code} · ${route.name}`,
                }))}
                placeholder={routes.length === 0 ? 'Todavía no hay rutas' : 'Elige la ruta'}
              />
            )}
            <TextField
              control={form.control}
              name="name"
              label="Nombre (opcional)"
              placeholder="Turno nocturno"
              className="sm:col-span-2"
            />
            <FormField
              control={form.control}
              name="weekdays"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Días (ninguno = todos)</FormLabel>
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
                </FormItem>
              )}
            />
            <TextField
              control={form.control}
              name="startTime"
              label="Desde (HH:MM)"
              placeholder="22:00"
            />
            <TextField
              control={form.control}
              name="endTime"
              label="Hasta (HH:MM)"
              placeholder="06:00"
            />
            <TextField
              control={form.control}
              name="minCapacity"
              label="Unidad desde (asientos)"
              inputMode="numeric"
            />
            <TextField
              control={form.control}
              name="maxCapacity"
              label="Unidad hasta (asientos)"
              inputMode="numeric"
            />
            <TextField
              control={form.control}
              name="minimumCharge"
              label="Cobro mínimo (MXN)"
              inputMode="decimal"
            />
            <TextField
              control={form.control}
              name="priority"
              label="Prioridad"
              inputMode="numeric"
            />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="rate-form" disabled={form.formState.isSubmitting}>
            Agregar tarifa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PenaltyDialog({
  contractId,
  open,
  onOpenChange,
  onSaved,
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const defaults: PenaltyForm = {
    type: 'late_arrival',
    description: '',
    amountType: 'fixed',
    amount: '',
    graceMinutes: '',
  };
  const form = useForm<PenaltyForm>({
    resolver: zodResolver(penaltySchema),
    defaultValues: defaults,
  });
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open]);
  const submit = form.handleSubmit(async (values) => {
    try {
      await api(`/contracts/${contractId}/penalties`, {
        method: 'POST',
        body: {
          ...values,
          amount: Number(values.amount),
          graceMinutes: toNumber(values.graceMinutes),
        },
      });
      toast.success('Penalización agregada');
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva penalización</DialogTitle>
          <DialogDescription>
            Se descuenta en la conciliación cuando el viaje lo amerita.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="penalty-form"
            onSubmit={(event) => void submit(event)}
            className="grid gap-4 sm:grid-cols-2"
            noValidate
          >
            <SelectField
              control={form.control}
              name="type"
              label="Motivo"
              className="sm:col-span-2"
              options={PENALTY_TYPES.map((value) => ({ value, label: PENALTY_TYPE_LABELS[value] }))}
            />
            <SelectField
              control={form.control}
              name="amountType"
              label="Tipo de monto"
              options={[
                { value: 'fixed', label: 'Monto fijo (MXN)' },
                { value: 'percent', label: 'Porcentaje del viaje' },
              ]}
            />
            <TextField control={form.control} name="amount" label="Monto" inputMode="decimal" />
            <TextField
              control={form.control}
              name="graceMinutes"
              label="Tolerancia (minutos)"
              inputMode="numeric"
              description="Solo para llegada tarde."
            />
            <TextField
              control={form.control}
              name="description"
              label="Descripción"
              className="sm:col-span-2"
            />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="penalty-form" disabled={form.formState.isSubmitting}>
            Agregar penalización
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditContractDialog({
  contract,
  open,
  onOpenChange,
  onSaved,
}: {
  contract: ContractDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const defaults: ContractForm = {
    clientOrgId: contract.clientOrgId,
    plantId: contract.plantId ?? ALL_PLANTS,
    name: contract.name,
    number: contract.number ?? '',
    status: contract.status,
    startsOn: contract.startsOn,
    endsOn: contract.endsOn ?? '',
    notes: contract.notes ?? '',
  };
  const form = useForm<ContractForm>({
    resolver: zodResolver(contractSchema),
    defaultValues: defaults,
  });
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open]);
  const submit = form.handleSubmit(async (values) => {
    try {
      const { clientOrgId: _clientOrgId, ...changes } = contractBody(values);
      await api(`/contracts/${contract.id}`, { method: 'PATCH', body: changes });
      toast.success('Contrato actualizado');
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar contrato</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            id="edit-contract"
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
          <Button type="submit" form="edit-contract" disabled={form.formState.isSubmitting}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContractDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const canWrite = can('contracts.write');
  const queryClient = useQueryClient();
  const contract = useQuery({
    queryKey: keys.contract(id),
    queryFn: () => api<ContractDetail>(`/contracts/${id}`),
  });
  const routes = useQuery({
    queryKey: ['routes'],
    queryFn: () => api<{ id: string; code: string; name: string; plantId: string }[]>('/routes'),
  });
  const [dialog, setDialog] = useState<'edit' | 'rate' | 'penalty' | null>(null);
  const [removing, setRemoving] = useState<{ kind: 'rate' | 'penalty'; id: string } | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.contract(id) });
    await queryClient.invalidateQueries({ queryKey: keys.contracts });
  };

  if (contract.isLoading) return <LoadingRows rows={6} />;
  if (contract.isError || !contract.data) {
    return (
      <ErrorState message={errorMessage(contract.error)} onRetry={() => void contract.refetch()} />
    );
  }
  const data = contract.data;
  const status = contractStatusInfo[data.status];
  const routeNames = new Map((routes.data ?? []).map((route) => [route.id, route.code]));

  return (
    <>
      <Link
        to="/contratos"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Contratos y tarifas
      </Link>
      <PageHeader
        title={data.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {data.clientOrgName}
            <Badge variant={status.variant}>{status.label}</Badge>
            <span className="tabular">
              {data.startsOn} → {data.endsOn ?? 'sin fin'}
            </span>
          </span>
        }
        actions={
          canWrite && (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilSimpleIcon className="size-4" />
              Editar
            </Button>
          )
        }
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Tarifas</CardTitle>
              <CardDescription>
                Cuánto se cobra por cada viaje según la ruta, el horario o la unidad.
              </CardDescription>
            </div>
            {canWrite && (
              <Button size="sm" onClick={() => setDialog('rate')}>
                <PlusIcon className="size-4" />
                Tarifa
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {data.rates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin tarifas: agrega al menos una para poder cobrar.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cobro</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Cuándo aplica</TableHead>
                    <TableHead className="text-right">Prioridad</TableHead>
                    {canWrite && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rates.map((rate) => (
                    <TableRow key={rate.id}>
                      <TableCell>
                        <span className="font-medium">{RATE_BASIS_LABELS[rate.basis]}</span>
                        {rate.name && (
                          <span className="block text-[13px] text-muted-foreground">
                            {rate.name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMxn(rate.amount)}
                      </TableCell>
                      <TableCell>{rateConditions(rate, routeNames)}</TableCell>
                      <TableCell className="text-right">{rate.priority}</TableCell>
                      {canWrite && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="Quitar tarifa"
                            onClick={() => setRemoving({ kind: 'rate', id: rate.id })}
                          >
                            <TrashIcon className="size-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Penalizaciones</CardTitle>
              <CardDescription>
                Lo acordado si el servicio llega tarde, no se realiza o queda incompleto.
              </CardDescription>
            </div>
            {canWrite && (
              <Button size="sm" variant="outline" onClick={() => setDialog('penalty')}>
                <PlusIcon className="size-4" />
                Penalización
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {data.penalties.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin penalizaciones acordadas.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Tolerancia</TableHead>
                    {canWrite && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.penalties.map((penalty: Penalty) => (
                    <TableRow key={penalty.id}>
                      <TableCell>
                        <span className="font-medium">{PENALTY_TYPE_LABELS[penalty.type]}</span>
                        {penalty.description && (
                          <span className="block text-[13px] text-muted-foreground">
                            {penalty.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {penalty.amountType === 'percent'
                          ? `${penalty.amount}%`
                          : formatMxn(penalty.amount)}
                      </TableCell>
                      <TableCell>
                        {penalty.graceMinutes !== null ? `${penalty.graceMinutes} min` : '—'}
                      </TableCell>
                      {canWrite && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="Quitar penalización"
                            onClick={() => setRemoving({ kind: 'penalty', id: penalty.id })}
                          >
                            <TrashIcon className="size-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <EditContractDialog
        contract={data}
        open={dialog === 'edit'}
        onOpenChange={(next) => !next && setDialog(null)}
        onSaved={refresh}
      />
      <RateDialog
        contractId={id}
        open={dialog === 'rate'}
        onOpenChange={(next) => !next && setDialog(null)}
        routes={(routes.data ?? []).filter(
          (route) => !data.plantId || route.plantId === data.plantId,
        )}
        onSaved={refresh}
      />
      <PenaltyDialog
        contractId={id}
        open={dialog === 'penalty'}
        onOpenChange={(next) => !next && setDialog(null)}
        onSaved={refresh}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={removing?.kind === 'rate' ? '¿Quitar esta tarifa?' : '¿Quitar esta penalización?'}
        description="Los viajes ya conciliados conservan lo que se calculó."
        confirmLabel="Quitar"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await api(
            removing.kind === 'rate' ? `/rates/${removing.id}` : `/penalties/${removing.id}`,
            { method: 'DELETE' },
          );
          toast.success('Listo');
          await refresh();
        }}
      />
    </>
  );
}
