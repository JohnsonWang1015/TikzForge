'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A group of items; groups are separated by a rule. */
export type ContextMenuSection = ContextMenuItem[];

interface CanvasContextMenuProps {
  /** Position inside the positioned container, in CSS pixels. */
  x: number;
  y: number;
  sections: ContextMenuSection[];
  onClose: () => void;
}

/** Right-click menu for the canvas; closes on outside click, Escape, scroll, blur or resize. */
export function CanvasContextMenu({ x, y, sections, onClose }: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  // Keep the menu inside its container when opened near the right or bottom edge.
  useLayoutEffect(() => {
    const menu = ref.current;
    const container = menu?.offsetParent;
    if (!menu || !(container instanceof HTMLElement)) return;
    setPosition({
      x: Math.max(4, Math.min(x, container.clientWidth - menu.offsetWidth - 4)),
      y: Math.max(4, Math.min(y, container.clientHeight - menu.offsetHeight - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const closeOutside = (event: Event) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      // Arrow keys otherwise nudge the selection (StudioShell).
      event.preventDefault();
      event.stopPropagation();
      const buttons = [
        ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
      ];
      const index = buttons.findIndex((button) => button === document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    };
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('wheel', onClose, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('wheel', onClose, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const visible = sections.filter((section) => section.length > 0);
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
      data-testid="canvas-context-menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {visible.map((section, sectionIndex) => (
        <div key={sectionIndex} className="context-menu-section">
          {section.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`context-menu-item${item.danger ? ' is-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <span className="context-menu-icon">{item.icon}</span>
              <span className="context-menu-label">{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
