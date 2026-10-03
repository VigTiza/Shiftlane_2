import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Almacenamiento de archivos (documentos, fotos, evidencia). La misma interfaz funciona con
 * una carpeta local, con S3/Cloudflare R2 y con MinIO en desarrollo.
 */
export interface ObjectStorage {
  put: (key: string, body: Buffer, contentType: string) => Promise<void>;
  /** Devuelve el contenido o null si no existe. */
  get: (key: string) => Promise<Buffer | null>;
  delete: (key: string) => Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

/** Las llaves las genera la API; aun así se valida que no puedan salir de su carpeta. */
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Llave de archivo inválida: ${key}`);
  }
}

export function createLocalStorage(rootDir: string): ObjectStorage {
  const root = path.resolve(rootDir);
  const resolve = (key: string) => {
    assertSafeKey(key);
    return path.join(root, ...key.split('/'));
  };
  return {
    async put(key, body) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async get(key) {
      try {
        return await readFile(resolve(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string | undefined;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO necesita rutas tipo /bucket/llave. */
  forcePathStyle?: boolean | undefined;
}

export function createS3Storage(options: S3StorageOptions): ObjectStorage {
  const client = new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    forcePathStyle: options.forcePathStyle ?? false,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
  return {
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      assertSafeKey(key);
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        if (!result.Body) return null;
        return Buffer.from(await result.Body.transformToByteArray());
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },
  };
}

/** En memoria, para pruebas. */
export function createMemoryStorage(): ObjectStorage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    put(key, body) {
      assertSafeKey(key);
      objects.set(key, Buffer.from(body));
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(objects.get(key) ?? null);
    },
    delete(key) {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}
