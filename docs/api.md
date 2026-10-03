# API de Shiftlane

Referencia técnica de la API (apps/api). La documentación interactiva de cada endpoint está
en `/docs` (OpenAPI) cuando la API corre con `API_DOCS_ENABLED=true`.

## Convenciones

- Todas las entradas se validan con Zod; los mensajes de error están en español.
- Formato de error:
  `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "path", "message" }] }, "requestId": "..." }`.
  El encabezado `x-request-id` permite rastrear la petición en los registros.
- Autenticación: `Authorization: Bearer <token de acceso>` (15 minutos). El token de
  renovación viaja en la cookie `shiftlane_rt` (web y pasajeros) o en el cuerpo (app del
  chofer). Ver docs/decisiones/0004-autenticacion.md.
- El tenant y la empresa cliente salen siempre del token, nunca de la petición. La base de
  datos aplica seguridad por filas (docs/decisiones/0003-multiempresa-y-seguridad-por-filas.md).
- Códigos comunes: 400 datos inválidos, 401 sin sesión, 403 sin permiso, 404 no existe o no
  es visible para la cuenta, 409 conflicto, 423 acceso bloqueado, 429 demasiadas peticiones.

## Permisos

La autorización es por acción: cada endpoint exige un permiso (por ejemplo,
`drivers.enroll`). Un usuario tiene los permisos de sus roles, más los que se le otorguen y
menos los que se le quiten (`PUT /users/:id/permissions`), siempre dentro de su ámbito
(transportista, planta o plataforma). Los permisos efectivos viajan en el token de acceso,
así que un cambio surte efecto en la siguiente renovación (máximo 15 minutos).

La matriz se define en `packages/shared/src/permissions.ts` y esta tabla se genera con
`pnpm docs:permisos`; una prueba falla si no está al día.

<!-- matriz-permisos:inicio (generado, no editar) -->

