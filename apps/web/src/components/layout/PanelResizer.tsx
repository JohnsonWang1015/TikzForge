'use client';

import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { PANEL_LIMITS, useUiStore, type SidePanel } from '@/stores/ui-store';

/** The canvas keeps at least this much room however wide the side panels are dragged. */
const MIN_CANVAS_WIDTH = 320;

/** Drag handle on the canvas-facing edge of a side panel; double-click restores the default. */
export function PanelResizer({ panel }: { panel: SidePanel }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = useUiStore((state) => state.panelWidths[panel]);
  const setPanelWidth = useUiStore((state) => state.setPanelWidth);
  const savePanelWidths = useUiStore((state) => state.savePanelWidths);
  const direction = panel === 'sidebar' ? 1 : -1;

  function resize(next: number): void {
    const other = useUiStore.getState().panelWidths[panel === 'sidebar' ? 'inspector' : 'sidebar'];
    setPanelWidth(panel, Math.min(next, window.innerWidth - other - MIN_CANVAS_WIDTH));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-panel');
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    resize(drag.current.startWidth + (event.clientX - drag.current.startX) * direction);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    drag.current = null;
    document.body.classList.remove('is-resizing-panel');
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    savePanelWidths();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.shiftKey ? 48 : 16) * (event.key === 'ArrowRight' ? 1 : -1);
    resize(width + step * direction);
    savePanelWidths();
  }

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={panel === 'sidebar' ? 'Resize components panel' : 'Resize editor panel'}
      aria-valuemin={PANEL_LIMITS[panel].min}
      aria-valuemax={PANEL_LIMITS[panel].max}
      aria-valuenow={width}
      tabIndex={0}
      data-testid={`resize-${panel}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        setPanelWidth(panel, PANEL_LIMITS[panel].initial);
        savePanelWidths();
      }}
    />
  );
}
