# Shiftlane — Plan de desarrollo

Fases, prompts para Claude Code, tecnologías y estructura del sistema

------------------------------------------------------------------------

*23 fases · 76 prompts · bitácora de avances para continuar tras cada corte*

Felix Armando Acosta · Ciudad Juárez, Chihuahua · Octubre 2026

## 1. Contexto del proyecto

**Shiftlane** es una plataforma SaaS para empresas de transporte de personal. Permite planear, operar, comprobar y cobrar cada viaje que hacen para las plantas que las contratan, y está diseñada para funcionar casi sin soporte del dueño de la plataforma. La descripción funcional completa está en el documento «Shiftlane — Descripción funcional» y el modelo de cobro en «Shiftlane — Sistema de precios»; este documento explica **cómo construirlo** con Claude Code, fase por fase y prompt por prompt.

### 1.1 Cómo usar este documento

1.  Crea una carpeta de trabajo (workspace) vacía y abre Claude Code dentro de ella.

2.  Copia en la raíz los dos documentos de referencia convertidos a Markdown (fase 0 lo explica) para que Claude pueda consultarlos.

3.  Ejecuta los prompts **en orden**, uno a la vez. No pases al siguiente hasta que el anterior esté terminado y sus pruebas pasen.

4.  Al terminar cada prompt, Claude actualiza **docs/AVANCES.md**. Si se acaban los tokens o abres una sesión nueva, el primer mensaje siempre es el **prompt de reanudación** (sección 4.3).

5.  Revisa tú mismo lo crítico: autenticación, aislamiento entre empresas, cobro y datos personales.

### 1.2 Componentes que se construirán

| **Componente** | **Carpeta** | **Para quién** |
|:--:|----|----|
| **API y servicios automáticos** | apps/api | Todos (backend) |
| **Panel web de la transportista, portal de la planta y consola de plataforma** | apps/web | Transportistas, plantas y administrador |
| **App del pasajero (web instalable)** | apps/rider | Empleados que viajan |
| **App del chofer** | apps/driver | Choferes (Android) |
| **Landing page con animaciones 3D** | apps/landing | Prospectos |
| **Página de estado y centro de ayuda público** | apps/landing (secciones) o apps/status | Todos |
| **Código compartido (tipos, validaciones, constantes)** | packages/shared | Backend y web |
| **Infraestructura, Docker, respaldos** | infra | Servidor |
| **Modelos 3D (Blender)** | assets/3d | Landing |
| **Documentación y bitácora de avances** | docs | Claude y tú |

## 2. Tecnologías por componente

### 2.1 Decisión sobre el frontend del sistema

Para la **landing page** se usa HTML, CSS y JavaScript como se pidió. Para el **sistema web** (panel, portal, consola y app del pasajero) se recomienda **React con TypeScript**: el resultado final sigue siendo HTML, CSS y JavaScript en el navegador, pero un sistema con decenas de pantallas, formularios, tablas, mapas en vivo y estados compartidos es mucho más mantenible con componentes y tipos. TypeScript además reduce errores en el código generado por IA, porque detecta inconsistencias antes de ejecutar.

| **Componente** | **Lenguaje** | **Tecnologías principales** |
|:--:|----|----|
| **Landing page** | HTML5, CSS3, JavaScript (módulos ES) | Vite (empaquetado), Three.js (3D), GSAP + ScrollTrigger (animaciones al hacer scroll), Lenis (scroll suave), modelos GLB exportados de Blender con compresión Draco |
| **Modelos 3D** | Python (scripts de Blender) / Blender | Blender en modo línea de comandos para generar, materializar y exportar el camión y escenarios a GLB |
| **Sistema web (panel, portal, consola)** | TypeScript (compila a JavaScript), HTML, CSS | React, Vite, TailwindCSS, componentes shadcn/ui, React Router, TanStack Query, React Hook Form + Zod, MapLibre GL JS (mapas), Recharts (gráficas), cliente Socket.IO |
| **App del pasajero** | TypeScript, HTML, CSS | Mismo stack que el sistema web, configurada como PWA instalable (service worker, manifest) |
| **App del chofer** | Dart | Flutter (Android), Riverpod (estado), go_router, dio (HTTP), drift/SQLite (datos sin señal), geolocator + servicio en primer plano (ubicación en segundo plano), mobile_scanner (gafetes y QR), flutter_map con mapas sin conexión, socket_io_client, Firebase Cloud Messaging, battery_plus, connectivity_plus, permission_handler |
| **API y servicios** | TypeScript sobre Node.js (versión LTS vigente) | Fastify, Zod, Prisma (ORM), Socket.IO, BullMQ (colas y tareas programadas), Pino (registros) |
| **Base de datos** | SQL | PostgreSQL 16 + PostGIS (datos geográficos), seguridad por filas para aislar empresas, particiones por fecha para posiciones GPS |
| **Caché y tiempo real** | — | Redis (posiciones en vivo, sesiones, colas, adaptador de Socket.IO) |
| **Pruebas** | TypeScript, Dart | Vitest y Supertest (API), Testcontainers (PostgreSQL real en pruebas), Playwright (navegador), flutter_test e integration_test (app), k6 (carga) |
| **Infraestructura** | YAML, Bash | Docker y Docker Compose, Caddy (HTTPS automático), Cloudflare, GitHub Actions, Sentry, UptimeRobot, respaldos de PostgreSQL a almacenamiento de objetos |
| **Servicios externos** | — | Stripe (suscripciones), proveedor de timbrado CFDI (por ejemplo Facturapi), WhatsApp Cloud API, SMS (por ejemplo Twilio), correo transaccional (por ejemplo Resend), Firebase Cloud Messaging, proveedor de mosaicos de mapa (OpenStreetMap/MapTiler), Android Management API (modo kiosco), API de Claude (asistente) |

> Para la ubicación en segundo plano en Flutter existen paquetes comerciales muy robustos (como flutter_background_geolocation, que requiere licencia para Android en producción) y opciones libres (geolocator + servicio en primer plano). El plan usa la opción libre; si en el piloto la precisión o la batería no son suficientes, se evalúa la comercial.

## 3. Arquitectura y estructura

### 3.1 Estructura del repositorio

```
shiftlane/
├── CLAUDE.md                 # Instrucciones permanentes para Claude Code (se carga solo)
├── docs/
│   ├── AVANCES.md            # Bitácora: estado actual + historial de cada prompt
│   ├── referencia/           # Descripción funcional y sistema de precios en Markdown
│   ├── decisiones/           # Decisiones de arquitectura (ADR)
│   ├── api.md                # Endpoints y eventos
│   └── manuales/             # Guías de usuario (se generan al final)
├── apps/
│   ├── api/                  # Fastify + Prisma + Socket.IO + BullMQ
│   │   ├── src/modules/      # auth, tenants, catalogs, routes, scheduling, trips, gps,
│   │   │                     # boarding, alerts, diagnostics, compliance, maintenance,
│   │   │                     # reconciliation, invoicing, billing, notifications, help,
│   │   │                     # tickets, platform, devices, integrations
│   │   ├── src/jobs/         # tareas programadas y colas
│   │   ├── src/realtime/     # Socket.IO
│   │   ├── prisma/           # esquema, migraciones, datos de ejemplo
│   │   └── test/
│   ├── web/                  # React: panel transportista, portal planta, consola
│   ├── rider/                # React PWA: app del pasajero
│   ├── driver/               # Flutter: app del chofer
│   └── landing/              # HTML + CSS + JS + Three.js + GSAP
├── packages/shared/          # tipos, esquemas Zod, constantes, reglas de precios
├── assets/3d/                # archivos .blend, scripts de Blender, .glb exportados
├── infra/                    # docker-compose, Caddyfile, respaldos, scripts
└── .github/workflows/        # CI/CD
```