| Permiso | Ámbito | Descripción | `owner` | `manager` | `planner` | `dispatcher` | `billing` | `maintenance` | `driver` | `plant_logistics` | `plant_hr` | `passenger` | `platform_admin` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `users.read` | Transportista, Planta | Ver usuarios de la cuenta y sus roles | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |
| `users.manage` | Transportista, Planta | Invitar, desactivar usuarios y asignar roles o permisos | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |
| `audit.read` | Transportista, Planta | Ver el historial de cambios | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |
| `dashboard.view` | Transportista | Ver el tablero de inicio | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `settings.manage` | Transportista | Configurar turnos, reglas de operación, plantillas y datos fiscales | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `subscription.manage` | Transportista | Ver y administrar la suscripción y las facturas de Shiftlane | ✓ |  |  |  |  |  |  |  |  |  |  |
| `vehicles.read` | Transportista | Ver unidades | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `vehicles.write` | Transportista | Dar de alta y editar unidades | ✓ | ✓ |  |  |  | ✓ |  |  |  |  |  |
| `drivers.read` | Transportista | Ver choferes | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `drivers.write` | Transportista | Dar de alta y editar choferes | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |
| `drivers.enroll` | Transportista | Generar el QR de alta del chofer y restablecer su PIN | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |
| `devices.manage` | Transportista | Administrar celulares, modo kiosco y bloqueo remoto | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `clients.read` | Transportista | Ver clientes, plantas y prospectos | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `clients.write` | Transportista | Editar clientes, plantas, contactos y prospectos | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `contracts.read` | Transportista | Ver contratos y tarifas | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |
| `contracts.write` | Transportista | Editar contratos, tarifas y penalizaciones | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `passengers.read` | Transportista | Ver pasajeros de las plantas atendidas | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `routes.read` | Transportista | Ver rutas y paradas | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `routes.write` | Transportista | Editar rutas, paradas y cambios temporales | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `schedule.read` | Transportista | Ver la programación de viajes | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `schedule.write` | Transportista | Programar viajes y asignar unidades y choferes | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `requests.manage` | Transportista | Atender solicitudes de las plantas | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `monitoring.view` | Transportista | Ver el monitoreo en vivo | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `dispatch.operate` | Transportista | Reasignar viajes, enviar unidad de respaldo y mensajes al chofer | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |
| `alerts.manage` | Transportista | Atender alertas e incidentes | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |
| `trips.execute` | Transportista | Ejecutar viajes desde la app del chofer |  |  |  |  |  |  | ✓ |  |  |  |  |
| `compliance.read` | Transportista | Ver documentos y vencimientos | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `compliance.write` | Transportista | Cargar y actualizar documentos | ✓ | ✓ |  |  |  | ✓ |  |  |  |  |  |
| `maintenance.read` | Transportista | Ver mantenimiento y combustible | ✓ | ✓ |  |  |  | ✓ |  |  |  |  |  |
| `maintenance.write` | Transportista | Registrar servicios, reparaciones y cargas de combustible | ✓ | ✓ |  |  |  | ✓ |  |  |  |  |  |
| `reconciliation.manage` | Transportista | Conciliar viajes, generar prefacturas y responder objeciones | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| `invoicing.manage` | Transportista | Emitir facturas y registrar cobranza | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| `reports.operations` | Transportista | Ver reportes de operación, ocupación, choferes, unidades y clientes | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `reports.finance` | Transportista | Ver reportes financieros | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |  |
| `plant.dashboard` | Planta | Ver el tablero en vivo de sus rutas |  |  |  |  |  |  |  | ✓ | ✓ |  |  |
| `plant.evidence` | Planta | Ver evidencia por viaje y puntualidad |  |  |  |  |  |  |  | ✓ |  |  |  |
| `plant.requests` | Planta | Solicitar viajes extra y cambios, y presentar quejas |  |  |  |  |  |  |  | ✓ |  |  |  |
| `plant.prefactures` | Planta | Revisar, objetar y aprobar prefacturas |  |  |  |  |  |  |  | ✓ |  |  |  |
| `plant.employees` | Planta | Administrar la lista de empleados y los gafetes provisionales |  |  |  |  |  |  |  |  | ✓ |  |  |
| `plant.attendance` | Planta | Ver la asistencia transportada |  |  |  |  |  |  |  |  | ✓ |  |  |
| `plant.compliance` | Planta | Ver el cumplimiento de sus proveedores |  |  |  |  |  |  |  | ✓ |  |  |  |
| `plant.complaints` | Planta | Ver encuestas y quejas de empleados |  |  |  |  |  |  |  |  | ✓ |  |  |
| `plant.reports` | Planta | Descargar reportes y configurar avisos |  |  |  |  |  |  |  | ✓ | ✓ |  |  |
| `passenger.self` | Planta | Ver su ruta, su credencial y sus avisos; calificar viajes |  |  |  |  |  |  |  |  |  | ✓ |  |
| `platform.accounts` | Plataforma | Administrar cuentas y pilotos |  |  |  |  |  |  |  |  |  |  | ✓ |
| `platform.billing` | Plataforma | Administrar suscripciones, igualaciones y cobranza |  |  |  |  |  |  |  |  |  |  | ✓ |
| `platform.support` | Plataforma | Atender tickets y entrar a cuentas con permiso del cliente |  |  |  |  |  |  |  |  |  |  | ✓ |
| `platform.health` | Plataforma | Ver la salud de clientes y del sistema |  |  |  |  |  |  |  |  |  |  | ✓ |
| `platform.announcements` | Plataforma | Publicar avisos |  |  |  |  |  |  |  |  |  |  | ✓ |

Roles:

- `owner`: Dueño
- `manager`: Gerente
- `planner`: Programador de rutas
- `dispatcher`: Despachador
- `billing`: Administración
- `maintenance`: Mantenimiento
- `driver`: Chofer
- `plant_logistics`: Logística de planta
- `plant_hr`: Recursos humanos de planta
- `passenger`: Pasajero
- `platform_admin`: Administrador de plataforma

