import { describe, expect, it } from 'vitest';

import { createCipher, sha256 } from '../../../lib/crypto.ts';
import { hashSecret, passwordSchema, pinSchema, verifySecret } from '../passwords.ts';
import { base32Decode, base32Encode, totpCode, totpStep, verifyTotp } from '../totp.ts';

// Secreto del RFC 6238 (ASCII "12345678901234567890") en base32.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('coincide con los vectores de prueba del RFC', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(totpCode(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(expected);
    }
  });

  it('acepta un paso de desfase y rechaza códigos viejos', () => {
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 3), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('codifica y decodifica base32', () => {
    const bytes = Buffer.from('Shiftlane-2026');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });
});

describe('cifrado de datos sensibles', () => {
  const cipher = createCipher(Buffer.alloc(32, 1).toString('base64'));

  it('cifra y descifra, con un resultado distinto cada vez', () => {
    const a = cipher.encrypt('JBSWY3DPEHPK3PXP');
    const b = cipher.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detecta datos alterados', () => {
    const [version, iv, tag, data] = cipher.encrypt('secreto').split('.');
    const tampered = [version, iv, tag, `${data}A`].join('.');
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('el hash SHA-256 es estable', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('contraseñas y PIN', () => {
  it('usa argon2id y verifica correctamente', async () => {
    const hashed = await hashSecret('MiClave2026');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await verifySecret(hashed, 'MiClave2026')).toBe(true);
    expect(await verifySecret(hashed, 'OtraClave2026')).toBe(false);
    expect(await verifySecret('no-es-un-hash', 'x')).toBe(false);
  });

  it('exige contraseñas de al menos 10 caracteres con letras y números', () => {
    expect(passwordSchema.safeParse('corta1').success).toBe(false);
    expect(passwordSchema.safeParse('sololetrasaqui').success).toBe(false);
    expect(passwordSchema.safeParse('Transporte2026').success).toBe(true);
  });

  it('el PIN es de exactamente 4 dígitos', () => {
    expect(pinSchema.safeParse('1234').success).toBe(true);
    expect(pinSchema.safeParse('123').success).toBe(false);
    expect(pinSchema.safeParse('12a4').success).toBe(false);
  });
});