### 3.2 Multiempresa y permisos

- Cada **transportista** es una cuenta (tenant). Todas las tablas operativas llevan tenant_id y PostgreSQL aplica **seguridad por filas**: aunque una consulta olvide filtrar, la base de datos no devuelve datos de otra cuenta.

- Cada **planta cliente** es una organización propia con usuarios propios. Accede a los viajes de una transportista mediante un **acuerdo de servicio** que la transportista crea; una planta con varias transportistas ve todo en un solo tablero.

- Roles: dueño, gerente, programador, despachador, administración, mantenimiento, chofer, usuario de planta (logística, RH), pasajero y administrador de plataforma.

### 3.3 Modelo de datos (tablas principales)

| **Área** | **Tablas** |
|:--:|----|
| **Cuentas y acceso** | tenants, users, roles, user_roles, sessions, api_keys, audit_log |
| **Clientes (CRM)** | client_orgs, plants, plant_gates (QR fijo), client_contacts, service_agreements, contracts, rates, penalties, leads |
| **Flota y personal** | vehicles, vehicle_documents, drivers, driver_documents, driver_pins, devices (celulares), device_health_reports |
| **Pasajeros** | passengers, passenger_credentials, passenger_imports, provisional_badges |
| **Rutas** | routes, route_versions (vigencia), stops (punto PostGIS), route_stop_times, temporary_changes |
| **Operación** | shifts, schedules, trips, trip_assignments, trip_events, trip_positions (particionada por fecha), boardings, checklists, checklist_results, incidents, panic_events |
| **Alertas y diagnóstico** | alert_rules, alerts, alert_actions, diagnostics_snapshots |
| **Solicitudes** | client_requests, complaints, surveys |
| **Mantenimiento** | maintenance_plans, maintenance_events, fuel_logs |
| **Facturación al cliente** | reconciliation_periods, prefactures, prefacture_items, objections, invoices, payments_received |
| **Cobro de la plataforma** | plans, subscriptions, price_overrides, billing_periods, platform_invoices, platform_payments, dunning_events |
| **Notificaciones** | notification_templates, notifications, deliveries (canal, estado, reintentos) |
| **Ayuda y soporte** | help_articles, help_videos, assistant_conversations, tickets, ticket_messages, status_components, status_incidents |

### 3.4 Tiempo real (eventos)

| **Evento** | **Lo recibe** |
|:--:|----|
| **trip.status_changed, trip.position, trip.eta_updated** | Panel, portal de planta, app del pasajero (solo su ruta) |
| **boarding.created** | Panel, portal de planta |
| **alert.created, alert.updated** | Panel; planta si la regla lo indica |
| **device.health_changed** | Panel |
| **message.to_driver** | App del chofer |
| **route.changed, trip.cancelled** | App del chofer, app del pasajero |

### 3.5 Variables de entorno

Todas las llaves y secretos viven en archivos .env (nunca en el repositorio) con un .env.example documentado: base de datos, Redis, JWT, cifrado, Stripe, timbrado CFDI, WhatsApp, SMS, correo, FCM, mapas, Android Management API, Sentry, API de Claude, almacenamiento de objetos.

### 3.6 Estrategia de pruebas

| **Tipo** | **Dónde** | **Qué cubre** |
|:--:|----|----|
| **Unitarias** | Backend, web, app | Reglas de negocio: programación, alertas, conciliación, precios, sincronización |
| **Integración** | Backend con PostgreSQL real (Testcontainers) | Endpoints, permisos, aislamiento entre empresas, migraciones |
| **Contrato** | Backend | Que cada endpoint respete su esquema Zod |
| **Sin señal** | App y backend | Envío en lote, duplicados, orden, reintentos |
| **Extremo a extremo** | Navegador (Playwright) y app (integration_test) | Flujos completos de un día |
| **Carga** | k6 | 300+ unidades enviando posiciones al mismo tiempo |
| **Seguridad** | Backend | Intentos de acceso cruzado, inyección, permisos, límites de peticiones |

## 4. Bitácora de avances y reanudación

Claude Code carga automáticamente el archivo **CLAUDE.md** de la raíz del proyecto al iniciar cada sesión, y se recomienda mantenerlo por debajo de unas 200 líneas. Por eso las reglas permanentes van en CLAUDE.md y el estado del trabajo va en **docs/AVANCES.md**, que Claude debe leer al inicio y actualizar al terminar cada prompt.

### 4.1 Plantilla de docs/AVANCES.md

```
# AVANCES — Shiftlane

## ESTADO ACTUAL (leer primero, máximo 25 líneas)
- Fase actual: F_ — <nombre>
- Último prompt completado: F_-P_
- Siguiente prompt: F_-P_
- Trabajo a medias (si lo hay): <qué quedó incompleto y en qué archivo>
- Pruebas: <todas pasan / cuáles fallan>
- Cómo levantar el entorno: <comandos>
- Pendientes abiertos: <lista corta>

## DECISIONES IMPORTANTES
- <fecha> <decisión y motivo>

## HISTORIAL (más reciente arriba)
### <fecha> — F_-P_ <título>
- Hecho: ...
- Archivos principales: ...
- Pruebas agregadas / resultado: ...
- Problemas encontrados y cómo se resolvieron: ...
- Pendiente para después: ...
```

### 4.2 Reglas del protocolo (van en CLAUDE.md)

1.  Al iniciar cualquier tarea: leer la sección ESTADO ACTUAL de docs/AVANCES.md y, si hace falta, la última entrada del historial.

2.  Trabajar solo en lo que pide el prompt actual.

3.  Escribir y ejecutar pruebas; corregir hasta que pasen.

4.  Durante tareas largas, actualizar AVANCES.md después de cada bloque importante, no solo al final, para que un corte por tokens no pierda el contexto.

5.  Al terminar: actualizar ESTADO ACTUAL e historial, hacer commit con el código del prompt (por ejemplo «F03-P02: editor de rutas»).

### 4.3 Prompt de reanudación (usar al abrir una sesión nueva o tras quedarse sin tokens)

```
Lee docs/AVANCES.md (sección ESTADO ACTUAL y la última entrada del historial).
Revisa con git status y git log -5 qué quedó sin terminar.
Dime en 5 líneas en qué nos quedamos y continúa exactamente desde ahí,
sin rehacer lo que ya está completo. Sigue el protocolo de CLAUDE.md.
```

### 4.4 Contenido de CLAUDE.md

