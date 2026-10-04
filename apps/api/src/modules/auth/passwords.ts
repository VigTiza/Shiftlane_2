import { hash, verify } from '@node-rs/argon2';

import { z } from '../../lib/zod.ts';

// argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, 2 iteraciones).
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// La regla de contraseña es la misma en la API y en los formularios web.
export { passwordSchema } from '@shiftlane/shared';

export const pinSchema = z.string().regex(/^\d{4}$/, 'El PIN debe tener exactamente 4 dígitos.');

export function hashSecret(secret: string): Promise<string> {
  return hash(secret, ARGON2_OPTIONS);
}

export async function verifySecret(hashed: string, secret: string): Promise<boolean> {
  try {
    return await verify(hashed, secret);
  } catch {
    return false;
  }
}

// Hash de referencia para que una cuenta inexistente tarde lo mismo que una real.
let dummyHash: Promise<string> | undefined;

/** Compara contra un hash ficticio: evita que el tiempo de respuesta revele si el correo existe. */
export async function burnVerifyTime(secret: string): Promise<void> {
  dummyHash ??= hashSecret('contraseña-ficticia-para-igualar-tiempos');
  await verifySecret(await dummyHash, secret);
}
