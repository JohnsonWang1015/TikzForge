'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { PlotElement, Point } from '@tikzforge/graphic-ir';
import { useProjectStore } from '@/stores/project-store';

export function PlotEditor({ plot }: { plot: PlotElement }) {
  const updateElement = useProjectStore((state) => state.updateElement);
  function updateData(data: Point[]): void {
    updateElement(plot.id, { data }, 'Edit plot data');
  }
  return (
    <div className="inspector-section">
      <h3>Data Editor</h3>
      <table className="plot-table">
        <thead>
          <tr>
            <th>#</th>
            <th>X</th>
            <th>Y</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plot.data.map((point, index) => (
            <tr key={`${plot.id}-${index}`}>
              <td>{index + 1}</td>
              <td>
                <input
                  type="number"
                  value={point.x}
                  onChange={(event) =>
                    updateData(
                      plot.data.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, x: Number(event.target.value) } : item,
                      ),
                    )
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  value={point.y}
                  onChange={(event) =>
                    updateData(
                      plot.data.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, y: Number(event.target.value) } : item,
                      ),
                    )
                  }
                />
              </td>
              <td>
                <button
                  className="button button-icon button-ghost button-danger"
                  onClick={() =>
                    updateData(plot.data.filter((_, itemIndex) => itemIndex !== index))
                  }
                  title="Remove point"
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="button button-ghost"
        onClick={() => updateData([...plot.data, { x: plot.data.length + 1, y: 0 }])}
      >
        <Plus size={12} /> Add point
      </button>
    </div>
  );
}
