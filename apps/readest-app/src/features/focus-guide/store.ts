'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface FocusGuidePreferences {
  enabled: boolean;
  intensity: number;
  contextLines: number;
}

interface FocusGuideStore extends FocusGuidePreferences {
  setEnabled: (enabled: boolean) => void;
  setIntensity: (intensity: number) => void;
  setContextLines: (lines: number) => void;
}

const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;

export const useFocusGuideStore = create<FocusGuideStore>()(
  persist(
    (set) => ({
      enabled: false,
      intensity: 0.16,
      contextLines: 2,
      setEnabled: (enabled) => set({ enabled }),
      setIntensity: (intensity) => set({ intensity: bounded(intensity, 0.16, 0, 0.35) }),
      setContextLines: (lines) => set({ contextLines: Math.round(bounded(lines, 2, 0, 4)) }),
    }),
    {
      name: 'reading-focus-guide-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: ({ enabled, intensity, contextLines }) => ({ enabled, intensity, contextLines }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<FocusGuidePreferences>;
        return {
          ...current,
          enabled: saved.enabled === true,
          intensity: bounded(saved.intensity, 0.16, 0, 0.35),
          contextLines: Math.round(bounded(saved.contextLines, 2, 0, 4)),
        };
      },
    },
  ),
);

let hydrationStarted = false;
export const useHydrateFocusGuide = () => {
  useEffect(() => {
    if (hydrationStarted) return;
    hydrationStarted = true;
    void useFocusGuideStore.persist.rehydrate();
  }, []);
};
