import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import FocusGuide from './FocusGuide';

const state = vi.hoisted(() => ({
  view: null as FoliateView | null,
  menu: null as string | null,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (s: unknown) => unknown) =>
    selector({
      viewStates: { book: { view: state.view, viewSettings: { vertical: false, isEink: false } } },
    }),
}));
vi.mock('@/context/DropdownContext', () => ({
  useDropdownContext: () => ({ openDropdownId: state.menu }),
}));
vi.mock('./store', () => ({
  useHydrateFocusGuide: () => {},
  useFocusGuideStore: (selector: (s: unknown) => unknown) =>
    selector({
      enabled: true,
      intensity: 0.16,
      contextLines: 2,
    }),
}));

describe('focus guide interaction', () => {
  let iframe: HTMLIFrameElement;
  let doc: Document;
  let paragraph: HTMLParagraphElement;
  let iframeTop: number;
  const rect = (x: number, y: number, width: number, height: number) =>
    new DOMRect(x, y, width, height);
  const move = (buttons = 0) => {
    act(() => {
      paragraph.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 25,
          clientY: 50,
          buttons,
        }),
      );
      vi.advanceTimersByTime(20);
    });
  };
  const overlay = () => document.querySelector<HTMLElement>('[data-focus-guide="book"]')!;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    iframeTop = 100;
    state.menu = null;
    const view = document.createElement('div') as unknown as FoliateView;
    const renderer = document.createElement('div') as unknown as FoliateView['renderer'];
    iframe = document.createElement('iframe');
    view.appendChild(iframe);
    document.body.appendChild(view);
    doc = iframe.contentDocument!;
    paragraph = doc.createElement('p');
    paragraph.textContent = 'A real passage with several lines.';
    paragraph.style.lineHeight = '24px';
    doc.body.appendChild(paragraph);
    vi.spyOn(view, 'getBoundingClientRect').mockImplementation(() => rect(80, 80, 700, 600));
    vi.spyOn(iframe, 'getBoundingClientRect').mockImplementation(() =>
      rect(100, iframeTop, 600, 500),
    );
    const createRange = doc.createRange.bind(doc);
    vi.spyOn(doc, 'createRange').mockImplementation(() => {
      const range = createRange();
      range.getBoundingClientRect = () => rect(20, 42, 10, 16);
      range.getClientRects = () =>
        [
          rect(20, 18, 300, 16),
          rect(20, 42, 300, 16),
          rect(20, 66, 300, 16),
        ] as unknown as DOMRectList;
      return range;
    });
    Object.assign(doc, {
      caretRangeFromPoint: () => {
        const range = doc.createRange();
        range.setStart(paragraph.firstChild!, 0);
        return range;
      },
    });
    Object.assign(renderer, { columnCount: 1, getContents: () => [{ doc }] });
    Object.assign(view, { renderer, isFixedLayout: false });
    state.view = view;
  });

  afterEach(() => {
    cleanup();
    state.view?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps the iframe line to its viewport offset and leaves selection events intact', () => {
    render(<FocusGuide bookKey='book' bookFormat='EPUB' />);
    move();
    expect(overlay().style.visibility).toBe('visible');
    expect(overlay().style.left).toBe('80px');
    expect((overlay().lastElementChild as HTMLElement).style.transform).toBe('translateY(62px)');
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    act(() => paragraph.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(false);
    expect(overlay().style.visibility).toBe('hidden');
    move(1);
    expect(overlay().style.visibility).toBe('hidden');
  });

  it('hides on text selection and only resumes when selection is cleared and pointer moves', () => {
    render(<FocusGuide bookKey='book' bookFormat='EPUB' />);
    move();
    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    doc.getSelection()!.addRange(range);
    act(() => doc.dispatchEvent(new Event('selectionchange')));
    move();
    expect(overlay().style.visibility).toBe('hidden');
    doc.getSelection()!.removeAllRanges();
    expect(overlay().style.visibility).toBe('hidden');
    move();
    expect(overlay().style.visibility).toBe('visible');
  });

  it('pauses when leaving the page or opening a menu, and disables unsupported columns', () => {
    const { rerender } = render(<FocusGuide bookKey='book' bookFormat='EPUB' />);
    move();
    act(() => document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })));
    expect(overlay().style.visibility).toBe('hidden');
    state.menu = 'settings';
    rerender(<FocusGuide bookKey='book' bookFormat='EPUB' />);
    move();
    expect(overlay().style.visibility).toBe('hidden');
    state.menu = null;
    state.view!.renderer.columnCount = 2;
    rerender(<FocusGuide bookKey='book' bookFormat='EPUB' />);
    move();
    expect(overlay().style.visibility).toBe('hidden');
  });
});
