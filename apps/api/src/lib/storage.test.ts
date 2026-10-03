import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { assertSafeKey, createLocalStorage, createS3Storage } from './storage.ts';
import type { ObjectStorage } from './storage.ts';

async function roundTrip(storage: ObjectStorage) {
  const key = `tenant/pruebas/${Date.now()}.pdf`;
  await storage.put(key, Buffer.from('%PDF contenido'), 'application/pdf');
  expect((await storage.get(key))?.toString()).toBe('%PDF contenido');
  await storage.delete(key);
  expect(await storage.get(key)).toBeNull();
}

describe('almacenamiento local', () => {
  let dir: string;

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('guarda, lee y borra archivos', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'shiftlane-storage-'));
    await roundTrip(createLocalStorage(dir));
  });

  it('no permite llaves que salgan de su carpeta', () => {
    expect(() => assertSafeKey('../../etc/passwd')).toThrow();
    expect(() => assertSafeKey('/absoluta')).toThrow();
    expect(() => assertSafeKey('tenant//doble')).toThrow();
    expect(() => assertSafeKey('tenant/unidades/archivo.pdf')).not.toThrow();
  });
});

// Requiere MinIO (infra/docker-compose.dev.yml) y S3_TEST_ENDPOINT en el entorno.
describe.skipIf(!process.env.S3_TEST_ENDPOINT)('almacenamiento S3 (MinIO)', () => {
  it('guarda, lee y borra archivos', async () => {
    await roundTrip(
      createS3Storage({
        bucket: process.env.S3_TEST_BUCKET ?? 'shiftlane',
        region: 'us-east-1',
        endpoint: process.env.S3_TEST_ENDPOINT,
        accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? 'shiftlane',
        secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'shiftlane-dev',
        forcePathStyle: true,
      }),
    );
  });
});
