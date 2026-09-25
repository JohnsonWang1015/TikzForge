import {
  createArrow,
  createEmptyProject,
  createNode,
  layoutProject,
  validateProject,
  type Project,
} from '@tikzforge/graphic-ir';

export interface GenerateResult {
  project: Project;
  explanation: string;
}

/** Deterministic local provider; the same interface can be backed by an LLM later. */
export function generateDiagramFromPrompt(prompt: string): GenerateResult {
  const words = prompt
    .split(/\n|→|->|,/u)
    .map((word) => word.trim())
    .filter(Boolean);
  const labels =
    words.length >= 2 ? words.slice(0, 12) : ['Input', 'Feature Extractor', 'Prediction'];
  const project = createEmptyProject('AI generated diagram');
  const nodes = labels.map((label, index) =>
    createNode('rectangle', {
      id:
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/giu, '_')
          .replace(/^_|_$/gu, '') || `node_${index + 1}`,
      x: 150 + index * 220,
      y: 250,
      text: label,
      style: { fill: index % 2 === 0 ? '#163250' : '#382650' },
    }),
  );
  project.elements = [...nodes];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    if (from && to)
      project.elements.push(createArrow(from.id, to.id, { id: `edge_ai_${index + 1}` }));
  }
  const laidOut = layoutProject(project, 'horizontal');
  const validation = validateProject(laidOut);
  if (!validation.valid) throw new Error(validation.errors.map((error) => error.message).join(' '));
  return {
    project: laidOut,
    explanation: `Generated ${nodes.length} editable IR nodes from the prompt. You can continue editing them visually or in TikZ.`,
  };
}
