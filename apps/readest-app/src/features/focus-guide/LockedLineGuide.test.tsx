import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import type { LockedLine } from './lockedLines';
import LockedLineGuide from './LockedLineGuide';

const geometry = vi.hoisted(() => ({ lines: [] as LockedLine[], hit: vi.fn(), measure: vi.fn() }));
vi.mock('./lockedLines', () => ({
  collectVisibleLines: () => {
    geometry.measure();
    return geometry.lines;
  },
  getReadingViewport: () => ({ left: 0, top: 0, right: 600, bottom: 400 }),
}));
vi.mock('./sentence', () => ({
  sentenceAtPoint: (...args: unknown[]) => geometry.hit(...args),
  glyphRectOnLine: (_range: Range, y: number) => new DOMRect(50, y - 10, 20, 20),
}));
vi.mock('../active-reading/session', () => ({
  sourceFromSelection: (_key: string, selection: { text: string }) => ({
    excerpt: selection.text,
    cfi: 'epubcfi(/6/2!/4/2)',
    chapter: '第一章',
  }),
}));

describe('locked line reading', () => {
  let view: FoliateView;
  let doc: Document;
  let paragraph: HTMLElement;
  const onDwell = vi.fn();
  const marker = () => document.querySelector<HTMLElement>('[data-locked-marker]')!;
  const root = () => document.querySelector<HTMLElement>('[data-locked-line-guide]')!;
  const move = (x: number, y = 50) =>
    act(() => {
      paragraph.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }),
      );
      vi.advanceTimersByTime(20);
    });
  const click = (x = 50, y = 50, bookKey = 'book') =>
    act(() => {
      paragraph.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1, clientX: x, clientY: y }),
      );
      const consumed = eventDispatcher.dispatchSync('iframe-single-click', {
        bookKey,
        clientX: x,
        clientY: y,
      });
      vi.advanceTimersByTime(20);
      return consumed;
    });
  const mount = (followStyle: 'classic' | 'soft' = 'soft') =>
    render(
      <LockedLineGuide
        bookKey='book'
        view={view}
        enabled
        remindersEnabled
        onDwell={onDwell}
        followStyle={followStyle}
      />,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    onDwell.mockClear();
    geometry.measure.mockClear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    view = document.createElement('div') as unknown as FoliateView;
    const iframe = document.createElement('iframe');
    view.appendChild(iframe);
    document.body.appendChild(view);
    doc = iframe.contentDocument!;
    paragraph = doc.createElement('p');
    paragraph.textContent = '第一行正文。第二行正文。';
    paragraph.style.fontSize = '20px';
    doc.body.appendChild(paragraph);
    vi.spyOn(view, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400));
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400));
    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    geometry.hit.mockReset();
    geometry.hit.mockReturnValue({ glyphs: [{ text: '正', range }] });
    geometry.lines = [40, 80].map((top) => ({
      doc,
      left: 20,
      right: 220,
      top,
      bottom: top + 20,
      range,
    }));
    const renderer = document.createElement('div');
    Object.assign(renderer, {
      getContents: () => [{ doc, index: 0 }],
      page: 0,
      atEnd: false,
      pageColors: { background: '#fff' },
    });
    Object.assign(view, { renderer, next: vi.fn(async () => {}), isFixedLayout: false });
  });
  afterEach(() => {
    cleanup();
    view.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('starts as soon as the pointer enters text and ignores all vertical pointer movement', () => {
    mount();
    move(50);
    expect(root().style.visibility).toBe('visible');
    const top = marker().style.top;
    const left = marker().style.left;
    move(50, 180);
    expect(root().style.visibility).toBe('visible');
    expect(marker().style.top).toBe(top);
    expect(marker().style.left).toBe(left);
    move(80, 230);
    expect(marker().style.top).toBe(top);
    expect(parseFloat(marker().style.left)).toBeGreaterThan(parseFloat(left));
  });

  it('keeps classic focus-window visuals while locking the reading line', () => {
    mount('classic');
    move(50);
    expect(root().dataset['followStyle']).toBe('classic');
    const veil = root().querySelector<SVGRectElement>('.moshu-focus-veil')!;
    expect(veil).not.toBeNull();
    expect(veil.style.opacity).toBe('0.52');
    expect(marker().style.background).toBe('transparent');
    const cutout = root().querySelector('[data-focus-cutout]')!;
    const y = cutout.getAttribute('y');
    move(80, 180);
    expect(cutout.getAttribute('y')).toBe(y);
    expect(geometry.hit).toHaveBeenLastCalledWith(doc, 80, 50);
  });

  it('does not start in blank space or while text is selected; clicking text repositions it', () => {
    mount();
    move(50, 160);
    expect(root().style.visibility).toBe('hidden');
    const selection = doc.getSelection()!;
    selection.addRange(geometry.lines[0]!.range);
    move(50);
    expect(root().style.visibility).toBe('hidden');
    selection.removeAllRanges();
    move(50);
    expect(marker().style.top).toBe('39px');
    click(50, 90);
    expect(marker().style.top).toBe('79px');
  });

  it('can guide a real text line even when sentence segmentation cannot resolve a phrase', () => {
    geometry.hit.mockReturnValue(null);
    mount('classic');
    move(50);
    expect(root().style.visibility).toBe('visible');
    const cutout = root().querySelector('[data-focus-cutout]')!;
    expect(Number(cutout.getAttribute('width'))).toBeGreaterThan(0);
  });

  it('does not rescan a chapter for every pointer event in blank space and refreshes after navigation', () => {
    mount();
    for (let x = 50; x < 60; x++) move(x, 160);
    expect(geometry.measure).toHaveBeenCalledTimes(1);
    act(() => view.dispatchEvent(new Event('navigate-start')));
    move(50);
    expect(geometry.measure).toHaveBeenCalledTimes(2);
    expect(root().style.visibility).toBe('visible');
  });

  it('moves to the next line once, holds during the left return, then resumes on right movement', () => {
    mount();
    click();
    move(225);
    const top = marker().style.top;
    const left = marker().style.left;
    expect(parseFloat(top)).toBe(79);
    move(240);
    expect(marker().style.left).toBe(left);
    move(30, 300);
    expect(marker().style.top).toBe(top);
    expect(marker().style.left).toBe(left);
    move(80, 350);
    expect(root().dataset['phase']).toBe('reading');
    expect(parseFloat(marker().style.left)).toBeGreaterThan(parseFloat(left));
  });

  it('does not consume other book clicks or links and leaves selections intact', () => {
    mount();
    click(50, 50, 'other');
    expect(root().style.visibility).toBe('hidden');
    const link = doc.createElement('a');
    link.href = '#note';
    link.textContent = '注';
    paragraph.appendChild(link);
    act(() =>
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1, clientX: 50, clientY: 50 }),
      ),
    );
    expect(
      eventDispatcher.dispatchSync('iframe-single-click', {
        bookKey: 'book',
        clientX: 50,
        clientY: 50,
      }),
    ).toBe(false);
    click();
    act(() => {
      const selection = doc.getSelection()!;
      selection.addRange(geometry.lines[0]!.range);
      doc.dispatchEvent(new Event('selectionchange'));
    });
    expect(root().style.visibility).toBe('hidden');
    expect(doc.getSelection()?.toString()).toContain('第一行');
  });

  it('turns the page once at the last visible line and resumes with its first line', async () => {
    mount();
    click(50, 90);
    vi.mocked(view.next).mockImplementation(async () => {
      geometry.lines = [{ ...geometry.lines[0]!, top: 30, bottom: 50 }];
      view.lastLocation = { cfi: 'epubcfi(/6/4!/4/2)' };
      view.dispatchEvent(new Event('relocate'));
    });
    move(225, 90);
    move(250, 120);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(root().style.visibility).toBe('visible');
    expect(marker().style.top).toBe('29px');
    expect(root().dataset['phase']).toBe('returning');
    act(() => view.dispatchEvent(new Event('relocate')));
    expect(root().style.visibility).toBe('visible');
    act(() => {
      view.lastLocation = { cfi: 'epubcfi(/6/6!/4/2)' };
      view.dispatchEvent(new Event('relocate'));
    });
    expect(root().style.visibility).toBe('hidden');
  });

  it('stops at the book end and cancels the lock on manual navigation', () => {
    view.renderer.atEnd = true;
    mount();
    click(50, 90);
    move(225, 90);
    expect(view.next).not.toHaveBeenCalled();
    act(() => view.dispatchEvent(new Event('navigate-start')));
    expect(root().style.visibility).toBe('hidden');
    move(200, 90);
    expect(root().style.visibility).toBe('visible');
  });

  it('accepts a sequence of one-pixel movements at the line end and after returning', () => {
    mount();
    click(215);
    for (let x = 216; x <= 222; x++) move(x);
    expect(marker().style.top).toBe('79px');
    move(25);
    for (let x = 26; x <= 32; x++) move(x);
    expect(root().dataset['phase']).toBe('reading');
    expect(parseFloat(marker().style.left)).toBeGreaterThan(20);
  });

  it('does not mistake slow continuous movement for a stopped pointer', () => {
    mount();
    click();
    for (let x = 51; x <= 57; x++) {
      move(x);
      act(() => vi.advanceTimersByTime(1000));
    }
    expect(onDwell).not.toHaveBeenCalled();
  });

  it('keeps the current line locked when an adjacent chapter loads in the background', () => {
    mount();
    click();
    const top = marker().style.top;
    act(() => view.dispatchEvent(new Event('load')));
    move(80, 180);
    expect(root().style.visibility).toBe('visible');
    expect(marker().style.top).toBe(top);
  });

  it('does not restore a stale guide when a pending auto turn finishes after manual navigation', async () => {
    let finish!: () => void;
    vi.mocked(view.next).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    click(50, 90);
    move(225, 90);
    act(() => view.dispatchEvent(new Event('navigate-start')));
    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(root().style.visibility).toBe('hidden');
  });

  it('leaves double clicks to native word selection', () => {
    mount();
    act(() => {
      for (const detail of [1, 2])
        paragraph.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            detail,
            clientX: 50,
            clientY: 50,
          }),
        );
    });
    expect(
      eventDispatcher.dispatchSync('iframe-single-click', {
        bookKey: 'book',
        clientX: 50,
        clientY: 50,
      }),
    ).toBe(false);
    expect(root().style.visibility).toBe('hidden');
  });

  it('keeps dwell next to the actual stopped pointer and cancels it when movement resumes', () => {
    mount();
    click();
    move(80, 200);
    act(() => vi.advanceTimersByTime(5000));
    expect(onDwell).toHaveBeenCalledWith(
      expect.objectContaining({ cfi: expect.any(String) }),
      expect.objectContaining({ x: 80, y: 200 }),
    );
  });
});
