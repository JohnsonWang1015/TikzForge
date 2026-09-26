import { ptToPx } from './geometry';
import type { NodeStyle, TikzStyleDefinition } from './index';

/** What a TikZ `\node` looks like with no options: no border, no fill, 10pt black text. */
export function tikzBaseNodeStyle(pixelsPerCm: number): NodeStyle {
  return {
    fill: 'none',
    stroke: 'none',
    lineWidth: ptToPx(0.4, pixelsPerCm),
    rounded: false,
    dashed: false,
    fontSize: ptToPx(10, pixelsPerCm),
    fontWeight: 'normal',
    textColor: 'black',
    align: 'center',
  };
}

/**
 * Applies a named style on top of a node style. Style lengths are canvas pixels, resolved when
 * the style was parsed.
 */
export function applyStyleDefinition(style: NodeStyle, definition: TikzStyleDefinition): NodeStyle {
  const next = { ...style };
  if (definition.draw === false) next.stroke = 'none';
  if (definition.draw === true) next.stroke = definition.stroke ?? 'black';
  else if (definition.stroke && next.stroke !== 'none') next.stroke = definition.stroke;
  if (definition.fill !== undefined) next.fill = definition.fill;
  if (definition.rounded !== undefined) next.rounded = definition.rounded;
  if (definition.dashed !== undefined) next.dashed = definition.dashed;
  if (definition.lineWidth !== undefined) next.lineWidth = definition.lineWidth;
  if (definition.fontSize !== undefined) next.fontSize = definition.fontSize;
  if (definition.fontWeight !== undefined) next.fontWeight = definition.fontWeight;
  if (definition.textColor !== undefined) next.textColor = definition.textColor;
  if (definition.textWidth !== undefined) next.textWidth = definition.textWidth;
  if (definition.align !== undefined) next.align = definition.align;
  return next;
}

export interface ResolvedStyleRefs {
  style: NodeStyle;
  shape?: TikzStyleDefinition['shape'];
  minimumWidth?: number;
  minimumHeight?: number;
}

/** The style a node gets from `every node/.style` plus its named styles, before its own options. */
export function resolveStyleRefs(
  styles: Record<string, TikzStyleDefinition>,
  refs: readonly string[],
  pixelsPerCm: number,
): ResolvedStyleRefs {
  const resolved: ResolvedStyleRefs = { style: tikzBaseNodeStyle(pixelsPerCm) };
  for (const name of ['every node', ...refs]) {
    const definition = styles[name];
    if (!definition) continue;
    resolved.style = applyStyleDefinition(resolved.style, definition);
    if (definition.shape) resolved.shape = definition.shape;
    if (definition.minimumWidth !== undefined) resolved.minimumWidth = definition.minimumWidth;
    if (definition.minimumHeight !== undefined) resolved.minimumHeight = definition.minimumHeight;
  }
  return resolved;
}
