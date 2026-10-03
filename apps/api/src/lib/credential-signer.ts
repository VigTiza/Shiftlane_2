import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

import { z } from './zod.ts';

/** Datos que lleva la credencial QR de un pasajero. */
export const credentialClaimsSchema = z.object({
  /** Identificador de la credencial. */
  c: z.uuid(),
  /** Pasajero. */
  p: z.uuid(),
  /** Empresa cliente. */
  o: z.uuid(),
  /** Valor aleatorio de la credencial (cambia al reemitirla). */
  v: z.string().min(8),
});

export type CredentialClaims = z.infer<typeof credentialClaimsSchema>;

const PREFIX = 'SL1';

/**
 * Firma credenciales QR con Ed25519. La API firma con la llave privada; la app del chofer
 * puede verificar sin señal con la llave pública, sin poder fabricar credenciales.
 */
export function createCredentialSigner(privateKeyBase64: string) {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('CREDENTIAL_SIGNING_KEY debe ser una llave Ed25519.');
  }
  const publicKey = createPublicKey(privateKey);

  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),

    sign(claims: CredentialClaims): string {
      const data = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signature = sign(null, Buffer.from(`${PREFIX}.${data}`), privateKey).toString(
        'base64url',
      );
      return `${PREFIX}.${data}.${signature}`;
    },

    /** Devuelve los datos si la firma es válida; null si el QR fue alterado o no es nuestro. */
    verify(payload: string): CredentialClaims | null {
      const [prefix, data, signature] = payload.trim().split('.');
      if (prefix !== PREFIX || !data || !signature) return null;
      try {
        const ok = verify(
          null,
          Buffer.from(`${PREFIX}.${data}`),
          publicKey,
          Buffer.from(signature, 'base64url'),
        );
        if (!ok) return null;
        const parsed = credentialClaimsSchema.safeParse(
          JSON.parse(Buffer.from(data, 'base64url').toString()),
        );
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}

export type CredentialSigner = ReturnType<typeof createCredentialSigner>;

/** Genera una llave nueva (para .env de desarrollo y pruebas). */
export function generateCredentialKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
}
