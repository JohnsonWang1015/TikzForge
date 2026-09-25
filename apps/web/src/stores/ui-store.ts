'use client';

import { create } from 'zustand';

export type Modal = 'templates' | 'ai' | 'export' | 'history' | 'plot' | null;

interface UiState {
  modal: Modal;
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  setModal: (modal: Modal) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  setIsPanning: (value: boolean) => void;
  resetView: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  isPanning: false,
  setModal: (modal) => set({ modal }),
  setZoom: (zoom) => set({ zoom: Math.min(2.5, Math.max(0.25, zoom)) }),
  setPan: (pan) => set({ pan }),
  setIsPanning: (isPanning) => set({ isPanning }),
  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
}));
