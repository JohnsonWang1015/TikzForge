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

`docker compose up --build` runs the web app plus the sandboxed compiler container (no network, read-only root, all caps dropped).

## Architecture

**The Graphic IR (`packages/graphic-ir`) is the single source of truth.** TikZ source is a view of it, never the domain model. The IR has no LaTeX dependency; coordinates are canvas pixels, and conversion to TikZ cm (`project.settings.pixelsPerCm`, default 100) happens only in the parser/serializer.

Round-trip loop (lives in `apps/web/src/stores/project-store.ts`):

- Canvas/inspector actions mutate IR → `serializeProject()` regenerates the **entire** `tikzpicture` into `source`. There is no incremental patching yet (AST source ranges and `serializeProjectWithMap` exist for that future work).
- Editor edits call `setSource`, then `TikzEditor` debounces `applySource()` → `parseTikz()`. Only a `valid` parse replaces `project`; an invalid parse just updates `diagnostics`, so the canvas keeps its last good state.
- The serializer must stay deterministic and round-trip stable (tests assert `serialize(p) === serialize(p)` and parse → serialize → parse preserves ids/edges). Full LaTeX wrappers survive via `project.documentWrapper`.

**Unsupported TikZ** (`\foreach`, `\newcommand`, conditionals, PGF math, unknown macros) becomes a `raw-tikz` element: preserved verbatim for export/compile, never interpreted or edited by the canvas. The parser is a bounded subset parser, not a TeX engine; don't add macro expansion.

**IDs** are stable and not derived from array position. Parsed TikZ node names become element ids; new elements use `createElementId(prefix, existingIds)`. Paste/duplicate remap edge `from`/`to` through a replacement map.

**Validation gate:** `validateProject()` (duplicate ids, dangling edge refs, coordinates, raw-block invariants) runs on everything entering the store from outside: parse results, AI output, JSON import.

**Undo/redo:** history entries hold a project snapshot plus an optional `DiagramCommand` (`packages/graphic-ir/src/commands.ts`); undo/redo prefer the command and fall back to the snapshot. History is capped at 100. Drags use `updateElementTransient` (no history) and then `commitInteraction(before, label)`, which diffs elements into a `BatchCommand`.

**Stores (zustand):** `project-store` (project, source, selection, history), `ui-store` (view transform, modals), `compiler-store` (preview lifecycle). Autosave/recovery goes to localStorage (`tikzforge.project.v1`, `tikzforge.recovery.v1`).

### Packages

TS packages have no build step: `main`/`types` point at `src/index.ts`, and `apps/web/next.config.ts` lists them in `transpilePackages`. A new package must be added there and to `apps/web/package.json`.

- `tikz-ast`: token and AST types with source ranges.
- `tikz-parser`: lexer, parser, AST → IR (resolves relative positioning, `axis`/`addplot coordinates` → plot elements).
- `tikz-serializer`: IR → TikZ.
- `svg-renderer`: the fast deterministic IR → SVG preview, plus `sanitizeSvg`.
- `tikz-language-service`: completions, snippets, and diagnostics for Monaco. The Monarch tokenizer and the `tikzforge-tikz` language registration live in `apps/web/src/components/editor/TikzEditor.tsx`.
- `plugin-system`: `DiagramPlugin` contract; the registry rejects duplicate ids. TikZ Core and PGFPlots are registered by default.

Monaco depends on browser globals, so it is loaded with `next/dynamic` and `ssr: false`.

### Rendering and the compiler boundary

`POST /api/render` (`apps/web/src/app/api/render/route.ts`) works like this:

1. It runs `validateLatexSource` (512 KB limit, and rejects `\write18`, `\input`/`\include`/`\openin`/`\openout`, and `shell-escape`).
2. If `COMPILER_SERVICE_URL` is set, it proxies to the Rust service with a 12 s timeout and returns that response body unchanged.
3. Otherwise, or if the service fails, it runs `parseTikz` → `renderProjectToSvg` → `sanitizeSvg`.

The Rust crates are **not** a port of the TS packages:

- `crates/graphic-ir` holds only the render wire types.
- `crates/tikz-parser` is only a lexer.
- `crates/tikz-serializer` holds compiler-service helpers: source validation, standalone document wrapping, and TeX log → line errors.

`apps/compiler-server` (Axum) re-validates the input rather than trusting the web process. It runs Tectonic only when `TECTONIC_BIN` is set, with `--untrusted --only-cached`, no shell, a cleared env, and a timeout, then converts the output with `pdftocairo`. Without Tectonic it returns a labelled fallback SVG.

- The forbidden-construct list exists in both `apps/web/src/lib/security.ts` and `crates/tikz-serializer/src/lib.rs`. Change both together.
- The web proxy forwards the Rust response unchanged, so `RenderResponse` and `CompileError` in `crates/graphic-ir` must serialize to the same JSON as the web route (`compileTime`, and `errors` as `Diagnostic` objects). A serde test there pins that shape.

`POST /api/generate` uses a deterministic local "AI" provider (`apps/web/src/lib/ai.ts`) that splits the prompt into labelled nodes. It is not an LLM; it is the seam where one would plug in. Its output is always validated as IR.

## Conventions

- Prettier: single quotes, trailing commas, 100-column width. TS is strict with `noUncheckedIndexedAccess`, so indexed reads are `T | undefined`.
- Regex literals in this codebase use the `u` flag.
- Security model (`docs/security.md`): treat all LaTeX as hostile input, sanitize SVG before preview, and spawn child processes with argument arrays only, never a shell.
- Further design notes: `architecture.md`, `docs/*.md`, and `docs/roadmap.md` (the Phase 1–14 status and next hardening steps).
