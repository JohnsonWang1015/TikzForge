'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from 'react';
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  FileUp,
  Grid2X2,
  Group,
  ImageUp,
  Maximize2,
  Minus,
  MoveRight,
  Plus,
  SquareDashedMousePointer,
  Trash2,
  Ungroup,
} from 'lucide-react';
import {
  DEFAULT_IMAGE_PATH,
  displayColor,
  displayText,
  edgeGeometry,
  isEdgeElement,
  isImageDataUrl,
  isNodeElement,
  plotGeometry,
  snapValue,
  type DiagramElement,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
  type Point,
  type PreviewShape,
  type Project,
  type RawTikzBlock,
} from '@tikzforge/graphic-ir';
import { useProjectStore } from '@/stores/project-store';
import { useUiStore } from '@/stores/ui-store';
import { importPlotCsv, uploadImageToNode } from '@/components/actions/file-actions';
import { CanvasContextMenu, type ContextMenuSection } from './CanvasContextMenu';

interface DragState {
  kind: 'move' | 'resize' | 'pan';
  start: Point;
  screenStart: Point;
  before: Project;
  ids: string[];
  initial: Record<string, { x: number; y: number; width?: number; height?: number }>;
  panStart: { x: number; y: number };
}

type Lookup = (id: string) => DiagramElement | undefined;

interface MenuState {
  /** Position inside the canvas stage. */
  x: number;
  y: number;
  /** The element that was right-clicked; undefined for the empty canvas. */
  targetId?: string;
}

const ELEMENT_TEST_ID = 'canvas-element-';

function nodeShape(node: NodeElement): ReactNode {
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const common = {
    fill: displayColor(node.style.fill, 'fill'),
    stroke: displayColor(node.style.stroke, 'stroke'),
    strokeWidth: node.style.lineWidth,
    strokeDasharray: node.style.dashed ? '6 4' : undefined,
  };
  if (node.type === 'image') {
    const box = { x, y, width: node.width, height: node.height };
    return isImageDataUrl(node.href) ? (
      <>
        <image href={node.href} {...box} preserveAspectRatio="none" />
        <rect {...box} {...common} fill="none" />
      </>
    ) : (
      <rect {...box} rx={4} fill="#101827" stroke="#6f83a7" strokeWidth={1} strokeDasharray="6 4" />
    );
  }
  if (node.type === 'coordinate')
    return (
      <g stroke={displayColor(node.style.stroke, 'stroke')} strokeWidth={1.2}>
        <line x1={node.x - 5} y1={node.y} x2={node.x + 5} y2={node.y} />
        <line x1={node.x} y1={node.y - 5} x2={node.x} y2={node.y + 5} />
        <rect
          x={x}
          y={y}
          width={node.width}
          height={node.height}
          fill="transparent"
          stroke="none"
        />
      </g>
    );
  if (node.type === 'circle')
    return <circle cx={node.x} cy={node.y} r={Math.min(node.width, node.height) / 2} {...common} />;
  if (node.type === 'ellipse')
    return <ellipse cx={node.x} cy={node.y} rx={node.width / 2} ry={node.height / 2} {...common} />;
  return (
    <rect
      x={x}
      y={y}
      width={node.width}
      height={node.height}
      rx={node.style.rounded ? Math.min(10, node.height / 4) : 0}
      {...common}
    />
  );
}

