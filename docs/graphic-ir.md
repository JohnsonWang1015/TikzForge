# Graphic IR

`@tikzforge/graphic-ir` is deliberately independent of LaTeX. Coordinates use canvas pixels and
are converted at the parser/serializer boundary using `pixelsPerCm` (default: 100).

Supported elements:

- Primitive nodes: rectangle, circle, ellipse, text, formula, coordinate and image.
- Connections: line, arrow, bidirectional-arrow, dashed-arrow and curved-arrow.
- Group, plot and read-only raw-tikz block.

Every element has a stable `id`, layer, visibility, lock state, rotation and optional source range.
Projects contain metadata, canvas settings, named TikZ styles, settings, elements and preserved
raw blocks. `validateProject` checks duplicate IDs, coordinates, edge references and raw-block
invariants before AI or import results enter the editor.

The JSON shape is intentionally portable and is saved as `.tikzproject`.
