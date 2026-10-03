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

| GET/POST | /shifts | `routes.read` / `routes.write` o `settings.manage` | Turnos de las plantas atendidas (con días de la semana; por omisión, lunes a viernes) |
| PATCH | /shifts/:id | `routes.write` o `settings.manage` | Editar o desactivar turno (ajusta los viajes ya generados) |
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

| POST | /schedule/generate | `schedule.write` | Genera los viajes regulares de un rango (máx. 62 días) y asigna los habituales; idempotente |
| PUT | /trips/:id/assignment | `schedule.write` | Asigna unidad y chofer; 409 `ASSIGNMENT_CONFLICTS` si hay conflictos que bloquean (con `force: true` asigna de todos modos) |
| POST | /schedule/auto-assign | `schedule.write` | Chofer y unidad habituales a los viajes sin asignar (no toca manuales ni copiados) |
| POST | /schedule/copy-week | `schedule.write` | Copia la asignación de una semana (lunes) a otra; respeta manuales salvo `overwrite` |
| GET | /schedule/conflicts?from=&to=&plantId=&routeId=&severity= | `schedule.read` | Conflictos con sugerencia de solución (máx. 31 días) |
| POST | /trips/extra | `schedule.write` | Viaje extraordinario (tiempo extra, cambio de turno, evento), con o sin ruta; asignación opcional |
| POST | /trips/:id/cancel | `schedule.write` o `dispatch.operate` | Cancela un viaje programado con motivo (la generación no lo reactiva) |
| GET | /plant/carriers | `plant.requests` o `plant.dashboard` | Transportistas con acuerdo activo y las plantas que atienden |
| GET/POST | /client-requests | `requests.manage` o `plant.requests` / `plant.requests` | Solicitudes de la planta: viaje extra, cambio de horario o de ruta, otra |
| GET | /client-requests/:id | `requests.manage` o `plant.requests` | Detalle con el viaje generado |
| POST | /client-requests/:id/cancel | `plant.requests` | La planta cancela una solicitud pendiente |
| POST | /client-requests/:id/approve, /reject | `requests.manage` | Aprobar (un viaje extra crea el viaje) o rechazar con respuesta |

| GET | /driver/trips?date= | chofer | Viajes del día (en curso y siguiente arriba) con paradas, unidad, pasajeros esperados y checklist |
| GET | /driver/checklist-template | chofer | Puntos del checklist de la unidad |
| POST | /driver/trips/:id/photos?kind= | chofer | Foto del viaje (checklist, incident, evidence; JPG, PNG o WebP) |
| POST | /driver/trips/:id/checklist | chofer | Checklist de la unidad (vale para todos los viajes del día de esa unidad) |
| POST | /driver/trips/:id/start, /stops, /gate, /finish | chofer | Iniciar, llegar a parada, QR de la puerta (`shiftlane-puerta://…`), terminar |
| POST | /driver/trips/:id/scan | chofer | Escanear credencial QR, gafete o número de empleado; parada por ubicación; sobrecupo |
| POST | /driver/trips/:id/incidents | chofer | Incidente con tipo, fotos y ubicación |
| POST | /driver/panic | chofer | Pánico con o sin viaje |
| POST | /sync/batch | chofer | Lote de eventos guardados sin señal (hasta 1000); resultado por evento |
| POST | /driver/positions | chofer | Posiciones GPS en lote (hasta 2000); geocercas y hora estimada de llegada |
| GET | /trips/:id/positions?from=&to=&limit= | igual que el detalle del viaje | Recorrido GPS guardado |
| GET | /trips/:id/live | `monitoring.view`, `schedule.read` o `plant.dashboard` | Última posición del viaje en curso con horas estimadas |
| GET | /live/positions | `monitoring.view` o `dispatch.operate` | Posiciones en vivo de los viajes en curso de la empresa |
| POST | /drivers/:id/messages | `dispatch.operate` | Mensaje al chofer (llega por tiempo real como `message.to_driver`) |
| GET | /alerts?status=&type=&tripId=&from=&to= | `alerts.manage`, `monitoring.view`, `dispatch.operate` o `plant.dashboard` | Alertas (la planta solo las que la regla le comparte) |
| GET | /alerts/:id | igual que la lista | Detalle con historial (quién, qué y cuándo) |
| POST | /alerts/:id/acknowledge, /resolve, /notes | `alerts.manage` o `dispatch.operate` | Atender, resolver (con lo que se hizo) o anotar |
| GET | /alert-rules | `settings.manage` o `alerts.manage` | Reglas de la empresa con valores por omisión |
| PUT | /alert-rules/:type | `settings.manage` | Activa, gravedad, umbrales, escalamiento y aviso a la planta |
| GET | /trips/:id | `schedule.read`, `monitoring.view`, `plant.evidence` o `plant.dashboard` | Detalle con evidencia: historial, checklist, abordajes, incidentes, fotos |
| GET | /trips/:id/photos/:photoId | igual que el detalle | Foto del viaje |
| POST | /trips/:id/checklist-exception | `dispatch.operate` | Autoriza salir con el checklist sin aprobar |
| GET/PUT | /checklist-template | `settings.manage` o `schedule.read` / `settings.manage` | Puntos del checklist y fotos obligatorias |
| GET | /incidents?status= | `alerts.manage`, `monitoring.view` o `dispatch.operate` | Incidentes |
| POST | /incidents/:id/resolve | `dispatch.operate` o `alerts.manage` | Registra la solución |
| GET | /panic-events?pending= | `alerts.manage`, `monitoring.view` o `dispatch.operate` | Alertas de pánico |
| POST | /panic-events/:id/acknowledge | `dispatch.operate` o `alerts.manage` | Marca el pánico como atendido |
| GET | /trips?from=&to=&plantId=&routeId=&status=&kind= | `schedule.read` o `plant.dashboard` | Viajes de un rango (por omisión, esta semana); la planta ve los de sus transportistas |
| GET/POST | /holidays | `schedule.read` / `schedule.write` o `settings.manage` | Días festivos del año, generales o por planta |
| PATCH/DELETE | /holidays/:id | `schedule.write` o `settings.manage` | Cambiar nombre o si hay servicio; eliminar (ajusta los viajes) |
| POST | /holidays/official | `schedule.write` o `settings.manage` | Agrega los días de descanso obligatorio de la LFT del año |

