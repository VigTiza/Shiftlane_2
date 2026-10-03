# Shiftlane

SaaS para empresas de transporte de personal en México: planear, operar, comprobar y
cobrar cada viaje que hacen para las plantas que las contratan.

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/api` | API y servicios automáticos (Fastify, Prisma, Socket.IO, BullMQ) |
| `apps/web` | Panel de la transportista, portal de la planta y consola de plataforma (React) |
| `apps/rider` | App del pasajero, web instalable (React PWA) |
| `apps/driver` | App del chofer para Android (Flutter) |
| `apps/landing` | Landing page con animaciones 3D (HTML, CSS, JS, Three.js, GSAP) |
| `packages/shared` | Tipos, esquemas Zod, constantes y reglas de precios compartidas |
| `assets/3d` | Modelos de Blender, scripts y GLB exportados |
| `infra` | Docker Compose, Caddy, respaldos y scripts |
| `docs` | Bitácora de avances, documentos de referencia, decisiones y manuales |

## Empezar

Requisitos: Node.js 24 LTS, pnpm, Python 3, Docker, Flutter 3.47 y pandoc (solo para
regenerar los documentos de referencia).

```sh
pnpm install
pnpm services:up   # PostgreSQL + PostGIS, Redis y Mailpit
pnpm test
pnpm lint
```

Los comandos completos están en [CLAUDE.md](CLAUDE.md#comandos).

## Documentación

- [docs/AVANCES.md](docs/AVANCES.md): estado actual del proyecto e historial.
- [docs/referencia/](docs/referencia/): plan de desarrollo, descripción funcional,
  sistema de precios e índice de prompts.
- [CLAUDE.md](CLAUDE.md): reglas del proyecto para Claude Code.
