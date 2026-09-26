# Security model

TikzForge treats LaTeX as hostile input.

- Browser render limits source to 512 KB and rejects shell escape, file input/output and include
  primitives before compilation.
- The Rust service repeats validation rather than trusting the web process.
- Child processes are spawned with argument arrays, not a shell, from a cleared environment in a
  per-request scratch directory that is removed afterwards. Compile and conversion are time-bounded
  and the returned log is size-bounded.
- Tectonic runs with `--untrusted` (no shell escape) and `--only-cached`: it only reads the package
  cache baked into the image and never downloads at runtime.
- In `docker compose`, the compiler container sits on an `internal` network shared only with the
  web service, so it has no route to the outside. It runs as UID 65532 with a read-only root, all
  Linux capabilities dropped, `no-new-privileges`, a bounded `noexec` `/tmp`, and memory/CPU limits.
- The web app does not forward compiler JSON blindly: it validates the response shape, rebuilds it,
  and sanitizes the SVG. Fast SVG is generated from typed IR and also sanitized. Preview iframes
  use a sandbox.
- AI output is validated as Graphic IR before entering the store. Invalid clipboard payloads are
  ignored.
- Raw TikZ is displayed as a non-editable block and is never interpreted by the visual canvas.

For deployment, run the compiler as a separate unprivileged container that is reachable only from
the web service, and ship only the curated Tectonic package cache built into its image.