```
# Shiftlane — instrucciones para Claude Code

## Qué es
SaaS para empresas de transporte de personal (México). Referencia funcional:
docs/referencia/descripcion-funcional.md y docs/referencia/sistema-de-precios.md.

## Protocolo obligatorio
1. Antes de trabajar, lee la sección ESTADO ACTUAL de docs/AVANCES.md.
2. Haz solo lo que pide el prompt actual.
3. Escribe y ejecuta pruebas; no termines con pruebas fallando.
4. Actualiza docs/AVANCES.md durante y al final de cada tarea.
5. Commit al terminar: "F<fase>-P<prompt>: <resumen>".

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

## Comandos
(Claude los completa en la fase 0: levantar entorno, pruebas, migraciones, lint.)
```

## 5. Fases y prompts

Cada fase construye una parte del sistema. Los prompts están listos para copiar y pegar en Claude Code; todos terminan con la instrucción de probar, actualizar la bitácora y hacer commit. Los números entre paréntesis en el resumen indican cuántos prompts tiene cada fase.

| **Fase** | **Contenido** | **Prompts** |
|:--:|----|----|
| **00** | Preparación del workspace | 3 |
| **01** | Núcleo del backend: base de datos, multiempresa, autenticación | 4 |
| **02** | Catálogos: flota, choferes, clientes, contratos, pasajeros | 3 |
| **03** | Rutas, paradas y editor de rutas (backend) | 3 |
| **04** | Programación de servicios | 3 |
| **05** | Operación: viajes, GPS, sincronización sin señal, tiempo real | 4 |
| **06** | Motor de alertas y diagnóstico de unidades | 3 |
| **07** | App del chofer (Flutter) | 7 |
| **08** | Panel web de la transportista | 7 |
| **09** | Portal de la planta | 3 |
| **10** | App del pasajero (PWA) | 2 |
| **11** | Cumplimiento, mantenimiento y combustible | 2 |
| **12** | Conciliación, prefactura y facturación CFDI | 3 |
| **13** | Suscripciones y cobro de la plataforma | 3 |
| **14** | Notificaciones multicanal | 2 |
| **15** | Autoservicio: ayuda, asistente, tickets, página de estado | 4 |
| **16** | Consola de plataforma | 2 |
| **17** | Administración de celulares y modo kiosco | 2 |
| **18** | Landing page con animaciones 3D | 6 |
| **19** | Seguridad y endurecimiento | 2 |
| **20** | Pruebas integrales, carga y QA | 3 |
| **21** | Despliegue, monitoreo y respaldos | 3 |
| **22** | Documentación y preparación del piloto | 2 |
| **Total** |  | **76** |

> El orden importa: primero el backend y la app del chofer (lo que hace funcionar la operación), luego las pantallas, después cobro y autoservicio, y la landing al final, cuando ya hay producto que mostrar. Si quieres empezar a promocionar antes, la fase 18 puede hacerse en paralelo después de la fase 08.

### Fase 00 — Preparación del workspace

**Objetivo:** Dejar el repositorio, el entorno local, la bitácora y la integración continua listos.

**Requiere:** Workspace vacío, Docker instalado, Node.js LTS, Flutter, Blender.

#### F00-P01 · Estructura del monorepo, CLAUDE.md y bitácora

```
Vamos a construir Shiftlane, un SaaS para empresas de transporte de personal.
1. Crea el monorepo con pnpm workspaces y esta estructura: apps/api, apps/web, apps/rider,
   apps/driver, apps/landing, packages/shared, assets/3d, infra, docs/referencia,
   docs/decisiones, docs/manuales, .github/workflows.
2. Crea CLAUDE.md en la raíz con el contenido que te pego abajo (sección "Contenido de
   CLAUDE.md" del documento de desarrollo) y complétalo con los comandos reales.
3. Crea docs/AVANCES.md con la plantilla de bitácora (ESTADO ACTUAL, DECISIONES, HISTORIAL).
4. Crea .gitignore, .editorconfig, README.md breve y .env.example vacío por app.
5. Inicializa git y haz el primer commit.
[PEGA AQUÍ EL CONTENIDO DE CLAUDE.md]
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F00-P02 · Documentos de referencia en Markdown

```
En la raíz dejé dos archivos: Shiftlane_Descripcion_Funcional.docx y
Shiftlane_Sistema_de_Precios.docx.
1. Conviértelos a Markdown (usa pandoc si está disponible) y guárdalos como
   docs/referencia/descripcion-funcional.md y docs/referencia/sistema-de-precios.md.
2. Revisa que tablas y listas queden legibles.
3. Crea docs/referencia/resumen.md (máximo 80 líneas) con los módulos, usuarios,
   reglas clave y planes de precios, para consultas rápidas.
4. Agrega a CLAUDE.md una línea que indique dónde está el resumen.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F00-P03 · Entorno local, calidad de código e integración continua

```
1. infra/docker-compose.dev.yml con PostgreSQL 16 + PostGIS, Redis y Mailpit (correo de prueba).
2. Configura TypeScript estricto, ESLint y Prettier compartidos para apps/api, apps/web,
   apps/rider, packages/shared; flutter analyze para apps/driver.
3. Scripts en la raíz: dev (levanta todo), test, lint, typecheck, db:migrate, db:seed.
4. GitHub Actions: en cada push corre lint, typecheck, pruebas de backend con PostgreSQL
   en contenedor, pruebas web y flutter test.
5. Crea una prueba trivial en cada app para validar la tubería.
6. Documenta en CLAUDE.md los comandos definitivos.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 01 — Núcleo del backend

**Objetivo:** Base de datos multiempresa con seguridad por filas, autenticación, roles y bitácora de auditoría.

**Requiere:** Fase 00.

#### F01-P01 · Esqueleto de la API

```
En apps/api crea la API con Fastify + TypeScript:
- Estructura por módulos (src/modules/<modulo>/{routes,service,schemas,tests}).
- Configuración con validación de variables de entorno (Zod), registros con Pino,
  manejo centralizado de errores en español, CORS, Helmet, límite de peticiones,
  endpoint /health y /ready, documentación OpenAPI automática.
- Pruebas con Vitest + Supertest y PostgreSQL real con Testcontainers.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F01-P02 · Esquema de base de datos y seguridad por filas

```
Diseña el esquema Prisma inicial con: tenants, users, roles, user_roles, sessions,
audit_log, client_orgs, plants, service_agreements.
- Todas las tablas operativas con tenant_id, created_at, updated_at, deleted_at.
- Activa PostGIS y seguridad por filas (RLS) en PostgreSQL: crea políticas por tenant_id
  y un mecanismo para fijar el tenant de la sesión en cada petición (SET LOCAL).
- Las plantas acceden a datos de una transportista solo a través de service_agreements.
- Migraciones y datos de ejemplo (2 transportistas, 2 plantas).
- Pruebas que demuestren que un tenant NO puede leer ni modificar datos de otro,
  incluso con consultas sin filtro.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F01-P03 · Autenticación y sesiones

```
Implementa autenticación:
- Usuarios web: correo + contraseña (argon2id), tokens de acceso cortos y de renovación
  rotativos en cookie httpOnly, detección de reutilización, cierre de sesiones.
- Bloqueo por intentos fallidos, recuperación de contraseña por correo, 2FA opcional (TOTP).
- Choferes: alta por código QR de un solo uso + PIN de 4 dígitos ligado a dispositivo;
  el despachador puede restablecer el PIN.
