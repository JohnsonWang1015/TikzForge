# Graphic IR

`@tikzforge/graphic-ir` is deliberately independent of LaTeX. Coordinates are canvas pixels (y
down). The parser and serializer convert them with `canvasToTikzPoint` / `tikzToCanvasPoint`:
`settings.pixelsPerCm` (default 50, which keeps 14 px canvas text close to `\footnotesize`) and
`settings.origin`, the canvas point for TikZ `(0,0)`. TikZ y points up.

Supported elements:

- Primitive nodes: rectangle, circle, ellipse, text, formula, coordinate and image. `sizeMode`
  is `fixed` (emitted as minimum width/height) or `auto` (sized from text like plain TikZ).
- Image nodes keep their `\includegraphics` file name in `source` (a plain relative path,
  `example-image` by default) and an uploaded picture in `href` as a PNG/JPEG data URL. The data
  URL is never written to TikZ; renderers ignore any other `href`, and `validateProject` rejects
  it.
- Connections: line, arrow, bidirectional-arrow, dashed-arrow and curved-arrow, with optional
  anchors, `bend`, orthogonal `route` (`-|`, `|-`), label and label options.
- Group, plot and read-only raw-tikz block. Raw blocks may carry a `preview` of the shapes they
  draw, which is rendered but never serialized or edited.

Every element has a stable `id`, layer, visibility, lock state, rotation and optional source range.
Nodes and edges can keep `styleRefs` (named TikZ styles) and `extraOptions` (TikZ options the IR
does not model) so round trips do not lose them. Projects contain metadata, canvas settings, named
TikZ styles, picture options, settings, elements and preserved raw blocks. `validateProject` checks
duplicate IDs, coordinates, edge references and raw-block invariants before AI or import results
enter the editor.

Colors are `#rrggbb` values or xcolor expressions (`blue!20`, `red!50!black`). `displayColor`
renders expressions on the dark canvas (white paper → canvas background, black ink → light
foreground); `tikzColor` turns canvas palette colors into printable TikZ colors.

`edgeGeometry`, `plotGeometry` and `resolveRelativePositions` are shared by the canvas, the SVG
renderer and the store so every surface draws the same shapes.

The JSON shape is intentionally portable and is saved as `.tikzproject`.
