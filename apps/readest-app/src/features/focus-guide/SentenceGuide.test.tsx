import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import SentenceGuide from './SentenceGuide';

const state = vi.hoisted(() => ({ view: null as FoliateView | null }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (s: unknown) => unknown) =>
    selector({ viewStates: { book: { view: state.view, viewSettings: {} } } }),
}));
vi.mock('@/context/DropdownContext', () => ({ useDropdownContext: () => null }));
vi.mock('../active-reading/session', () => ({
  sourceFromSelection: (_bookKey: string, selection: { text: string; index: number }) => ({
    excerpt: selection.text,
    cfi: 'epubcfi(/6/2!/4/2)',
    chapter: '第一章',
    sectionIndex: selection.index,
  }),
}));

describe('sentence guide reader integration', () => {
  let doc: Document;
  let paragraph: HTMLParagraphElement;
  const onDwell = vi.fn();
  const move = () =>
    act(() => {
      paragraph.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 25, clientY: 50 }),
      );
      vi.advanceTimersByTime(20);
    });
  const overlay = () => document.querySelector<HTMLElement>('[data-sentence-guide="book"]')!;

  beforeEach(() => {
    vi.useFakeTimers();
    onDwell.mockClear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const view = document.createElement('div') as unknown as FoliateView;
    const renderer = document.createElement('div') as unknown as FoliateView['renderer'];
    const iframe = document.createElement('iframe');
    view.appendChild(iframe);
    document.body.appendChild(view);
    doc = iframe.contentDocument!;
    paragraph = doc.createElement('p');
    paragraph.textContent = '阅读需要主动思考。下一句。';
    paragraph.style.fontSize = '20px';
    doc.body.appendChild(paragraph);
    vi.spyOn(view, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 80, 700, 600));
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 600, 500));
    const createRange = doc.createRange.bind(doc);
    vi.spyOn(doc, 'createRange').mockImplementation(() => {
      const range = createRange();
      range.getBoundingClientRect = () => new DOMRect(20 + range.startOffset * 20, 42, 20, 24);
      return range;
    });
    Object.assign(doc, {
      caretRangeFromPoint: () => {
        const range = doc.createRange();
        range.setStart(paragraph.firstChild!, 0);
        return range;
      },
    });
    Object.assign(renderer, { page: 0, primaryIndex: 2, getContents: () => [{ doc, index: 2 }] });
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

  it('emphasizes seven nearby characters without changing source DOM or selection, then supplies the CFI', () => {
    render(
      <SentenceGuide
        bookKey='book'
        enabled
        remindersEnabled
        variant='focus-window'
        onDwell={onDwell}
      />,
    );
    const original = paragraph.innerHTML;
    move();
    expect(overlay().style.visibility).toBe('visible');
    expect(overlay().querySelector('.moshu-focus-veil')).not.toBeNull();
    expect(overlay().textContent).toBe('');
    expect(overlay().querySelectorAll('[data-focus-cutout]')).toHaveLength(7);
    expect(overlay().dataset['variant']).toBe('focus-window');
    expect(paragraph.innerHTML).toBe(original);
    expect(doc.getSelection()?.rangeCount).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(onDwell).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        excerpt: '阅读需要主动思考。',
        cfi: 'epubcfi(/6/2!/4/2)',
        sectionIndex: 2,
      }),
    );
  });

  it.each([
    'scroll',
    'keydown',
    'pointerdown',
    'selectionchange',
  ])('cancels pending reminders on iframe %s', (eventName) => {
    render(<SentenceGuide bookKey='book' enabled remindersEnabled onDwell={onDwell} />);
    move();
    act(() => {
      vi.advanceTimersByTime(4000);
      doc.dispatchEvent(new Event(eventName));
      vi.advanceTimersByTime(5000);
    });
    expect(onDwell).not.toHaveBeenCalled();
    expect(overlay().style.visibility).toBe('hidden');
  });

  it.each(['relocate', 'navigate-start'])('cancels pending reminders on reader %s', (eventName) => {
    render(<SentenceGuide bookKey='book' enabled remindersEnabled onDwell={onDwell} />);
    move();
    act(() => {
      state.view!.dispatchEvent(new Event(eventName));
      vi.advanceTimersByTime(5000);
    });
    expect(onDwell).not.toHaveBeenCalled();
  });

  it('keeps text following available when reminders are disabled and cancels on pause', () => {
    const { rerender } = render(
      <SentenceGuide bookKey='book' enabled remindersEnabled={false} onDwell={onDwell} />,
    );
    move();
    act(() => vi.advanceTimersByTime(5000));
    expect(overlay().style.visibility).toBe('visible');
    expect(onDwell).not.toHaveBeenCalled();
    rerender(<SentenceGuide bookKey='book' enabled remindersEnabled onDwell={onDwell} />);
    move();
    rerender(<SentenceGuide bookKey='book' enabled remindersEnabled paused onDwell={onDwell} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(onDwell).not.toHaveBeenCalled();
    expect(overlay().style.visibility).toBe('hidden');
  });

  it('uses the macOS-safe analytical ring while preserving interactive cursor rules', () => {
    paragraph.style.cursor = 'text';
    const link = doc.createElement('a');
    link.href = '#next';
    link.style.cursor = 'pointer';
    paragraph.appendChild(link);
    const button = doc.createElement('button');
    paragraph.appendChild(button);
    const iframe = doc.defaultView!.frameElement as HTMLIFrameElement;
    iframe.style.cursor = 'wait';

    const { rerender } = render(
      <SentenceGuide bookKey='book' enabled remindersEnabled={false} onDwell={onDwell} />,
    );
    expect(doc.documentElement.style.cursor).toContain('url(');
    expect(doc.body.style.cursor).toContain('url(');
    expect(iframe.style.cursor).toContain('url(');
    const cursorRule = doc.querySelector<HTMLStyleElement>('style[data-moshu-reader-cursor]');
    expect(cursorRule?.dataset['moshuReaderCursor']).toBe('emphasis');
    expect(cursorRule?.dataset['moshuReaderCursorMode']).toBe('analytical');
    expect(cursorRule?.textContent).toContain('data:image/png;base64');
    expect(cursorRule?.textContent).toContain('8 8, default');
    expect(cursorRule?.textContent).not.toContain('image/svg+xml');
    expect(cursorRule?.textContent).not.toContain('crosshair');
    expect(cursorRule?.textContent).not.toContain('cursor: none');
    expect(cursorRule?.textContent).toContain('body *');
    expect(cursorRule?.textContent).toContain('cursor: pointer !important');
    expect(doc.defaultView?.getComputedStyle(button).cursor).toBe('pointer');
    expect(paragraph.style.cursor).toBe('text');
    expect(link.style.cursor).toBe('pointer');
    rerender(<SentenceGuide bookKey='book' enabled={false} remindersEnabled onDwell={onDwell} />);
    expect(doc.documentElement.style.cursor).toBe('');
    expect(doc.body.style.cursor).toBe('');
    expect(iframe.style.cursor).toBe('wait');
    expect(doc.querySelector('style[data-moshu-reader-cursor]')).toBeNull();
    expect(paragraph.style.cursor).toBe('text');
    expect(link.style.cursor).toBe('pointer');
  });

  it('keeps quick and analytical cursor profiles separate across mode and page changes', () => {
    doc.documentElement.style.setProperty('cursor', 'progress', 'important');
    doc.body.style.cursor = 'help';
    const iframe = doc.defaultView!.frameElement as HTMLIFrameElement;
    iframe.style.cursor = 'wait';
    const { rerender } = render(
      <SentenceGuide
        bookKey='book'
        enabled
        remindersEnabled={false}
        variant='focus-window'
        onDwell={onDwell}
      />,
    );
    let cursorRule = doc.querySelector<HTMLStyleElement>('style[data-moshu-reader-cursor]');
    expect(cursorRule?.dataset['moshuReaderCursor']).toBe('focus-window');
    expect(cursorRule?.dataset['moshuReaderCursorMode']).toBe('quick');
    expect(cursorRule?.textContent).toContain('data:image/png;base64');
    expect(cursorRule?.textContent).toContain('8 8, default');
    expect(cursorRule?.textContent).not.toContain('crosshair');
    expect(doc.documentElement.style.cursor).toContain('url(');

    act(() => state.view!.dispatchEvent(new Event('relocate')));
    expect(doc.querySelectorAll('style[data-moshu-reader-cursor]')).toHaveLength(1);
    expect(doc.documentElement.style.cursor).toContain('url(');

    rerender(
      <SentenceGuide
        bookKey='book'
        enabled
        remindersEnabled={false}
        variant='emphasis'
        onDwell={onDwell}
      />,
    );
    cursorRule = doc.querySelector<HTMLStyleElement>('style[data-moshu-reader-cursor]');
    expect(doc.querySelectorAll('style[data-moshu-reader-cursor]')).toHaveLength(1);
    expect(cursorRule?.dataset['moshuReaderCursor']).toBe('emphasis');
    expect(cursorRule?.dataset['moshuReaderCursorMode']).toBe('analytical');

    rerender(
      <SentenceGuide
        bookKey='book'
        enabled={false}
        remindersEnabled={false}
        variant='emphasis'
        onDwell={onDwell}
      />,
    );
    expect(doc.documentElement.style.getPropertyValue('cursor')).toBe('progress');
    expect(doc.documentElement.style.getPropertyPriority('cursor')).toBe('important');
    expect(doc.body.style.cursor).toBe('help');
    expect(iframe.style.cursor).toBe('wait');
    expect(doc.querySelector('style[data-moshu-reader-cursor]')).toBeNull();
  });

  it('keeps the focus visible across a brief gap between glyph hit boxes', () => {
    render(
      <SentenceGuide
        bookKey='book'
        enabled
        remindersEnabled={false}
        variant='focus-window'
        onDwell={onDwell}
      />,
    );
    move();
    expect(overlay().style.visibility).toBe('visible');
    Object.assign(doc, { caretRangeFromPoint: () => null });
    move();
    expect(overlay().style.visibility).toBe('visible');
    act(() => vi.advanceTimersByTime(140));
    expect(overlay().style.visibility).toBe('visible');
    act(() => doc.dispatchEvent(new Event('pointerout')));
    expect(overlay().style.visibility).toBe('hidden');
  });

  it('preserves cooldown across temporary pauses and uses the latest callback', () => {
    const laterCallback = vi.fn();
    const { rerender } = render(
      <SentenceGuide bookKey='book' enabled remindersEnabled onDwell={onDwell} />,
    );
    move();
    act(() => vi.advanceTimersByTime(5000));
    expect(onDwell).toHaveBeenCalledTimes(1);
    rerender(
      <SentenceGuide bookKey='book' enabled remindersEnabled paused onDwell={laterCallback} />,
    );
    rerender(<SentenceGuide bookKey='book' enabled remindersEnabled onDwell={laterCallback} />);
    move();
    act(() => vi.advanceTimersByTime(5000));
    expect(laterCallback).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(60000));
    move();
    act(() => vi.advanceTimersByTime(5000));
    expect(laterCallback).toHaveBeenCalledTimes(1);
  });

  it('cancels on window blur and removes timers and document listeners on unmount', () => {
    const { unmount } = render(
      <SentenceGuide bookKey='book' enabled remindersEnabled onDwell={onDwell} />,
    );
    move();
    act(() => {
      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(5000);
    });
    expect(onDwell).not.toHaveBeenCalled();
    move();
    unmount();
    move();
    act(() => vi.advanceTimersByTime(5000));
    expect(onDwell).not.toHaveBeenCalled();
  });
});
