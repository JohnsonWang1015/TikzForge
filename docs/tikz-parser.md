# TikZ parser and language service

The parser (`packages/tikz-parser`) is a bounded subset parser, not a TeX macro engine. It never
expands macros or executes anything.

## Pipeline

1. `%` comments are blanked out (offsets and newlines kept), so they never split or swallow a
   statement.
2. `\begin{tikzpicture}[...]` options are read for `name/.style`, `every node/.style` and
   `node distance`, and kept verbatim as `project.pictureOptions`.
3. The body is sliced into statements: path commands end at a top-level `;`, environments at
   their matching `\end{...}`, `\foreach` at its braced body, and macros such as `\tikzset` after
   their brace/bracket arguments.
4. Each statement becomes IR elements, or a `raw-tikz` block when it is outside the editable
   subset. Every element records its statement's offsets (including the `;`) in `sourceMap`.

## Editable subset

- `\node` / `\coordinate`: options, `(name)` and `at (...)` in any order; cartesian, polar
  (`(30:2)`) and arithmetic coordinates; `right=of A`, `below=2cm of A`, `1cm and 2cm`; no `at`
  means the origin. Nodes without `minimum width/height` are `auto`-sized from their text.
- Edges between named nodes with `--`, `-|`, `|-`, `to[bend left/right=...]` or
  `.. controls .. and .. ..`; anchors; arrow specs (`->`, `<-`, `<->`, `-Stealth`, `Latex-`,
  `-{Stealth[length=3mm]}`); at most one label `node[...]{...}`. `A <- B` is stored as `B -> A`.
- `\draw`/`\fill`/`\filldraw` `(p) rectangle (q)`, `(p) circle (r)` and `(p) ellipse (a and b)`
  become shape nodes.
- Appearance options: `draw`, `fill`, `color`/bare colors, `text`, `rounded corners`,
  dashed/dotted, TikZ line widths, `font=` size commands and `\bfseries`, `text width`, `align`,
  shapes. Colors keep their xcolor expression. Options the IR does not model are kept in
  `extraOptions` and re-emitted verbatim; named styles are kept in `styleRefs`.
- Node text that is only `\includegraphics[width=..,height=..]{file}` (both lengths, no other
  graphics options, a plain relative file name) becomes an image node; the serializer's
  `inner sep=0pt` belongs to the image and is not kept as an extra option. Anything else stays
  node text.
- A PGFPlots `axis` with exactly one `\addplot coordinates {...}` or `\addplot {expr}`; `at`,
  `anchor`, `width`, `height`, `title`, `xlabel`, `ylabel`, `ybar` and `only marks` are
  understood.

## Raw blocks and previews

Anything else is a `raw-tikz` block (an `info` diagnostic, never an error) whose source is
preserved exactly. Raw blocks carry a read-only `preview` when their shapes can be computed:

- `\foreach` with a literal list (including `1,...,n` and `a/b` pairs) is unrolled, with
  arithmetic in coordinates evaluated;
- `scope` environments with only `shift`/`xshift`/`yshift`;
- coordinate paths (`--`, `-|`, `rectangle`, `circle`, `.. controls ..`, `++`/`+`);
- axes with several plots (first series).

Nodes defined inside previews can be referenced by later statements. An edge or relatively
positioned node that depends on such a node is kept raw too, so editable IR never refers to
something only raw TikZ defines.

Genuine syntax problems (unbalanced delimiters, missing `;`, node without `{text}`, references to
undefined nodes) are errors, and the editor keeps the last valid canvas until they are fixed.

## Text edits

`reconcileParsedProject` folds a new parse into the current project. Statements without a TikZ
name keep their previous id (matched by position through the text diff, or by endpoints for
edges), and IR-only state such as locks, visibility, groups and uploaded pictures (matched by
image file name) is kept.

## Language service

Monaco receives a dedicated language id, Monarch tokenization, option completions, snippets,
bracket matching and source diagnostics. The language service is package-level so another editor
can reuse it.
