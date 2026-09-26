# Security model

TikzForge treats LaTeX as hostile input.

- Browser render limits source to 512 KB and rejects shell escape, file input/output and include
  primitives before compilation. The one exception is `\includegraphics`, and only with a literal,
  plain relative file name: one to four `/`-separated segments of letters, digits, `_`, `.` and
  `-` that do not start with `.`. Absolute paths, `..`, macros as the file name and
  `\includegraphics*` are rejected.
- The Rust service repeats validation rather than trusting the web process.
- Uploaded images travel with the render request as base64 and are checked again by the service:
  at most 16 files, 2 MiB each and 8 MiB in total, unique plain relative names ending in `.png`,
  `.jpg` or `.jpeg`, and bytes that start with the matching PNG or JPEG signature. They are written
  only inside the per-request scratch directory, next to `main.tex`. The request body is capped at
  16 MiB.
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
