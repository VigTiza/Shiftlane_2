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
