# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

npm workspaces monorepo (`apps/*`, `packages/*`) plus a Cargo workspace (`crates/*`, `apps/compiler-server`). Node 20+.

```bash
npm install
npm run dev                 # Next.js studio on http://localhost:3000 (no TeX install needed)
npm run typecheck           # tsc --noEmit in every workspace
npm run test:unit           # vitest in every workspace
npm run lint                # eslint (apps/web only)
npm run build
npm run format / format:check   # prettier
npm run e2e                 # Playwright; auto-starts `next dev -p 3100`
cargo test --workspace      # also: npm run rust:test
npm run rust:fmt            # cargo fmt --check
```

Single tests:

```bash
npx vitest run packages/tikz-parser/src/index.test.ts            # one file (from repo root)
npx vitest run packages/tikz-parser/src/index.test.ts -t "raw"   # by test name
npm run test:unit --workspace @tikzforge/graphic-ir              # one package
cargo test -p tikzforge-tikz-serializer                          # one crate
cargo run -p tikzforge-compiler-server                           # compiler service on :8080
```

`docker compose up --build` runs the web app plus the sandboxed compiler container with real Tectonic (first build ~5 min). The compiler sits on an `internal` network reachable only from web, with a read-only root, all caps dropped and uid 65532. If host port 3000 is taken, map another with a compose override file instead of editing `docker-compose.yml`.

`e2e` shares one dev server across parallel workers; running it while something else saturates the CPU (e.g. a Docker build) causes spurious Monaco-load timeouts.

## Architecture

**The Graphic IR (`packages/graphic-ir`) is the single source of truth.** TikZ source is a view of it, never the domain model. The IR has no LaTeX dependency; coordinates are canvas pixels with y down. Conversion to TikZ happens only in the parser/serializer via `canvasToTikzPoint`/`tikzToCanvasPoint`, using `settings.pixelsPerCm` (default 50) and `settings.origin` (the canvas point for TikZ `(0,0)`); TikZ y points up. Font sizes and line widths are canvas px and are converted to pt (`\footnotesize`, `thick`, ...) by the TikZ vocabulary helpers in `packages/tikz-parser/src/vocabulary.ts`.

Round-trip loop (lives in `apps/web/src/stores/project-store.ts`):

- The store keeps `source`, a `sourceMap` (element id → statement offsets including the `;`), and `mappedSource` (the text the map describes; it differs from `source` while the user is typing).
- IR changes go through `commit()`: `normalize()` (relative nodes follow targets, `auto`-sized nodes fit text, orphaned relative nodes become absolute), then `patchSource()` rewrites only the changed statements. Full `serializeProjectWithMap()` is the fallback when a patch is impossible. Document replacements (template, open, import, AI) use `replaceProject()`; TikZ import keeps the file's text as-is.
- `TikzEditor` is uncontrolled (`defaultValue`): store changes are applied to Monaco as one minimal `executeEdits`, and `onChange` ignores those programmatic edits.
- Editor edits call `setSource`, then a debounced `applySource()` → `parseTikz()` → `reconcileParsedProject()`, which keeps ids of unnamed statements (by position through the text diff, or endpoints for edges) and IR-only state (locks, visibility, groups). Only a `valid` parse replaces `project`; history is recorded only if the drawing changed.
- The serializer is deterministic and round-trip stable; tests assert parse → serialize → parse preserves geometry and that a second serialization is identical. It emits elements in IR order, deferring anything that references a node defined later.

**Unsupported TikZ** becomes a `raw-tikz` element (an `info` diagnostic, never an error): preserved verbatim, never rewritten by patches. `\foreach` with literal lists, shifted `scope`s and coordinate paths get a read-only `preview` (shapes drawn on canvas, never serialized). Nodes defined inside previews can be referenced later, but an edge or relative node depending on one is kept raw too, so editable IR never points at raw-only nodes. The parser is a bounded subset parser (see `docs/tikz-parser.md`); don't add macro expansion.

Colors in the IR are `#hex` (canvas palette) or xcolor expressions (`blue!20`). `displayColor` maps expressions onto the dark canvas; `tikzColor` maps the canvas palette to printable TikZ. `edgeGeometry`, `plotGeometry` and `resolveRelativePositions` are shared by the canvas, the SVG renderer and the store.

**IDs** are stable and not derived from array position. Parsed TikZ node names become element ids; new elements use `createElementId(prefix, existingIds)`. Paste/duplicate remap edge `from`/`to` through a replacement map.

**Validation gate:** `validateProject()` (duplicate ids, dangling edge refs, coordinates, raw-block invariants) runs on everything entering the store from outside: parse results, AI output, JSON import.

