// Piezas comunes de los catálogos: importar Excel con vista previa, confirmar acciones,
// mostrar códigos QR y etiquetas de estado.
import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileXlsIcon,
  UploadSimpleIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { DRIVER_STATUS_LABELS, VEHICLE_STATUS_LABELS } from '@shiftlane/shared';
import type { DriverStatus, VehicleStatus } from '@shiftlane/shared';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';

import { apiUpload, ApiError, downloadFile } from '@/lib/api';
import type { ImportReport } from '@/lib/resources';
import { cn } from '@/lib/utils';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/overlays';
import { Badge } from './ui/primitives';
import type { BadgeVariant } from './ui/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Algo salió mal; intenta de nuevo.';
}

// --- Estados -----------------------------------------------------------------------------

const vehicleVariant: Record<VehicleStatus, BadgeVariant> = {
  available: 'success',
  on_route: 'info',
  maintenance: 'warning',
  out_of_service: 'danger',
};

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  return <Badge variant={vehicleVariant[status]}>{VEHICLE_STATUS_LABELS[status]}</Badge>;
}

export function DriverStatusBadge({ status }: { status: DriverStatus }) {
  return (
    <Badge variant={status === 'active' ? 'success' : 'neutral'}>
      {DRIVER_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Documentos vencidos o por vencer (en orden: nada que mostrar si todo está bien). */
export function DocumentsBadge({ expired, expiring }: { expired: number; expiring: number }) {
  if (expired > 0) {
    return (
      <Badge variant="danger">
        <WarningIcon weight="fill" />
        {expired === 1 ? '1 vencido' : `${expired} vencidos`}
      </Badge>
    );
  }
  if (expiring > 0) {
    return (
      <Badge variant="warning">{expiring === 1 ? '1 por vencer' : `${expiring} por vencer`}</Badge>
    );
  }
  return <span className="text-[13px] text-muted-foreground">En orden</span>;
}

// --- Confirmación --------------------------------------------------------------------------

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onOpenChange(false);
                } catch (error) {
                  toast.error(errorMessage(error));
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Importar desde Excel -------------------------------------------------------------------

/**
 * Importación en dos pasos: primero se valida el archivo y se muestra qué pasaría (sin
 * guardar); luego se confirma. Es todo o nada: con errores no se guarda ninguna fila.
 */
export function ImportDialog({
  open,
  onOpenChange,
  title,
  templatePath,
  templateName,
  importPath,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  templatePath: string;
  templateName: string;
  importPath: string;
  onImported: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setReport(null);
    setError(null);
    if (input.current) input.current.value = '';
  };

  const preview = async (chosen: File) => {
    setFile(chosen);
    setReport(null);
    setError(null);
    setBusy(true);
    try {
      setReport(await apiUpload<ImportReport>(`${importPath}?dryRun=true`, chosen));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await apiUpload<ImportReport>(`${importPath}?dryRun=false`, file);
      toast.success(`Listo: ${result.created} nuevos y ${result.updated} actualizados.`);
      onImported();
      reset();
      onOpenChange(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const canApply = report && report.errors.length === 0 && report.totalRows > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Llena la plantilla y súbela. Primero verás qué se va a guardar; nada cambia hasta que lo
            confirmes.
          </DialogDescription>
        </DialogHeader>

        <ol className="grid gap-3 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5">
            <span>
              <span className="font-medium">1.</span> Descarga la plantilla de Excel.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void downloadFile(templatePath, templateName).catch((failure: unknown) =>
                  toast.error(errorMessage(failure)),
                )
              }
            >
              <DownloadSimpleIcon className="size-4" />
              Plantilla
            </Button>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5">
            <span className="min-w-0">
              <span className="font-medium">2.</span> Sube el archivo lleno.
              {file && (
                <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
                  <FileXlsIcon className="size-4" />
                  {file.name}
                </span>
              )}
            </span>
            <input
              ref={input}
              type="file"
              accept=".xlsx"
              className="sr-only"
              aria-label="Archivo de Excel"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                // Se limpia para que, al corregir el archivo, elegir el mismo nombre vuelva a revisarlo.
                event.target.value = '';
                if (chosen) void preview(chosen);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <UploadSimpleIcon className="size-4" />
              Elegir archivo
            </Button>
          </li>
        </ol>

        {busy && <p className="text-sm text-muted-foreground">Revisando el archivo…</p>}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}

        {report && (
          <div className="grid gap-3" aria-live="polite">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="neutral">{report.totalRows} filas</Badge>
              <Badge variant="success">{report.created} nuevas</Badge>
              <Badge variant="info">{report.updated} se actualizan</Badge>
              {report.errors.length > 0 && (
                <Badge variant="danger">{report.errors.length} con error</Badge>
              )}
            </div>
            {report.errors.length > 0 ? (
              <div className="max-h-60 overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Fila</TableHead>
                      <TableHead className="w-40">Columna</TableHead>
                      <TableHead>Qué corregir</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.errors.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="tabular">{item.row}</TableCell>
                        <TableCell>{item.column ?? '—'}</TableCell>
                        <TableCell>{item.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <CheckCircleIcon className="size-5 text-success" weight="fill" />
                El archivo no tiene errores.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!canApply || busy} onClick={() => void apply()}>
            {report && report.errors.length > 0
              ? 'Corrige el archivo para importar'
              : `Importar${report ? ` ${report.totalRows} filas` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Código QR ------------------------------------------------------------------------------

/** QR grande y legible (fondo blanco aun en modo oscuro, para que la cámara lo lea). */
export function QrCard({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  return (
    <figure className={cn('flex flex-col items-center gap-2', className)}>
      <div
        role="img"
        aria-label={label ? `Código QR: ${label}` : 'Código QR'}
        className="rounded-lg border border-border bg-white p-4"
      >
        <QRCode value={value} size={200} fgColor="#0b2545" aria-hidden="true" />
      </div>
      {label && <figcaption className="text-sm font-medium">{label}</figcaption>}
    </figure>
  );
}

/** Descarga el QR como SVG (para imprimirlo, por ejemplo, en la puerta de la planta). */
export function downloadQrSvg(container: HTMLElement | null, fileName: string) {
  const svg = container?.querySelector('svg');
  if (!svg) return;
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
