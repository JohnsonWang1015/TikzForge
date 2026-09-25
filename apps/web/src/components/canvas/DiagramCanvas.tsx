'use client';

import { useRef } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { Grid2X2, Minus, Plus, Maximize2 } from 'lucide-react';
import {
  isNodeElement,
  snapValue,
  type DiagramElement,
  type EdgeElement,
  type NodeElement,
  type Point,
  type Project,
} from '@tikzforge/graphic-ir';
import { useProjectStore } from '@/stores/project-store';
import { useUiStore } from '@/stores/ui-store';

interface DragState {
  kind: 'move' | 'resize' | 'pan';
  start: Point;
  screenStart: Point;
  before: Project;
  ids: string[];
  initial: Record<string, { x: number; y: number; width?: number; height?: number }>;
  panStart: { x: number; y: number };
}

function elementPoint(element: DiagramElement): Point | undefined {
  if ('x' in element && 'y' in element) return { x: element.x, y: element.y };
  return undefined;
}

function nodeShape(node: NodeElement): ReactNode {
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const fill = node.style.fill === 'none' ? 'transparent' : node.style.fill;
  const common = {
    fill,
    stroke: node.style.stroke,
    strokeWidth: node.style.lineWidth,
    strokeDasharray: node.style.dashed ? '6 4' : undefined,
  };
  if (node.type === 'circle')
    return <circle cx={node.x} cy={node.y} r={Math.min(node.width, node.height) / 2} {...common} />;
  if (node.type === 'ellipse')
    return <ellipse cx={node.x} cy={node.y} rx={node.width / 2} ry={node.height / 2} {...common} />;
  if (node.type === 'image')
    return <rect x={x} y={y} width={node.width} height={node.height} rx={8} {...common} />;
  return (
    <rect
      x={x}
      y={y}
      width={node.width}
      height={node.height}
      rx={node.style.rounded ? 10 : 0}
      {...common}
    />
  );
}

function renderNode(
  node: NodeElement,
  selected: boolean,
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void,
) {
  const anchor =
    node.style.align === 'left' ? 'start' : node.style.align === 'right' ? 'end' : 'middle';
  const textX =
    node.style.align === 'left'
      ? node.x - node.width / 2 + 12
      : node.style.align === 'right'
        ? node.x + node.width / 2 - 12
        : node.x;
  return (
    <g
      key={node.id}
      data-testid={`canvas-element-${node.id}`}
      transform={`rotate(${node.rotation} ${node.x} ${node.y})`}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
      {nodeShape(node)}
      {node.type === 'image' && (
        <text x={node.x} y={node.y + 4} textAnchor="middle" fill="#8fa1be" fontSize={11}>
          Image placeholder
        </text>
      )}
      {node.text && node.type !== 'image' && (
        <text
          x={textX}
          y={node.y + node.style.fontSize * 0.35}
          textAnchor={anchor}
          fill={node.style.textColor}
          fontSize={node.style.fontSize}
          fontWeight={node.style.fontWeight}
        >
          {node.text}
        </text>
      )}
      {selected && (
        <rect
          className="selection-box"
          x={node.x - node.width / 2 - 5}
          y={node.y - node.height / 2 - 5}
          width={node.width + 10}
          height={node.height + 10}
          rx={node.style.rounded ? 12 : 2}
        />
      )}
    </g>
  );
}

function renderEdge(
  edge: EdgeElement,
  project: Project,
  selected: boolean,
  onPointerDown: (event: ReactPointerEvent<SVGPathElement>, id: string) => void,
) {
  const from = project.elements.find((element) => element.id === edge.from);
  const to = project.elements.find((element) => element.id === edge.to);
  const fromPoint = from ? elementPoint(from) : undefined;
  const toPoint = to ? elementPoint(to) : undefined;
  if (!fromPoint || !toPoint) return null;
  let d = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
  if (edge.type === 'curved-arrow' && edge.controlPoints?.length) {
    const first = edge.controlPoints[0] ?? fromPoint;
    const second = edge.controlPoints[1] ?? first;
    d = `M ${fromPoint.x} ${fromPoint.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${toPoint.x} ${toPoint.y}`;
  }
  const arrow =
    edge.type === 'line' || edge.style.arrow === 'none'
      ? undefined
      : edge.type === 'bidirectional-arrow'
        ? 'url(#canvas-arrow)'
        : 'url(#canvas-arrow)';
  return (
    <path
      key={edge.id}
      data-testid={`canvas-element-${edge.id}`}
      d={d}
      fill="none"
      stroke={selected ? '#67d8bc' : edge.style.stroke}
      strokeWidth={selected ? edge.style.lineWidth + 2 : edge.style.lineWidth}
      strokeDasharray={edge.style.dashed || edge.type === 'dashed-arrow' ? '7 5' : undefined}
      markerEnd={arrow}
      markerStart={edge.type === 'bidirectional-arrow' ? arrow : undefined}
      onPointerDown={(event) => onPointerDown(event, edge.id)}
    />
  );
}

