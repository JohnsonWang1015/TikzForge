'use client';

import { create } from 'zustand';

export type Modal = 'templates' | 'ai' | 'export' | 'history' | 'plot' | null;

export type SidePanel = 'sidebar' | 'inspector';

const PANEL_WIDTHS_KEY = 'tikzforge.panels.v1';

export const PANEL_LIMITS: Record<SidePanel, { min: number; max: number; initial: number }> = {
  sidebar: { min: 160, max: 420, initial: 208 },
  inspector: { min: 300, max: 760, initial: 390 },
};

export function clampPanelWidth(panel: SidePanel, width: number): number {
  const { min, max } = PANEL_LIMITS[panel];
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** Panel widths are a per-browser convenience; unreadable storage just means the defaults. */
function loadPanelWidths(): Record<SidePanel, number> {
  const widths = {
    sidebar: PANEL_LIMITS.sidebar.initial,
    inspector: PANEL_LIMITS.inspector.initial,
  };
  if (typeof window === 'undefined') return widths;
  try {
    const saved = JSON.parse(window.localStorage.getItem(PANEL_WIDTHS_KEY) ?? 'null') as Partial<
      Record<SidePanel, unknown>
    > | null;
    for (const panel of ['sidebar', 'inspector'] as const) {
      const value = saved?.[panel];
      if (typeof value === 'number' && Number.isFinite(value))
        widths[panel] = clampPanelWidth(panel, value);
    }
  } catch {
    // Keep the defaults.
  }
  return widths;
}

interface UiState {
  modal: Modal;
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  panelWidths: Record<SidePanel, number>;
  setModal: (modal: Modal) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  setIsPanning: (value: boolean) => void;
  resetView: () => void;
  loadPanelWidths: () => void;
  setPanelWidth: (panel: SidePanel, width: number) => void;
  savePanelWidths: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  modal: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  isPanning: false,
  panelWidths: { sidebar: PANEL_LIMITS.sidebar.initial, inspector: PANEL_LIMITS.inspector.initial },
  setModal: (modal) => set({ modal }),
  setZoom: (zoom) => set({ zoom: Math.min(2.5, Math.max(0.25, zoom)) }),
  setPan: (pan) => set({ pan }),
  setIsPanning: (isPanning) => set({ isPanning }),
  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
  loadPanelWidths: () => set({ panelWidths: loadPanelWidths() }),
  setPanelWidth: (panel, width) =>
    set({ panelWidths: { ...get().panelWidths, [panel]: clampPanelWidth(panel, width) } }),
  savePanelWidths: () => {
    try {
      window.localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(get().panelWidths));
    } catch {
      // Not persisting a panel width is harmless.
    }
  },
}));
