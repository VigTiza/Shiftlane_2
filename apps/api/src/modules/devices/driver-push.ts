import type { FastifyBaseLogger } from 'fastify';

import type { Database } from '../../lib/db.ts';
import type { DomainEvent, DomainEvents } from '../../lib/domain-events.ts';
import type { PushMessage, PushSender } from '../../lib/push.ts';

function hhmm(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/**
 * Avisos al celular del chofer con la app cerrada o en segundo plano (Firebase Cloud
 * Messaging): mensajes del despachador, viajes cancelados y cambios de ruta. Con la app
 * abierta también llegan por tiempo real; la app ignora el aviso repetido. Los envíos nunca
 * detienen la operación: si FCM falla, solo se registra.
 */
export function createDriverPush(deps: {
  db: Database;
  events: DomainEvents;
  push: PushSender;
  log: FastifyBaseLogger;
}) {
  const { db, push, log } = deps;
  const pending = new Set<Promise<void>>();

  /** Celulares con la sesión vigente de esos choferes (uno compartido avisa a quien entró). */
  async function devicesOf(driverIds: string[]) {
    if (driverIds.length === 0) return [];
    const sessions = await db.system.session.findMany({
      where: {
        driverId: { in: driverIds },
        revokedAt: null,
        rotatedAt: null,
        expiresAt: { gt: new Date() },
        device: { revokedAt: null, pushToken: { not: null } },
      },
      select: { device: { select: { id: true, pushToken: true } } },
    });
    const byId = new Map<string, string>();
    for (const { device } of sessions) if (device?.pushToken) byId.set(device.id, device.pushToken);
    return [...byId].map(([id, token]) => ({ id, token }));
  }

  async function messageFor(
    event: DomainEvent,
  ): Promise<{ driverIds: string[]; message: PushMessage } | null> {
    switch (event.type) {
      case 'message.to_driver':
        return {
          driverIds: [event.driverId],
          message: {
            title: 'Mensaje del despachador',
            body: event.message.text,
            data: { type: 'message', messageId: event.message.id },
          },
        };
      case 'trip.cancelled': {
        const trip = await db.system.trip.findUnique({
          where: { id: event.tripId },
          select: {
            driverId: true,
            scheduledStartAt: true,
            route: { select: { code: true } },
            plant: { select: { timezone: true } },
          },
        });
        if (!trip?.driverId) return null;
        const name = trip.route ? `${trip.route.code} ` : 'extra ';
        return {
          driverIds: [trip.driverId],
          message: {
            title: 'Viaje cancelado',
            body: `Se canceló el viaje ${name}de las ${hhmm(trip.scheduledStartAt, trip.plant.timezone)}${event.reason ? `: ${event.reason}` : '.'}`,
            data: { type: 'trip_cancelled', tripId: event.tripId },
          },
        };
      }
      case 'route.changed': {
        const route = await db.system.route.findUnique({
          where: { id: event.routeId },
          select: { code: true },
        });
        const upcoming = await db.system.trip.findMany({
          where: { routeId: event.routeId, status: 'scheduled', driverId: { not: null } },
          select: { driverId: true },
          distinct: ['driverId'],
        });
        if (!route) return null;
        return {
          driverIds: upcoming.map((t) => t.driverId!),
          message: {
            title: 'Cambió tu ruta',
            body: `La ruta ${route.code} cambió: revisa las paradas antes de salir.`,
            data: { type: 'route_changed', routeId: event.routeId },
          },
        };
      }
      default:
        return null;
    }
  }

  async function deliver(event: DomainEvent) {
    const target = await messageFor(event);
    if (!target) return;
    for (const device of await devicesOf(target.driverIds)) {
      const result = await push.send(device.token, target.message);
      if (result === 'invalid_token') {
        // El celular renovó su token o quitó la app: se deja de usar ese token.
        await db.system.device.updateMany({
          where: { id: device.id, pushToken: device.token },
          data: { pushToken: null, pushTokenUpdatedAt: new Date() },
        });
      }
    }
  }

  const unsubscribe = deps.events.subscribe((event) => {
    if (!push.enabled) return;
    const job: Promise<void> = deliver(event)
      .catch((error: unknown) => log.warn({ err: error, type: event.type }, 'Aviso no enviado'))
      .finally(() => pending.delete(job));
    pending.add(job);
  });

  return {
    close: unsubscribe,
    /** Espera los envíos en curso (pruebas y cierre). */
    idle: async () => {
      await Promise.all([...pending]);
    },
  };
}

export type DriverPush = ReturnType<typeof createDriverPush>;
