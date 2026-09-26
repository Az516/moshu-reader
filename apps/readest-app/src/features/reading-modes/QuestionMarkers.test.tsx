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
    const iframe = document.createElement('iframe');
    view.appendChild(iframe);
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
      'question-dot',
    );
    const resolved = screen.getByRole('button', { name: '已解决：疑问 resolved' });
    expect(resolved.dataset['status']).toBe('resolved');
    expect(resolved.classList.contains('moshu-question-marker')).toBe(true);
    expect(resolved.style.width).toBe('');
    expect(paragraph.innerHTML).toBe('当前原文，有一个待解决的问题。');
  });

  it('renders anchored questions on both visible pages of a two-page spread', () => {
    const view = state.view!;
    const leftFrame = view.querySelector('iframe')!;
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

  it('opens the exact saved record and leaves reader navigation untouched', () => {
    const record = question('here');
    const onOpen = vi.fn();
    render(<QuestionMarkers bookKey='book' records={[record]} onOpen={onOpen} />);
    paint();
    fireEvent.click(screen.getByRole('button', { name: '疑问：疑问 here' }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(record);
    expect(doc.getSelection()?.rangeCount).toBe(0);
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
