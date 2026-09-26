import { act, cleanup, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useViewportWidth } from './useViewportWidth';

const WidthProbe = () => <span>{useViewportWidth() ?? 'unknown'}</span>;

describe('useViewportWidth', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('uses an SSR-safe snapshot without reading the browser width', () => {
    expect(renderToString(<WidthProbe />)).toContain('unknown');
  });

  test('updates when the viewport is resized and removes its listener on unmount', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useViewportWidth());

    expect(result.current).toBe(1024);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 560 });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current).toBe(560);

    unmount();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
