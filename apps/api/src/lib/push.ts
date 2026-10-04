import { createPrivateKey, sign } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { z } from './zod.ts';

/** Aviso al celular. `data` viaja a la app (todo en texto, como pide FCM). */
export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

/** sent: entregado a FCM; invalid_token: el celular ya no existe o desinstaló la app. */
export type PushResult = 'sent' | 'invalid_token' | 'failed';

export interface PushSender {
  /** Hay un proveedor configurado (sin él no se intenta enviar). */
  readonly enabled: boolean;
  send: (token: string, message: PushMessage) => Promise<PushResult>;
}

/** Sin Firebase configurado: los avisos llegan solo por tiempo real con la app abierta. */
export function createDisabledPushSender(): PushSender {
  return { enabled: false, send: () => Promise.resolve('failed') };
}

/** Guarda los avisos en memoria. Para pruebas. */
export function createMemoryPushSender(): PushSender & {
  sent: { token: string; message: PushMessage }[];
  invalidTokens: Set<string>;
} {
  const sent: { token: string; message: PushMessage }[] = [];
  const invalidTokens = new Set<string>();
  return {
    enabled: true,
    sent,
    invalidTokens,
    send(token, message) {
      if (invalidTokens.has(token)) return Promise.resolve('invalid_token');
      sent.push({ token, message });
      return Promise.resolve('sent');
    },
  };
}

const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.email(),
  private_key: z.string().min(1),
  token_uri: z.url().default('https://oauth2.googleapis.com/token'),
});

export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

/** Cuenta de servicio de Firebase (JSON completo, o el JSON en base64). */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return serviceAccountSchema.parse(JSON.parse(text));
}

const MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

/** JWT firmado con la llave de la cuenta de servicio (RS256) para pedir un token de acceso. */
export function serviceAccountAssertion(account: ServiceAccount, now = new Date()) {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: MESSAGING_SCOPE,
      aud: account.token_uri,
      iat,
      exp: iat + 3600,
    }),
  );
  const key = createPrivateKey(account.private_key);
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key);
  return `${header}.${claims}.${base64url(signature)}`;
}

/**
 * Firebase Cloud Messaging (API HTTP v1). Nunca lanza errores: un aviso que no sale no debe
 * detener nada de la operación.
 */
export function createFcmPushSender(options: {
  account: ServiceAccount;
  log: FastifyBaseLogger;
  fetch?: typeof fetch;
  now?: () => Date;
}): PushSender {
  const { account, log } = options;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken() {
    if (cached && cached.expiresAt > now().getTime() + 60_000) return cached.token;
    const response = await doFetch(account.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: serviceAccountAssertion(account, now()),
      }),
    });
    if (!response.ok) throw new Error(`Token de Google rechazado (${response.status})`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    cached = {
      token: body.access_token,
      expiresAt: now().getTime() + body.expires_in * 1000,
    };
    return cached.token;
  }

  return {
    enabled: true,
    async send(token, message) {
      try {
        const response = await doFetch(
          `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${await accessToken()}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: message.title, body: message.body },
                data: message.data,
                android: {
                  priority: 'high',
                  notification: { sound: 'default' },
                },
              },
            }),
          },
        );
        if (response.ok) return 'sent';
        const text = await response.text();
        // El celular ya no tiene la app o renovó su token.
        if (response.status === 404 || text.includes('UNREGISTERED')) return 'invalid_token';
        log.warn({ status: response.status, body: text.slice(0, 300) }, 'FCM rechazó un aviso');
        return 'failed';
      } catch (error) {
        log.warn({ err: error }, 'No se pudo enviar un aviso por FCM');
        return 'failed';
      }
    },
  };
}