- Pasajeros: activación con número de empleado validado contra la lista de la planta.
- Pruebas de cada flujo, incluidos intentos inválidos.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F01-P04 · Roles, permisos y auditoría

```
- Define roles: owner, manager, planner, dispatcher, billing, maintenance, driver,
  plant_logistics, plant_hr, passenger, platform_admin.
- Middleware de permisos por acción (no solo por rol) y matriz documentada en docs/api.md.
- Registro en audit_log de toda creación, edición y borrado (quién, qué, antes/después).
- Pruebas de la matriz de permisos con casos permitidos y prohibidos.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 02 — Catálogos

**Objetivo:** API de unidades, choferes, clientes, contratos, tarifas y pasajeros, con importación desde Excel.

**Requiere:** Fase 01.

#### F02-P01 · Unidades, choferes y documentos

```
API CRUD para vehicles, vehicle_documents, drivers, driver_documents:
- Campos de la descripción funcional (sección Catálogos), estados de unidad,
  fechas de vencimiento por documento, archivos adjuntos en almacenamiento de objetos
  (usa una interfaz que funcione con S3/R2 y en local con MinIO o carpeta).
- Búsqueda, filtros, paginación, historial de cambios.
- Importación y exportación en Excel con validación fila por fila y reporte de errores.
- Pruebas de CRUD, permisos e importación con archivo de ejemplo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F02-P02 · Clientes, plantas, contratos y tarifas

```
API para client_orgs, plants, plant_gates (con QR fijo por puerta), client_contacts,
contracts, rates (por viaje, ruta, km, unidad o pasajero; especiales por horario o día),
penalties y leads (prospectos con etapas).
- Invitar a usuarios de la planta por correo y crear el service_agreement.
- Pruebas de cálculo de tarifas con casos variados.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F02-P03 · Pasajeros y credenciales

```
API para passengers y passenger_credentials:
- Carga de Excel por la planta (altas, bajas y cambios en un solo archivo, con vista
  previa de diferencias antes de aplicar).
- Credencial QR firmada generada por el sistema y soporte para gafetes existentes
  (código de barras o QR propio de la planta).
- Gafetes desconocidos registrados como provisional_badges para resolver después.
- Pruebas de importación con duplicados, bajas y errores.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 03 — Rutas y paradas

**Objetivo:** Rutas con paradas geográficas, versiones con vigencia y cambios temporales.

**Requiere:** Fase 02.

#### F03-P01 · Modelo de rutas con PostGIS

```
Crea routes, route_versions, stops (geometría PostGIS), route_stop_times y
temporary_changes. Cada ruta tiene sentido (entrada/salida), planta, turno, paradas
ordenadas con horario. Guarda la línea del trazado (LineString).
API CRUD, versión vigente por fecha, historial y restauración de versiones.
Pruebas de vigencia: qué versión aplica en una fecha dada.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F03-P02 · Cálculos geográficos

```
- Distancia y tiempo estimado de la ruta usando un servicio de rutas (OSRM o proveedor
  configurable) con caché; respaldo en línea recta si el servicio falla.
- Función "parada más cercana" para asignar escaneos automáticamente (radio configurable).
- Función "distancia al trazado" para detectar desvíos.
- Pruebas con coordenadas reales de Ciudad Juárez.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F03-P03 · Cambios temporales y simulación

```
- Cambios con fecha de inicio y fin que se aplican y revierten solos.
- Endpoint de simulación: dado un cambio, devuelve viajes, choferes y pasajeros afectados
  sin guardar nada.
- Pruebas de reversión automática y de simulación.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 04 — Programación de servicios

**Objetivo:** Generar los viajes del periodo, asignar unidad y chofer y detectar conflictos antes de que ocurran.

**Requiere:** Fase 03.

#### F04-P01 · Generador de viajes

```
Servicio que genera trips a partir de rutas vigentes, turnos, calendario laboral,
días festivos y cambios temporales, para un rango de fechas. Idempotente (correrlo dos
veces no duplica). Tarea programada diaria que asegura 14 días generados por adelantado.
Pruebas con festivos, cambios temporales y regeneración.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F04-P02 · Asignación y conflictos

```
- Asignación de unidad y chofer: automática según asignación habitual o manual.
- Copiar programación de la semana anterior.
- Detector de conflictos: chofer en dos viajes, unidad en mantenimiento, documentos
  vencidos, capacidad menor a pasajeros asignados, licencia no válida.
- Endpoint que devuelve conflictos con sugerencia de solución.
- Pruebas por cada tipo de conflicto.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F04-P03 · Viajes extraordinarios y solicitudes

```
- Viajes extra manuales y creados desde client_requests aprobadas.
- Flujo de solicitud de la planta: crear, aprobar/rechazar, viaje generado.
- Pruebas del flujo completo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 05 — Operación de viajes y tiempo real

**Objetivo:** Ejecución de viajes desde el celular, posiciones GPS, abordajes, sincronización sin señal y tiempo real.

**Requiere:** Fase 04.

#### F05-P01 · Ciclo de vida del viaje

```
API para el chofer: viajes del día, checklist (con fotos), iniciar, llegar a parada,
escanear pasajero, incidente, pánico, llegada (escaneo de QR de puerta), terminar.
Máquina de estados de trip con validaciones. trip_events como historial inmutable.
Pruebas de transiciones válidas e inválidas.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F05-P02 · Sincronización sin señal (idempotente)

```
Endpoint POST /sync/batch que recibe lotes de eventos generados sin conexión
(cada evento con UUID del dispositivo, marca de tiempo local y tipo).
- Procesa en orden por dispositivo, ignora duplicados, tolera llegadas tardías.
- Corrige diferencias de hora del celular usando la hora del servidor al recibir.
- Pruebas: lotes repetidos, desordenados, parciales y muy grandes.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F05-P03 · Ingesta GPS y posiciones

```
- Endpoint de posiciones en lote; posiciones en vivo en Redis; historial en
  trip_positions particionada por fecha (crea las particiones automáticamente).
- Cálculo de hora estimada de llegada a planta y a cada parada.
- Detección automática de llegada a paradas por geocerca.
- Pruebas de carga ligera y de cálculo de ETA.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F05-P04 · Tiempo real con Socket.IO

```
- Socket.IO autenticado con el mismo token, adaptador Redis, salas por tenant,
  por planta y por ruta.
- Emitir los eventos de la sección 3.4 del documento.
- Un usuario de planta solo recibe eventos de sus viajes; un pasajero solo de su ruta.
- Pruebas de que ninguna sala filtra información de otra empresa.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 06 — Alertas y diagnóstico

**Objetivo:** Detectar problemas automáticamente y explicar su causa al despachador.

**Requiere:** Fase 05.

#### F06-P01 · Motor de alertas

```
Implementa alert_rules configurables por tenant y un evaluador que corre con cada
evento y cada minuto: viaje no iniciado, retraso, desvío, exceso de velocidad, parada
no programada, sobrecupo, pánico, falla de checklist, unidad sin reportar,
documento vencido al asignar. Cada alerta con causa, ubicación y acción sugerida;
estados (abierta, atendida, resuelta), registro de quién y cuánto tardó;
escalamiento automático al gerente si nadie atiende en X minutos.
Pruebas por cada regla con datos simulados.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F06-P02 · Reportes de salud del celular y diagnóstico

```
- Endpoint device_health_reports: permisos, batería, señal, versión, optimización de
  batería, hora del sistema.
