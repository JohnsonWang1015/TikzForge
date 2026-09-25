# Architecture reference

The root [architecture.md](../architecture.md) describes runtime boundaries. This page records
the invariants used during implementation.

1. Graphic IR is the only mutable diagram model.
2. A node/edge id is stable and never derived from array position.
3. Parser failures preserve the last valid project.
4. Unsupported syntax is retained in `raw-tikz` elements.
5. The compiler boundary treats user source as hostile input.
6. Plugins register explicit capabilities and cannot silently replace an existing id.

The initial implementation serializes full TikZ on IR updates. AST source ranges are available for
an incremental patch service once the round-trip behavior is stable.
