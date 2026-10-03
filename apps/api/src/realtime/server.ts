import type { Server as HttpServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyBaseLogger } from 'fastify';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';

import type { Database } from '../lib/db.ts';
import type { DomainEvent, DomainEvents } from '../lib/domain-events.ts';
import type { LiveStore } from '../lib/live-store.ts';
import type { AccessClaims } from '../modules/auth/tokens.ts';
import type { TokenService } from '../modules/auth/tokens.ts';

export const REALTIME_PATH = '/realtime';

/** Salas: cada evento llega solo a quien le corresponde. */
export const rooms = {
  tenant: (tenantId: string) => `tenant:${tenantId}`,
  plant: (plantId: string) => `plant:${plantId}`,
  route: (routeId: string) => `route:${routeId}`,
  driver: (driverId: string) => `driver:${driverId}`,
};

/** Permisos con los que un usuario de la transportista recibe los eventos de su empresa. */
const CARRIER_PERMISSIONS = [
  'monitoring.view',
  'dispatch.operate',
  'alerts.manage',
  'schedule.read',
];
/** Permisos con los que un usuario de la planta recibe los eventos de sus plantas. */
const PLANT_PERMISSIONS = ['plant.dashboard', 'plant.evidence'];

interface TripRef {
  id: string;
  tenantId: string;
  plantId: string;
  routeId: string | null;
  driverId: string | null;
  status: string;
  kind: string;
  serviceDate: Date;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
}

/**
 * Tiempo real con Socket.IO. El cliente se autentica con el mismo token de acceso de la API
 * (`auth: { token }`) y entra solo a sus salas: la transportista a la de su empresa, la planta
 * a las de sus plantas, el pasajero a las de sus rutas y el chofer a la suya. Con Redis, varias
 * copias de la API comparten las salas.
 */
