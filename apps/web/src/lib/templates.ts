import {
  createEmptyProject,
  createNode,
  createPlot,
  createArrow,
  type Project,
} from '@tikzforge/graphic-ir';
import { layoutProject } from '@tikzforge/graphic-ir';

export interface DiagramTemplate {
  id: string;
  name: string;
  description: string;
  create: () => Project;
}

function chainProject(title: string, labels: string[], fills: string[]): Project {
  const project = createEmptyProject(title);
  const nodes = labels.map((text, index) =>
    createNode('rectangle', {
      id: text.toLowerCase().replace(/[^a-z0-9]+/gu, '_'),
      x: 170 + index * 230,
      y: 250,
      text,
      style: { fill: fills[index] ?? '#163250' },
    }),
  );
  project.elements = [...nodes];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    if (from && to) project.elements.push(createArrow(from.id, to.id, { id: `edge_${index + 1}` }));
  }
  return project;
}

export const templates: DiagramTemplate[] = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    description: 'A clean input → process → output flow.',
    create: () =>
      chainProject('Flowchart', ['Input', 'Process', 'Output'], ['#163250', '#382650', '#18443b']),
  },
  {
    id: 'neural-network',
    name: 'Neural Network',
    description: 'A research-ready CNN / attention / classifier pipeline.',
    create: () =>
      chainProject(
        'Neural Network',
        ['Input', 'CNN', 'Attention', 'Classifier'],
        ['#163250', '#273f70', '#382650', '#18443b'],
      ),
  },
  {
    id: 'research-pipeline',
    name: 'Research Pipeline',
    description: 'Dataset, preprocessing, model and evaluation stages.',
    create: () =>
      chainProject(
        'Research Pipeline',
        ['Dataset', 'Preprocess', 'Train', 'Evaluate'],
        ['#213553', '#30385f', '#4a3158', '#254d4b'],
      ),
  },
  {
    id: 'system-architecture',
    name: 'System Architecture',
    description: 'Client, API, worker and database topology.',
    create: () => {
      const project = createEmptyProject('System Architecture');
      const client = createNode('rectangle', { id: 'client', x: 190, y: 220, text: 'Client' });
      const api = createNode('rectangle', {
        id: 'api',
        x: 450,
        y: 220,
        text: 'API',
        style: { fill: '#382650' },
      });
      const worker = createNode('rectangle', {
        id: 'worker',
        x: 710,
        y: 140,
        text: 'Worker',
        style: { fill: '#293d68' },
      });
      const db = createNode('ellipse', {
        id: 'database',
        x: 710,
        y: 310,
        text: 'Database',
        style: { fill: '#18443b' },
      });
      project.elements = [
        client,
        api,
        worker,
        db,
        createArrow(client.id, api.id, { id: 'edge_client_api' }),
        createArrow(api.id, worker.id, { id: 'edge_api_worker' }),
        createArrow(api.id, db.id, { id: 'edge_api_db' }),
      ];
      return project;
    },
  },
  {
    id: 'plot',
    name: 'PGFPlots Chart',
    description: 'A line chart with editable data points.',
    create: () => {
      const project = createEmptyProject('PGFPlots Chart');
      project.elements = [
        createPlot({
          id: 'plot_01',
          x: 550,
          y: 330,
          title: 'Experiment results',
          xLabel: 'epoch',
          yLabel: 'accuracy',
        }),
      ];
      return project;
    },
  },
];

export function getTemplate(id: string): DiagramTemplate | undefined {
  return templates.find((template) => template.id === id);
}

export function createTemplateProject(id: string): Project {
  const template = getTemplate(id);
  if (!template) throw new Error(`Unknown template: ${id}`);
  const project = template.create();
  return id === 'flowchart' || id === 'neural-network' || id === 'research-pipeline'
    ? layoutProject(project, 'horizontal')
    : project;
}
