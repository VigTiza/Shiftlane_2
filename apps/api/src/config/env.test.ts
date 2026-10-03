import { describe, expect, it } from 'vitest';

import { InvalidEnvError, loadEnv } from './env.ts';

const DATABASE_URL = 'postgresql://usuario:clave@localhost:5432/shiftlane';
const SECRETS = {
  JWT_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

describe('loadEnv', () => {
  it('aplica valores por omisión', () => {
    const env = loadEnv({ DATABASE_URL, ...SECRETS });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGINS: ['http://localhost:5173'],
      TRUST_PROXY: false,
      API_DOCS_ENABLED: true,
    });
  });

  it('convierte números, listas y booleanos', () => {
    const env = loadEnv({
      DATABASE_URL,
      ...SECRETS,
      PORT: '8080',
      CORS_ORIGINS: 'https://app.shiftlane.mx, https://planta.shiftlane.mx',
      TRUST_PROXY: 'true',
    });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['https://app.shiftlane.mx', 'https://planta.shiftlane.mx']);
    expect(env.TRUST_PROXY).toBe(true);
  });

  it('explica en español qué variables son inválidas', () => {
    let error: unknown;
    try {
      loadEnv({ PORT: 'abc', DATABASE_URL: 'mysql://localhost/db' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidEnvError);
    const message = (error as Error).message;
    expect(message).toContain('Configuración inválida');
    expect(message).toContain('- PORT:');
    expect(message).toContain('- DATABASE_URL:');
    expect(message).toContain('- JWT_SECRET:');
  });

  it('exige una llave de cifrado de 32 bytes', () => {
    expect(() => loadEnv({ DATABASE_URL, ...SECRETS, ENCRYPTION_KEY: 'corta' })).toThrow(
      /ENCRYPTION_KEY: Debe ser una llave de 32 bytes/,
    );
  });
});
