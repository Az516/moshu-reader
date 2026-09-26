import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RefObject } from 'react';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { useReaderChrome } from './useReaderChrome';

const makeView = (contentDocument: Document) => {
  const view = new EventTarget() as FoliateView;
  Object.assign(view, {
    renderer: {
      getContents: () => [{ doc: contentDocument }],
    },
  });
  return view;
};

const pointerEvent = (type: string, init: PointerEventInit = {}) => {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperties(event, {
    clientY: { value: init.clientY ?? 200 },
    pointerType: { value: init.pointerType ?? 'mouse' },
  });
  return event;
};

describe('useReaderChrome', () => {
  let root: HTMLDivElement;
  let rootRef: RefObject<HTMLDivElement | null>;
  let contentDocument: Document;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.append(root);
    root.getBoundingClientRect = () =>
      ({ top: 100, bottom: 700, left: 0, right: 900, width: 900, height: 600 }) as DOMRect;
    rootRef = { current: root };
    contentDocument = document.implementation.createHTMLDocument('book');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    root.remove();
  });

  const setCoarsePointer = (coarse: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: coarse && query === '(pointer: coarse)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  };

  test('keeps the desktop edge-hover and 1.6 second auto-hide behavior', () => {
    setCoarsePointer(false);
    const view = makeView(contentDocument);
    const { result } = renderHook(() => useReaderChrome(rootRef, view));

    act(() => vi.advanceTimersByTime(1600));
    expect(result.current.visible).toBe(false);

    act(() => document.dispatchEvent(pointerEvent('pointermove', { clientY: 110 })));
    expect(result.current.visible).toBe(true);

    act(() => vi.advanceTimersByTime(1600));
    expect(result.current.visible).toBe(false);
    act(() => root.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' })));
    expect(result.current.visible).toBe(false);
    act(() => contentDocument.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' })));
    expect(result.current.visible).toBe(false);
  });

  test('gives touch readers time to use the toolbar and restores it from a body tap', () => {
    setCoarsePointer(true);
    const view = makeView(contentDocument);
    const { result } = renderHook(() => useReaderChrome(rootRef, view));

    act(() => vi.advanceTimersByTime(1600));
    expect(result.current.visible).toBe(true);

    act(() => vi.advanceTimersByTime(2400));
    expect(result.current.visible).toBe(false);

    act(() => root.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' })));
    expect(result.current.visible).toBe(true);
  });

  test('restores hidden touch chrome when the EPUB document is tapped', () => {
    setCoarsePointer(true);
    const view = makeView(contentDocument);
    const { result } = renderHook(() => useReaderChrome(rootRef, view));
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.visible).toBe(false);

    act(() => contentDocument.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' })));
    expect(result.current.visible).toBe(true);
  });

  test('consumes only the iframe click that revealed hidden touch chrome', () => {
    setCoarsePointer(true);
    const view = makeView(contentDocument);
    const { result } = renderHook(() => useReaderChrome(rootRef, view));
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.visible).toBe(false);

    act(() => contentDocument.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' })));
    expect(result.current.visible).toBe(true);
    expect(eventDispatcher.dispatchSync('iframe-single-click')).toBe(true);
    expect(eventDispatcher.dispatchSync('iframe-single-click')).toBe(false);

    act(() => contentDocument.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch' })));
    expect(eventDispatcher.dispatchSync('iframe-single-click')).toBe(false);
  });

  test('does not consume desktop iframe clicks while revealing chrome from pointer movement', () => {
    setCoarsePointer(false);
    const view = makeView(contentDocument);
    renderHook(() => useReaderChrome(rootRef, view));
    act(() => vi.advanceTimersByTime(1600));

    act(() => contentDocument.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' })));
    expect(eventDispatcher.dispatchSync('iframe-single-click')).toBe(false);
  });

  test('Tab, Escape, and the explicit reveal control still restore the toolbar', () => {
    setCoarsePointer(false);
    const view = makeView(contentDocument);
    const { result } = renderHook(() => useReaderChrome(rootRef, view));
    act(() => vi.advanceTimersByTime(1600));

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })));
    expect(result.current.visible).toBe(true);
    act(() => vi.advanceTimersByTime(1600));
    expect(result.current.visible).toBe(false);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.visible).toBe(true);
    act(() => vi.advanceTimersByTime(1600));
    expect(result.current.visible).toBe(false);

    act(() => result.current.reveal());
    expect(result.current.visible).toBe(true);
  });
});