Rutas por calles: `ROUTING_PROVIDER=osrm` con `ROUTING_URL` (OSRM propio con extracto de
México) o `straight_line`. Resultados en caché (tabla routing_cache, 30 días); si OSRM falla
o tarda más de `ROUTING_TIMEOUT_MS`, se usa la línea recta y la operación sigue. Cada versión
guarda su origen (`routingSource`: osrm, straight_line o manual).

Vigencia de rutas: la versión regular aplica desde su `validFrom` hasta que empieza otra;
un cambio temporal vigente gana a la versión regular. Las versiones que ya empezaron no se
modifican (un cambio crea otra versión) y no se crean versiones en el pasado.

Generación de viajes: un viaje regular por ruta y día (`generation_key` = ruta + fecha). Hay
viaje si la ruta está activa, la planta tiene acuerdo vigente, el turno trabaja ese día de la
semana, no es festivo sin servicio y ningún cambio temporal suspende el servicio. Entrada:
sale a la hora de la primera parada y llega a la hora de entrada del turno; salida: sale a la
hora de salida del turno y llega a la última parada (horas locales de la planta, con horario
de verano). Regenerar crea lo que falta, actualiza lo programado y cancela lo que ya no aplica
(motivo con prefijo «[Automático]»); no toca viajes iniciados, terminados ni cancelados a
mano, ni fechas pasadas. Una tarea diaria mantiene `TRIP_HORIZON_DAYS` (14) días generados y
cada cambio de ruta, turno, festivo o cambio temporal ajusta los viajes en la misma operación.

Asignación y conflictos: cada viaje guarda chofer, unidad y origen de la asignación
(`habitual`, `manual` o `copied`). La ruta puede tener chofer y unidad habituales (si no tiene
unidad, se usa la habitual del chofer). Conflictos que bloquean (`error`): chofer o unidad en
dos viajes que se traslapan, unidad en mantenimiento, fuera de servicio o dada de baja,
documentos vencidos a la fecha del viaje (permiso, seguro, tarjeta de circulación,
verificación; examen médico, antidoping, capacitación), licencia ausente, vencida o de otro
tipo que el que exige la unidad (`requiredLicenseType`), chofer inactivo. Avisos (`warning`):
capacidad menor que los pasajeros asignados a la ruta y viaje sin asignar. Cada conflicto trae
una sugerencia con opciones (choferes o unidades libres y en regla).

Solicitudes de la planta: la planta elige su transportista (si tiene una sola, se toma esa) y
pide un viaje extra con fecha, sentido, hora en planta (llegada si es de entrada, salida si es
de salida), pasajeros estimados y ruta de referencia opcional. Al aprobar, el horario sale de
la hora en planta y el tiempo de recorrido de la ruta (60 minutos sin ruta) o del que indique
la transportista; si la asignación tiene conflictos que bloquean no se aprueba nada (409),
salvo con `force`. Cada transportista ve solo las solicitudes dirigidas a ella.

Ciclo de vida del viaje: `scheduled` → `in_progress` (iniciar) → `completed` (terminar);
`scheduled` → `cancelled`. Checklist, excepción y cancelación solo antes de iniciar; paradas,
escaneos, QR de puerta y terminar solo en curso; incidentes antes o durante. Para iniciar se
necesita unidad asignada, checklist del día de esa unidad aprobado (o la excepción del
despachador), estar dentro de las 2 horas previas a la hora programada y no tener otro viaje
en curso. Cada acción escribe en `trip_events` (inmutable: ni la aplicación puede editarlo) y
acepta `clientEventId` (UUID del celular) para que un reenvío no duplique nada; `occurredAt`
es la hora del celular (si viene adelantada se usa la del servidor). El escaneo responde
`ok`, `other_route`, `unregistered` (gafete provisional), `already_scanned` o `rejected` para
el sonido y la vibración del celular.

