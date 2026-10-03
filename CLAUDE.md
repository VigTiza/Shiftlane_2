# Shiftlane — instrucciones para Claude Code

## Qué es
SaaS para empresas de transporte de personal (México). Referencia funcional:
docs/referencia/descripcion-funcional.md y docs/referencia/sistema-de-precios.md.
Plan de trabajo (76 prompts en 23 fases): docs/referencia/plan-de-desarrollo.md.
Índice para ubicar cada prompt (código, título, fase, línea): docs/referencia/indice-de-prompts.md.
Resumen de consulta rápida (módulos, usuarios, reglas clave, precios): docs/referencia/resumen.md.

## Protocolo obligatorio
1. Antes de trabajar, lee la sección ESTADO ACTUAL de docs/AVANCES.md.
2. Haz solo lo que pide el prompt actual.
3. Escribe y ejecuta pruebas; no termines con pruebas fallando.
4. Actualiza docs/AVANCES.md durante y al final de cada tarea.
5. Commit al terminar: "F<fase>-P<prompt>: <resumen>".

Si una sesión empieza tras un corte, sigue el prompt de reanudación (sección 4.3 del plan):
revisa `git status` y `git log -5` y continúa desde donde quedó, sin rehacer lo terminado.

## Reglas de sesión
1. Ejecuta los prompts del plan en orden; el siguiente está en ESTADO ACTUAL de docs/AVANCES.md.
2. Completa como máximo de 3 a 5 prompts por sesión. Si uno es muy grande, divídelo en
   subtareas y cuenta solo los prompts terminados.
3. Al terminar cada prompt: pruebas pasando, docs/AVANCES.md actualizado y commit.
4. En tareas largas, actualiza docs/AVANCES.md también a mitad del trabajo.
5. Si algo requiere una acción del usuario (instalar software, crear cuentas, poner llaves,
   aprobar un diseño), detente y pídeselo claramente.
6. Al completar el último prompt de la sesión, detente y entrega este reporte:
   - Prompts completados en esta sesión
   - Qué se construyó, en 5 a 10 líneas
   - Resultado de las pruebas
   - Qué debe revisar o aprobar el usuario
   - Cuál es el siguiente prompt
   Después espera su confirmación para continuar.

## Stack
- API: Node.js LTS + TypeScript + Fastify + Zod + Prisma + PostgreSQL 16/PostGIS + Redis + BullMQ + Socket.IO
- Web y app del pasajero: React + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query + MapLibre
- App del chofer: Flutter + Dart (Riverpod, drift, geolocator, mobile_scanner)
- Landing: HTML + CSS + JavaScript + Three.js + GSAP; modelos 3D de Blender (GLB)

## Reglas no negociables
- Toda tabla operativa lleva tenant_id y seguridad por filas; nunca tomar tenant_id del cliente.
- Validar toda entrada con Zod; respuestas de error en español.
- Ningún secreto en el código; usar .env y mantener .env.example.
- La operación de viajes nunca se interrumpe por cobro o por fallas de terceros.
- Textos de interfaz en español de México; código y tablas en inglés.
- Ubicación del chofer solo durante viajes; datos personales mínimos.

## Estructura
Monorepo con pnpm workspaces (pnpm-workspace.yaml). Cada app tiene su .env.example.
- apps/api — API y servicios automáticos (src/modules, src/jobs, src/realtime, prisma, test)
- apps/web — panel de la transportista, portal de la planta y consola de plataforma
- apps/rider — app del pasajero (PWA)
- apps/driver — app del chofer en Flutter; no forma parte del workspace de pnpm
- apps/landing — landing page con 3D
- packages/shared — tipos, esquemas Zod, constantes y reglas de precios
- assets/3d — archivos .blend, scripts de Blender y .glb exportados
- infra — docker-compose, Caddyfile, respaldos; infra/scripts para utilidades del repo
- docs — AVANCES.md, referencia/ (docs de referencia; originales/ guarda los .docx),
  decisiones/ (ADR), manuales/, api.md (desde F01-P04)
- .github/workflows — CI/CD

## Comandos
- `pnpm install` — instala las dependencias del workspace; en apps/driver, `flutter pub get`.
- `pnpm dev` — levanta PostgreSQL+PostGIS, Redis y Mailpit (Docker) y los `dev` de cada app.
- `pnpm services:up` / `pnpm services:down` — solo los servicios de infra/docker-compose.dev.yml.
- `pnpm test` — todas las pruebas: documentos, Vitest de cada paquete y `flutter test`.
- `pnpm lint` — ESLint + Prettier (--check) + `dart format` y `flutter analyze` en apps/driver.
- `pnpm format` — aplica Prettier y `dart format`.
- `pnpm typecheck` — `tsc --noEmit` en cada paquete TypeScript.
- `pnpm db:migrate` / `pnpm db:seed` — aplica migraciones (`prisma migrate deploy`) y
  siembra datos de ejemplo en la base de apps/api/.env.
