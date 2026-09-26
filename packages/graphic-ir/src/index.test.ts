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

  it('only accepts embedded PNG/JPEG data and plain relative names for images', () => {
    const project = createEmptyProject();
    const valid = createNode('image', { id: 'ok' });
    valid.href = 'data:image/jpeg;base64,/9j/4AAQ';
    valid.source = 'figs/photo.jpg';
    const remote = createNode('image', { id: 'remote' });
    remote.href = 'https://example.com/a.png';
    const escaping = createNode('image', { id: 'escaping' });
    escaping.source = '/etc/passwd';
    project.elements = [valid, remote, escaping];
    const result = validateProject(project);
    expect(result.errors.map((error) => error.code)).toEqual(['IR_IMAGE_HREF', 'IR_IMAGE_PATH']);
  });

  it('normalizes imported project JSON without changing the domain format', () => {
    const project = projectFromJson({ elements: [] });
    expect(project.format).toBe('latex-diagram-project');
    expect(project.version).toBe('1.0');
  });
});
