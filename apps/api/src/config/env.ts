import { z } from '../lib/zod.ts';

const booleanFromEnv = z.stringbool({ truthy: ['true', '1'], falsy: ['false', '0'] });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Orígenes permitidos para CORS, separados por comas. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Activar cuando la API esté detrás de un proxy (Caddy, Cloudflare). */
  TRUST_PROXY: booleanFromEnv.default(false),
  /** Documentación OpenAPI interactiva en /docs. */
  API_DOCS_ENABLED: booleanFromEnv.default(true),
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  constructor(issues: z.core.$ZodIssue[]) {
    const lines = issues.map((issue) => `- ${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
    super(`Configuración inválida en las variables de entorno:\n${lines.join('\n')}`);
    this.name = 'InvalidEnvError';
  }
}

/** Valida las variables de entorno. Lanza InvalidEnvError con el detalle en español. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(result.error.issues);
  }
  return result.data;
}