- Servicio de diagnóstico: cuando una unidad deja de reportar, calcula la causa
  probable (batería baja, sin datos, permiso revocado, app cerrada, zona sin señal
  conocida) usando el último reporte y el historial.
- Pruebas con escenarios de cada causa.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F06-P03 · Simulador de flota

```
Crea un script simulador (apps/api/scripts/simulator) que reproduzca un turno con
30 unidades: posiciones, abordajes, un retraso, un desvío, un celular sin batería y
una zona sin señal. Se usará para probar el panel y las alertas sin celulares reales.
Documenta cómo correrlo en CLAUDE.md.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 07 — App del chofer (Flutter)

**Objetivo:** App Android de 3 botones que funciona sin señal, revisa el celular antes del turno y no depende de soporte.

**Requiere:** Fases 05 y 06.

#### F07-P01 · Proyecto Flutter y arquitectura

```
En apps/driver crea la app Flutter (Dart) para Android:
- Arquitectura por capas (presentation, application, domain, data) con Riverpod,
  go_router, dio, drift (SQLite local), manejo de errores y registros.
- Tema visual Shiftlane: botones grandes (mínimo 56 px), alto contraste, español.
- Ambientes dev/staging/prod configurables.
- Pruebas unitarias base y flutter analyze sin advertencias.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F07-P02 · Acceso con QR y PIN

```
- Pantalla de vinculación: escanear QR de alta generado en el panel.
- Ingreso con PIN de 4 dígitos; cambio de chofer en celular compartido.
- Guardado seguro de credenciales (flutter_secure_storage).
- Pruebas de widgets y de flujo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F07-P03 · Revisión del celular antes del turno

```
Pantalla que verifica: ubicación activada y permiso "siempre", exclusión de
optimización de batería, batería suficiente, datos móviles, hora correcta, cámara y
versión. Si algo falla, muestra pasos con imágenes específicas según la marca
(Samsung, Motorola, Xiaomi, genérico) y abre la pantalla de ajustes exacta.
No permite iniciar viaje hasta que todo esté en verde (o excepción del despachador).
Envía el resultado al endpoint de salud del dispositivo.
Pruebas con permisos simulados.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F07-P04 · Pantalla principal, checklist y viaje

```
- Pantalla principal con 3 botones: Iniciar viaje, Escanear pasajero, Terminar viaje,
  y lista de viajes del día.
- Checklist con fotos obligatorias configurables.
- Durante el viaje: mapa con la ruta y paradas (flutter_map con mosaicos guardados
  para las rutas de la empresa), aviso de parada, contador de pasajeros, incidentes con
  foto, botón de pánico siempre visible, mensajes del despachador.
- Llegada: escanear QR de puerta de planta y terminar.
- Pruebas de widgets de cada pantalla.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F07-P05 · Ubicación en segundo plano y modo sin señal

```
- Servicio en primer plano con notificación "Viaje en curso" que envía ubicación cada
  10–15 s solo durante viajes (geolocator + servicio en primer plano).
- Cola local en drift para TODO evento (ubicación, escaneo, checklist, incidente);
  envío en lote al endpoint /sync/batch cuando hay conexión, con reintentos y
  sin duplicados.
- Indicador "Sin señal — tus datos están guardados".
- Pruebas de la cola: sin conexión, reconexión, reinicio del celular a mitad de viaje.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F07-P06 · Escaneo de pasajeros

```
- mobile_scanner para códigos de barras y QR (gafetes existentes y credenciales Shiftlane).
- Validación local contra la lista descargada (funciona sin señal) y luego en servidor.
- Sonido y vibración distintos: correcto, otra ruta, no registrado, ya escaneado.
- Registro manual por número de empleado.
- La parada se asigna sola por cercanía.
- Pruebas de cada resultado de escaneo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F07-P07 · Notificaciones, actualización y pruebas integrales

```
- Firebase Cloud Messaging para mensajes, cambios de ruta y cancelaciones.
- Revisión de versión y actualización obligatoria cuando el servidor lo indique.
- Tutorial de 2 minutos la primera vez y botón "Tengo un problema" con soluciones.
- integration_test que recorra un turno completo contra el backend local y el simulador.
- Genera APK de staging y documenta cómo instalarlo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 08 — Panel web de la transportista

**Objetivo:** Panel web completo: tablero, catálogos, rutas, programación, monitoreo, CRM, reportes y configuración.

**Requiere:** Fases 01–06.

#### F08-P01 · Proyecto web y sistema de diseño

```
En apps/web crea la app con React + TypeScript + Vite + TailwindCSS + shadcn/ui,
React Router, TanStack Query, React Hook Form + Zod (esquemas de packages/shared).
Antes de diseñar, revisa las skills de diseño web instaladas en Claude Code y aplica
las más adecuadas para una interfaz profesional, limpia y moderna.
- Sistema de diseño Shiftlane: colores, tipografía, componentes (tabla con filtros,
  formularios, diálogos, toasts, estados vacíos y de carga), modo claro/oscuro.
- Layout con barra lateral por rol, búsqueda global y cambio de cuenta.
- Login, 2FA, recuperación de contraseña.
- Pruebas de componentes con Vitest y Testing Library.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F08-P02 · Asistente de configuración inicial y catálogos

```
- Asistente de 8 pasos con barra de progreso y video por paso (descripción funcional 5.2).
- Pantallas de catálogos: unidades, choferes (con QR de alta y restablecer PIN),
  clientes, plantas, contratos y tarifas, pasajeros; importación Excel con vista previa.
- Pruebas de flujos con Playwright.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F08-P03 · Editor de rutas

```
Editor visual con MapLibre GL JS: trazar ruta, agregar/mover/ordenar paradas
arrastrando, horarios por parada, pasajeros por parada, cambios temporales con
fechas, simulación antes de guardar, historial y restaurar versión.
Pruebas E2E de crear y editar una ruta.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F08-P04 · Programación

```
Calendario por día/semana con vista por ruta, unidad o chofer; arrastrar y soltar
para reasignar; panel de conflictos con solución sugerida; copiar semana anterior;
viajes extraordinarios; bandeja de solicitudes de plantas.
Pruebas E2E.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F08-P05 · Monitoreo en vivo y alertas

```
- Mapa en tiempo real con todas las unidades y colores por estado (Socket.IO).
- Lista del turno con avance, pasajeros a bordo y ETA.
- Detalle del viaje con recorrido real vs planeado, abordajes, fotos e incidentes.
- Panel de diagnóstico por unidad con causa probable.
- Alertas ordenadas por urgencia con acción sugerida y acciones de un clic
  (reasignar, unidad de respaldo, avisar a planta, mensaje al chofer).
- Reproducción de viajes pasados.
- Prueba con el simulador de flota de la fase 06.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F08-P06 · CRM, cumplimiento y mantenimiento (pantallas)

```
- Ficha de cliente y planta, prospectos con etapas, cotizador de rutas.
- Calendario de vencimientos y expedientes de unidades y choferes.
- Mantenimiento, combustible y unidades fuera de servicio.
(Las pantallas que dependan de la fase 11 pueden dejarse con datos de ejemplo y
completarse al terminar esa fase; anótalo en AVANCES.md.)
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F08-P07 · Tablero de inicio, reportes y configuración

