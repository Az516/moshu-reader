import { create } from 'zustand';
import type { ReadingSource } from '../reading-method/types';

export const useThemeSourceReturn = create<{
  origin: { bookHash: string; cfi?: string } | null;
  target: ReadingSource | null;
  setOrigin: (origin: { bookHash: string; cfi?: string } | null) => void;
  setTarget: (target: ReadingSource | null) => void;
}>((set) => ({
  origin: null,
  target: null,
  setOrigin: (origin) => set({ origin }),
  setTarget: (target) => set({ target }),
}));
