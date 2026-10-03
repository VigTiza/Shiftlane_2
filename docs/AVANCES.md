# AVANCES — Shiftlane

## ESTADO ACTUAL (leer primero, máximo 25 líneas)
- Fase actual: F02 — Catálogos
- Último prompt completado: F02-P01
- Siguiente prompt: F02-P02 Clientes, plantas, contratos y tarifas
- Trabajo a medias (si lo hay): ninguno
- Pruebas: todas pasan (`pnpm test`, `pnpm lint`, `pnpm typecheck`)
- Cómo levantar el entorno: `pnpm install`; base local = PostgreSQL nativo (puerto 5433,
  apps/api/.env). Con Docker: `pnpm services:up` (requiere reiniciar la PC una vez).
- Pendientes abiertos:
  - PENDIENTE DE REINICIO: WSL y Docker Desktop instalados, se activan al reiniciar. Tras
    reiniciar: abrir Docker Desktop, `pnpm services:up` (verificar que minio-setup no rompa
    `--wait`) y correr las pruebas con Testcontainers / contra el compose, incluida la de S3
    (S3_TEST_ENDPOINT=http://localhost:9000).
  - Push a GitHub: remoto origin = https://github.com/VigTiza/Shiftlane_2 (público), pero
    falta iniciar sesión (`gh auth login` + `gh auth setup-git`). Los commits están locales
    y el CI no ha corrido todavía.

## DECISIONES IMPORTANTES
- 2026-10-02 Los .docx se convierten con pandoc 3.12 y un script propio
  (infra/scripts/docx-a-markdown.py + .lua): su styles.xml no es legible para pandoc, que
  perdía encabezados y bloques de código. El script usa estilos mínimos sobre una copia y
  marca como código los párrafos sombreados en Consolas. `pnpm docs:verificar` comprueba
  que ningún párrafo se pierda y que el índice de prompts coincida con el plan.
- 2026-10-02 En los Markdown se omiten la portada con «RUTASYNC» y el índice con números
  de página; cada documento abre con un H1 «Shiftlane — <documento>».
- 2026-10-02 Los .docx originales viven en docs/referencia/originales/ como fuente para
  regenerar los Markdown.
- 2026-10-02 pnpm 12.8.1 fijado en packageManager. apps/driver (Flutter) queda fuera del
  workspace de pnpm.
- 2026-10-02 Saltos de línea LF en todo el repo (.gitattributes y .editorconfig) para que
  Windows y el CI en Linux produzcan los mismos archivos.
- 2026-10-02 Las reglas de sesión del usuario (3 a 5 prompts por sesión, detenerse ante
  acciones del usuario, reporte final) quedan en CLAUDE.md para que apliquen siempre.
- 2026-10-03 El usuario confirmó que el nombre es Shiftlane (RUTASYNC era el anterior).
- 2026-10-03 TypeScript 6.0 (no 7): typescript-eslint 8.71 solo soporta TypeScript <6.1.
  Revisar al llegar soporte para TypeScript 7.
- 2026-10-03 PostgreSQL 16 + PostGIS 3.6 nativo en Windows (puerto 5433) para correr
  pruebas de integración mientras Docker espera el reinicio. Docker Compose usa el 5432
  para que ambos convivan. En CI la base es un contenedor postgis/postgis:16-3.5.
- 2026-10-03 Versiones compartidas con `catalog:` de pnpm; Prettier no toca Markdown ni
  apps/driver (Dart usa `dart format`). Lint de TypeScript con información de tipos.
- 2026-10-03 apps/driver se creó con `flutter create --empty` (org mx.shiftlane, paquete
  shiftlane_driver, solo Android). El applicationId mx.shiftlane.shiftlane_driver puede
  cambiarse antes de publicar en Google Play (F21).
- 2026-10-03 El usuario autorizó, solo en esta sesión, avanzar todos los prompts posibles.
- 2026-10-03 La API corre con Node 24 directamente sobre TypeScript, sin compilar
  (docs/decisiones/0001). Imports con extensión .ts en todo el monorepo.
- 2026-10-03 Pruebas de la API con PostgreSQL real: base temporal con TEST_DATABASE_URL o
  Testcontainers (docs/decisiones/0002). El CI ya no usa contenedor de servicio.
- 2026-10-03 Multiempresa (docs/decisiones/0003): rol shiftlane_app sin BYPASSRLS fijado en
  cada conexión; contexto por transacción con set_config local; empresas cliente y plantas
  compartidas, visibles por acuerdo de servicio. REVISAR CON EL USUARIO (fase crítica 01).
- 2026-10-03 Prisma 7.10 con adaptador pg y cliente generado en TypeScript (compatible con
  ejecutar TS directo en Node). `prisma migrate reset` está bloqueado para agentes: usar
  `migrate deploy` o recrear la base local a mano. `migrate dev` no funciona sin terminal
  interactiva cuando hay advertencias: generar el SQL con `prisma migrate diff
  --from-config-datasource --to-schema prisma/schema.prisma --script`.
- 2026-10-03 Autenticación (docs/decisiones/0004): JWT de 15 min + token de renovación
  rotativo con detección de reutilización; cookie httpOnly para web y pasajeros, cuerpo para
  la app del chofer; PIN del chofer ligado al secreto del celular. REVISAR CON EL USUARIO.
- 2026-10-03 Permisos por acción en packages/shared (matriz rol → permisos + ajustes por
  usuario), viajan en el token; docs/api.md se genera con `pnpm docs:permisos`. Planta:
  plant_logistics administra los usuarios de su planta (users.manage).
- 2026-10-03 Auditoría con disparadores de PostgreSQL (app.audit_row / app.enable_audit):
  cubre SQL directo, nunca guarda secretos, ignora columnas sin importancia. audit_log sin
  llaves foráneas para sobrevivir a lo que registra.
- 2026-10-03 Archivos con interfaz ObjectStorage (carpeta local, S3/R2/MinIO); tipo de
  archivo validado por sus bytes. Excel con read-excel-file/write-excel-file (exceljs está
  sin mantenimiento). Importaciones: vista previa por omisión y todo o nada.

## HISTORIAL (más reciente arriba)
### 2026-10-03 — F02-P01 Unidades, choferes y documentos
- Hecho: migración fleet (vehicles, vehicle_documents, driver_documents y campos nuevos de
  drivers: licencia, contacto de emergencia, unidad habitual, foto) con RLS, auditoría y
  restricciones. Almacenamiento de archivos (local/S3/memoria) y subida validada por bytes.
  Módulos vehicles y drivers: CRUD, búsqueda/filtros/paginación, documentos con estado de
  vencimiento (vigente, por vencer a 30 días, vencido), archivo por documento, foto,
  historial (bitácora), importación y exportación en Excel con plantilla. MinIO en el
  compose. Etiquetas en español y documentStatus en packages/shared. Datos de ejemplo
  con unidades y documentos.
- Archivos principales: apps/api/src/modules/{vehicles,drivers}/*, src/lib/{storage,uploads,
  excel,files,http-schemas,prisma-errors}.ts, packages/shared/src/catalogs.ts.
- Pruebas agregadas / resultado: 17 de unidades, 9 de choferes, 3 de almacenamiento (1
  omitida hasta tener MinIO) y 3 de vencimientos en shared. 142 pruebas de la API en verde.
- Problemas encontrados y cómo se resolvieron: tipos de z.coerce en pipe (validadores
  simplificados); regla no-unused-vars con prefijo _ para variables descartadas.
- Pendiente para después: alertas de vencimiento y bloqueos (F11-P01); pantallas (F08-P02).

### 2026-10-03 — F01-P04 Roles, permisos y auditoría
- Hecho: catálogo de 49 permisos por acción y matriz de 11 roles en packages/shared (con
  efectivePermissions y ajustes por usuario); permisos efectivos en el token; middleware
  requirePermission; docs/api.md con convenciones, matriz generada y endpoints. Migración
  permissions_audit: user_permission_overrides con RLS, audit_log con actor_type/actor_id,
  disparador genérico de auditoría en 13 tablas. Módulos users (/users, roles, permisos,
  /me/permissions) y audit (/audit-log). Contexto de BD con actor, request id e IP.
- Archivos principales: packages/shared/src/permissions*.ts, apps/api/src/plugins/auth.ts,
  src/modules/{users,audit}/*, prisma/migrations/*_permissions_audit, docs/api.md.
- Pruebas agregadas / resultado: 9 en shared (matriz, ámbitos, casos permitidos/prohibidos,
  ajustes, docs al día) y 25 en la API (matriz por HTTP por rol, ajustes que cambian el
  acceso, 403 en español, roles de BD = shared, usuarios con validaciones y último dueño,
  auditoría con actor y request id, altas/bajas, secretos, ruido, alcance por tenant,
  cobertura de tablas). 114 pruebas de la API en verde.
- Problemas encontrados y cómo se resolvieron: heredocs de bash con plantillas de TS se
  rompen (se escriben archivos con la herramienta Write); Supertest con await dentro de la
  cadena (calcular tokens antes).
- Pendiente para después: invitar usuarios por correo (F02-P02 para planta, F08-P07 panel).

### 2026-10-03 — F01-P03 Autenticación y sesiones
- Hecho: migración auth (bloqueo y 2FA en users, sesiones para usuario/chofer/pasajero,
  password_reset_tokens, drivers, driver_pins, driver_enrollments, devices, driver_devices,
  passengers, código de activación por planta) con RLS. Módulo auth: argon2id, JWT (jose),
  TOTP propio (RFC 6238), cifrado AES-256-GCM, sesiones rotativas, login web con bloqueo,
  2FA, recuperación por correo (Mailpit/registro), cierre de sesiones; choferes con QR de un
  solo uso, PIN ligado a celular, celular compartido y restablecer PIN; activación de
  pasajeros. Rutas /auth/* y /drivers/:id/{enrollment,pin-reset}. Datos de ejemplo con
  choferes, pasajeros y contraseña de desarrollo (SEED_USER_PASSWORD en .env local).
- Archivos principales: apps/api/src/modules/auth/*, src/modules/drivers/*, src/plugins/auth.ts,
  src/lib/{crypto,mailer}.ts, prisma/migrations/*_auth, docs/decisiones/0004.
- Pruebas agregadas / resultado: 49 pruebas nuevas (TOTP con vectores del RFC, cifrado,
  argon2, login, enumeración, bloqueo, tokens alterados, rotación y reutilización, cierre de
  sesiones, recuperación, 2FA con repetición de código, límite por IP, QR de un solo uso,
  QR vencido, PIN, bloqueo de PIN, celular compartido, restablecer PIN, permisos de
  despachador, pasajeros) y aislamiento de las tablas nuevas. 89 pruebas de la API en verde.
- Problemas encontrados y cómo se resolvieron: base sombra sin _prisma_migrations (REVOKE
  condicional en la migración inicial y base local recreada); `migrate dev` no interactivo
  (SQL con migrate diff); cuerpo nulo en /auth/refresh (nullish); 204 con z.null().
- Pendiente para después: permisos por acción (F01-P04); QR de RH para pasajeros (F10).

### 2026-10-03 — F01-P02 Esquema de base de datos y seguridad por filas
- Hecho: esquema Prisma con tenants, users, roles, user_roles, sessions, audit_log,
  client_orgs, plants (ubicación PostGIS) y service_agreements; todas con created_at,
  updated_at y deleted_at donde aplica. Migración inicial con PostGIS, rol shiftlane_app,
  funciones de contexto en el esquema app, RLS y políticas en todas las tablas, disparadores
  de integridad, catálogo fijo de 11 roles. Capa de datos con db.app (RLS), db.system y
  withDbContext. Datos de ejemplo idempotentes (prisma/seed.ts).
- Archivos principales: apps/api/prisma/{schema.prisma,seed.ts,migrations/}, prisma.config.ts,
  src/lib/db.ts, test/security/tenant-isolation.test.ts, docs/decisiones/0003.
- Pruebas agregadas / resultado: 23 pruebas de aislamiento (RLS en toda tabla, rol sin
  bypass, sin contexto no se ve nada, contexto que no se filtra entre transacciones, lectura,
  SQL sin WHERE, update/delete/insert cruzados, acuerdos y plantas, vista de planta con dos
  transportistas, escalamiento de roles, bitácora inmutable). 40 pruebas de la API en verde.
- Problemas encontrados y cómo se resolvieron: recursión entre políticas (funciones SECURITY
  DEFINER); INSERT RETURNING en client_orgs (condición sobre columnas de la fila); Prisma
  ocultaba el mensaje del disparador con código FK (se usó insufficient_privilege).
- Pendiente para después: las tablas de las fases siguientes deben seguir las reglas del ADR.

### 2026-10-03 — F01-P01 Esqueleto de la API
- Hecho: Fastify 5 + fastify-type-provider-zod (Zod 4 con mensajes en español). Config de
  entorno validada con Zod (src/config/env.ts), Pino con datos sensibles ocultos, manejador
  central de errores en español, Helmet, CORS por lista de orígenes, límite de peticiones
  (429 en español; /health y /ready exentos), x-request-id, OpenAPI en /docs. Módulo
  health con /health (vida) y /ready (base de datos). Scripts dev/start con `node`.
- Archivos principales: apps/api/src/{app,server}.ts, src/config/env.ts, src/lib/*,
  src/plugins/error-handler.ts, src/modules/health/*, test/global-setup.ts, test/helpers/*.
- Pruebas agregadas / resultado: 17 pruebas en la API (config, health/ready con base real y
  sin base, 404, errores de negocio e internos, validación, JSON inválido, encabezados,
  CORS, OpenAPI, límite). Todas pasan. Se probó el servidor real con curl.
- Problemas encontrados y cómo se resolvieron: reglas no-unsafe de ESLint con las respuestas
  de Supertest (se relajaron solo en pruebas); require-await en el plugin de rutas (se usó
  la forma con callback).
- Pendiente para después: correr las pruebas con Testcontainers cuando Docker funcione.

### 2026-10-03 — F00-P03 Entorno local, calidad de código e integración continua
- Hecho: infra/docker-compose.dev.yml (postgis/postgis:16-3.5, redis:8.10-alpine,
  axllent/mailpit:v1.31, puertos solo en 127.0.0.1, chequeos de salud) e infra/.env.example.
  tsconfig.base.json estricto, eslint.config.mjs (typescript-eslint con tipos + Prettier),
  .prettierrc.json. Paquetes @shiftlane/api, web, rider, landing y shared con prueba
  trivial; app Flutter mínima con análisis estricto y prueba de widget. Scripts en la raíz:
  dev, services:up/down, test, lint, format, typecheck, db:migrate, db:seed.
  CI en .github/workflows/ci.yml (job Node con PostGIS en contenedor y job Flutter).
- Instalado en la PC: WSL, Docker Desktop 4.93, Flutter 3.47.6, GitHub CLI, PostgreSQL 16
  + PostGIS 3.6 (nativo), actionlint. Remoto cambiado a VigTiza/Shiftlane_2 y la historia
  local se reubicó sobre su commit inicial (LICENSE Apache 2.0).
- Archivos principales: package.json, pnpm-workspace.yaml, tsconfig.base.json,
  eslint.config.mjs, infra/docker-compose.dev.yml, .github/workflows/ci.yml, apps/*/,
  packages/shared/.
- Pruebas agregadas / resultado: 6 pruebas Vitest (incluye conexión a PostgreSQL con PostGIS
  si hay DATABASE_URL) y 1 de Flutter; lint, tipos y actionlint sin problemas. El compose
  se validó con `docker compose config` (sin levantarlo: falta el reinicio).
- Problemas encontrados y cómo se resolvieron: TypeScript 7 incompatible con
  typescript-eslint (se fijó 6.0); el tar de Git Bash no abre .zip (se usó el de Windows);
  pnpm 12 agregó una excepción de antigüedad mínima para eslint 10.12.0.
- Pendiente para después: levantar el compose y correr el CI real (reinicio y login de GitHub).

### 2026-10-02 — F00-P02 Documentos de referencia en Markdown
- Hecho: la conversión de los .docx y la revisión de tablas y listas se hicieron antes de
  F00-P01 (ver esa entrada). En este prompt se agregó docs/referencia/resumen.md (65 líneas:
  módulos, usuarios, reglas clave, planes y reglas de cobro, etapas) y su referencia en
  CLAUDE.md.
- Archivos principales: docs/referencia/resumen.md, CLAUDE.md, infra/scripts/docx-a-markdown.py.
- Pruebas agregadas / resultado: `pnpm docs:verificar` ahora también falla si falta el
  resumen o si pasa de 80 líneas. Pasa; se comprobó que falla con 85 líneas.
- Problemas encontrados y cómo se resolvieron: ninguno.
- Pendiente para después: el resumen se escribe a mano; si cambian los .docx, revisarlo.

### 2026-10-02 — F00-P01 Estructura del monorepo, CLAUDE.md y bitácora
- Hecho: monorepo pnpm (package.json, pnpm-workspace.yaml) con apps/api, apps/web,
  apps/rider, apps/driver, apps/landing, packages/shared, assets/3d, infra, docs/referencia,
  docs/decisiones, docs/manuales y .github/workflows. CLAUDE.md completado (documentos,
  reglas de sesión, estructura, comandos, entorno) sin reemplazar su contenido.
  .gitignore, .editorconfig, .gitattributes, README.md y .env.example por app.
  git inicializado en la rama main.
- Antes de este prompt (pasos pedidos por el usuario): los 3 .docx convertidos a
  docs/referencia/{plan-de-desarrollo,descripcion-funcional,sistema-de-precios}.md con sus
  imágenes en docs/referencia/img/; índice de los 76 prompts en
  docs/referencia/indice-de-prompts.md; AVANCES.md movido a docs/.
- Archivos principales: CLAUDE.md, package.json, pnpm-workspace.yaml, README.md,
  infra/scripts/docx-a-markdown.py, infra/scripts/docx-a-markdown.lua, docs/referencia/*.
- Pruebas agregadas / resultado: `pnpm test` verifica que cada párrafo de los .docx esté
  en el Markdown, que las imágenes existan y que el índice coincida con la tabla resumen
  del plan (76 prompts, 23 fases). Pasa. Se comprobó que falla si se altera un documento.
- Problemas encontrados y cómo se resolvieron: pandoc no estaba instalado (se instaló con
  winget); pandoc ignoraba los estilos de los .docx (se resolvió con el script). pnpm no
  estaba instalado (se instaló con npm). Git no tenía identidad configurada: se configuró
  solo para este repositorio con los datos del usuario.
- Pendiente para después: Docker y Flutter para F00-P03.