```
- Tablero de inicio con resumen del turno, alertas, indicadores y pendientes.
- Reportes de operación, ocupación, choferes, unidades, clientes y finanzas;
  exportar a Excel/PDF; reportes programados por correo.
- Configuración: usuarios y roles, turnos, reglas de operación, plantillas,
  canales de notificación, datos fiscales, historial de cambios.
- Pruebas E2E del recorrido principal del despachador.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 09 — Portal de la planta

**Objetivo:** Tablero en vivo, evidencia, solicitudes, empleados, cumplimiento y prefacturas para la maquila.

**Requiere:** Fase 08.

#### F09-P01 · Tablero en vivo y evidencia

```
Dentro de apps/web, área para usuarios de planta:
- Tablero en vivo de sus rutas (todas sus transportistas en una vista).
- Puntualidad por turno, ruta, día y transportista.
- Evidencia por viaje: recorrido, horarios, abordajes, fotos, incidentes.
- Asistencia transportada para RH.
Pruebas de que la planta solo ve sus viajes.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F09-P02 · Empleados, solicitudes y cumplimiento

```
- Carga de Excel de empleados con vista previa y resolución de gafetes provisionales.
- Solicitudes de viajes extra, cambios y quejas con seguimiento.
- Vista de cumplimiento documental de sus proveedores.
- Encuestas y quejas de empleados con estadísticas.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F09-P03 · Prefacturas y reportes

```
- Revisión de prefactura, objeción por viaje con comentario y aprobación.
- Reportes descargables y avisos configurables.
- Plan "Planta" opcional (multi-transportista) preparado para la fase 13.
- Pruebas E2E del flujo de aprobación.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 10 — App del pasajero (PWA)

**Objetivo:** App web instalable para que el empleado vea su camión, use su credencial y reciba avisos.

**Requiere:** Fases 05 y 09.

#### F10-P01 · PWA base y activación

```
En apps/rider crea la PWA (React + TypeScript + Vite) con manifest e instalación
desde el navegador, funcionamiento básico sin conexión (service worker).
Activación con número de empleado o QR de RH; credencial QR en pantalla.
Revisa las skills de diseño web instaladas y aplica las adecuadas: interfaz simple,
grande y móvil.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F10-P02 · Ubicación del camión, avisos y calificación

```
- Su ruta, parada y horario; ubicación en vivo del camión y ETA a su parada.
- Avisos de retraso, cambio y cancelación (Web Push).
- Calificación del viaje y quejas; preguntas frecuentes.
- Pruebas E2E en tamaño móvil.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 11 — Cumplimiento, mantenimiento y combustible

**Objetivo:** Vencimientos con avisos y bloqueos, expedientes, mantenimiento preventivo y rendimiento de combustible.

**Requiere:** Fases 02 y 04.

#### F11-P01 · Vencimientos y expedientes

```
Tarea diaria que revisa documentos de unidades y choferes, crea avisos a 30, 15 y 5
días y marca documentos vencidos; integración con el detector de conflictos de la
fase 04 (bloqueo o advertencia configurable). Reporte de cumplimiento para auditorías.
Pruebas de fechas límite.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F11-P02 · Mantenimiento y combustible

```
Planes de mantenimiento por km o fecha con avisos, eventos de reparación con costos,
unidades fuera de servicio excluidas de la programación, cargas de combustible,
rendimiento km/l y costo por km. Completa las pantallas de la fase 08-P06.
Pruebas de cálculos.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 12 — Conciliación y facturación al cliente

**Objetivo:** Comparar viajes programados contra realizados, generar prefactura con evidencia y emitir CFDI.

**Requiere:** Fases 05, 09 y 11.

#### F12-P01 · Motor de conciliación

```
Servicio que, por planta y periodo, compara viajes programados vs realizados,
clasifica cada viaje (completo, con retraso, incompleto, cancelado, extraordinario),
aplica tarifas y penalizaciones del contrato y genera prefactures con prefacture_items
y referencia a la evidencia. Pruebas exhaustivas con contratos de distintos tipos.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F12-P02 · Objeciones y aprobación

```
Flujo de objeciones por viaje, respuesta de la transportista con evidencia,
ajustes y aprobación final. Bloqueo de cambios después de aprobar.
Pruebas del flujo completo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F12-P03 · Factura electrónica y cuentas por cobrar

```
Integración con proveedor de timbrado CFDI 4.0 mediante una interfaz intercambiable
(adaptador para Facturapi y un adaptador simulado para pruebas): emitir, cancelar,
guardar XML/PDF; cola con reintentos si el servicio falla.
Cuentas por cobrar: pagos registrados, antigüedad de saldos, recordatorios.
Pruebas con el adaptador simulado.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 13 — Suscripciones y cobro de la plataforma

**Objetivo:** Implementar el sistema de precios: planes por unidad, igualación −5%, piso, mínimo, piloto, facturación y cobranza sin cortar la operación.

**Requiere:** Fases 01 y 12.

#### F13-P01 · Modelo de cobro

```
Implementa plans, subscriptions, price_overrides, billing_periods, platform_invoices,
platform_payments y dunning_events según docs/referencia/sistema-de-precios.md:
- Precios Esencial $219, Profesional $379, Corporativo $474 por unidad + IVA.
- Unidad facturable = unidad con al menos un viaje en el mes.
- Precio igualado = 95% de lo que paga hoy, piso $199, vigencia 12 meses.
- Mínimo mensual $2,000; anual = 10 meses; contrato 24 meses −5%.
- Piloto de 60 días sin cobro con "lo que costaría" mensual.
Reglas en packages/shared con pruebas exhaustivas de cálculo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F13-P02 · Facturación mensual, pagos y morosidad

```
- Cierre mensual automático, factura CFDI de la plataforma, envío por correo.
- Pagos con tarjeta (Stripe) y transferencia con referencia única por cliente
  con conciliación automática.
- Morosidad: recordatorios días 1, 5 y 10; día 20 restringe solo funciones
  administrativas; día 45 suspensión programada con aviso, nunca durante un turno;
  la app del chofer y el monitoreo nunca se cortan de golpe.
- Pruebas de cada etapa de morosidad.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F13-P03 · Pantallas de cobro

```
- "Mi suscripción" en el panel: plan, precio aplicado, unidades del mes, estimado,
  facturas, pagos, datos fiscales, cambio de plan.
- Flujo de igualación: el cliente sube su factura del proveedor de GPS; el
  administrador aprueba en la consola.
- Pruebas E2E.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 14 — Notificaciones multicanal

**Objetivo:** Enviar cada aviso por el canal correcto con respaldo automático.

**Requiere:** Fases 05, 06 y 12.

#### F14-P01 · Motor de notificaciones