- `pnpm docs:referencia` — regenera docs/referencia/*.md e indice-de-prompts.md a partir
  de los .docx de docs/referencia/originales/ (requiere pandoc).
- `pnpm docs:verificar` — comprueba que los Markdown estén completos, el índice al día y
  el resumen dentro de 80 líneas.
- Un solo paquete: `pnpm --filter @shiftlane/api test` (lo mismo con web, rider, shared, landing).
- CI: .github/workflows/ci.yml (Node con PostgreSQL+PostGIS en contenedor, y Flutter).

## Convenciones de la API (apps/api)
- Corre con `node src/server.ts` sin compilar (docs/decisiones/0001): imports relativos con
  extensión `.ts`, sin `enum`/`namespace`/propiedades de parámetro (usar `as const`).
- Módulos en src/modules/<modulo>/: routes.ts, service.ts, schemas.ts y tests/.
- Esquemas con `z` importado de src/lib/zod.ts (mensajes en español). Rutas tipadas con
  fastify-type-provider-zod; toda ruta declara `schema` (entrada y respuesta) y `tags`.
- Errores esperados: clases de src/lib/errors.ts (mensaje en español para el usuario). El
  manejador central da el formato `{ error: { code, message, details? }, requestId }`.
- Pruebas con Vitest + Supertest; la base real llega con `inject('databaseUrl')` y la app de
  prueba con test/helpers/app.ts (docs/decisiones/0002). Datos con test/helpers/fixtures.ts.
  Nunca poner `await` dentro de una cadena de Supertest (obtener tokens antes): rompe el
  servidor efímero con "Cannot read properties of null (reading 'address')". Los helpers que
  devuelven una petición de Supertest no deben ser `async` (se pierde `.expect`).
- Base de datos (docs/decisiones/0003): Prisma 7 (cliente generado en src/generated, no se
  versiona). `app.db.app` respeta RLS y siempre se usa dentro de
  `withDbContext(db.app, { tenantId, clientOrgId, userId }, (tx) => ...)`. `app.db.system`
  se salta RLS: solo autenticación, tareas programadas y consola de plataforma.
- Autorización por acción (docs/api.md): rutas de usuarios web con
  `onRequest: requirePermission(app, 'drivers.enroll')`; choferes/pasajeros con
  `requireAuth(app, { kinds: [...] })`. Permisos nuevos se agregan en
  packages/shared/src/permissions.ts y luego `pnpm docs:permisos`.
- En los handlers: `withDbContext(app.db.app, dbContextOf(request), (tx) => ...)` (contexto,
  actor, request id e IP para la bitácora); `authOf(request, 'user')` para leer la sesión.
- Tabla nueva = `tenant_id` + `ENABLE ROW LEVEL SECURITY` + políticas `TO shiftlane_app` +
  `SELECT app.enable_audit('tabla', ARRAY[columnas_sin_importancia])` en la misma migración
  (test/security/tenant-isolation.test.ts y auditoria.test.ts lo exigen).
- Archivos: `app.storage` (src/lib/storage.ts: local, S3/R2/MinIO, memoria en pruebas);
  subir con `readUpload(request, 'document' | 'image' | 'spreadsheet')` (valida por bytes,
  máx. 10 MB) y llaves con `storageKey(tenantId, carpeta, ext)`; descargar con `sendFile`.
- Excel: src/lib/excel.ts (`parseSpreadsheet` valida fila por fila con Zod,
  `buildSpreadsheet`, `buildTemplate`); importar = vista previa con `dryRun` y todo o nada.
- Fechas de negocio como AAAA-MM-DD (`dateString`, `toDbDate`, `fromDbDate` en
  src/lib/http-schemas.ts); estado de documentos con `documentStatus` de @shiftlane/shared.
- Migración nueva: editar prisma/schema.prisma, `pnpm --filter @shiftlane/api db:migrate:new`,
  agregar el SQL de RLS al migration.sql generado y aplicar con `db:migrate`.
  Datos de ejemplo en prisma/seed.ts (`pnpm db:seed`).

## Configuración compartida
- tsconfig.base.json (estricto), eslint.config.mjs (typescript-eslint con tipos),
  .prettierrc.json. Versiones comunes en `catalog:` de pnpm-workspace.yaml.
- TypeScript 6.0: typescript-eslint aún no soporta TypeScript 7.
- Las pruebas de apps/api leen apps/api/.env (no versionado); DATABASE_URL apunta a la base local.

## Entorno local
- Windows 10; Node.js 24 LTS y pnpm 12. Los scripts de package.json deben funcionar en
  Windows y en Linux (CI).
- Flutter 3.47.6 en C:\src\flutter (en el PATH del usuario; en una terminal vieja usar
  C:\src\flutter\bin\flutter).
- PostgreSQL 16 + PostGIS 3.6 nativo (servicio postgresql-x64-16, puerto 5433): rol y base
  `shiftlane`; la contraseña está en apps/api/.env. La del superusuario postgres está en
  %LOCALAPPDATA%\Shiftlane\pg-superuser.txt.
- Docker Desktop instalado; necesita reiniciar la PC (WSL) antes del primer uso.
- pandoc: %LOCALAPPDATA%\Pandoc\pandoc.exe (el script lo encuentra aunque no esté en PATH).
- Blender 5.2: "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" (no está en PATH).
- actionlint (winget) para validar workflows de GitHub Actions.