export function DiagramCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const project = useProjectStore((state) => state.project);
  const selectedIds = useProjectStore((state) => state.selectedIds);
  const select = useProjectStore((state) => state.select);
  const clearSelection = useProjectStore((state) => state.clearSelection);
  const updateElementTransient = useProjectStore((state) => state.updateElementTransient);
  const commitInteraction = useProjectStore((state) => state.commitInteraction);
  const zoom = useUiStore((state) => state.zoom);
  const pan = useUiStore((state) => state.pan);
  const isPanning = useUiStore((state) => state.isPanning);
  const setZoom = useUiStore((state) => state.setZoom);
  const setPan = useUiStore((state) => state.setPan);
  const setIsPanning = useUiStore((state) => state.setIsPanning);
  const resetView = useUiStore((state) => state.resetView);

  function canvasPoint(event: { clientX: number; clientY: number }): Point {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom,
    };
  }

  function startElementDrag(
    event: ReactPointerEvent<SVGGElement> | ReactPointerEvent<SVGPathElement>,
    id: string,
  ): void {
    event.stopPropagation();
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    select(id, additive);
    const ids = additive ? [...new Set([...selectedIds, id])] : [id];
    const initial: DragState['initial'] = {};
    ids.forEach((selectedId) => {
      const element = project.elements.find((candidate) => candidate.id === selectedId);
      if (element && 'x' in element && 'y' in element)
        initial[selectedId] = {
          x: element.x,
          y: element.y,
          width: 'width' in element ? element.width : undefined,
          height: 'height' in element ? element.height : undefined,
        };
    });
    dragRef.current = {
      kind: 'move',
      start: canvasPoint(event),
      screenStart: { x: event.clientX, y: event.clientY },
      before: project,
      ids,
      initial,
      panStart: pan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startResize(event: ReactPointerEvent<SVGRectElement>, id: string): void {
    event.stopPropagation();
    const element = project.elements.find((candidate) => candidate.id === id);
    if (
      !element ||
      !('x' in element) ||
      !('y' in element) ||
      !('width' in element) ||
      !('height' in element)
    )
      return;
    dragRef.current = {
      kind: 'resize',
      start: canvasPoint(event),
      screenStart: { x: event.clientX, y: event.clientY },
      before: project,
      ids: [id],
      initial: {
        [id]: { x: element.x, y: element.y, width: element.width, height: element.height },
      },
      panStart: pan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>): void {
    const target = event.target;
    const clickedElement =
      target instanceof Element && target.closest('[data-testid^="canvas-element-"]');
    if (clickedElement && event.button !== 1) return;
    if (event.button !== 0 && event.button !== 1) return;
    if (!event.shiftKey) clearSelection();
    setIsPanning(true);
    dragRef.current = {
      kind: 'pan',
      start: canvasPoint(event),
      screenStart: { x: event.clientX, y: event.clientY },
      before: project,
      ids: [],
      initial: {},
      panStart: pan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<SVGSVGElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pan') {
      setPan({
        x: drag.panStart.x + (event.clientX - drag.screenStart.x),
        y: drag.panStart.y + (event.clientY - drag.screenStart.y),
      });
      return;
    }
    const point = canvasPoint(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (drag.kind === 'resize') {
      const id = drag.ids[0];
      const initial = id ? drag.initial[id] : undefined;
      if (id && initial?.width !== undefined && initial.height !== undefined)
        updateElementTransient(id, {
          width: Math.max(
            24,
            snapValue(initial.width + dx, project.settings.gridSize, project.settings.snap),
          ),
          height: Math.max(
            20,
            snapValue(initial.height + dy, project.settings.gridSize, project.settings.snap),
          ),
        });
      return;
    }
    for (const id of drag.ids) {
      const initial = drag.initial[id];
      if (!initial) continue;
      updateElementTransient(id, {
        x: snapValue(initial.x + dx, project.settings.gridSize, project.settings.snap),
        y: snapValue(initial.y + dy, project.settings.gridSize, project.settings.snap),
      });
    }
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind !== 'pan')
      commitInteraction(drag.before, drag.kind === 'resize' ? 'Resize element' : 'Move selection');
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onWheel(event: ReactWheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    setZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  }

  const selectedElement =
    selectedIds.length === 1
      ? project.elements.find((element) => element.id === selectedIds[0])
      : undefined;
  return (
    <section className="canvas-panel">
      <div className="canvas-toolbar">
        <div className="canvas-toolbar-left">
          <span>Canvas</span>
          <span className="brand-subtitle">
            {project.canvas.width} × {project.canvas.height}
          </span>
        </div>
        <div className="canvas-toolbar-right">
          <button
            className="button button-icon button-ghost"
            onClick={() => setZoom(zoom * 0.9)}
            title="Zoom out"
          >
            <Minus size={13} />
          </button>
          <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
          <button
            className="button button-icon button-ghost"
            onClick={() => setZoom(zoom * 1.1)}
            title="Zoom in"
          >
            <Plus size={13} />
          </button>
          <button
            className="button button-icon button-ghost"
            onClick={() => resetView()}
            title="Reset view"
          >
            <Maximize2 size={13} />
          </button>
          <Grid2X2 size={14} color="var(--subtle)" />
        </div>
      </div>
      <div className="canvas-stage">
        <svg
          ref={svgRef}
          className={`canvas-svg${isPanning ? ' is-panning' : ''}`}
          viewBox={`0 0 ${project.canvas.width} ${project.canvas.height}`}
          role="application"
          aria-label="Visual diagram canvas"
          data-testid="diagram-canvas"
          onPointerDown={startPan}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
        >
          <defs>
            <pattern
              id="canvas-grid"
              width={project.settings.gridSize}
              height={project.settings.gridSize}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${project.settings.gridSize} 0 L 0 0 0 ${project.settings.gridSize}`}
                fill="none"
                stroke="#ffffff0b"
                strokeWidth="1"
              />
            </pattern>
            <marker
              id="canvas-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#91a4c6" />
            </marker>
          </defs>
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {project.settings.grid && (
              <rect
                width={project.canvas.width}
                height={project.canvas.height}
                fill="url(#canvas-grid)"
                pointerEvents="none"
              />
            )}
            <rect
              width={project.canvas.width}
              height={project.canvas.height}
              fill="transparent"
              pointerEvents="none"
            />
            {project.elements
              .filter(
                (element): element is EdgeElement =>
                  element.type === 'line' ||
                  element.type === 'arrow' ||
                  element.type === 'bidirectional-arrow' ||
                  element.type === 'dashed-arrow' ||
                  element.type === 'curved-arrow',
              )
              .map((edge) =>
                renderEdge(edge, project, selectedIds.includes(edge.id), startElementDrag),
              )}
            {project.elements
              .filter(isNodeElement)
              .map((node) => renderNode(node, selectedIds.includes(node.id), startElementDrag))}
            {project.elements
              .filter((element) => element.type === 'raw-tikz')
              .map((raw) => (
                <g
                  key={raw.id}
                  data-testid={`canvas-element-${raw.id}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    select(raw.id);
                  }}
                >
                  <rect
                    x={32}
                    y={32}
                    width={230}
                    height={44}
                    rx={8}
                    fill="#251e33"
                    stroke="#a67bd6"
                    strokeDasharray="5 4"
                  />
                  <text x={44} y={59} fill="#d4bbfa" fontSize={12}>
                    Raw TikZ · unsupported
                  </text>
                </g>
              ))}
            {selectedElement &&
              'x' in selectedElement &&
              'width' in selectedElement &&
              'height' in selectedElement && (
                <rect
                  className="selection-handle"
                  x={selectedElement.x + selectedElement.width / 2 - 5}
                  y={selectedElement.y + selectedElement.height / 2 - 5}
                  width={10}
                  height={10}
                  onPointerDown={(event) => startResize(event, selectedElement.id)}
                />
              )}
          </g>
        </svg>
        <div className="canvas-hint">
          Drag to move · Shift-click multi-select · Wheel to zoom · Ctrl/Cmd+D duplicate
        </div>
      </div>
    </section>
  );
}