<!-- matriz-permisos:fin -->

## Auditoría

Toda creación, edición y borrado en las tablas de negocio queda en `audit_log` mediante
disparadores de PostgreSQL, aunque el cambio se haga con SQL directo. Cada registro guarda
quién (`actor_type`, `actor_id`), qué (`entity_type`, `entity_id`, `action`), el antes y
el después, la petición (`request_id`) y la IP. Nunca guarda hashes ni secretos; si cambia
uno, solo se anota su nombre en `_secretos_cambiados`. La bitácora no se puede modificar
ni borrar desde la API. Se consulta con `GET /audit-log` (permiso `audit.read`).

## Endpoints

| Método | Ruta | Permiso o sesión | Descripción |
|---|---|---|---|
| GET | /health, /ready | — | Salud del proceso y de la base de datos |
| POST | /auth/login, /auth/login/2fa | — | Inicio de sesión web (con 2FA opcional) |
| POST | /auth/refresh, /auth/logout | cookie o token | Renovar o cerrar la sesión |
| POST | /auth/logout-all | usuario web | Cerrar todas las sesiones |
| GET/DELETE | /auth/sessions, /auth/sessions/:id | usuario web | Sesiones abiertas |
| GET | /auth/me | cualquier sesión | Datos de la sesión |
| POST | /auth/password/forgot, /auth/password/reset | — | Recuperar contraseña |
| POST | /auth/2fa/setup, /enable, /disable | usuario web | Verificación en dos pasos |
| POST | /auth/driver/enroll, /login, /pin, /device-drivers | celular | Acceso de choferes |
| POST | /auth/passenger/activate | — | Activación de pasajeros |
| GET | /me/permissions | usuario web | Permisos efectivos |
| POST | /drivers/:id/enrollment, /drivers/:id/pin-reset | `drivers.enroll` | QR de alta y restablecer PIN |
| GET | /users | `users.read` | Usuarios de la cuenta |
| PATCH | /users/:id | `users.manage` | Datos y estado de un usuario |
| PUT | /users/:id/roles | `users.manage` | Roles de un usuario |
| PUT | /users/:id/permissions | `users.manage` | Permisos otorgados o quitados |
| GET | /audit-log | `audit.read` | Historial de cambios |
| GET/POST | /vehicles | `vehicles.read` / `vehicles.write` | Buscar (search, status, page, pageSize) y dar de alta unidades |
| GET/PATCH/DELETE | /vehicles/:id | `vehicles.read` / `vehicles.write` | Detalle con documentos, edición y baja |
| GET | /vehicles/:id/history | `vehicles.read` | Historial de la unidad y sus documentos |
| GET/PUT | /vehicles/:id/photo | `vehicles.read` / `vehicles.write` | Foto (JPG, PNG o WebP) |
| POST | /vehicles/:id/documents | `vehicles.write` o `compliance.write` | Documento con vencimiento |
| PATCH/DELETE | /vehicle-documents/:id | `vehicles.write` o `compliance.write` | Editar o eliminar documento |
| GET/PUT | /vehicle-documents/:id/file | lectura / escritura de documentos | Archivo del documento (PDF o imagen, máx. 10 MB) |
| GET | /vehicles/export, /vehicles/import/template | `vehicles.read` | Excel de unidades y plantilla |
| POST | /vehicles/import?dryRun= | `vehicles.write` | Carga desde Excel; dryRun=true valida sin guardar |
| GET/POST | /drivers | `drivers.read` / `drivers.write` | Buscar y dar de alta choferes |
| GET/PATCH/DELETE | /drivers/:id | `drivers.read` / `drivers.write` | Detalle con documentos y acceso, edición y baja |
| GET | /drivers/:id/history | `drivers.read` | Historial del chofer, su PIN y sus documentos |
| GET/PUT | /drivers/:id/photo | `drivers.read` / `drivers.write` | Foto del chofer |
| POST | /drivers/:id/documents | `drivers.write` o `compliance.write` | Licencia, examen médico, antidoping, capacitación |
| PATCH/DELETE | /driver-documents/:id | `drivers.write` o `compliance.write` | Editar o eliminar documento |
| GET/PUT | /driver-documents/:id/file | lectura / escritura de documentos | Archivo del documento |
| GET | /drivers/export, /drivers/import/template | `drivers.read` | Excel de choferes y plantilla |
| POST | /drivers/import?dryRun= | `drivers.write` | Carga desde Excel (unidad habitual por número económico) |

