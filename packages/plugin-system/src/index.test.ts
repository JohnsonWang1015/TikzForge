import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, PluginRegistry } from './index';

describe('plugin registry', () => {
  it('registers deterministic built-in plugin metadata', () => {
    const registry = createDefaultRegistry();
    expect(registry.list().map((plugin) => plugin.id)).toEqual(['pgfplots', 'tikz-core']);
  });

  it('prevents duplicate plugin ids', () => {
    const registry = new PluginRegistry();
    const plugin = {
      id: 'test',
      name: 'Test',
      version: '1',
      supportedCommands: [],
      parse: () => {
        throw new Error('unused');
      },
      serialize: () => {
        throw new Error('unused');
      },
    };
    registry.register(plugin);
    expect(() => registry.register(plugin)).toThrow('already registered');
  });
});
