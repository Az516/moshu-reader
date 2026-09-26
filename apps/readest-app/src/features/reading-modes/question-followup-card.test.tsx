import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReadingData, ReadingRecord } from '../active-reading/data';
import { emptyReadingData } from '../active-reading/data';
import QuestionFollowup, { QuestionAnswerLink } from './QuestionFollowup';

const mocks = vi.hoisted(() => ({
  service: {},
  progress: {} as { range: Range; index: number; sectionLabel: string; location: string },
  view: { getCFI: vi.fn() },
  book: { hash: 'book', title: 'Alice in Wonderland', author: 'Lewis Carroll' },
  mutate: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.service }) }));
vi.mock('@/store/readerProgressStore', () => ({ useBookProgress: () => mocks.progress }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (value: unknown) => unknown) =>
    selector({ viewStates: { 'book-view': { view: mocks.view } } }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (value: unknown) => unknown) =>
    selector({ booksData: { book: { book: mocks.book } } }),
}));
vi.mock('../active-reading/data', async (original) => ({
  ...(await original<typeof import('../active-reading/data')>()),
  mutateReadingData: mocks.mutate,
}));

const question: ReadingRecord = {
  id: 'q1',
  kind: 'question',
  status: 'open',
  userText: 'Why does the rabbit carry a watch?',
  originalText: 'Why does the rabbit carry a watch?',
  revisions: [],
  source: {
    bookHash: 'book',
    excerpt: 'The rabbit took a watch out of its pocket.',
    cfi: 'epubcfi(/6/2!/4/2:0)',
  },
};
let saved: ReadingData;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  const book = document.implementation.createHTMLDocument('book');
  book.body.innerHTML =
    '<p>The rabbit checks the watch because the appointment is approaching.</p><p>A hidden rabbit also owns a watch.</p>';
  const range = book.createRange();
  range.selectNodeContents(book.querySelector('p')!);
  mocks.progress = { range, index: 0, sectionLabel: 'Chapter 1', location: 'later' };
  mocks.view.getCFI.mockReturnValue('epubcfi(/6/2!/4/8:0)');
  saved = { ...emptyReadingData('book'), records: [question] };
  mocks.mutate.mockImplementation(
    async (
      _service: unknown,
      _initial: ReadingData,
      mutate: (data: ReadingData) => ReadingData,
    ) => {
      saved = mutate(saved);
      return saved;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(700));
}

describe('nonmodal question follow-up', () => {
  it('shows an anchored local lead without moving focus or changing the question', async () => {
    const onOpenSource = vi.fn();
    render(
      <QuestionFollowup
        bookKey='book-view'
        records={[question]}
        enabled
        onResolved={vi.fn()}
        onOpenSource={onOpenSource}
      />,
    );
    const focusBefore = document.activeElement;
    await settle();
    expect(screen.getByText('这段可能与先前疑问有关')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(focusBefore);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.view.getCFI).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '回看疑问原文' }));
    expect(onOpenSource).toHaveBeenCalledWith(question.source);
  });

  it('saves only after explicit confirmation and links back to both sources', async () => {
    const onResolved = vi.fn();
    const onOpenSource = vi.fn();
    render(
      <QuestionFollowup
        bookKey='book-view'
        records={[question]}
        enabled
        onResolved={onResolved}
        onOpenSource={onOpenSource}
      />,
    );
    await settle();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '我确认已解答' })));
    expect(saved.records[0]).toMatchObject({ status: 'resolved', source: question.source });
    expect(saved.records[0]?.resolutionSource?.excerpt).toContain('appointment');
    expect(saved.records[0]?.resolutionSource?.excerpt).not.toContain('hidden');
    expect(saved.records[0]?.resolutionSource).toMatchObject({
      bookVersion: 'book-hash:book',
      title: mocks.book.title,
      author: mocks.book.author,
    });
    expect(onResolved).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '回到解答原文' }));
    expect(onOpenSource).toHaveBeenCalledWith(saved.records[0]?.resolutionSource);
  });

  it('keeps an open question and readable feedback when persistence fails', async () => {
    mocks.mutate.mockRejectedValueOnce(new Error('磁盘写入失败'));
    const onResolved = vi.fn();
    render(
      <QuestionFollowup
        bookKey='book-view'
        records={[question]}
        enabled
        onResolved={onResolved}
        onOpenSource={vi.fn()}
      />,
    );
    await settle();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '我确认已解答' })));
    expect(screen.getByRole('alert').textContent).toContain('磁盘写入失败');
    expect(saved.records[0]?.status).toBe('open');
    expect(onResolved).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: '我确认已解答' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('does not repeat a dismissed clue when the same page rerenders or is revisited', async () => {
    const props = {
      bookKey: 'book-view',
      records: [question],
      enabled: true,
      onResolved: vi.fn(),
      onOpenSource: vi.fn(),
    };
    const { rerender } = render(<QuestionFollowup {...props} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '暂不处理' }));
    mocks.progress = { ...mocks.progress, location: 'later-revisited' };
    rerender(<QuestionFollowup {...props} records={[{ ...question }]} />);
    await settle();
    expect(screen.queryByText('这段可能与先前疑问有关')).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('waits until reading overlays are closed and provides a reusable saved-answer link', async () => {
    render(
      <QuestionFollowup
        bookKey='book-view'
        records={[question]}
        enabled={false}
        onResolved={vi.fn()}
        onOpenSource={vi.fn()}
      />,
    );
    await settle();
    expect(screen.queryByText('这段可能与先前疑问有关')).toBeNull();
    const resolutionSource = { ...question.source!, cfi: 'epubcfi(/6/4!/4/2:0)' };
    const onOpenSource = vi.fn();
    render(
      <QuestionAnswerLink
        record={{ ...question, status: 'resolved', resolutionSource }}
        onOpenSource={onOpenSource}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '回到解答原文' }));
    expect(onOpenSource).toHaveBeenCalledWith(resolutionSource);
  });
});