**Undo/redo:** history entries hold a project snapshot plus an optional `DiagramCommand` (`packages/graphic-ir/src/commands.ts`); undo/redo prefer the command and fall back to the snapshot. History is capped at 100. Drags use `updateElementTransient` (no history) and then `commitInteraction(before, label)`, which diffs elements into a `BatchCommand`.

**Stores (zustand):** `project-store` (project, source/source map, selection, history), `ui-store` (view transform, modals), `compiler-store` (preview lifecycle and `renderer`). Autosave/recovery goes to localStorage (`tikzforge.project.v1`, `tikzforge.source.v1` for the text and map, `tikzforge.recovery.v1`).

### Packages

TS packages have no build step: `main`/`types` point at `src/index.ts`, and `apps/web/next.config.ts` lists them in `transpilePackages`. A new package must be added there and to `apps/web/package.json`.

- `tikz-ast`: token and AST types with source ranges.
- `tikz-parser`: comment masking, statement slicing, IR conversion, raw previews, `reconcileParsedProject`, and the shared TikZ vocabulary (`TIKZ_PREAMBLE`, units, fonts, line widths, arrow specs).
- `tikz-serializer`: IR → TikZ (`serializeProjectWithMap`) and `patchSource`.
- `svg-renderer`: the fast deterministic IR → SVG preview, plus `sanitizeSvg`.
- `tikz-language-service`: completions, snippets, and diagnostics for Monaco. The Monarch tokenizer and the `tikzforge-tikz` language registration live in `apps/web/src/components/editor/TikzEditor.tsx`.
- `plugin-system`: `DiagramPlugin` contract; the registry rejects duplicate ids. TikZ Core and PGFPlots are registered by default.

Monaco depends on browser globals, so it is loaded with `next/dynamic` and `ssr: false`.

### Rendering and the compiler boundary

`POST /api/render` (`apps/web/src/app/api/render/route.ts`) validates the source (`validateLatexSource`: 512 KB, no `\write18`/`\input`/`\include`/`\openin`/`\openout`/`shell-escape`). With `COMPILER_SERVICE_URL` set it calls the Rust service (20 s timeout), checks the response shape, and forwards 200/400/422. Any 5xx, network error, timeout or malformed body falls back to the fast renderer (`parseTikz` → `renderProjectToSvg({ fitToContent: true })` → `sanitizeSvg`). Every response carries `renderer: 'tectonic' | 'fast'`; the UI (`CompilePreview` in `components/preview/PreviewPanel.tsx`, shown in the Export dialog) labels the preview and uses a white background for Tectonic output.

The Rust crates are **not** a port of the TS packages:

- `crates/graphic-ir` holds only the render wire types; a serde test pins the JSON (`compileTime`, `renderer`, `errors` as `Diagnostic`-shaped objects) to what the web route expects.
- `crates/tikz-parser` is only a lexer.
- `crates/tikz-serializer` holds compiler-service helpers: source validation, standalone wrapping (`PICTURE_PREAMBLE`), and TeX log → editor line errors (offset by the preamble length).

`apps/compiler-server` (Axum) re-validates input, runs a pinned Tectonic (`--untrusted --only-cached`, no shell, cleared env plus `TECTONIC_CACHE_DIR`, timeouts) and converts with `pdftocairo`. It returns 503 when Tectonic is unavailable (no placeholder SVG).

Keep these in sync when changing them:

- The forbidden-construct list: `apps/web/src/lib/security.ts` and `crates/tikz-serializer/src/lib.rs`.
- The preamble: `TIKZ_PREAMBLE` (TS LaTeX export), `PICTURE_PREAMBLE` (Rust) and `docker/compiler/warmup.tex`. The image's package cache is built from `warmup.tex`, so anything the serializer starts emitting (a package, TikZ library or font) must be added there or offline compiles fail.

`POST /api/generate` uses a deterministic local "AI" provider (`apps/web/src/lib/ai.ts`) that splits the prompt into labelled nodes. It is not an LLM; it is the seam where one would plug in. Its output is always validated as IR.

## Conventions

- Prettier: single quotes, trailing commas, 100-column width. TS is strict with `noUncheckedIndexedAccess`, so indexed reads are `T | undefined`.
- Regex literals in this codebase use the `u` flag.
- Security model (`docs/security.md`): treat all LaTeX as hostile input, sanitize SVG before preview, and spawn child processes with argument arrays only, never a shell.
- Further design notes: `architecture.md`, `docs/*.md`, and `docs/roadmap.md` (the Phase 1–14 status and next hardening steps).
