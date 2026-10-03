// Máquina de estados del viaje. Función pura: qué acciones se permiten en cada estado y a qué
// estado llevan. Los servicios la consultan antes de escribir cualquier evento.
import { ConflictError } from '../../lib/errors.ts';

export type TripStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export type TripAction =
  | 'checklist'
  | 'checklist_exception'
  | 'start'
  | 'arrive_stop'
  | 'scan'
  | 'incident'
  | 'gate'
  | 'finish'
  | 'cancel';

/** Estados en que se permite cada acción. */
export const ALLOWED: Record<TripAction, readonly TripStatus[]> = {
  checklist: ['scheduled'],
  checklist_exception: ['scheduled'],
  start: ['scheduled'],
  arrive_stop: ['in_progress'],
  scan: ['in_progress'],
  incident: ['scheduled', 'in_progress'],
  gate: ['in_progress'],
  finish: ['in_progress'],
  cancel: ['scheduled'],
};

const NEXT: Partial<Record<TripAction, TripStatus>> = {
  start: 'in_progress',
  finish: 'completed',
  cancel: 'cancelled',
};

/** Minutos antes de la hora programada desde los que el chofer puede iniciar. */
export const START_WINDOW_MINUTES = 120;

export function canDo(status: TripStatus, action: TripAction): boolean {
  return ALLOWED[action].includes(status);
}

function refusal(status: TripStatus, action: TripAction): string {
  if (status === 'completed') return 'El viaje ya terminó.';
  if (status === 'cancelled') return 'El viaje está cancelado.';
  if (status === 'scheduled') return 'Primero inicia el viaje.';
  // En curso.
  if (action === 'cancel') return 'El viaje ya está en curso; el despacho debe atenderlo.';
  if (action === 'checklist' || action === 'checklist_exception') {
    return 'El viaje ya está en curso; el checklist se hace antes de salir.';
  }
  return 'El viaje ya está en curso.';
}

/** Lanza un error en español si la acción no se permite en el estado actual. */
export function assertCan(status: TripStatus, action: TripAction): void {
  if (!canDo(status, action)) throw new ConflictError(refusal(status, action));
}

/** Estado después de la acción (las que no cambian el estado devuelven el mismo). */
export function nextStatus(status: TripStatus, action: TripAction): TripStatus {
  assertCan(status, action);
  return NEXT[action] ?? status;
}

/** Desde cuándo se puede iniciar un viaje. */
export function startWindowOpensAt(scheduledStartAt: Date): Date {
  return new Date(scheduledStartAt.getTime() - START_WINDOW_MINUTES * 60_000);
}