function renderNode(
  node: NodeElement,
  selected: boolean,
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>, id: string) => void,
) {
  const anchor =
    node.style.align === 'left' ? 'start' : node.style.align === 'right' ? 'end' : 'middle';
  const textX =
    node.style.align === 'left'
      ? node.x - node.width / 2 + 12
      : node.style.align === 'right'
        ? node.x + node.width / 2 - 12
        : node.x;
  const text = displayText(node.text);
  return (
    <g
      key={node.id}
      data-testid={onPointerDown ? `canvas-element-${node.id}` : undefined}
      transform={`rotate(${node.rotation} ${node.x} ${node.y})`}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, node.id) : undefined}
    >
      {nodeShape(node)}
      {node.type === 'image' && !isImageDataUrl(node.href) && (
        <text x={node.x} y={node.y + 4} textAnchor="middle" fill="#8fa1be" fontSize={11}>
          {node.source || DEFAULT_IMAGE_PATH}
        </text>
      )}
      {text && node.type !== 'image' && (
        <text
          x={textX}
          y={node.y + node.style.fontSize * 0.35}
          textAnchor={anchor}
          fill={displayColor(node.style.textColor, 'text')}
          fontSize={node.style.fontSize}
          fontWeight={node.style.fontWeight}
        >
          {text}
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
  lookup: Lookup,
  selected: boolean,
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>, id: string) => void,
) {
  const geometry = edgeGeometry(edge, lookup);
  if (!geometry) return null;
  const arrow =
    edge.type === 'line' || edge.style.arrow === 'none' ? undefined : 'url(#canvas-arrow)';
  const stroke = selected ? '#67d8bc' : displayColor(edge.style.stroke, 'stroke');
  return (
    <g
      key={edge.id}
      data-testid={onPointerDown ? `canvas-element-${edge.id}` : undefined}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, edge.id) : undefined}
    >
      <path d={geometry.d} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        d={geometry.d}
        fill="none"
        stroke={stroke}
        color={stroke}
        strokeWidth={selected ? edge.style.lineWidth + 2 : edge.style.lineWidth}
        strokeDasharray={edge.style.dashed || edge.type === 'dashed-arrow' ? '7 5' : undefined}
        markerEnd={arrow}
        markerStart={edge.type === 'bidirectional-arrow' ? arrow : undefined}
      />
      {edge.label && (
        <text
          x={geometry.label.x}
          y={geometry.label.y - 6}
          textAnchor="middle"
          fill="#c9d4e5"
          fontSize={12}
        >
          {displayText(edge.label)}
        </text>
      )}
    </g>
  );
}

function renderPlot(
  plot: PlotElement,
  selected: boolean,
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>, id: string) => void,
) {
  const { frame, points } = plotGeometry(plot);
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const baseline = frame.y + frame.height * 0.92;
  const barWidth = points.length ? Math.max(4, (frame.width * 0.6) / points.length) : 0;
  return (
    <g
      key={plot.id}
      data-testid={onPointerDown ? `canvas-element-${plot.id}` : undefined}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, plot.id) : undefined}
    >
      <rect {...frame} fill={plot.style.fill} stroke="#6f83a7" />
      {plot.plotType === 'bar'
        ? points.map((point, index) => (
            <rect
              key={index}
              x={point.x - barWidth / 2}
              y={Math.min(point.y, baseline)}
              width={barWidth}
              height={Math.abs(baseline - point.y)}
              fill={plot.style.stroke}
              opacity={0.75}
            />
          ))
        : plot.plotType !== 'scatter' && (
            <path
              d={line}
              fill="none"
              stroke={plot.style.stroke}
              strokeWidth={plot.style.lineWidth}
            />
          )}
      {plot.plotType !== 'bar' &&
        (plot.style.showPoints || plot.plotType === 'scatter') &&
        points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={plot.style.pointRadius}
            fill={plot.style.stroke}
          />
        ))}
      {plot.title && (
        <text x={plot.x} y={frame.y - 8} textAnchor="middle" fill="#c9d4e5" fontSize={12}>
          {displayText(plot.title)}
        </text>
      )}
      {selected && (
        <rect
          className="selection-box"
          x={frame.x - 5}
          y={frame.y - 5}
          width={frame.width + 10}
          height={frame.height + 10}
          rx={2}
        />
      )}
    </g>
  );
}