```
Servicio de notificaciones con plantillas en español, preferencias por usuario dentro
de lo que su rol permite y matriz evento→destinatarios de la descripción funcional
(sección Notificaciones). Cada envío crea deliveries con estado y reintentos.
Pruebas de la matriz.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F14-P02 · Canales y respaldo

```
Adaptadores intercambiables (con versión simulada para pruebas): push (FCM),
Web Push, WhatsApp Cloud API, SMS, correo. Respaldo automático:
app → WhatsApp → SMS → correo si un canal falla o no se confirma.
Límites de SMS por unidad con cobro del excedente registrado para la fase 13.
Pruebas de falla y respaldo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 15 — Autoservicio y ayuda

**Objetivo:** Centro de ayuda, ayuda contextual, asistente con datos de la cuenta, tickets y página de estado.

**Requiere:** Fases 08 y 14.

#### F15-P01 · Centro de ayuda y ayuda contextual

```
- help_articles y help_videos administrables desde la consola; búsqueda.
- Ícono "?" en cada pantalla del panel y de la app con artículo y video relacionados.
- Redacta 25 artículos iniciales en español sencillo (alta de chofer, QR, PIN,
  permisos por marca, unidad que no aparece, importar empleados, cambios temporales,
  prefactura, objeciones, etc.).
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F15-P02 · Asistente con datos de la cuenta

```
Asistente dentro del panel que usa la API de Claude con herramientas internas de
solo lectura y siempre limitadas al tenant del usuario: estado de una unidad y su
diagnóstico, viajes pendientes de conciliar, documentos por vencer, artículos de ayuda.
Nunca ejecuta cambios; si no puede resolver, propone abrir un ticket.
Registra conversaciones. Pruebas de que no puede consultar datos de otra empresa.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F15-P03 · Tickets por niveles

```
Tickets con categoría, prioridad y contexto adjunto automático (cuenta, usuario,
dispositivo, últimos errores). Antes de crear el ticket se sugieren artículos.
Solo los tickets clasificados como falla del sistema llegan al administrador;
el resto se enruta al responsable de la transportista.
Pruebas de enrutamiento.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F15-P04 · Página de estado y avisos automáticos

```
status_components y status_incidents; monitoreo interno que actualiza el estado de
API, app del chofer, mapas, notificaciones y facturación; letrero automático en el
panel y la app cuando un servicio externo falla ("la operación no se ve afectada").
Página pública de estado servida desde la landing (fase 18) o apps/status.
Pruebas de cambio de estado.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 16 — Consola de plataforma

**Objetivo:** Herramienta del dueño de Shiftlane para administrar cuentas, cobro, salud y soporte.

**Requiere:** Fases 13 y 15.

#### F16-P01 · Cuentas, cobro y prospectos

```
En apps/web, área exclusiva platform_admin:
cuentas (estado, plan, uso), suscripciones, pilotos por vencer, igualaciones por
aprobar, facturas del mes, pagos pendientes, ingreso recurrente mensual, unidades
totales, cancelaciones; prospectos llegados desde la landing.
Acceso de soporte a una cuenta solo con permiso del cliente y registro en auditoría.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F16-P02 · Salud de clientes y del sistema

```
- Salud por cliente: viajes registrados, % con abordaje, celulares con problemas,
  alertas sin atender, uso del panel; aviso de cuentas en riesgo.
- Salud del sistema: colas, errores, proveedores externos.
- Bandeja de tickets de nivel 3 y publicación de avisos.
- Pruebas de permisos (solo platform_admin).
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 17 — Administración de celulares y modo kiosco

**Objetivo:** Configurar a distancia los celulares de la empresa y bloquearlos en modo kiosco.

**Requiere:** Fases 07 y 08.

#### F17-P01 · Integración con Android Management API

```
Investiga la documentación oficial vigente de Android Management API y crea un
módulo que permita: registrar celulares escaneando un QR de inscripción, aplicar una
política (solo Shiftlane y apps permitidas, permisos de ubicación concedidos,
sin desinstalar), ver inventario y estado, bloquear o borrar en caso de robo.
Usa un adaptador simulado para pruebas y documenta en docs/decisiones los pasos
que yo debo hacer manualmente en Google Cloud.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F17-P02 · Pantallas de dispositivos

```
Inventario de celulares en el panel (modelo, versión, batería, último contacto,
chofer), generación del QR de inscripción, aplicar o quitar modo kiosco, bloqueo y
borrado remoto con confirmación. Pruebas E2E con el adaptador simulado.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 18 — Landing page con animaciones 3D

**Objetivo:** Sitio público de nivel profesional con un camión de personal en 3D que recorre la página y el mapa mientras el usuario hace scroll.

**Requiere:** Producto funcional (fases 00–08). Blender instalado.

#### F18-P01 · Dirección de arte y estructura

```
En apps/landing crea la landing con HTML, CSS y JavaScript (módulos ES) empaquetada
con Vite. Antes de diseñar:
1. Revisa TODAS las skills de diseño web instaladas en Claude Code y elige y aplica
   las mejores para una landing de altísimo nivel (anota cuáles usaste en AVANCES.md).
2. Define la dirección de arte: estilo, paleta Shiftlane, tipografías, ritmo de
   animación, referencias. Debe sentirse premium, moderna y confiable, no plantilla.
3. Estructura de secciones: hero, problema, cómo funciona (recorrido de un turno),
   monitoreo en vivo, evidencia y prefactura, para transportistas, para plantas,
   seguridad, precios con calculadora de ahorro, preguntas frecuentes, demo, pie.
4. Presupuesto de rendimiento: carga inicial ligera, 3D cargado de forma progresiva.
Entrega un documento docs/landing-arte.md con todo lo anterior antes de programar.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F18-P02 · Modelos 3D en Blender

```
Usando Blender en modo línea de comandos (blender --background --python) o el
servidor MCP de Blender si está disponible, crea en assets/3d:
1. Un camión/van de transporte de personal estilizado (low-poly elegante) con
   colores de marca y logotipo Shiftlane, ruedas como objetos separados para girarlas,
   faros y luces emisivas, interior simple visible por ventanas.
2. Escenario modular: tramo de carretera curva, parada de autobús, puerta de planta
   industrial estilizada, edificios de ciudad low-poly y marcadores de parada.
3. Optimiza (pocas caras, materiales PBR simples, texturas pequeñas) y exporta a
   GLB con compresión Draco; genera renders de previsualización en PNG.
4. Guarda los scripts .py para poder regenerar los modelos.
Muéstrame los renders y espera mi aprobación antes de seguir.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F18-P03 · Escena 3D principal: el camión recorre la página

```
Con Three.js y GSAP ScrollTrigger:
- Escena persistente detrás del contenido donde el camión recorre una ruta
  (curva CatmullRom) sincronizada con el scroll: arranca en el hero, se detiene en
  "paradas" que coinciden con cada sección y llega a la planta al final.
- Ruedas que giran según el avance, luces que se encienden, ligera suspensión,
  cámara cinematográfica que cambia de ángulo por sección, iluminación cuidada,
  sombras suaves, niebla y post-procesado ligero.
- En cada parada aparecen pasajeros abstractos que "abordan" (partículas o siluetas)
  para ilustrar el escaneo.
- Carga progresiva con pantalla de carga elegante; LOD y reducción automática de
  calidad en equipos lentos.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F18-P04 · Mapa en vivo con el camión 3D

```
Sección "Monitoreo en vivo": mapa estilizado (MapLibre con capa personalizada de
Three.js, o escena 3D de mapa propia) donde el camión 3D recorre una ruta luminosa
por calles de Ciudad Juárez con paradas que se iluminan, ETA que cambia en vivo,
una alerta de retraso simulada y tarjetas flotantes de abordaje.
Animación sincronizada con el scroll y también reproducible en bucle.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F18-P05 · Contenido, interacciones y conversión

