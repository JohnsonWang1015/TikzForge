# Roadmap and Phase audit

The requested implementation order is represented in the repository as follows:

| Phase | Deliverable                                                 | State                                |
| ----- | ----------------------------------------------------------- | ------------------------------------ |
| 1     | npm workspace, Next shell, Rust workspace, docs             | implemented                          |
| 2     | versioned Graphic IR, validation, IDs, coordinates          | implemented                          |
| 3     | SVG canvas, selection, pan/zoom, drag/resize, grid          | implemented                          |
| 4     | deterministic IR → TikZ serializer                          | implemented                          |
| 5     | Monaco language id, highlighting, completion, snippets      | implemented                          |
| 6     | lexer, AST, subset parser and source ranges                 | implemented                          |
| 7     | debounced TikZ ↔ IR sync and invalid-source retention       | implemented                          |
| 8     | secure fast render route and optional Rust/Tectonic service | implemented                          |
| 9     | TikZ/LaTeX/SVG/JSON export and project import               | implemented                          |
| 10    | command-style history, undo/redo, history panel             | implemented                          |
| 11    | template gallery and deterministic layout engine            | implemented                          |
| 12    | PGFPlots line/scatter/bar data editor and serializer        | implemented                          |
| 13    | validated editable AI generation interface                  | implemented with local provider seam |
| 14    | parser/serializer/renderer/inspector plugin contract        | implemented                          |

## Production hardening

Done:

- AST source-range patches: canvas edits rewrite only the changed statements, and text edits keep
  element ids.
- Real LaTeX previews through the sandboxed Tectonic service (`docker compose up`).
- A wider editable TikZ subset (styles, anchors, bends, orthogonal routes, labels, polar
  coordinates) and read-only previews for `\foreach`, scopes and coordinate paths.
- Playwright coverage for resize, history, raw blocks, PGFPlots and source preservation.

Next:

- A real model behind the AI generation seam (currently a deterministic local provider).
- Browser WASM compilation and IndexedDB binary snapshots.
- Accessibility review and visual regression baselines.
