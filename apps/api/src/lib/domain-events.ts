// Eventos de dominio: los servicios publican qué pasó y otros módulos reaccionan (tiempo real
// hoy; alertas y notificaciones después). Solo se entregan si los cambios se guardaron.
import { afterCommit } from './after-commit.ts';

export interface BoardingNotice {
  result: 'ok' | 'other_route' | 'unregistered';
  passenger: { id: string; fullName: string } | null;
  stop: { id: string; name: string } | null;
  onboard: number;
  overCapacity: boolean;
}

export type DomainEvent =
  | { type: 'trip.status_changed'; tripId: string }
  | { type: 'trip.cancelled'; tripId: string; reason: string | null }
  /** Nueva posición en vivo (con las paradas a las que llegó por geocerca). */
  | { type: 'trip.position'; tripId: string; autoArrivals: { stopId: string; at: string }[] }
  | { type: 'boarding.created'; tripId: string; boarding: BoardingNotice }
  | { type: 'route.changed'; routeId: string }
  | {
      type: 'message.to_driver';
      tenantId: string;
      driverId: string;
      message: { id: string; text: string; sentAt: string; fromUserId: string };
    }
  | {
      type: 'alert.created' | 'alert.updated';
      tenantId: string;
      plantId: string | null;
      notifyPlant: boolean;
      alert: Record<string, unknown>;
    }
  | { type: 'device.health_changed'; tenantId: string; device: Record<string, unknown> };

type Listener = (event: DomainEvent) => void;

export interface DomainEvents {
  /** Publica el evento cuando se confirmen los cambios actuales. */
  publish: (event: DomainEvent) => void;
  subscribe: (listener: Listener) => () => void;
}

export function createDomainEvents(): DomainEvents {
  const listeners = new Set<Listener>();
  return {
    publish(event) {
      afterCommit(() => {
        for (const listener of listeners) listener(event);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
