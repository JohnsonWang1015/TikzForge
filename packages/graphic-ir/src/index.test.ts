import { describe, expect, it } from 'vitest';
import {
  createArrow,
  createEmptyProject,
  createNode,
  projectFromJson,
  validateProject,
} from './index';

describe('Graphic IR', () => {
  it('creates a valid project with stable element ids', () => {
    const project = createEmptyProject();
    const node = createNode('rectangle', { id: 'server' });
    project.elements = [node, createArrow('server', 'server', { id: 'loop' })];
    expect(validateProject(project).valid).toBe(true);
    expect(node.id).toBe('server');
  });

  it('rejects duplicate ids and dangling references', () => {
    const project = createEmptyProject();
    project.elements = [
      createNode('rectangle', { id: 'a' }),
      createNode('rectangle', { id: 'a' }),
      createArrow('a', 'missing'),
    ];
    const result = validateProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['IR_DUPLICATE_ID', 'IR_EDGE_REFERENCE']),
    );
  });

  it('normalizes imported project JSON without changing the domain format', () => {
    const project = projectFromJson({ elements: [] });
    expect(project.format).toBe('latex-diagram-project');
    expect(project.version).toBe('1.0');
  });
});
