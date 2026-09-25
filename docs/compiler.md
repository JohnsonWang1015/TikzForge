# Compiler service

The browser route `/api/render` validates size and dangerous commands, optionally delegates to
`COMPILER_SERVICE_URL`, and otherwise provides a deterministic fast SVG preview from IR.

The Rust Axum service exposes:

- `GET /health`
- `POST /api/render` with `{ "source": "..." }`

When `TECTONIC_BIN` is configured, the service wraps a TikZ picture in a standalone document,
invokes the trusted binary directly (no shell), uses `--untrusted --only-cached`, applies a timeout,
and converts the resulting PDF with `pdftocairo`. Without a configured binary it returns a clearly
labelled fallback response so local development remains offline-friendly.

The container profile disables networking, drops Linux capabilities, uses a read-only root and a
bounded `/tmp`. The service never accepts a user-provided filesystem path.
