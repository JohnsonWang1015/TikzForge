# Security model

TikzForge treats LaTeX as hostile input.

- Browser render limits source to 512 KB and rejects shell escape, file input/output and include
  primitives before compilation.
- The Rust service repeats validation rather than trusting the web process.
- Child processes are spawned with argument arrays, not a shell. Environment and working directory
  are explicitly constrained.
- Tectonic is intended to run with cached packages and `--untrusted`; the compose profile removes
  network access and host filesystem access.
- Fast SVG is generated from typed IR and sanitized before preview insertion. Preview iframes use a
  sandbox.
- AI output is validated as Graphic IR before entering the store. Invalid clipboard payloads are
  ignored.
- Raw TikZ is displayed as a non-editable block and is never interpreted by the visual canvas.

For deployment, run the compiler as a separate unprivileged container and provide only a curated
Tectonic package cache.
