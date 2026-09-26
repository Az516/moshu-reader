'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (onStoreChange: () => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
};

const getSnapshot = () => (typeof window === 'undefined' ? null : window.innerWidth);
const getServerSnapshot = () => null;

/** The live viewport width, or null while rendering without a browser window. */
export const useViewportWidth = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
