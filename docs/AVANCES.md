# AVANCES — Shiftlane

## ESTADO ACTUAL (leer primero, máximo 25 líneas)
- Fase actual: F00 — Preparación del workspace
- Último prompt completado: F00-P01
- Siguiente prompt: F00-P02 (la conversión ya está hecha; falta solo docs/referencia/resumen.md)
- Trabajo a medias (si lo hay): ninguno
- Pruebas: todas pasan (`pnpm test` = verificación de documentos de referencia)
- Cómo levantar el entorno: `pnpm install` y `pnpm test` (Docker y servicios llegan en F00-P03)
- Pendientes abiertos:
  - El usuario debe instalar Docker Desktop y Flutter antes de F00-P03.
  - F00-P03 necesita un repositorio remoto en GitHub para que corra el CI.
  - Confirmar con el usuario: la portada de los .docx dice «RUTASYNC» (¿nombre anterior?).

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

## HISTORIAL (más reciente arriba)
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
