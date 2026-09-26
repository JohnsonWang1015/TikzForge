# Architecture reference

The root [architecture.md](../architecture.md) describes runtime boundaries. This page records
the invariants used during implementation.

1. Graphic IR is the only mutable diagram model.
2. A node/edge id is stable and never derived from array position; text edits keep the ids of
   unnamed statements.
3. Parser failures preserve the last valid project.
4. Unsupported syntax is retained in `raw-tikz` elements and is never rewritten.
5. IR edits patch only the statements of changed elements; the whole picture is regenerated only
   when a patch is impossible (picture options changed, or a dependency would move after its use).
6. The compiler boundary treats user source as hostile input.
7. Plugins register explicit capabilities and cannot silently replace an existing id.
