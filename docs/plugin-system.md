# Plugin system

`@tikzforge/plugin-system` defines:

```ts
interface DiagramPlugin {
  id: string;
  name: string;
  version: string;
  supportedCommands: string[];
  parse(source, context): { project; diagnostics };
  serialize(project, context): string;
  render?(project): string;
  inspectorFields?: string[];
  completions?: string[];
}
```

The registry rejects duplicate ids and lists plugins deterministically. TikZ Core and PGFPlots are
registered by default. Future CircuitTikZ, tikz-cd, automata and neural-network plugins can use the
same boundary without coupling the canvas to a dialect.
