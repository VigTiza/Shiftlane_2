-- Filtro de pandoc para los documentos de referencia de Shiftlane.
-- Lo usa docx-a-markdown.py; no está pensado para usarse solo.
--  * Pone el título del documento como H1 y baja un nivel los demás encabezados.
--  * Quita las negritas redundantes dentro de los encabezados.
--  * Elimina la portada con el nombre anterior y el índice con números de página.
--  * Une en un solo bloque cercado las líneas de código consecutivas.

local stringify = pandoc.utils.stringify

local function unwrap_strong(inlines)
  return pandoc.Inlines(inlines):walk({
    Strong = function(s) return s.content end,
  })
end

function Header(h)
  h.level = h.level + 1
  h.content = unwrap_strong(h.content)
  return h
end

-- Los prompts vienen sangrados, así que pandoc los envuelve en una cita.
function BlockQuote(bq)
  local lines = {}
  for _, block in ipairs(bq.content) do
    if block.t ~= "CodeBlock" then
      return nil
    end
    table.insert(lines, block.text)
  end
  return pandoc.CodeBlock(table.concat(lines, "\n"), pandoc.Attr("", { "text" }))
end

-- Sin tamaño, la imagen sale como ![...](...) en vez de una etiqueta <img>.
function Image(img)
  img.attributes = {}
  if #img.caption == 0 then
    img.caption = { pandoc.Str("Figura") }
  end
  return img
end

-- Con una clase, el escritor gfm usa bloques cercados (```) en vez de sangría.
function CodeBlock(cb)
  if #cb.classes == 0 then
    cb.classes = { "text" }
  end
  return cb
end

local function is_old_cover_title(block)
  return block.t == "Para" and stringify(block):upper():find("RUTASYNC", 1, true) ~= nil
end

function Pandoc(doc)
  local title = doc.meta.doc_title and stringify(doc.meta.doc_title) or nil
  local out = pandoc.Blocks({})
  if title then
    out:insert(pandoc.Header(1, title))
  end

  local skipping_toc = false
  for _, block in ipairs(doc.blocks) do
    if skipping_toc then
      if block.t == "Header" then
        skipping_toc = false
      end
    end

    if skipping_toc then
      -- índice con números de página: no sirve en Markdown
    elseif block.t == "Para" and stringify(block) == "Contenido" then
      skipping_toc = true
    elseif is_old_cover_title(block) then
      -- portada con el nombre anterior del proyecto: el H1 la reemplaza
    elseif block.t == "CodeBlock" and #out > 0 and out[#out].t == "CodeBlock" then
      out[#out].text = out[#out].text .. "\n" .. block.text
    else
      out:insert(block)
    end
  end

  for _, block in ipairs(out) do
    if block.t == "CodeBlock" then
      block.text = block.text:gsub("[ \t]+\n", "\n"):gsub("[ \t]+$", "")
    end
  end

  doc.blocks = out
  doc.meta.doc_title = nil
  return doc
end
