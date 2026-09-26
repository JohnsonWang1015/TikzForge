'use client';

import { Settings2 } from 'lucide-react';
import {
  isEdgeElement,
  isNodeElement,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
} from '@tikzforge/graphic-ir';
import { useProjectStore } from '@/stores/project-store';
import { PlotEditor } from '@/components/plots/PlotEditor';

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const color = /^#[0-9a-f]{6}$/iu.test(value) ? value : '#101827';
  return (
    <div className="field">
      <label>{label}</label>
      <div className="color-field">
        <input type="color" value={color} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}

function NodeInspector({ node }: { node: NodeElement }) {
  const updateElement = useProjectStore((state) => state.updateElement);
  const update = (patch: Partial<NodeElement>, label = 'Edit node') =>
    updateElement(node.id, patch, label);
  const updateStyle = (patch: Partial<NodeElement['style']>, label = 'Edit style') =>
    update({ style: { ...node.style, ...patch } }, label);
  return (
    <>
      <section className="inspector-section">
        <h3>Position</h3>
        <div className="field-grid">
          <NumberField
            label="X"
            value={node.x}
            onChange={(value) => update({ x: value }, 'Move node')}
          />
          <NumberField
            label="Y"
            value={node.y}
            onChange={(value) => update({ y: value }, 'Move node')}
          />
        </div>
      </section>
      <section className="inspector-section">
        <h3>Size</h3>
        <div className="field-grid">
          <NumberField
            label="Width"
            value={node.width}
            onChange={(value) => update({ width: Math.max(20, value) }, 'Resize node')}
          />
          <NumberField
            label="Height"
            value={node.height}
            onChange={(value) => update({ height: Math.max(20, value) }, 'Resize node')}
          />
        </div>
      </section>
      <section className="inspector-section">
        <h3>Appearance</h3>
        <div className="field-grid">
          <ColorField
            label="Fill"
            value={node.style.fill}
            onChange={(value) => updateStyle({ fill: value })}
          />
          <ColorField
            label="Stroke"
            value={node.style.stroke}
            onChange={(value) => updateStyle({ stroke: value })}
          />
          <NumberField
            label="Line width"
            value={node.style.lineWidth}
            onChange={(value) => updateStyle({ lineWidth: value })}
          />
          <NumberField
            label="Font size"
            value={node.style.fontSize}
            onChange={(value) => updateStyle({ fontSize: value })}
          />
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={node.style.rounded}
            onChange={(event) => updateStyle({ rounded: event.target.checked })}
          />{' '}
          Rounded corners
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={node.style.dashed ?? false}
            onChange={(event) => updateStyle({ dashed: event.target.checked })}
          />{' '}
          Dashed stroke
        </label>
      </section>
      <section className="inspector-section">
        <h3>Text</h3>
        <div className="field-grid">
          <div className="field full-field">
            <label>Content</label>
            <textarea
              value={node.text}
              onChange={(event) => update({ text: event.target.value }, 'Edit text')}
            />
          </div>
          <div className="field">
            <label>Alignment</label>
            <select
              value={node.style.align}
              onChange={(event) =>
                updateStyle({ align: event.target.value as NodeElement['style']['align'] })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div className="field">
            <label>Weight</label>
            <select
              value={node.style.fontWeight}
              onChange={(event) =>
                updateStyle({
                  fontWeight: event.target.value as NodeElement['style']['fontWeight'],
                })
              }
            >
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
            </select>
          </div>
        </div>
      </section>
      <section className="inspector-section">
        <h3>TikZ</h3>
        <div className="field-grid">
          <div className="field full-field">
            <label>Node ID</label>
            <input value={node.id} readOnly />
          </div>
          <NumberField
            label="Rotation"
            value={node.rotation}
            onChange={(value) => update({ rotation: value }, 'Rotate node')}
          />
        </div>
      </section>
    </>
  );
}

function EdgeInspector({ edge }: { edge: EdgeElement }) {
  const updateElement = useProjectStore((state) => state.updateElement);
  return (
    <>
      <section className="inspector-section">
        <h3>Connection</h3>
        <div className="field-grid">
          <div className="field">
            <label>From</label>
            <input
              value={edge.from}
              onChange={(event) =>
                updateElement(edge.id, { from: event.target.value }, 'Change edge source')
              }
            />
          </div>
          <div className="field">
            <label>To</label>
            <input
              value={edge.to}
              onChange={(event) =>
                updateElement(edge.id, { to: event.target.value }, 'Change edge target')
              }
            />
          </div>
        </div>
      </section>
      <section className="inspector-section">
        <h3>Path</h3>
        <div className="field">
          <label>Label</label>
          <input
            value={edge.label ?? ''}
            placeholder="none"
            onChange={(event) =>
              updateElement(edge.id, { label: event.target.value || undefined }, 'Edit edge label')
            }
          />
        </div>
        <div className="field-grid">
          <div className="field">
            <label>Route</label>
            <select
              value={edge.route ?? ''}
              onChange={(event) =>
                updateElement(
                  edge.id,
                  {
                    route: (event.target.value || undefined) as EdgeElement['route'],
                    bend: undefined,
                  },
                  'Change edge route',
                )
              }
            >
              <option value="">Straight</option>
              <option value="-|">Horizontal, then vertical (-|)</option>
              <option value="|-">Vertical, then horizontal (|-)</option>
            </select>
          </div>
          <NumberField
            label="Bend (°, + left)"
            value={edge.bend ?? 0}
            onChange={(value) =>
              updateElement(
                edge.id,
                { bend: value || undefined, route: undefined },
                'Change edge bend',
              )
            }
          />
        </div>
      </section>
      <section className="inspector-section">
        <h3>Style</h3>
        <div className="field-grid">
          <ColorField
            label="Stroke"
            value={edge.style.stroke}
            onChange={(value) =>
              updateElement(
                edge.id,
                { style: { ...edge.style, stroke: value } },
                'Edit edge stroke',
              )
            }
          />
          <NumberField
            label="Line width"
            value={edge.style.lineWidth}
            onChange={(value) =>
              updateElement(
                edge.id,
                { style: { ...edge.style, lineWidth: value } },
                'Edit edge width',
              )
            }
          />
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={edge.style.dashed}
            onChange={(event) =>
              updateElement(
                edge.id,
                { style: { ...edge.style, dashed: event.target.checked } },
                'Toggle dashed edge',
              )
            }
          />{' '}
          Dashed
        </label>
      </section>
    </>
  );
}

function PlotInspector({ plot }: { plot: PlotElement }) {
  const updateElement = useProjectStore((state) => state.updateElement);
  return (
    <>
      <section className="inspector-section">
        <h3>Plot</h3>
        <div className="field-grid">
          <div className="field">
            <label>Type</label>
            <select
              value={plot.plotType}
              onChange={(event) =>
                updateElement(
                  plot.id,
                  { plotType: event.target.value as PlotElement['plotType'] },
                  'Change plot type',
                )
              }
            >
              <option value="line">Line</option>
              <option value="scatter">Scatter</option>
              <option value="bar">Bar</option>
              <option value="function">Function</option>
            </select>
          </div>
          <div className="field">
            <label>Title</label>
            <input
              value={plot.title ?? ''}
              onChange={(event) =>
                updateElement(plot.id, { title: event.target.value }, 'Edit plot title')
              }
            />
          </div>
          <div className="field">
            <label>X label</label>
            <input
              value={plot.xLabel ?? ''}
              onChange={(event) =>
                updateElement(plot.id, { xLabel: event.target.value }, 'Edit x label')
              }
            />
          </div>
          <div className="field">
            <label>Y label</label>
            <input
              value={plot.yLabel ?? ''}
              onChange={(event) =>
                updateElement(plot.id, { yLabel: event.target.value }, 'Edit y label')
              }
            />
          </div>
        </div>
      </section>
      <PlotEditor plot={plot} />
    </>
  );
}

export function PropertyInspector() {
  const project = useProjectStore((state) => state.project);
  const selectedIds = useProjectStore((state) => state.selectedIds);
  const selected =
    selectedIds.length === 1
      ? project.elements.find((element) => element.id === selectedIds[0])
      : undefined;
  const selectedNode = selected && isNodeElement(selected) ? selected : undefined;
  const selectedEdge = selected && isEdgeElement(selected) ? selected : undefined;
  const selectedPlot = selected?.type === 'plot' ? selected : undefined;
  const setProject = useProjectStore((state) => state.setProject);
  const settings = project.settings;
  return (
    <section className="inspector-content">
      <div className="panel-heading">
        <span>
          <Settings2 size={13} /> Properties
        </span>
        <span>{selectedIds.length ? `${selectedIds.length} selected` : 'PROJECT'}</span>
      </div>
      {selectedIds.length === 0 && (
        <div className="empty-inspector">
          <strong>Select an element</strong>
          <br />
          Drag on the canvas or edit TikZ source.
          <br />
          <br />
          All changes flow through Graphic IR.
        </div>
      )}
      {selectedIds.length > 1 && (
        <div className="empty-inspector">
          <strong>{selectedIds.length} elements selected</strong>
          <br />
          Use arrow keys to move, Ctrl/Cmd+D to duplicate, or group from the toolbar.
        </div>
      )}
      {selected?.type === 'raw-tikz' && (
        <div className="raw-block">
          Unsupported TikZ is preserved as a RawTikZBlock and remains compile/export safe. Visual
          editing is disabled for this block.
        </div>
      )}
      {selectedPlot ? (
        <PlotInspector plot={selectedPlot} />
      ) : selectedEdge ? (
        <EdgeInspector edge={selectedEdge} />
      ) : selectedNode ? (
        <NodeInspector node={selectedNode} />
      ) : null}
      <section className="inspector-section">
        <h3>Canvas</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.grid}
            onChange={(event) =>
              setProject(
                { ...project, settings: { ...settings, grid: event.target.checked } },
                'Toggle grid',
              )
            }
          />{' '}
          Show grid
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.snap}
            onChange={(event) =>
              setProject(
                { ...project, settings: { ...settings, snap: event.target.checked } },
                'Toggle snap',
              )
            }
          />{' '}
          Snap to grid ({settings.gridSize}px)
        </label>
      </section>
    </section>
  );
}
