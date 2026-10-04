import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ACCOUNT_FILE = resolve(here, '.cache/account.json');

/** Revisa que la API esté arriba y crea una transportista nueva para esta corrida. */
export default async function globalSetup() {
  const api = process.env.SHIFTLANE_API_URL ?? 'http://localhost:3000';
  try {
    const response = await fetch(`${api}/health`);
    if (!response.ok) throw new Error(String(response.status));
  } catch {
    throw new Error(
      `La API no responde en ${api}. Levántala con «node src/server.ts» en apps/api antes de correr las pruebas.`,
    );
  }
  execFileSync(process.execPath, ['scripts/e2e/web-account.ts', ACCOUNT_FILE], {
    cwd: resolve(here, '../../api'),
    stdio: 'inherit',
  });
}
