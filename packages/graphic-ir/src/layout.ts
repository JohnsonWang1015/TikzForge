import type { DiagramElement, Project } from './index';

export type LayoutDirection = 'horizontal' | 'vertical' | 'grid' | 'tree' | 'dag';

/** Deterministic layout for templates and AI-generated diagrams. */
export function layoutProject(project: Project, direction: LayoutDirection): Project {
  const nodes = project.elements.filter(
    (element) =>
      'x' in element && 'width' in element && element.type !== 'plot' && element.type !== 'group',
  );
  const edges = project.elements.filter((element) => 'from' in element && 'to' in element);
  const incoming = new Map<string, number>();
  nodes.forEach((node) => incoming.set(node.id, 0));
  edges.forEach((edge) => {
    if (incoming.has(edge.to)) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  });
  const ordered =
    direction === 'dag' || direction === 'tree'
      ? [...nodes].sort(
          (a, b) =>
            (incoming.get(a.id) ?? 0) - (incoming.get(b.id) ?? 0) || a.id.localeCompare(b.id),
        )
      : [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const columns = direction === 'vertical' || direction === 'tree' || direction === 'dag' ? 1 : 3;
  const elements = project.elements.map((element) => {
    const index = ordered.findIndex((candidate) => candidate.id === element.id);
    if (
      index < 0 ||
      !('x' in element) ||
      !('y' in element) ||
      !('width' in element) ||
      element.type === 'plot' ||
      element.type === 'group'
    )
      return element;
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...element,
      x:
        180 +
        (direction === 'vertical' || direction === 'tree' || direction === 'dag'
          ? 0
          : column * 300),
      y: 140 + (direction === 'horizontal' ? 0 : row * 140),
    } as DiagramElement;
  });
  return { ...project, elements };
}
