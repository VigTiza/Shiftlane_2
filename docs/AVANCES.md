# AVANCES — Shiftlane

## ESTADO ACTUAL (leer primero, máximo 25 líneas)
- Fase actual: F04 — Programación de servicios
- Último prompt completado: F04-P01 Generador de viajes
- Siguiente prompt: F04-P02 Asignación y conflictos
- Trabajo a medias (si lo hay): ninguno
- Pruebas: todas pasan (`pnpm test`, `pnpm lint`, `pnpm typecheck`)
- Cómo levantar el entorno: `pnpm install`; base local = PostgreSQL nativo (puerto 5433,
  apps/api/.env). Con Docker: `pnpm services:up` (requiere reiniciar la PC una vez).
- Pendientes abiertos:
  - PENDIENTE DE REINICIO: WSL y Docker Desktop instalados, se activan al reiniciar. Tras
    reiniciar: abrir Docker Desktop, `pnpm services:up` (verificar que minio-setup no rompa
    `--wait`) y correr las pruebas con Testcontainers / contra el compose, incluida la de S3
    (S3_TEST_ENDPOINT=http://localhost:9000).
  - GitHub: origin = https://github.com/VigTiza/Shiftlane_2 (público), con acceso por el
    administrador de credenciales de Git. El CI pasó completo (incluye Testcontainers y
    Flutter en GitHub). Revisar el resultado tras cada push.
  - F04-P02: llenar chofer en los viajes de la simulación y la lista de choferes afectados.
  - Tareas programadas: hoy corren dentro de la API (temporizador + candado de PostgreSQL).
    Pasarlas a BullMQ cuando Redis esté disponible (tras el reinicio y Docker).
  - Deuda técnica: varios servicios usan Promise.all dentro de transacciones (pg avisa que
    pg@9 lo prohibirá); volverlos secuenciales antes de actualizar pg.
  - La API de desarrollo se puede levantar con `node src/server.ts` en apps/api (puerto
    3000, documentación en http://localhost:3000/docs).

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
- 2026-10-03 Motor de tarifas en packages/shared (centavos; tarifa ganadora por prioridad y
  especificidad; per_vehicle = precio por viaje según capacidad; viaje no realizado = no se
  cobra y su penalización queda a favor del cliente). Invitaciones de planta con fusión de
  empresas duplicadas (ver ADR 0003). Autorización en onRequest (403 antes de validar).
- 2026-10-03 Credencial QR del pasajero firmada con Ed25519 (CREDENTIAL_SIGNING_KEY); la app
  del chofer verificará sin señal con /credentials/public-key. Carga de empleados en dos
  pasos (vista previa guardada y aplicación recalculada, todo o nada); las filas se borran al
  aplicar o descartar. passenger_imports no se audita (datos personales).
- 2026-10-03 Rutas versionadas por fecha (valid_from); las versiones vigentes o pasadas son
  inmutables; cambios temporales = versión alterna entre dos fechas (gana a la regular).
  Paradas con stop_key estable entre versiones. Una transportista nunca ve rutas ni turnos de
  otra en la misma planta; la planta ve las de sus transportistas. La auditoría omite el trazo
  PostGIS (app.enable_audit acepta columnas omitidas).
- 2026-10-03 Rutas por calles con proveedor configurable (OSRM o línea recta), caché en la
  base y respaldo automático; funciones geográficas en packages/shared (verificadas contra
  PostGIS) y equivalentes PostGIS en el servidor.
- 2026-10-03 Cambios temporales sin traslapes (máx. 180 días), con versión alterna o
  suspensión del servicio; solo aplican si la ruta ya existía. Pasajeros asignados a paradas
  por stop_key (route_passengers). La simulación no guarda nada.

- 2026-10-03 Viajes regulares idempotentes con generation_key «ruta:fecha». Regenerar
  cancela con motivo «[Automático] …» y solo reactiva esas cancelaciones; no toca viajes
  iniciados, terminados o cancelados a mano, ni fechas pasadas. Los cambios de ruta, turno,
  festivo y cambio temporal ajustan los viajes en la misma transacción. Las transportistas
  suspendidas siguen generando viajes (la operación no se detiene por cobro).
- 2026-10-03 La tarea diaria (14 días por adelantado) corre dentro de la API con un candado
  de PostgreSQL por transportista (pg_try_advisory_xact_lock); BullMQ queda para cuando haya
  Redis. Se desactiva en pruebas (SCHEDULER_ENABLED).
- 2026-10-03 Festivos por transportista, generales o por planta, con «hay servicio» (se marca
  is_holiday para tarifa especial) o «sin servicio». Se importan los de la LFT art. 74.

## HISTORIAL (más reciente arriba)
### 2026-10-03 — F04-P01 Generador de viajes
- Hecho: packages/shared/src/calendar.ts (festivos LFT art. 74 con lunes móviles y
  transmisión del Ejecutivo; hora local a UTC con horario de verano). Migración trips:
  shifts.weekdays, holidays (único general por día con NULLS NOT DISTINCT), trips (estado,
  tipo, sentido, fecha de servicio, horarios, festivo, generation_key). RLS: festivos de la
  transportista; viajes de la transportista y visibles para la planta con acuerdo; sin DELETE.
  Generador idempotente (src/modules/schedule/generator.ts) con turnos, días de la semana,
  festivos, cambios temporales, versiones, acuerdo vigente y turnos que cruzan la medianoche.
  Endpoints /schedule/generate, /trips, /holidays (+ /holidays/official). Tarea diaria
  src/jobs/trip-horizon.ts. Ajuste automático tras cambios de rutas, versiones, turnos,
  festivos y cambios temporales. La simulación lista los viajes programados afectados.
- Archivos principales: apps/api/src/modules/schedule/*, apps/api/src/jobs/trip-horizon.ts,
  prisma/migrations/*_trips, packages/shared/src/calendar.ts.
- Pruebas agregadas / resultado: 5 de calendario en shared y 14 de integración (horizonte al
  crear la ruta, idempotencia, validaciones y permisos, días del turno, salida y medianoche,
  horario de verano, festivo por planta sin/con servicio, festivos LFT sin repetir,
  suspensión y su cancelación, cambio de horario y versión nueva, viajes iniciados y
  cancelaciones manuales intactos, simulación, tarea diaria, visibilidad planta/rival). 236
  pruebas de la API y 42 de shared en verde.
- Problemas encontrados y cómo se resolvieron: `dart` no estaba en el PATH de la terminal
  (se usa C:\src\flutter\bin). El aviso de pg por consultas en paralelo dentro de
  transacciones queda como deuda técnica.
- Pendiente para después: choferes en la simulación (F04-P02); BullMQ con Redis.

### 2026-10-03 — F03-P03 Cambios temporales y simulación
- Hecho: vigencia con suspensión (versionId nulo); cambios temporales con versión alterna o
  servicio suspendido, validación de fechas, traslapes y duración, cancelación; asignación de
  pasajeros a paradas (route_passengers, RLS y auditoría); simulación sin guardar de cambios
  temporales o versiones nuevas: periodo afectado, paradas agregadas/quitadas/movidas/con
  otro horario, distancia y tiempo antes y después, pasajeros afectados con el motivo.
- Archivos principales: apps/api/src/modules/routes/{temporary-changes,route-passengers,
  versioning}.ts, prisma/migrations/*_temporary_changes.
- Pruebas agregadas / resultado: 2 unitarias nuevas de vigencia y 8 de integración
  (reversión automática, suspensión, validaciones, cancelación, pasajeros por parada,
  simulación con motivos y sin guardar, suspensión simulada, periodo de una versión). 222
  pruebas de la API en verde.
- Problemas encontrados y cómo se resolvieron: reemplazos de texto que fallaron por el
  formato de Prettier (se hicieron por posición).
- Pendiente para después: viajes y choferes afectados en la simulación (F04).

### 2026-10-03 — F03-P02 Cálculos geográficos
- Hecho: packages/shared/src/geo.ts (haversine, longitud, distancia punto-segmento y al
  trazado, parada más cercana con radio, tiempo estimado). src/lib/routing.ts: OSRM con
  tiempo límite, línea recta, caché en routing_cache y respaldo automático. Las versiones de
  ruta calculan trazo, distancia y tiempo por calles hasta la planta (o respetan el trazo
  dibujado) y guardan routing_source. Endpoints de vista previa, parada más cercana y
  distancia al trazado con PostGIS. Botón «Authorize» en /docs para probar con token.
- Archivos principales: packages/shared/src/geo.ts, apps/api/src/lib/routing.ts,
  src/modules/routes/{service,routes,schemas}.ts, prisma/migrations/*_routing.
- Pruebas agregadas / resultado: 9 geográficas en shared con lugares de Ciudad Juárez y 9 en
  la API (PostGIS vs shared ±0.5 %, OSRM simulado con caché, falla, tiempo agotado, trazo por
  calles hasta la planta, trazo manual, parada más cercana, desvío, vista previa). 212
  pruebas de la API y 37 de shared en verde.
- Problemas encontrados y cómo se resolvieron: `app.routing` ya existe en Fastify (la
  decoración se llama routingProvider).
- Pendiente para después: OSRM propio con extracto de México en producción (F21).

### 2026-10-03 — F03-P01 Modelo de rutas con PostGIS
- Hecho: lógica pura de vigencia (versioning.ts: versión efectiva por fecha con cambios
  temporales; horario de parada por día). Migración routes: shifts, routes (sentido, planta,
  turno), route_versions (trazo LineString, distancia calculada por PostGIS), stops (punto,
  geocerca, stop_key), route_stop_times (variantes por día), temporary_changes; llave foránea
  de rates.route_id. RLS por transportista con visibilidad para la planta; auditoría con
  columnas omitidas. Módulo routes: turnos, CRUD de rutas, versiones (crear, ver, eliminar
  futuras, restaurar), versión vigente por fecha.
- Archivos principales: apps/api/src/modules/routes/*, prisma/migrations/*_routes.
- Pruebas agregadas / resultado: 6 unitarias de vigencia y 11 de integración (alta con
  distancia, horarios en orden, claves, plantas sin acuerdo, versiones futuras, pasado,
  eliminar, restaurar con stop_key, cambio temporal, turnos, aislamiento entre
  transportistas en la misma planta y visibilidad para la planta). 203 pruebas de la API.
- Problemas encontrados y cómo se resolvieron: Prisma no inserta columnas PostGIS
  obligatorias (paradas con SQL parametrizado); helper de prueba async (nota en CLAUDE.md).
- Pendiente para después: asignación de pasajeros a paradas (por stop_key) cuando la
  necesite la programación (F04) o el editor (F08-P03).

### 2026-10-03 — F02-P03 Pasajeros y credenciales
- Hecho: migración passengers (turno y teléfono en passengers; passenger_credentials,
  provisional_badges y passenger_imports) con RLS y auditoría. Firmado Ed25519 de
  credenciales. Módulo passengers: CRUD para RH, consulta para transportistas con acuerdo,
  credencial QR (emitir, reemitir, ver en la app del pasajero), gafetes existentes de la
  planta, verificación por el chofer (QR firmado o gafete), gafetes provisionales (registrar,
  resolver, descartar) y carga de Excel con vista previa de diferencias (altas, cambios,
  bajas, reactivaciones; modos solo cambios y lista completa).
- Archivos principales: apps/api/src/modules/passengers/*, src/lib/credential-signer.ts,
  prisma/migrations/*_passengers.
- Pruebas agregadas / resultado: 15 de pasajeros (aislamiento, duplicados, permisos, firma,
  reemisión, alteración, verificación sin señal con llave pública, bajas, app del pasajero,
  gafetes, provisionales, Excel con errores, carga mixta, lista completa, cambios entre
  vista previa y aplicación). 186 pruebas de la API en verde.
- Problemas encontrados y cómo se resolvieron: ninguno relevante.
- Pendiente para después: contexto de base de datos propio del pasajero (F10); la app del
  chofer descargará la lista y la llave pública para validar sin señal (F07-P06).

### 2026-10-03 — F02-P02 Clientes, plantas, contratos y tarifas
- Hecho: motor de tarifas y penalizaciones (packages/shared/src/contract-rates.ts).
  Migración crm (plant_gates con QR fijo, client_contacts, contracts, rates, penalties,
  leads, plant_invitations) con RLS (contratos y contactos solo de empresas atendidas o
  administradas, verificado en la base), auditoría y CHECKs. Módulos clients (empresas,
  plantas con ubicación PostGIS y código de activación, puertas, contactos), contracts
  (tarifas con condiciones, penalizaciones, cotizador), leads (etapas y conversión) e
  invitations (invitar por correo, aceptar creando cuenta, aceptar con cuenta existente y
  fusionar datos). Autorización movida de preHandler a onRequest.
- Archivos principales: packages/shared/src/contract-rates.ts, apps/api/src/modules/{clients,
  contracts,leads,invitations}/*, prisma/migrations/*_crm.
- Pruebas agregadas / resultado: 16 del motor de tarifas y 29 de la API (clientes, puertas,
  contactos, aislamiento, contratos, cotizador con domingo/nocturno/km/pasajero/penalizaciones,
  prospectos, invitaciones y fusión). 171 pruebas de la API y 28 de shared en verde.
- Problemas encontrados y cómo se resolvieron: 400 antes de 403 por validar el cuerpo antes
  del preHandler (autorización a onRequest); Supertest con await en cadena (nota en CLAUDE.md).
- Pendiente para después: route_id de las tarifas sin llave foránea hasta F03; los pasajeros
  de una empresa provisional no se mueven en la fusión (revisar en F02-P03/F09).

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
