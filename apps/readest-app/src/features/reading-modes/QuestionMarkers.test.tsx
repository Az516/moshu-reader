import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import type { ReadingRecord } from '../active-reading/data';
import QuestionMarkers from './QuestionMarkers';

const state = vi.hoisted(() => ({ view: null as FoliateView | null }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (s: unknown) => unknown) =>
    selector({ viewStates: { book: { view: state.view, viewSettings: {} } } }),
}));

const question = (id: string, patch: Partial<ReadingRecord> = {}): ReadingRecord => ({
  id,
  kind: 'question',
  status: 'open',
  userText: `疑问 ${id}`,
  originalText: `疑问 ${id}`,
  revisions: [],
  source: { excerpt: '当前原文', cfi: id, sectionIndex: 1 },
  ...patch,
});

describe('anchored margin question markers', () => {
  let doc: Document;
  let paragraph: HTMLParagraphElement;
  let passageTop: number;
  let pageViewport: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    passageTop = 80;
    const view = document.createElement('div') as unknown as FoliateView;
    const renderer = document.createElement('div') as unknown as FoliateView['renderer'];
    pageViewport = document.createElement('div');
    renderer.appendChild(pageViewport);
    view.appendChild(renderer);
    const iframe = document.createElement('iframe');
    pageViewport.appendChild(iframe);
    document.body.appendChild(view);
    doc = iframe.contentDocument!;
    paragraph = doc.createElement('p');
    paragraph.textContent = '当前原文，有一个待解决的问题。';
    doc.body.appendChild(paragraph);
    vi.spyOn(view, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 700, 600));
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 120, 640, 540));
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 80, 520, 70));
    Object.assign(renderer, { primaryIndex: 1, getContents: () => [{ doc, index: 1 }] });
    Object.assign(view, {
      renderer,
      resolveCFI: (cfi: string) => {
        if (cfi === 'invalid') throw new Error('invalid CFI');
        return {
          index: cfi === 'other-chapter' ? 3 : 1,
          anchor: (sourceDoc: Document) => {
            expect(sourceDoc).toBe(doc);
            const range = doc.createRange();
            range.selectNodeContents(paragraph);
            range.getClientRects = () =>
              [
                new DOMRect(30, cfi === 'off-page' ? 900 : passageTop, 400, 24),
              ] as unknown as DOMRectList;
            return range;
          },
        };
      },
    });
    state.view = view;
  });
  afterEach(() => {
    cleanup();
    state.view?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const paint = () => act(() => vi.advanceTimersByTime(20));

  it('shows only anchored questions on the current chapter and visible page', () => {
    render(
      <QuestionMarkers
        bookKey='book'
        records={[
          question('here'),
          question('resolved', { status: 'resolved' }),
          question('other-chapter'),
          question('off-page'),
          question('invalid'),
          question('unanchored', { source: undefined }),
          question('discarded', { status: 'discarded' }),
          question('understanding', { kind: 'understanding' }),
        ]}
        onOpen={vi.fn()}
      />,
    );
    paint();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '疑问：疑问 here' }).dataset['status']).toBe('open');
    expect(screen.getByRole('button', { name: '疑问：疑问 here' }).dataset['visual']).toBe(
      'question-mascot',
    );
    const resolved = screen.getByRole('button', { name: '已解决：疑问 resolved' });
    expect(resolved.dataset['status']).toBe('resolved');
    expect(resolved.classList.contains('moshu-question-marker')).toBe(true);
    expect(resolved.style.width).toBe('');
    expect(paragraph.innerHTML).toBe('当前原文，有一个待解决的问题。');
  });

  it('renders anchored questions on both visible pages of a two-page spread', () => {
    const view = state.view!;
    const leftFrame = doc.defaultView!.frameElement!;
    const rightFrame = document.createElement('iframe');
    view.appendChild(rightFrame);
    const rightDoc = rightFrame.contentDocument!;
    const rightParagraph = rightDoc.createElement('p');
    rightParagraph.textContent = '右页也有一个待解决的问题。';
    rightDoc.body.appendChild(rightParagraph);

    vi.spyOn(leftFrame, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 120, 300, 540));
    vi.spyOn(rightFrame, 'getBoundingClientRect').mockReturnValue(new DOMRect(440, 120, 320, 540));
    vi.spyOn(rightParagraph, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(24, 120, 240, 70),
    );
    Object.assign(view.renderer, {
      getContents: () => [
        { doc, index: 1 },
        { doc: rightDoc, index: 2 },
      ],
    });
    view.resolveCFI = (cfi: string) => {
      const isRightPage = cfi === 'right';
      return {
        index: isRightPage ? 2 : 1,
        anchor: (sourceDoc: Document) => {
          const targetDoc = isRightPage ? rightDoc : doc;
          const targetParagraph = isRightPage ? rightParagraph : paragraph;
          expect(sourceDoc).toBe(targetDoc);
          const range = targetDoc.createRange();
          range.selectNodeContents(targetParagraph);
          range.getClientRects = () =>
            [
              new DOMRect(isRightPage ? 24 : 30, isRightPage ? 120 : 80, 220, 24),
            ] as unknown as DOMRectList;
          return range;
        },
      };
    };

    render(
      <QuestionMarkers
        bookKey='book'
        records={[question('left'), question('right')]}
        onOpen={vi.fn()}
      />,
    );
    paint();

    expect(screen.getByRole('button', { name: '疑问：疑问 left' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '疑问：疑问 right' })).not.toBeNull();
    expect(document.querySelectorAll('[data-question-highlight]')).toHaveLength(2);
  });

  it('marks the exact saved passage with the reader-selected style without changing the book DOM', () => {
    const original = paragraph.innerHTML;
    render(
      <QuestionMarkers
        bookKey='book'
        records={[question('here', { markerStyle: 'highlight' })]}
        onOpen={vi.fn()}
      />,
    );
    paint();
    const highlight = document.querySelector<HTMLElement>('[data-question-highlight="highlight"]');
    expect(highlight).not.toBeNull();
    expect(highlight?.classList.contains('is-highlight')).toBe(true);
    expect(highlight?.style.backgroundColor).toBe('');
    expect(paragraph.innerHTML).toBe(original);
  });

  it('clips a saved mark to its visible page after a layout change', () => {
    state.view!.resolveCFI = () => ({
      index: 1,
      anchor: () => {
        const range = doc.createRange();
        range.selectNodeContents(paragraph);
        range.getClientRects = () => [new DOMRect(-180, 80, 500, 24)] as unknown as DOMRectList;
        return range;
      },
    });
    render(<QuestionMarkers bookKey='book' records={[question('here')]} onOpen={vi.fn()} />);
    paint();
    const mark = document.querySelector<HTMLElement>('[data-question-highlight]')!;
    expect(parseFloat(mark.style.left)).toBeGreaterThanOrEqual(120);
    expect(parseFloat(mark.style.width)).toBe(320);
  });

  it.each([
    ['left', new DOMRect(30, 80, 100, 24)],
    ['right', new DOMRect(610, 80, 20, 24)],
    ['top', new DOMRect(210, 20, 100, 24)],
    ['bottom', new DOMRect(210, 360, 100, 24)],
  ])('does not paint a question hidden beyond the page viewport on the %s', (_, hiddenRect) => {
    pageViewport.style.overflow = 'hidden';
    vi.spyOn(pageViewport, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(300, 180, 400, 270),
    );
    state.view!.resolveCFI = (cfi) => ({
      index: 1,
      anchor: () => {
        const range = doc.createRange();
        range.selectNodeContents(paragraph);
        range.getClientRects = () =>
          [cfi === 'hidden' ? hiddenRect : new DOMRect(210, 80, 240, 24)] as unknown as DOMRectList;
        return range;
      },
    });
    render(
      <QuestionMarkers
        bookKey='book'
        records={[question('hidden'), question('here')]}
        onOpen={vi.fn()}
      />,
    );
    paint();
    expect(screen.queryByRole('button', { name: '疑问：疑问 hidden' })).toBeNull();
    expect(screen.getByRole('button', { name: '疑问：疑问 here' })).not.toBeNull();
    expect(document.querySelectorAll('[data-question-highlight]')).toHaveLength(1);
  });

  it('clips passage marks through a shadow host but keeps the question button in the page margin', () => {
    const renderer = state.view!.renderer;
    // jsdom does not load iframe documents in shadow roots; preserve the document
    // while exposing the same connected frame ancestry as Foliate's paginator.
    const shadowFrame = document.createElement('div');
    renderer.attachShadow({ mode: 'open' }).appendChild(shadowFrame);
    vi.spyOn(doc.defaultView!, 'frameElement', 'get').mockReturnValue(shadowFrame);
    vi.spyOn(shadowFrame, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 120, 640, 540));
    renderer.style.overflowX = 'hidden';
    vi.spyOn(renderer, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 180, 220, 270));
    render(<QuestionMarkers bookKey='book' records={[question('here')]} onOpen={vi.fn()} />);
    paint();
    const mark = document.querySelector<HTMLElement>('[data-question-highlight]')!;
    expect(parseFloat(mark.style.left)).toBe(300);
    expect(parseFloat(mark.style.width)).toBe(220);
    const marker = screen.getByRole('button', { name: '疑问：疑问 here' });
    expect(parseFloat(marker.style.left)).toBeGreaterThan(520);
  });

  it('opens the exact saved record and leaves reader navigation untouched', () => {
    const record = question('here');
    const onOpen = vi.fn();
    render(<QuestionMarkers bookKey='book' records={[record]} onOpen={onOpen} />);
    paint();
    fireEvent.click(screen.getByRole('button', { name: '疑问：疑问 here' }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(record);
    expect(doc.getSelection()?.rangeCount).toBe(0);
  });

  it('keeps adjacent question touch targets separate and inside the bottom page edge', () => {
    passageTop = 529;
    render(
      <QuestionMarkers
        bookKey='book'
        records={[question('first'), question('second')]}
        onOpen={vi.fn()}
      />,
    );
    paint();
    const markers = screen.getAllByRole('button');
    const tops = markers.map((marker) => parseFloat(marker.style.top));
    expect(Math.abs(tops[0]! - tops[1]!)).toBeGreaterThanOrEqual(44);
    for (const marker of markers) {
      expect(parseFloat(marker.style.top)).toBeGreaterThanOrEqual(120);
      expect(parseFloat(marker.style.top) + 44).toBeLessThanOrEqual(660);
      expect(parseFloat(marker.style.left) + 44).toBeLessThanOrEqual(760);
    }
  });

  const setNarrowPageLines = (
    lineRects: DOMRect[],
    sourceRect = new DOMRect(18, 80, 354, 24),
    followingRects: DOMRect[] = [],
  ) => {
    vi.spyOn(state.view!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 600));
    vi.spyOn(doc.defaultView!.frameElement!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 6894, 600),
    );
    pageViewport.style.overflow = 'hidden';
    vi.spyOn(pageViewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(18, 0, 354, 600));
    vi.spyOn(paragraph, 'getClientRects').mockReturnValue([
      new DOMRect(18, 80, 354, 100),
    ] as unknown as DOMRectList);
    const followingParagraph = doc.createElement('p');
    if (followingRects.length) {
      followingParagraph.textContent = 'The following paragraph continues here.';
      paragraph.after(followingParagraph);
    }
    const createRange = doc.createRange.bind(doc);
    vi.spyOn(doc, 'createRange').mockImplementation(() => {
      const range = createRange();
      range.getClientRects = () =>
        (range.startContainer === followingParagraph.firstChild
          ? followingRects
          : range.startContainer.nodeType === Node.TEXT_NODE && range.endOffset === 10
            ? [sourceRect]
            : lineRects) as unknown as DOMRectList;
      return range;
    });
    state.view!.resolveCFI = () => ({
      index: 1,
      anchor: () => {
        const range = doc.createRange();
        range.setStart(paragraph.firstChild!, 0);
        range.setEnd(paragraph.firstChild!, 10);
        return range;
      },
    });
  };

  it('uses the short paragraph ending when the narrow page has no right margin', () => {
    setNarrowPageLines([new DOMRect(18, 80, 354, 24), new DOMRect(18, 120, 29, 24)]);
    const record = question('here');
    const onOpen = vi.fn();
    render(<QuestionMarkers bookKey='book' records={[record]} onOpen={onOpen} />);
    paint();
    const marker = screen.getByRole('button', { name: '疑问：疑问 here' });
    expect(parseFloat(marker.style.top)).toBeGreaterThanOrEqual(104);
    expect(parseFloat(marker.style.top)).toBeLessThanOrEqual(144);
    expect(parseFloat(marker.style.left)).toBeGreaterThanOrEqual(53);
    expect(parseFloat(marker.style.left) + 44).toBeLessThanOrEqual(390);
    fireEvent.click(marker);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(record);
  });

  it('includes every glyph on a candidate line before using its apparent right whitespace', () => {
    setNarrowPageLines([
      new DOMRect(18, 80, 354, 24),
      new DOMRect(18, 120, 29, 24),
      new DOMRect(100, 120, 272, 24),
    ]);
    render(<QuestionMarkers bookKey='book' records={[question('here')]} onOpen={vi.fn()} />);
    paint();
    const marker = screen.getByRole('button', { name: '疑问：疑问 here' });
    expect(parseFloat(marker.style.top)).toBeGreaterThanOrEqual(144);
  });

  it('fits beside a short final line between the previous line and the following paragraph', () => {
    const previousLines = Array.from(
      { length: 22 },
      (_, index) => new DOMRect(18, 5 + index * 26, 354, 24),
    );
    setNarrowPageLines(
      [...previousLines, new DOMRect(18, 589, 29, 12)],
      new DOMRect(18, 551, 354, 24),
      [new DOMRect(18, 625, 354, 15)],
    );
    vi.spyOn(state.view!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 700));
    vi.spyOn(doc.defaultView!.frameElement!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 6894, 700),
    );
    vi.spyOn(pageViewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(18, 0, 354, 700));
    render(<QuestionMarkers bookKey='book' records={[question('here')]} onOpen={vi.fn()} />);
    paint();
    const marker = screen.getByRole('button', { name: '疑问：疑问 here' });
    const top = parseFloat(marker.style.top);
    expect(top).toBeGreaterThanOrEqual(577);
    expect(top + 44).toBeLessThanOrEqual(623);
    expect(top).toBeLessThan(601);
    expect(top + 44).toBeGreaterThan(589);
  });

  it('keeps the passage mark but hides the mascot when no visible blank area fits', () => {
    setNarrowPageLines([new DOMRect(18, 0, 354, 600)]);
    render(<QuestionMarkers bookKey='book' records={[question('here')]} onOpen={vi.fn()} />);
    paint();
    expect(screen.queryByRole('button', { name: '疑问：疑问 here' })).toBeNull();
    expect(document.querySelector('[data-question-highlight]')).not.toBeNull();
  });

  it.each([
    'scroll',
    'relocate',
  ])('repositions on %s and hides the marker after moving off the page', (eventName) => {
    render(<QuestionMarkers bookKey='book' records={[question('here')]} onOpen={vi.fn()} />);
    paint();
    const marker = screen.getByRole('button', { name: '疑问：疑问 here' });
    const originalTop = marker.style.top;
    act(() => {
      passageTop += 100;
      state.view!.renderer.dispatchEvent(new Event(eventName));
    });
    paint();
    expect(marker.style.top).not.toBe(originalTop);
    act(() => {
      passageTop = 900;
      state.view!.dispatchEvent(new Event('relocate'));
    });
    paint();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the name, purpose, and no-shortcut tooltip after 400ms', async () => {
    render(<QuestionMarkers bookKey='book' records={[question('here')]} onOpen={vi.fn()} />);
    paint();
    const marker = screen.getByRole('button', { name: '疑问：疑问 here' });
    fireEvent.pointerMove(marker, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(399));
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip').textContent).toContain('查看这个位置保存的疑问');
    expect(screen.getByRole('tooltip').textContent).toContain('无快捷键');
  });
});