export function createRealtime(options: {
  server: HttpServer;
  db: Database;
  tokens: TokenService;
  events: DomainEvents;
  liveStore: LiveStore;
  corsOrigins: string[];
  redisUrl?: string | undefined;
  log: FastifyBaseLogger;
}) {
  const { db, log } = options;
  const io = new Server(options.server, {
    path: REALTIME_PATH,
    serveClient: false,
    cors: { origin: options.corsOrigins, credentials: true },
  });
  let pub: Redis | null = null;
  let sub: Redis | null = null;
  if (options.redisUrl) {
    pub = new Redis(options.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 });
    sub = pub.duplicate();
    pub.on('error', (error) => log.warn({ err: error }, 'Redis de tiempo real no disponible'));
    sub.on('error', (error) => log.warn({ err: error }, 'Redis de tiempo real no disponible'));
    io.adapter(createAdapter(pub, sub));
  }

  async function roomsFor(claims: AccessClaims): Promise<string[]> {
    switch (claims.kind) {
      case 'driver':
        return [rooms.driver(claims.sub)];
      case 'passenger': {
        const assignments = await db.system.routePassenger.findMany({
          where: { passengerId: claims.sub, deletedAt: null },
          select: { routeId: true },
        });
        return assignments.map((a) => rooms.route(a.routeId));
      }
      case 'user': {
        const has = (list: string[]) => list.some((p) => claims.permissions.includes(p));
        if (claims.tenantId && has(CARRIER_PERMISSIONS)) return [rooms.tenant(claims.tenantId)];
        if (claims.clientOrgId && has(PLANT_PERMISSIONS)) {
          const plants = await db.system.plant.findMany({
            where: { clientOrgId: claims.clientOrgId, deletedAt: null },
            select: { id: true },
          });
          return plants.map((p) => rooms.plant(p.id));
        }
        return [];
      }
    }
  }

  io.use((socket, next) => {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const raw = typeof auth?.token === 'string' ? auth.token : '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    void options.tokens.verifyAccessWithExpiry(token).then(async (verified) => {
      if (!verified) return next(new Error('No autorizado.'));
      const joined = await roomsFor(verified.claims);
      if (joined.length === 0)
        return next(new Error('Sin permiso para recibir eventos en tiempo real.'));
      socket.data = { claims: verified.claims, expiresAt: verified.expiresAt, rooms: joined };
      next();
    }, next);
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as { expiresAt: Date; rooms: string[] };
    void socket.join(data.rooms);
    // Al vencer el token se cierra: el cliente se reconecta con uno nuevo.
    const expiry = setTimeout(
      () => {
        socket.emit('session.expired');
        socket.disconnect(true);
      },
      Math.max(0, data.expiresAt.getTime() - Date.now()),
    );
    expiry.unref();
    socket.on('disconnect', () => clearTimeout(expiry));
    socket.emit('ready');
  });

  async function tripRef(tripId: string): Promise<TripRef | null> {
    return db.system.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        tenantId: true,
        plantId: true,
        routeId: true,
        driverId: true,
        status: true,
        kind: true,
        serviceDate: true,
        actualStartAt: true,
        actualEndAt: true,
      },
    });
  }

  /** Empresa y planta siempre; la ruta (pasajeros) solo si se indica. */
  function tripRooms(trip: TripRef, audience: { route?: boolean; driver?: boolean } = {}) {
    return [
      rooms.tenant(trip.tenantId),
      rooms.plant(trip.plantId),
      ...(audience.route && trip.routeId ? [rooms.route(trip.routeId)] : []),
      ...(audience.driver && trip.driverId ? [rooms.driver(trip.driverId)] : []),
    ];
  }

  function tripPayload(trip: TripRef) {
    return {
      tripId: trip.id,
      routeId: trip.routeId,
      plantId: trip.plantId,
      kind: trip.kind,
      status: trip.status,
      serviceDate: trip.serviceDate.toISOString().slice(0, 10),
      actualStartAt: trip.actualStartAt,
      actualEndAt: trip.actualEndAt,
    };
  }

  async function deliver(event: DomainEvent) {
    switch (event.type) {
      case 'trip.status_changed': {
        const trip = await tripRef(event.tripId);
        if (trip)
          io.to(tripRooms(trip, { route: true })).emit('trip.status_changed', tripPayload(trip));
        return;
      }
      case 'trip.cancelled': {
        const trip = await tripRef(event.tripId);
        if (!trip) return;
        const payload = { ...tripPayload(trip), reason: event.reason };
        io.to(tripRooms(trip, { route: true, driver: true })).emit('trip.cancelled', payload);
        io.to(tripRooms(trip, { route: true })).emit('trip.status_changed', tripPayload(trip));
        return;
      }
      case 'trip.position': {
        const [trip, position] = [
          await tripRef(event.tripId),
          await options.liveStore.getTripPosition(event.tripId),
        ];
        if (!trip || !position) return;
        const target = io.to(tripRooms(trip, { route: true }));
        target.emit('trip.position', {
          tripId: trip.id,
          routeId: trip.routeId,
          lat: position.lat,
          lng: position.lng,
          speedKmh: position.speedKmh,
          heading: position.heading,
          recordedAt: position.recordedAt,
        });
        target.emit('trip.eta_updated', {
          tripId: trip.id,
          routeId: trip.routeId,
          eta: position.eta,
          arrivedStops: event.autoArrivals,
        });
        return;
      }
      case 'boarding.created': {
        const trip = await tripRef(event.tripId);
        // Los pasajeros no reciben los abordajes de otros.
        if (trip)
          io.to(tripRooms(trip)).emit('boarding.created', { tripId: trip.id, ...event.boarding });
        return;
      }
      case 'route.changed': {
        const route = await db.system.route.findUnique({
          where: { id: event.routeId },
          select: { id: true, tenantId: true, plantId: true, code: true },
        });
        if (!route) return;
        // Choferes con viajes próximos de la ruta.
        const upcoming = await db.system.trip.findMany({
          where: { routeId: route.id, status: 'scheduled', driverId: { not: null } },
          select: { driverId: true },
          distinct: ['driverId'],
        });
        io.to([
          rooms.tenant(route.tenantId),
          rooms.route(route.id),
          ...upcoming.map((t) => rooms.driver(t.driverId!)),
        ]).emit('route.changed', { routeId: route.id, code: route.code });
        return;
      }
      case 'message.to_driver':
        io.to(rooms.driver(event.driverId)).emit('message.to_driver', event.message);
        return;
      case 'alert.created':
      case 'alert.updated':
        io.to([
          rooms.tenant(event.tenantId),
          ...(event.notifyPlant && event.plantId ? [rooms.plant(event.plantId)] : []),
        ]).emit(event.type, event.alert);
        return;
      case 'device.health_changed':
        io.to(rooms.tenant(event.tenantId)).emit('device.health_changed', event.device);
        return;
    }
  }

  const unsubscribe = options.events.subscribe((event) => {
    deliver(event).catch((error: unknown) =>
      log.warn({ err: error, event: event.type }, 'No se pudo enviar un evento en tiempo real'),
    );
  });

  return {
    io,
    close() {
      unsubscribe();
      // io.close() también cerraría el servidor HTTP, que es de Fastify.
      io.disconnectSockets(true);
      io.engine.close();
      pub?.disconnect();
      sub?.disconnect();
    },
  };
}

export type Realtime = ReturnType<typeof createRealtime>;
