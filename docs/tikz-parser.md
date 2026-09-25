# TikZ parser and language service

The parser is a bounded subset parser, not a TeX macro engine. It lexes commands, identifiers,
numbers, delimiters, options and source ranges, then parses:

- `\\node` and `\\coordinate` declarations;
- `\\draw`, `\\path`, `\\fill`, `\\filldraw` and `\\clip` paths;
- absolute coordinates, named node references, arrows, rectangles, circles, ellipses and basic
  Bézier controls;
- a PGFPlots `axis` / `addplot coordinates` subset.

Unknown macros (`\\foreach`, `\\newcommand`, conditionals and PGF math) become `raw-tikz` IR
elements. They remain available to export/compile but are intentionally not visual-editable.

Monaco receives a dedicated language id, Monarch tokenization, option completions, snippets,
bracket matching and source diagnostics. The language service is package-level so another editor
can reuse it.