Sincronización sin señal (`POST /sync/batch`): `{ sentAt, events: [{ id, type, sequence,
occurredAt, tripId, data }] }` con tipos `checklist`, `start`, `stop_arrived`, `scan`,
`incident`, `panic`, `gate` y `finish` (`data` lleva lo mismo que el endpoint directo). Se
procesa en el orden del celular (`sequence`; sin él, la hora), cada evento en su propia
transacción. La hora se corrige con el desfase del reloj del celular (hora del servidor al
recibir menos `sentAt`; se ignora si es menor a 2 s) y nunca queda en el futuro. Cada evento
responde `applied`, `duplicate` (ya se había recibido; trae el resultado original),
`rejected` (con el motivo; no reenviar) o `retry` (por ejemplo, el inicio del viaje aún no
llega; reenviar después). Paradas, escaneos, QR de puerta e incidentes que llegan después de
terminar el viaje se aceptan si ocurrieron antes de terminarlo.

Posiciones GPS: solo se guardan las tomadas durante el viaje (entre el inicio y el fin; las
de antes, después o de viajes sin iniciar se rechazan como `outside_trip`). El historial vive
en `telemetry.trip_positions`, particionada por día (UTC) y fuera de Prisma; la partición se
crea sola al recibir datos y la tarea diaria crea los próximos días. Un punto por viaje e
instante (los reenvíos cuentan como `duplicates`). La primera posición dentro del radio de
una parada registra la llegada (`stop_arrived` con `auto: true`). La hora estimada suma la
distancia directa × 1.3 a las paradas que faltan y a la planta (entrada) con la velocidad de
la ruta (distancia ÷ tiempo de la versión, o `ROUTING_AVERAGE_SPEED_KMH`) y 1 minuto por
parada; `delayMinutes` compara contra la llegada programada. La posición en vivo está en
Redis (`REDIS_URL`; sin él, memoria) y se borra al terminar el viaje.

Tiempo real (Socket.IO, ruta `/realtime`): el cliente se conecta con
`auth: { token: '<token de acceso>' }`; sin token válido o sin permiso la conexión se rechaza
(«No autorizado.» o «Sin permiso para recibir eventos en tiempo real.»). Al conectar recibe
`ready`; cuando vence el token recibe `session.expired` y se desconecta (reconectar con un
token nuevo). Salas según quién se conecta: transportista con `monitoring.view`,
`dispatch.operate`, `alerts.manage` o `schedule.read` → su empresa; planta con
`plant.dashboard` o `plant.evidence` → sus plantas; pasajero → sus rutas; chofer → el suyo.

| Evento | Lo reciben |
|---|---|
| `trip.status_changed`, `trip.position`, `trip.eta_updated` | Empresa, planta y pasajeros de la ruta |
| `boarding.created` | Empresa y planta (no los pasajeros) |
| `trip.cancelled` | Empresa, planta, pasajeros de la ruta y el chofer |
| `route.changed` | Empresa, pasajeros de la ruta y choferes con viajes próximos |
| `message.to_driver` | El chofer |
| `alert.created`, `alert.updated` | Empresa; planta si la regla lo indica (F06) |
| `device.health_changed` | Empresa (F06) |

Los eventos salen solo después de guardar los cambios: lo publicado en una transacción que
falla o en una petición que responde con error no se envía. Con `REDIS_URL`, varias copias
de la API comparten las salas (adaptador de Redis).

Alertas: el motor evalúa con cada evento (posición, abordaje, pánico, checklist, asignación,
inicio, fin o cancelación del viaje) y cada minuto (viaje no iniciado, unidad sin reportar,
parada no programada y escalamiento). Tipos y umbrales por omisión: `trip_not_started`
(5 min de tolerancia), `delay` (10 min), `off_route` (150 m del trazado), `speeding`
(80 km/h), `unscheduled_stop` (5 min dentro de 50 m, lejos de paradas y de la planta),
`overcapacity`, `panic` (crítica, escala a los 2 min), `checklist_failed`, `device_silent`
(5 min sin posiciones) y `expired_documents_on_assign`. Cada alerta trae causa, ubicación y
acción sugerida; no se repite mientras sigue abierta y se cierra sola cuando la causa
desaparece (`autoResolved`). Estados: `open` → `acknowledged` → `resolved`, con
`minutesToAcknowledge` y `minutesToResolve`. Si nadie la atiende en `escalateAfterMinutes`,
se escala al gerente (`escalatedAt`). Se envían en tiempo real como `alert.created` y
`alert.updated`.

Credencial QR del pasajero: `SL1.<datos en base64url>.<firma Ed25519>`; los datos llevan
credencial, pasajero, empresa y un valor aleatorio que cambia al reemitirla.

Las cargas de Excel validan cada fila y devuelven `{ totalRows, created, updated, errors: [{ row, column, message }], applied }`.
Si hay un solo error no se guarda nada.
