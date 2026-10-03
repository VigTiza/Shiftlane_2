"""Genera los documentos de referencia de Shiftlane en Markdown.

Convierte los .docx de docs/referencia/originales/ a docs/referencia/*.md y
genera docs/referencia/indice-de-prompts.md a partir del plan de desarrollo.

Los .docx originales tienen un styles.xml que pandoc no logra leer, así que
pandoc pierde los encabezados y los bloques de código. Por eso se trabaja
sobre una copia temporal:
  1. Se sustituye styles.xml por uno mínimo con los estilos que el documento usa.
  2. Se marcan como código los párrafos sombreados escritos en Consolas.
  3. Se ejecuta pandoc con el filtro docx-a-markdown.lua.

Uso:
  python infra/scripts/docx-a-markdown.py              # convierte, genera el índice y verifica
  python infra/scripts/docx-a-markdown.py --verificar  # solo verifica lo que ya está generado
"""

from __future__ import annotations

import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REF_DIR = ROOT / "docs" / "referencia"
ORIGINALS_DIR = REF_DIR / "originales"
INDEX_FILE = REF_DIR / "indice-de-prompts.md"
SUMMARY_FILE = REF_DIR / "resumen.md"
SUMMARY_MAX_LINES = 80
LUA_FILTER = Path(__file__).with_suffix(".lua")

DOCUMENTS = [
    ("Shiftlane_Plan_de_Desarrollo.docx", "plan-de-desarrollo", "Shiftlane — Plan de desarrollo"),
    ("Shiftlane_Descripcion_Funcional.docx", "descripcion-funcional", "Shiftlane — Descripción funcional"),
    ("Shiftlane_Sistema_de_Precios.docx", "sistema-de-precios", "Shiftlane — Sistema de precios"),
]
PLAN_SLUG = "plan-de-desarrollo"