```
- Textos finales en español de México orientados a transportistas y a plantas.
- Animaciones de entrada de texto y tarjetas, contadores, comparativas.
- Calculadora: unidades y precio actual por unidad → precio Shiftlane (−5% o
  precio de lista) y ahorro mensual, con las reglas de packages/shared.
- Planes y precios, preguntas frecuentes, formulario de demo/piloto que crea el
  prospecto en la API (fase 16).
- Botones de WhatsApp y correo.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F18-P06 · Rendimiento, accesibilidad, SEO y publicación

```
- Versión sin 3D para prefers-reduced-motion y celulares de gama baja (imágenes o
  video corto en su lugar), sin perder contenido.
- Lighthouse ≥ 90 en rendimiento, accesibilidad, buenas prácticas y SEO en móvil.
- Metadatos, Open Graph, datos estructurados, sitemap.
- Páginas: centro de ayuda público, estado del servicio (fase 15), aviso de
  privacidad, términos.
- Despliegue en Cloudflare Pages (o el servidor) con caché de assets 3D.
- Pruebas visuales con Playwright en escritorio y móvil.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 19 — Seguridad y endurecimiento

**Objetivo:** Revisar y cerrar riesgos antes de exponer el sistema a clientes reales.

**Requiere:** Fases 01–17.

#### F19-P01 · Auditoría de seguridad

```
Actúa como auditor de seguridad del repositorio completo: aislamiento entre
empresas (incluye Socket.IO y asistente), autenticación, permisos, validación de
entradas, carga de archivos, secretos, dependencias vulnerables, límites de
peticiones, cifrado de datos sensibles, OWASP Top 10. Entrega un reporte por
severidad en docs/seguridad.md antes de corregir.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F19-P02 · Correcciones y pruebas de seguridad

```
Corrige los hallazgos críticos y altos, agrega pruebas automáticas que los cubran
(intentos de acceso cruzado, escalamiento de permisos, archivos maliciosos,
fuerza bruta) y escaneo de secretos y dependencias en CI.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 20 — Pruebas integrales y QA

**Objetivo:** Comprobar el sistema completo de punta a punta, bajo carga y en dispositivos reales.

**Requiere:** Fases 01–19.

#### F20-P01 · Pruebas extremo a extremo de un día completo

```
Suite Playwright + integration_test de Flutter que recorra un día completo con el
simulador: alta de transportista y planta, catálogos, ruta, programación, turno con
abordajes, retraso, celular sin batería, zona sin señal, solicitud de viaje extra,
cierre de mes, objeción, aprobación y factura simulada.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F20-P02 · Pruebas de carga y resistencia

```
Escenarios k6: 300 y 1,000 unidades enviando posiciones cada 10 s, 200 usuarios en
el panel, lotes de sincronización grandes. Mide tiempos de respuesta, uso de CPU y
memoria; documenta límites y optimiza cuellos de botella.
Prueba de caída: detener la API 5 minutos durante un turno simulado y verificar que
nada se pierde.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F20-P03 · Revisión de calidad y corrección de errores

```
Revisa pantallas en escritorio, tableta y móvil; textos, estados vacíos, errores y
accesibilidad. Lista todos los errores encontrados en AVANCES.md, corrígelos y
vuelve a correr toda la suite.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 21 — Despliegue, monitoreo y respaldos

**Objetivo:** Poner Shiftlane en producción con alta disponibilidad básica, monitoreo y respaldos verificados.

**Requiere:** Fase 20.

#### F21-P01 · Infraestructura de producción

```
infra/: docker-compose de producción (API, workers, Redis, Caddy con HTTPS),
PostgreSQL administrado o en contenedor con réplica, almacenamiento de objetos,
variables de entorno por ambiente (staging y producción), dominios y subdominios
(app., api., status.). Guía paso a paso en docs/despliegue.md de lo que debo
contratar y configurar manualmente.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F21-P02 · CI/CD y publicación segura

```
GitHub Actions: pruebas → construir imágenes → desplegar a staging → pruebas de humo →
publicar a producción con etiqueta de versión, migraciones automáticas y regreso
automático a la versión anterior si falla la verificación de salud.
Regla: nunca publicar entre las 4:00 y 8:00 ni entre 14:00 y 16:00 (cambios de turno).
Publicación de la app del chofer en Google Play (pista interna) documentada.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F21-P03 · Monitoreo, alertas y respaldos

```
Sentry en API, web, rider y app; UptimeRobot; alertas al administrador solo para
fallas del sistema; respaldos diarios de PostgreSQL con archivo continuo,
cifrados, fuera del servidor, con restauración de prueba automatizada mensual.
Documenta el plan de recuperación ante desastres.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

### Fase 22 — Documentación y piloto

**Objetivo:** Dejar todo listo para operar con el primer cliente y con mínimo soporte.

**Requiere:** Fase 21.

#### F22-P01 · Manuales y documentación técnica

```
Genera en docs/manuales: manual del dueño/gerente, despachador, chofer (con
capturas), planta y pasajero; guía de configuración inicial; documentación técnica
(arquitectura, API, eventos, base de datos, despliegue, recuperación).
Convierte los manuales de usuario en artículos del centro de ayuda.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

#### F22-P02 · Preparación del piloto

```
Crea el kit del piloto: cuenta de demostración con datos realistas, checklist de
arranque (celulares, rutas, empleados, QR de puertas), criterios de éxito medibles
con reporte automático semanal para la transportista y la planta, y un documento de
acuerdo de piloto (60 días, precio posterior). Actualiza AVANCES.md con el estado
final del proyecto.
Al terminar: ejecuta todas las pruebas, actualiza docs/AVANCES.md y haz commit siguiendo CLAUDE.md.
```

## 6. Recomendaciones para trabajar con Claude Code

- **Un prompt a la vez.** Si un prompt es muy grande para una sesión, pide a Claude que lo divida en sub-tareas y que actualice AVANCES.md después de cada una.

- **Revisa los planes antes del código** en las fases críticas (01, 05, 12, 13, 19): pide primero el plan y apruébalo.

- **Usa el simulador de flota** (fase 06) para probar todo sin depender de celulares reales.

- **No mezcles fases.** Si descubres algo pendiente de otra fase, que Claude lo anote en AVANCES.md en lugar de hacerlo en ese momento.

- **Secretos:** nunca pegues llaves reales en el chat; Claude trabaja con .env.example y valores de prueba.

- **Aprobaciones visuales:** en la landing (fase 18) aprueba renders y dirección de arte antes de que Claude programe las animaciones.

- **Reanudación:** ante cualquier corte, usa el prompt de la sección 4.3.
