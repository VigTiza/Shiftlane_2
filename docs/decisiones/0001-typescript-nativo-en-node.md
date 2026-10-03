# 0001 — Ejecutar TypeScript directamente con Node.js 24

- Fecha: 2026-10-03
- Estado: aceptada

## Contexto
La API se escribe en TypeScript. Las opciones eran compilar a JavaScript (tsc o un
empaquetador), ejecutar con tsx, o usar la eliminación de tipos que Node.js 24 trae integrada.

## Decisión
La API corre con `node src/server.ts` (desarrollo: `node --watch src/server.ts`), sin paso
de compilación. Para que funcione en todo el monorepo:
- Los imports relativos llevan extensión `.ts` (`allowImportingTsExtensions`).
- Solo se usa sintaxis que se puede borrar (`erasableSyntaxOnly`): nada de `enum`,
  `namespace` ni propiedades en parámetros del constructor. En su lugar, objetos `as const`
  y uniones de literales.
- `tsc --noEmit` solo revisa tipos.
- packages/shared se consume como código fuente TypeScript desde la API, la web y la app.

## Consecuencias
- Menos herramientas y arranque más rápido; lo que se prueba es exactamente lo que corre.
- El código generado (por ejemplo, el cliente de Prisma) debe ser compatible con esta forma
  de ejecución.
- Si alguna dependencia lo impide, la alternativa es compilar con tsc/tsup sin cambiar el
  código, porque las reglas anteriores también son válidas para compilar.