function renderPreview(shape: PreviewShape, lookup: Lookup) {
  if (shape.type === 'preview-path')
    return (
      <path
        key={shape.id}
        d={shape.d}
        fill={displayColor(shape.fill, 'fill')}
        stroke={displayColor(shape.stroke, 'stroke')}
        color={displayColor(shape.stroke, 'stroke')}
        strokeWidth={shape.lineWidth}
        strokeDasharray={shape.dashed ? '7 5' : undefined}
        markerEnd={shape.arrowEnd ? 'url(#canvas-arrow)' : undefined}
        markerStart={shape.arrowStart ? 'url(#canvas-arrow)' : undefined}
      />
    );
  if (shape.type === 'plot') return renderPlot(shape, false);
  if (isNodeElement(shape)) return renderNode(shape, false);
  return renderEdge(shape, lookup, false);
}

export function DiagramCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const project = useProjectStore((state) => state.project);
  const selectedIds = useProjectStore((state) => state.selectedIds);
  const select = useProjectStore((state) => state.select);
  const rawBlocks = useMemo(
    () =>
      project.elements.filter((element): element is RawTikzBlock => element.type === 'raw-tikz'),
    [project.elements],
  );
  const lookup = useMemo<Lookup>(() => {
    const byId = new Map<string, DiagramElement>();
    for (const raw of rawBlocks)
      for (const shape of raw.preview ?? [])
        if (shape.type !== 'preview-path') byId.set(shape.id, shape);
    for (const element of project.elements) byId.set(element.id, element);
    return (id) => byId.get(id);
  }, [project.elements, rawBlocks]);
  const clearSelection = useProjectStore((state) => state.clearSelection);
  const updateElementTransient = useProjectStore((state) => state.updateElementTransient);
  const commitInteraction = useProjectStore((state) => state.commitInteraction);
  const duplicateSelected = useProjectStore((state) => state.duplicateSelected);
  const deleteSelected = useProjectStore((state) => state.deleteSelected);
  const copySelected = useProjectStore((state) => state.copySelected);
  const pasteClipboard = useProjectStore((state) => state.pasteClipboard);
  const groupSelected = useProjectStore((state) => state.groupSelected);
  const ungroupSelected = useProjectStore((state) => state.ungroupSelected);
  const selectAll = useProjectStore((state) => state.selectAll);
  const addArrow = useProjectStore((state) => state.addArrow);
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

  function startElementDrag(event: ReactPointerEvent<SVGGElement>, id: string): void {
    event.stopPropagation();
    // A right-click keeps a multi-selection that includes the element, for the context menu.
    if (event.button === 2) {
      if (!selectedIds.includes(id)) select(id);
      return;
    }
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

  function openContextMenu(event: ReactMouseEvent<SVGSVGElement>): void {
    event.preventDefault();
    const stage = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!stage) return;
    const hit =
      event.target instanceof Element
        ? event.target.closest(`[data-testid^="${ELEMENT_TEST_ID}"]`)
        : null;
    const targetId = hit?.getAttribute('data-testid')?.slice(ELEMENT_TEST_ID.length);
    if (targetId && !useProjectStore.getState().selectedIds.includes(targetId)) select(targetId);
    setMenu({ x: event.clientX - stage.left, y: event.clientY - stage.top, targetId });
  }

  function menuSections(targetId: string | undefined): ContextMenuSection[] {
    const paste = {
      label: 'Paste',
      icon: <ClipboardPaste size={13} />,
      shortcut: 'Ctrl+V',
      onSelect: () => {
        void navigator.clipboard
          ?.readText()
          .then((payload) => {
            if (payload) pasteClipboard(payload);
          })
          .catch(() => undefined);
      },
    };
    const target = targetId
      ? project.elements.find((element) => element.id === targetId)
      : undefined;
    if (!target)
      return [
        [
          paste,
          {
            label: 'Select all',
            icon: <SquareDashedMousePointer size={13} />,
            shortcut: 'Ctrl+A',
            onSelect: selectAll,
          },
        ],
        [{ label: 'Reset view', icon: <Maximize2 size={13} />, onSelect: resetView }],
      ];
    const selection = project.elements.filter((element) => selectedIds.includes(element.id));
    const nodes = selectedIds.flatMap((id) => {
      const element = selection.find((candidate) => candidate.id === id);
      return element && isNodeElement(element) ? [element] : [];
    });
    const [from, to] = nodes;
    return [
      [
        ...(target.type === 'image'
          ? [
              {
                label: target.href ? 'Replace image…' : 'Upload image…',
                icon: <ImageUp size={13} />,
                onSelect: () => void uploadImageToNode(target.id),
              },
            ]
          : []),
        ...(target.type === 'plot'
          ? [
              {
                label: 'Import CSV data…',
                icon: <FileUp size={13} />,
                onSelect: () => void importPlotCsv(target.id),
              },
            ]
          : []),
      ],
      [
        ...(nodes.length === 2 && from && to
          ? [
              {
                label: `Connect ${from.id} → ${to.id}`,
                icon: <MoveRight size={13} />,
                onSelect: () => addArrow(from.id, to.id),
              },
            ]
          : []),
        ...(selection.length >= 2
          ? [{ label: 'Group', icon: <Group size={13} />, onSelect: groupSelected }]
          : []),
        ...(selection.some((element) => element.type === 'group')
          ? [{ label: 'Ungroup', icon: <Ungroup size={13} />, onSelect: ungroupSelected }]
          : []),
      ],
      [
        {
          label: 'Duplicate',
          icon: <CopyPlus size={13} />,
          shortcut: 'Ctrl+D',
          onSelect: duplicateSelected,
        },
        {
          label: 'Copy',
          icon: <Copy size={13} />,
          shortcut: 'Ctrl+C',
          onSelect: () =>
            void navigator.clipboard?.writeText(copySelected()).catch(() => undefined),
        },
        paste,
      ],
      [
        {
          label: selection.length > 1 ? `Delete ${selection.length} items` : 'Delete',
          icon: <Trash2 size={13} />,
          shortcut: 'Del',
          danger: true,
          onSelect: deleteSelected,
        },
      ],
    ];
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
          onContextMenu={openContextMenu}
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
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
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
            {rawBlocks.map((raw) =>
              raw.preview?.map((shape) => (
                <g key={`${raw.id}-${shape.id}`} className="raw-preview" pointerEvents="none">
                  {renderPreview(shape, lookup)}
                </g>
              )),
            )}
            {project.elements
              .filter((element): element is PlotElement => element.type === 'plot')
              .map((plot) => renderPlot(plot, selectedIds.includes(plot.id), startElementDrag))}
            {project.elements
              .filter(isEdgeElement)
              .map((edge) =>
                renderEdge(edge, lookup, selectedIds.includes(edge.id), startElementDrag),
              )}
            {project.elements
              .filter(isNodeElement)
              .map((node) => renderNode(node, selectedIds.includes(node.id), startElementDrag))}
            {rawBlocks.map((raw, index) => (
              <g
                key={raw.id}
                data-testid={`canvas-element-${raw.id}`}
                className="raw-chip"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  select(raw.id);
                }}
              >
                <rect
                  x={16}
                  y={16 + index * 34}
                  width={250}
                  height={28}
                  rx={7}
                  fill="#251e33"
                  stroke={selectedIds.includes(raw.id) ? '#67d8bc' : '#a67bd6'}
                  strokeDasharray="5 4"
                />
                <text x={28} y={34 + index * 34} fill="#d4bbfa" fontSize={11}>
                  {`TikZ · ${raw.reason}`.slice(0, 40)}
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
          Drag to move · Shift-click multi-select · Right-click for actions · Wheel to zoom
        </div>
        {menu && (
          <CanvasContextMenu
            x={menu.x}
            y={menu.y}
            sections={menuSections(menu.targetId)}
            onClose={closeMenu}
          />
        )}
      </div>
    </section>
  );
}
