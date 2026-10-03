import { describe, expect, it } from 'vitest';

import { ALLOWED, assertCan, canDo, nextStatus, startWindowOpensAt } from '../lifecycle.ts';
import type { TripAction, TripStatus } from '../lifecycle.ts';

const STATUSES: TripStatus[] = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const ACTIONS = Object.keys(ALLOWED) as TripAction[];

describe('máquina de estados del viaje', () => {
  it('transiciones válidas', () => {
    expect(nextStatus('scheduled', 'start')).toBe('in_progress');
    expect(nextStatus('in_progress', 'finish')).toBe('completed');
    expect(nextStatus('scheduled', 'cancel')).toBe('cancelled');
    // Las acciones intermedias no cambian el estado.
    expect(nextStatus('scheduled', 'checklist')).toBe('scheduled');
    expect(nextStatus('in_progress', 'scan')).toBe('in_progress');
    expect(nextStatus('in_progress', 'arrive_stop')).toBe('in_progress');
    expect(nextStatus('in_progress', 'gate')).toBe('in_progress');
    expect(nextStatus('scheduled', 'incident')).toBe('scheduled');
    expect(nextStatus('in_progress', 'incident')).toBe('in_progress');
  });

  it('un viaje terminado o cancelado no acepta ninguna acción', () => {
    for (const action of ACTIONS) {
      expect(canDo('completed', action)).toBe(false);
      expect(canDo('cancelled', action)).toBe(false);
      expect(() => assertCan('completed', action)).toThrow('El viaje ya terminó.');
      expect(() => assertCan('cancelled', action)).toThrow('El viaje está cancelado.');
    }
  });

  it('las acciones de ruta exigen el viaje en curso', () => {
    for (const action of ['arrive_stop', 'scan', 'gate', 'finish'] as const) {
      expect(() => assertCan('scheduled', action)).toThrow('Primero inicia el viaje.');
      expect(canDo('in_progress', action)).toBe(true);
    }
  });

  it('no se inicia, cancela ni revisa la unidad de un viaje en curso', () => {
    expect(() => assertCan('in_progress', 'start')).toThrow('El viaje ya está en curso.');
    expect(() => assertCan('in_progress', 'cancel')).toThrow(/el despacho debe atenderlo/);
    expect(() => assertCan('in_progress', 'checklist')).toThrow(/antes de salir/);
    expect(() => assertCan('in_progress', 'checklist_exception')).toThrow(/antes de salir/);
  });

  it('cada combinación de estado y acción es explícita', () => {
    const table = Object.fromEntries(
      STATUSES.map((status) => [status, ACTIONS.filter((action) => canDo(status, action))]),
    );
    expect(table).toEqual({
      scheduled: ['checklist', 'checklist_exception', 'start', 'incident', 'cancel'],
      in_progress: ['arrive_stop', 'scan', 'incident', 'gate', 'finish'],
      completed: [],
      cancelled: [],
    });
  });

  it('la ventana para iniciar abre dos horas antes', () => {
    const start = new Date('2026-10-05T12:00:00Z');
    expect(startWindowOpensAt(start).toISOString()).toBe('2026-10-05T10:00:00.000Z');
  });
});