| GET/POST | /client-orgs | `clients.read` / `clients.write` | Empresas cliente (atendidas o administradas) y alta |
| GET/PATCH | /client-orgs/:id | `clients.read` / `clients.write` | Ficha con plantas, contactos y contratos; editar solo si la administra |
| POST | /client-orgs/:id/plants | `clients.write` | Planta (ubicación, código de activación) y su acuerdo de servicio |
| GET/PATCH | /plants/:id | `clients.read` / `clients.write` | Planta con sus puertas |
| POST | /plants/:id/gates | `clients.write` | Puerta con QR fijo de llegada |
| PATCH | /plant-gates/:id, POST /plant-gates/:id/rotate-qr | `clients.write` | Editar, desactivar o rotar el QR |
| GET/POST | /client-orgs/:id/contacts | `clients.read` / `clients.write` | Contactos por área |
| PATCH/DELETE | /client-contacts/:id | `clients.write` | Editar o eliminar contacto |
| GET/POST | /leads | `clients.read` / `clients.write` | Prospectos por etapa |
| PATCH/DELETE | /leads/:id | `clients.write` | Cambiar etapa (perdido exige motivo) |
| POST | /leads/:id/convert | `clients.write` | Convertir en empresa cliente con planta y contacto |
| GET/POST | /contracts | `contracts.read` / `contracts.write` | Contratos |
| GET/PATCH/DELETE | /contracts/:id | `contracts.read` / `contracts.write` | Contrato con tarifas y penalizaciones |
| POST | /contracts/:id/rates, PATCH/DELETE /rates/:id | `contracts.write` | Tarifas por viaje, ruta, km, unidad o pasajero, con condiciones |
| POST | /contracts/:id/penalties, PATCH/DELETE /penalties/:id | `contracts.write` | Penalizaciones (fijas o porcentaje) |
| POST | /contracts/:id/quote | `contracts.read` | Cotizar un viaje con el motor de tarifas |
| GET/POST | /plants/:id/invitations | `clients.read` / `clients.write` | Invitar por correo a usuarios de la planta |
| DELETE | /plant-invitations/:id | `clients.write` | Cancelar invitación |
| POST | /invitations/accept | — | Aceptar creando la cuenta (la empresa pasa a administrarse sola) |
| POST | /invitations/accept-existing | `users.manage` (planta) | Aceptar con una cuenta de planta existente (fusiona los datos capturados) |

