# Compiler service

The web route `/api/render` validates size and dangerous commands, then either delegates to the
Rust compiler service at `COMPILER_SERVICE_URL` or renders a deterministic fast SVG preview from
IR. Every response carries `renderer: "tectonic" | "fast"` so the UI can say which one it shows.

The Rust Axum service exposes:

- `GET /health` → `{ "status": "ok", "tectonic": true | false }`
- `POST /api/render` with `{ "source": "...", "images": [{ "name": "fig.png", "data": "<base64>" }] }`

`images` is optional. Each entry is a file the source includes with `\includegraphics{name}`;
`data` is padded standard base64 of the PNG or JPEG bytes. The service validates the list (see
[security.md](security.md)) and writes each file at its relative `name` inside the scratch
directory before compiling. New image nodes point at mwe's `example-image`, which the offline cache
includes.

## Compilation

When `TECTONIC_BIN` points at a Tectonic binary, the service:

1. wraps a bare picture in the standard preamble (`PICTURE_PREAMBLE` in
   `crates/tikz-serializer`): `standalone`, `tikz`, `pgfplots` (`compat=1.18`), `amsmath`,
   `amssymb`, and the TikZ libraries `arrows.meta`, `calc`, `positioning`, `shapes.geometric`,
   `fit` and `backgrounds`. Sources that already contain `\documentclass` are compiled as-is;
2. runs `tectonic --untrusted --only-cached` directly (no shell) in a per-request scratch
   directory, with a cleared environment and a 10 s timeout. `TECTONIC_CACHE_DIR` is passed through
   explicitly because of the cleared environment;
3. converts the PDF with `pdftocairo -svg` (5 s timeout);
4. maps TeX error lines back onto the submitted source by subtracting the preamble length.

A missing image file is an ordinary LaTeX error (422) that points at the `\includegraphics` line.

## Responses

| Status | Meaning                                            | Web app behaviour          |
| ------ | -------------------------------------------------- | -------------------------- |
| 200    | Compiled; `svg` is real LaTeX output               | shown as LaTeX (Tectonic)  |
| 422    | LaTeX error or timeout; `errors` have source lines | errors shown to the user   |
| 400    | Rejected by the security policy                    | errors shown to the user   |
| 503    | Tectonic not configured or could not start         | falls back to fast preview |
| 500    | Scratch directory or PDF → SVG conversion failed   | falls back to fast preview |

The web route also falls back to the fast preview when the service is unreachable, exceeds its
20 s proxy timeout, or returns a body that does not match the contract. It rebuilds the forwarded
response field by field and sanitizes the SVG instead of passing the service's JSON through.

## Docker image

`docker/compiler/Dockerfile` downloads a pinned Tectonic release (checksum-verified) and
pre-warms an offline package cache at `/opt/tectonic-cache` by compiling
`docker/compiler/warmup.tex`, then re-compiles it with `--only-cached` to prove the cache is
complete. The runtime image sets `TECTONIC_BIN` and `TECTONIC_CACHE_DIR`, so
`docker compose up --build` needs no configuration.

Because the runtime never downloads anything, a package or font that the warm-up document does not
use fails to compile. When the serializer starts emitting a new package, library or font shape,
add it to both `warmup.tex` and `PICTURE_PREAMBLE`.

## Running the service locally

```bash
TECTONIC_BIN=$(command -v tectonic) cargo run -p tikzforge-compiler-server
COMPILER_SERVICE_URL=http://localhost:8080 npm run dev
```

A local Tectonic uses its default cache (`~/.cache/Tectonic`); compile the warm-up document once
without `--only-cached` to populate it, or set `TECTONIC_CACHE_DIR`.
