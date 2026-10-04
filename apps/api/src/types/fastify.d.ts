import type { Env } from '../config/env.ts';
import type { CredentialSigner } from '../lib/credential-signer.ts';
import type { Cipher } from '../lib/crypto.ts';
import type { Database } from '../lib/db.ts';
import type { DomainEvents } from '../lib/domain-events.ts';
import type { LiveStore } from '../lib/live-store.ts';
import type { Realtime } from '../realtime/server.ts';
import type { AlertEngine } from '../modules/alerts/engine.ts';
import type { Mailer } from '../lib/mailer.ts';
import type { RoutingProvider } from '../lib/routing.ts';
import type { ObjectStorage } from '../lib/storage.ts';
import type { DriverAuthService } from '../modules/auth/driver-service.ts';
import type { createPassengerAuthService } from '../modules/auth/passenger-service.ts';
import type { AuthService } from '../modules/auth/service.ts';
import type { TokenService } from '../modules/auth/tokens.ts';
import type { ScheduleService } from '../modules/schedule/service.ts';
import type { PushSender } from '../lib/push.ts';
import type { DriverPush } from '../modules/devices/driver-push.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Acciones que se ejecutan al responder sin error (después de guardar los cambios). */
    afterCommit: (() => void)[];
  }

  interface FastifyInstance {
    config: Env;
    db: Database;
    tokens: TokenService;
    cipher: Cipher;
    credentialSigner: CredentialSigner;
    mailer: Mailer;
    storage: ObjectStorage;
    routingProvider: RoutingProvider;
    schedule: ScheduleService;
    liveStore: LiveStore;
    events: DomainEvents;
    realtime: Realtime;
    alerts: AlertEngine;
    push: PushSender;
    driverPush: DriverPush;
    authServices: {
      auth: AuthService;
      drivers: DriverAuthService;
      passengers: ReturnType<typeof createPassengerAuthService>;
    };
  }
}
