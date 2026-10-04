import { WarningIcon } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Button } from './ui/button';
import { Skeleton } from './ui/primitives';

/** Encabezado de cada pantalla: la pregunta del usuario en grande y la acción principal. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-[70ch] text-[15px] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Sin datos todavía: explica qué va aquí y cuál es el siguiente paso. */
export function EmptyState({
  icon: IconComponent,
  title,
  description,
  action,
  className,
}: {
  icon: Icon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      <IconComponent className="size-9 text-muted-foreground" weight="duotone" />
      <div className="max-w-md">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** No se pudo cargar: el mensaje de la API y cómo reintentar. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft px-6 py-10 text-center"
    >
      <WarningIcon className="size-8 text-danger" weight="duotone" />
      <p className="max-w-md text-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}

/** Carga: la forma de lo que viene (no un círculo girando en medio de la nada). */
export function LoadingRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={cn('h-6', column === 0 ? 'w-1/3' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}
