'use client';

import {
  Circle,
  CircleDot,
  GitBranch,
  Image as ImageIcon,
  LineChart,
  MoveRight,
  Square,
  TextCursorInput,
  Type,
  Workflow,
} from 'lucide-react';
import { useProjectStore } from '@/stores/project-store';
import { useUiStore } from '@/stores/ui-store';

interface ComponentButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function ComponentButton({ label, icon, onClick }: ComponentButtonProps) {
  return (
    <button className="component-button" onClick={onClick}>
      <span className="component-icon">{icon}</span>
      {label}
    </button>
  );
}

export function ComponentSidebar() {
  const addNode = useProjectStore((state) => state.addNode);
  const addArrow = useProjectStore((state) => state.addArrow);
  const addPlot = useProjectStore((state) => state.addPlot);
  const setModal = useUiStore((state) => state.setModal);
  return (
    <aside className="sidebar">
      <div className="panel-heading">
        Components <span>PRIMITIVES</span>
      </div>
      <section className="component-section">
        <h3>Nodes</h3>
        <div className="component-grid">
          <ComponentButton
            label="Rectangle"
            icon={<Square size={14} />}
            onClick={() => addNode('rectangle')}
          />
          <ComponentButton
            label="Circle"
            icon={<Circle size={14} />}
            onClick={() => addNode('circle')}
          />
          <ComponentButton
            label="Ellipse"
            icon={<CircleDot size={14} />}
            onClick={() => addNode('ellipse')}
          />
          <ComponentButton label="Text" icon={<Type size={14} />} onClick={() => addNode('text')} />
          <ComponentButton
            label="Formula"
            icon={<TextCursorInput size={14} />}
            onClick={() => addNode('formula')}
          />
          <ComponentButton
            label="Coordinate"
            icon={<Workflow size={14} />}
            onClick={() => addNode('coordinate')}
          />
        </div>
      </section>
      <section className="component-section">
        <h3>Connections</h3>
        <div className="component-grid">
          <ComponentButton
            label="Arrow"
            icon={<MoveRight size={14} />}
            onClick={() => addArrow()}
          />
          <ComponentButton label="Line" icon={<LineChart size={14} />} onClick={() => addArrow()} />
          <ComponentButton
            label="Curved"
            icon={<GitBranch size={14} />}
            onClick={() => addArrow()}
          />
        </div>
      </section>
      <section className="component-section">
        <h3>Scientific</h3>
        <div className="component-grid">
          <ComponentButton label="Plot" icon={<LineChart size={14} />} onClick={() => addPlot()} />
          <ComponentButton
            label="Image"
            icon={<ImageIcon size={14} />}
            onClick={() => addNode('image')}
          />
        </div>
      </section>
      <section className="component-section">
        <h3>Templates</h3>
        <div className="template-list">
          <button className="template-button" onClick={() => setModal('templates')}>
            Open template gallery →
          </button>
          <button className="template-button" onClick={() => setModal('ai')}>
            Describe a diagram with AI →
          </button>
        </div>
      </section>
      <div className="sidebar-footer">
        Graphic IR v1.0
        <br />
        Source and canvas stay in sync
        <br />
        Raw TikZ is preserved
      </div>
    </aside>
  );
}
