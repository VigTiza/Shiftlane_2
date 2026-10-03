import { z } from '../lib/zod.ts';

const booleanFromEnv = z.stringbool({ truthy: ['true', '1'], falsy: ['false', '0'] });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
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

    /** Secreto para firmar los tokens de acceso (HS256). Mínimo 32 caracteres. */
    JWT_SECRET: z.string().min(32),
    /** Llave AES-256 en base64 (32 bytes) para cifrar datos sensibles, como los secretos TOTP. */
    ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'Debe ser una llave de 32 bytes codificada en base64.',
    }),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    DRIVER_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),
    PASSENGER_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(180),
    /** Cookie del token de renovación solo por HTTPS. Por omisión, activa en producción. */
    COOKIE_SECURE: booleanFromEnv.optional(),
    /** Peticiones por minuto e IP en los endpoints de inicio de sesión y activación. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    /** URL del panel web, para los enlaces de los correos. */
    APP_URL: z.url().default('http://localhost:5173'),
    /** Servidor de correo (smtp://...). Sin él, los correos solo se escriben en el registro. */
    SMTP_URL: z.url().optional(),
    MAIL_FROM: z.string().default('Shiftlane <no-responder@shiftlane.mx>'),

    /** Dónde se guardan los archivos: carpeta local o S3/R2/MinIO. */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanFromEnv.default(false),
    /** Zona horaria por omisión para fechas de negocio (vencimientos, días de servicio). */
    DEFAULT_TIME_ZONE: z.string().default('America/Ciudad_Juarez'),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER !== 's3') return;
    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Es obligatoria cuando STORAGE_DRIVER=s3.',
        });
      }
    }
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