MINIMAL_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style>
</w:styles>
"""

PARAGRAPH_RE = re.compile(r"<w:p(?:\s[^>]*)?>.*?</w:p>", re.DOTALL)
SHADED_PPR_RE = re.compile(r"<w:pPr>(?:(?!</w:pPr>).)*<w:shd [^>]*w:fill=\"[0-9A-Fa-f]{6}\"", re.DOTALL)
TEXT_RE = re.compile(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>")

PHASE_HEADING_RE = re.compile(r"^### Fase (\d\d) — (.+)$")
PROMPT_HEADING_RE = re.compile(r"^#### (F\d\d-P\d\d) · (.+)$")
PHASE_SUMMARY_ROW_RE = re.compile(r"^\| \*\*(\d\d)\*\* \| (.+?) \| (\d+) \|$")


# --- Conversión -------------------------------------------------------------

def find_pandoc() -> str:
    found = shutil.which("pandoc")
    if found:
        return found
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "Pandoc" / "pandoc.exe"
    if local.exists():
        return str(local)
    sys.exit("No se encontró pandoc. Instálalo con: winget install JohnMacFarlane.Pandoc")


def mark_code_paragraphs(document_xml: str) -> tuple[str, int]:
    count = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal count
        para = match.group(0)
        if "Consolas" not in para or not SHADED_PPR_RE.search(para) or "<w:pStyle " in para:
            return para
        count += 1
        return para.replace("<w:pPr>", '<w:pPr><w:pStyle w:val="SourceCode"/>', 1)

    return PARAGRAPH_RE.sub(repl, document_xml), count


def patch_docx(src: Path, dst: Path) -> int:
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        code_paragraphs = 0
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/styles.xml":
                data = MINIMAL_STYLES.encode("utf-8")
            elif item.filename == "word/document.xml":
                text, code_paragraphs = mark_code_paragraphs(data.decode("utf-8"))
                data = text.encode("utf-8")
            zout.writestr(item, data)
    return code_paragraphs


def convert(pandoc: str, docx: Path, slug: str, title: str) -> None:
    media_rel = f"img/{slug}"
    media_dir = REF_DIR / media_rel
    if media_dir.exists():
        shutil.rmtree(media_dir)
    output = REF_DIR / f"{slug}.md"
    with tempfile.TemporaryDirectory() as tmp:
        patched = Path(tmp) / docx.name
        code_paragraphs = patch_docx(docx, patched)
        subprocess.run(
            [
                pandoc, str(patched),
                "-f", "docx", "-t", "gfm", "--wrap=none",
                f"--lua-filter={LUA_FILTER}",
                f"--metadata=doc_title:{title}",
                f"--extract-media={media_rel}",
                "-o", str(output),
            ],
            check=True,
            cwd=REF_DIR,
        )
    # pandoc deja las imágenes en img/<slug>/media/; se aplanan a img/<slug>/.
    nested = media_dir / "media"
    if nested.exists():
        for f in nested.iterdir():
            f.replace(media_dir / f.name)
        nested.rmdir()
    md = output.read_text(encoding="utf-8").replace(f"({media_rel}/media/", f"({media_rel}/")
    output.write_text(md, encoding="utf-8", newline="\n")
    print(f"{output.relative_to(ROOT).as_posix()}: {len(md.splitlines())} líneas, {code_paragraphs} líneas de código")


# --- Índice de prompts ------------------------------------------------------

def parse_plan(plan_md: str) -> tuple[list[dict], dict[str, int]]:
    """Devuelve los prompts encontrados y el número de prompts por fase según la tabla resumen."""
    prompts: list[dict] = []
    expected: dict[str, int] = {}
    phase = None
    for number, line in enumerate(plan_md.splitlines(), start=1):
        if m := PHASE_SUMMARY_ROW_RE.match(line):
            expected[m.group(1)] = int(m.group(3))
        elif m := PHASE_HEADING_RE.match(line):
            phase = (m.group(1), m.group(2))
        elif m := PROMPT_HEADING_RE.match(line):
            if phase is None:
                raise ValueError(f"El prompt {m.group(1)} aparece antes de cualquier fase")
            prompts.append({"code": m.group(1), "title": m.group(2), "phase": phase, "line": number})
    return prompts, expected


def render_index(prompts: list[dict]) -> str:
    phases = {p["phase"] for p in prompts}
    lines = [
        "# Índice de prompts — Shiftlane",
        "",
        f"{len(prompts)} prompts en {len(phases)} fases. Generado por `infra/scripts/docx-a-markdown.py`",
        "a partir de [plan-de-desarrollo.md](plan-de-desarrollo.md); no lo edites a mano.",
        "",
        "La columna «Línea» indica dónde empieza cada prompt en el plan, para leerlo directo.",
        "El avance se registra en [docs/AVANCES.md](../AVANCES.md), no aquí.",
        "",
        "| Código | Título | Fase | Línea |",
        "|---|---|---|---|",
    ]
    for p in prompts:
        number, name = p["phase"]
        lines.append(f"| {p['code']} | {p['title']} | F{number} — {name} | {p['line']} |")
    return "\n".join(lines) + "\n"


def write_index() -> None:
    plan_md = (REF_DIR / f"{PLAN_SLUG}.md").read_text(encoding="utf-8")
    prompts, _ = parse_plan(plan_md)
    INDEX_FILE.write_text(render_index(prompts), encoding="utf-8", newline="\n")
    print(f"{INDEX_FILE.relative_to(ROOT).as_posix()}: {len(prompts)} prompts")


# --- Verificación -----------------------------------------------------------

def normalize(text: str) -> str:
    text = text.replace("\\", "").replace("*", "").replace("`", "")
    return re.sub(r"\s+", " ", text).strip()


def omitted_on_purpose(raw_text: str, text: str, before_first_heading: bool) -> bool:
    """La portada con el nombre anterior y el índice con números de página se omiten a propósito."""
    if "RUTASYNC" in text.upper():
        return True
    # Las entradas del índice separan el título del número de página con un tabulador.
    return before_first_heading and (text == "Contenido" or "\t" in raw_text)


def verify() -> list[str]:
    errors: list[str] = []

    for filename, slug, _ in DOCUMENTS:
        md_path = REF_DIR / f"{slug}.md"
        if not md_path.exists():
            errors.append(f"Falta {md_path.relative_to(ROOT).as_posix()}")
            continue
        md_raw = md_path.read_text(encoding="utf-8")
        md = normalize(md_raw)
        xml = zipfile.ZipFile(ORIGINALS_DIR / filename).read("word/document.xml").decode("utf-8")
        before_first_heading = True
        for para in PARAGRAPH_RE.findall(xml):
            if 'w:val="Heading1"' in para:
                before_first_heading = False
            raw_text = html.unescape("".join(TEXT_RE.findall(para)))
            text = normalize(raw_text)
            if not text or omitted_on_purpose(raw_text, text, before_first_heading):
                continue
            if text not in md:
                errors.append(f"{slug}.md no contiene el párrafo: {text[:80]}")
        for image in re.findall(r"!\[[^\]]*\]\(([^)]+)\)", md_raw):
            if not (REF_DIR / image).exists():
                errors.append(f"{slug}.md apunta a una imagen inexistente: {image}")

    plan_md = (REF_DIR / f"{PLAN_SLUG}.md").read_text(encoding="utf-8")
    prompts, expected = parse_plan(plan_md)
    if not expected:
        errors.append("No se encontró la tabla resumen de fases en el plan")
    found: dict[str, int] = {}
    for p in prompts:
        found[p["phase"][0]] = found.get(p["phase"][0], 0) + 1
    for phase in sorted(set(expected) | set(found)):
        if expected.get(phase) != found.get(phase):
            errors.append(f"Fase {phase}: la tabla resumen dice {expected.get(phase)} prompts y el plan tiene {found.get(phase)}")
    codes = [p["code"] for p in prompts]
    if len(codes) != len(set(codes)):
        errors.append("Hay códigos de prompt repetidos en el plan")
    for p in prompts:
        if not p["code"].startswith(f"F{p['phase'][0]}-"):
            errors.append(f"{p['code']} está dentro de la fase {p['phase'][0]}")
    if not INDEX_FILE.exists() or INDEX_FILE.read_text(encoding="utf-8") != render_index(prompts):
        errors.append("indice-de-prompts.md no coincide con el plan; vuelve a generarlo")

    # El resumen se escribe a mano (F00-P02) y debe seguir siendo de consulta rápida.
    if not SUMMARY_FILE.exists():
        errors.append("Falta docs/referencia/resumen.md")
    elif (lines := len(SUMMARY_FILE.read_text(encoding="utf-8").splitlines())) > SUMMARY_MAX_LINES:
        errors.append(f"resumen.md tiene {lines} líneas; el máximo es {SUMMARY_MAX_LINES}")

    return errors


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # la consola de Windows no usa UTF-8 por omisión
    if "--verificar" not in sys.argv:
        pandoc = find_pandoc()
        for filename, slug, title in DOCUMENTS:
            convert(pandoc, ORIGINALS_DIR / filename, slug, title)
        write_index()

    errors = verify()
    if errors:
        print(f"Verificación fallida ({len(errors)} problemas):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("Verificación correcta: documentos completos e índice consistente con el plan.")


if __name__ == "__main__":
    main()