| GET/POST | /passengers | `plant.employees` (o `passengers.read` para ver) | Empleados de la planta |
| GET/PATCH | /passengers/:id | `plant.employees` (o `passengers.read` para ver) | Detalle con credenciales, edición y baja |
| POST | /passengers/:id/credential | `plant.employees` | Emite credencial QR firmada (la anterior deja de servir) |
| POST | /passengers/:id/badges | `plant.employees` | Registra el gafete existente (código de barras o QR) |
| DELETE | /passenger-credentials/:id | `plant.employees` | Da de baja una credencial |
| GET | /passenger-imports/template | `plant.employees` | Plantilla de Excel de empleados |
| GET/POST | /passenger-imports?plantId=&mode=changes\|full | `plant.employees` | Sube el Excel y devuelve la vista previa de diferencias |
| POST | /passenger-imports/:id/apply, /discard | `plant.employees` | Aplica (todo o nada, recalculando) o descarta |
| GET | /me/credential | pasajero | Credencial QR para abordar |
| GET | /credentials/public-key | — | Llave pública Ed25519 para verificar credenciales sin señal |
| POST | /credentials/verify | chofer | Identifica al pasajero por QR firmado o gafete |
| POST | /provisional-badges | chofer | Registra un gafete desconocido sin detener el viaje |
| GET | /provisional-badges | `plant.employees` o `passengers.read` | Gafetes provisionales |
| POST | /provisional-badges/:id/resolve, /dismiss | `plant.employees` | Asignar a un empleado o descartar |

| GET/POST | /shifts | `routes.read` / `routes.write` o `settings.manage` | Turnos de las plantas atendidas |
| PATCH | /shifts/:id | `routes.write` o `settings.manage` | Editar o desactivar turno |
| GET/POST | /routes | `routes.read` / `routes.write` | Rutas con su versión vigente; alta con primera versión |
| GET/PATCH/DELETE | /routes/:id | `routes.read` / `routes.write` | Historial de versiones y cambios temporales; datos generales |
| GET | /routes/:id/effective?date= | `routes.read` | Versión que aplica en una fecha (incluye cambios temporales) |
| POST | /routes/:id/versions | `routes.write` | Versión nueva desde hoy o una fecha futura |
| GET/DELETE | /routes/:id/versions/:versionId | `routes.read` / `routes.write` | Detalle (paradas, horarios, trazo GeoJSON); eliminar solo futuras |
| POST | /routes/:id/versions/:versionId/restore | `routes.write` | Restaurar una versión anterior como nueva |

| POST | /routes/:id/temporary-changes | `routes.write` | Cambio temporal: otras paradas u horarios, o servicio suspendido, entre dos fechas |
| POST | /temporary-changes/:id/cancel | `routes.write` | Cancelar un cambio que no ha terminado |
| POST | /routes/:id/simulate | `routes.read` | Simular un cambio (temporal o versión) sin guardar: paradas, tiempos y pasajeros afectados |
| GET/PUT | /routes/:id/passengers | `routes.read` / `routes.write` | Pasajeros asignados a cada parada (por stop_key) |
| POST | /routing/preview | `routes.read` | Distancia, tiempo y trazo por calles entre puntos (OSRM o línea recta) |
| GET | /route-versions/:id/nearest-stop?lat=&lng=&maxMeters= | `routes.read` | Parada más cercana dentro del radio |
| GET | /route-versions/:id/distance-to-path?lat=&lng=&thresholdMeters= | `routes.read` | Distancia al trazado y si es desvío |

Rutas por calles: `ROUTING_PROVIDER=osrm` con `ROUTING_URL` (OSRM propio con extracto de
México) o `straight_line`. Resultados en caché (tabla routing_cache, 30 días); si OSRM falla
o tarda más de `ROUTING_TIMEOUT_MS`, se usa la línea recta y la operación sigue. Cada versión
guarda su origen (`routingSource`: osrm, straight_line o manual).

Vigencia de rutas: la versión regular aplica desde su `validFrom` hasta que empieza otra;
un cambio temporal vigente gana a la versión regular. Las versiones que ya empezaron no se
modifican (un cambio crea otra versión) y no se crean versiones en el pasado.

Credencial QR del pasajero: `SL1.<datos en base64url>.<firma Ed25519>`; los datos llevan
credencial, pasajero, empresa y un valor aleatorio que cambia al reemitirla.

Las cargas de Excel validan cada fila y devuelven `{ totalRows, created, updated, errors: [{ row, column, message }], applied }`.
Si hay un solo error no se guarda nada.
