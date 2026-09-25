import type { Diagnostic, Project } from '@tikzforge/graphic-ir';

export interface DiagramPluginContext {
  pixelsPerCm: number;
}

export interface DiagramPlugin {
  id: string;
  name: string;
  version: string;
  supportedCommands: string[];
  parse(
    source: string,
    context: DiagramPluginContext,
  ): { project: Project; diagnostics: Diagnostic[] };
  serialize(project: Project, context: DiagramPluginContext): string;
  render?(project: Project): string;
  inspectorFields?: string[];
  completions?: string[];
}

export class PluginRegistry {
  private readonly plugins = new Map<string, DiagramPlugin>();

  register(plugin: DiagramPlugin): void {
    if (this.plugins.has(plugin.id))
      throw new Error(`Diagram plugin "${plugin.id}" is already registered.`);
    this.plugins.set(plugin.id, plugin);
  }

  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  get(id: string): DiagramPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): DiagramPlugin[] {
    return [...this.plugins.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function createDefaultRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register({
    id: 'tikz-core',
    name: 'TikZ Core',
    version: '1.0.0',
    supportedCommands: ['node', 'coordinate', 'draw', 'path', 'fill', 'filldraw', 'clip'],
    parse: () => {
      throw new Error('Use @tikzforge/tikz-parser for the built-in TikZ parser.');
    },
    serialize: () => {
      throw new Error('Use @tikzforge/tikz-serializer for the built-in TikZ serializer.');
    },
    inspectorFields: ['position', 'size', 'fill', 'stroke', 'lineWidth', 'rounded'],
    completions: ['draw', 'fill', 'rounded corners', 'below', 'above'],
  });
  registry.register({
    id: 'pgfplots',
    name: 'PGFPlots',
    version: '1.0.0',
    supportedCommands: ['begin{axis}', 'addplot'],
    parse: () => {
      throw new Error('PGFPlots parsing is provided by the core parser.');
    },
    serialize: () => {
      throw new Error('PGFPlots serialization is provided by the core serializer.');
    },
    inspectorFields: ['plotType', 'data', 'title', 'xLabel', 'yLabel'],
    completions: ['ybar', 'only marks', 'coordinates', 'xlabel', 'ylabel'],
  });
  return registry;
}
