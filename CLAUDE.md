# Shiftlane — instrucciones para Claude Code

## Qué es
SaaS para empresas de transporte de personal (México). Referencia funcional:
docs/referencia/descripcion-funcional.md y docs/referencia/sistema-de-precios.md.
Plan de trabajo (76 prompts en 23 fases): docs/referencia/plan-de-desarrollo.md.
Índice para ubicar cada prompt (código, título, fase, línea): docs/referencia/indice-de-prompts.md.

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
- `pnpm install` — instala las dependencias del workspace.
- `pnpm test` — ejecuta todas las pruebas (por ahora, la verificación de documentos).
- `pnpm docs:referencia` — regenera docs/referencia/*.md e indice-de-prompts.md a partir
  de los .docx de docs/referencia/originales/ (requiere pandoc).
- `pnpm docs:verificar` — comprueba que los Markdown estén completos y el índice al día.
- Pendientes de F00-P03: dev (levantar entorno), lint, typecheck, db:migrate, db:seed.

## Entorno local
- Windows 10; Node.js 24 LTS y pnpm 12. Los scripts de package.json deben funcionar en
  Windows y en Linux (CI).
- pandoc: %LOCALAPPDATA%\Pandoc\pandoc.exe (el script lo encuentra aunque no esté en PATH).
- Blender 5.2: "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" (no está en PATH).
