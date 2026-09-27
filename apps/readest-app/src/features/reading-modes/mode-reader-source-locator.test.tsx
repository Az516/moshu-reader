import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import { emptyReadingData, type ReadingData } from '../active-reading/data';
import type { SentenceGuideProps } from '../focus-guide/SentenceGuide';

const h = vi.hoisted(() => {
  const source = {
    bookHash: 'book',
    cfi: 'epubcfi(/6/2!/4/2:0)',
    chapter: '第一章',
    excerpt: '这是被引用的原文。',
  };
  const sourceStore = {
    origin: { bookHash: 'theme-book', cfi: 'epubcfi(/6/4)' } as {
      bookHash: string;
      cfi?: string;
    } | null,
    target: source as typeof source | null,
    setOrigin: vi.fn(),
    setTarget: vi.fn(),
  };
  sourceStore.setTarget.mockImplementation((target: typeof source | null) => {
    sourceStore.target = target;
  });
  sourceStore.setOrigin.mockImplementation((origin: { bookHash: string; cfi?: string } | null) => {
    sourceStore.origin = origin;
  });
  return {
    request: null as null | {
      bookKey: string;
      handled: boolean;
      source: typeof source;
      action?: 'ask' | 'question';
    },
    appService: null as AppService | null,
    onDwell: null as SentenceGuideProps['onDwell'] | null,
    readingData: null as ReadingData | null,
    mutateReadingData:
      vi.fn<
        (
          service: AppService,
          initial: ReadingData,
          mutate: (data: ReadingData) => ReadingData,
        ) => Promise<ReadingData>
      >(),
    clearHighlight: vi.fn(),
    goTo: vi.fn(async () => undefined),
    highlight: vi.fn(),
    source,
    sourceStore,
  };
});

vi.mock('@/app/reader/utils/transientHighlight', () => ({
  showTransientHighlight: h.highlight,
}));

vi.mock('./source-return', () => {
  const useThemeSourceReturn = <T,>(selector: (state: typeof h.sourceStore) => T) =>
    selector(h.sourceStore);
  useThemeSourceReturn.getState = () => h.sourceStore;
  return { useThemeSourceReturn };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService, envConfig: {} }),
}));

vi.mock('../active-reading/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../active-reading/data')>()),
  loadReadingData: async (_service: AppService, initial: ReadingData) => h.readingData || initial,
  mutateReadingData: h.mutateReadingData,
}));

vi.mock('./state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./state')>();
  return { ...actual, loadModeState: async () => actual.emptyModeState('book') };
});

vi.mock('@/store/bookDataStore', () => {
  const state = {
    booksData: {
      book: {
        book: { title: '测试书', author: '作者' },
        bookDoc: { toc: [] },
        config: { booknotes: [] },
      },
    },
    getConfig: vi.fn(() => null),
    setConfig: vi.fn(),
  };
  const useBookDataStore = <T,>(selector: (value: typeof state) => T) => selector(state);
  useBookDataStore.getState = () => state;
  return { useBookDataStore };
});

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({
    fraction: 0.1,
    index: 0,
    page: 1,
    sectionHref: 'chapter-1.xhtml',
    sectionLabel: '第一章',
  }),
}));

vi.mock('@/store/readerStore', () => {
  const view = {
    goTo: h.goTo,
    getSectionFractions: () => [0, 1],
    lastLocation: { cfi: 'epubcfi(/6/4)' },
    renderer: { getContents: () => [] },
  };
  const state = {
    viewStates: {
      'book-view': {
        inited: true,
        view,
        viewSettings: { spreadMode: 'none' },
      },
    },
    getViewState: vi.fn(),
    getViewSettings: vi.fn(),
    getView: vi.fn(),
  };
  const useReaderStore = <T,>(selector: (value: typeof state) => T) => selector(state);
  useReaderStore.getState = () => state;
  return { useReaderStore };
});

vi.mock('@/store/sidebarStore', () => {
  const state = {
    isSideBarVisible: false,
    isSideBarPinned: false,
    setSideBarVisible: vi.fn(),
    setSideBarBookKey: vi.fn(),
  };
  const useSidebarStore = <T,>(selector: (value: typeof state) => T) => selector(state);
  useSidebarStore.getState = () => state;
  return { useSidebarStore };
});

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: { getState: () => ({ setNotebookVisible: vi.fn() }) },
}));

vi.mock('../active-reading/session', () => {
  const useReadingSession = <T,>(selector: (value: { request: typeof h.request }) => T) =>
    selector({ request: h.request });
  useReadingSession.setState = vi.fn();
  return { sourceFromSelection: vi.fn(), useReadingSession };
});
vi.mock('./DialogueCard', () => ({
  default: () => <section data-modian-dialogue>对话正在等待本地保存</section>,
}));

vi.mock('./useReaderChrome', () => ({
  useReaderChrome: () => ({ reveal: vi.fn(), visible: true }),
}));

vi.mock('./useViewportWidth', () => ({ useViewportWidth: () => 1200 }));
vi.mock('./useChapterCapture', () => ({
  useChapterCapture: () => ({ capture: '', clearDraft: vi.fn(), setCapture: vi.fn() }),
}));
vi.mock('../focus-guide/SentenceGuide', () => ({
  default: ({ onDwell }: SentenceGuideProps) => {
    h.onDwell = onDwell;
    return null;
  },
}));
vi.mock('./DwellNudge', () => ({
  default: ({ onOpen }: { onOpen: () => void }) => <button onClick={onOpen}>打开停留提醒</button>,
}));
vi.mock('./QuestionFollowup', () => ({
  default: () => null,
  QuestionAnswerLink: () => null,
}));

import ModeReader from './ModeReader';

describe('ModeReader thematic source locator', () => {
  beforeEach(() => {
    localStorage.removeItem('moshu-question-marker-style');
    h.goTo.mockClear();
    h.highlight.mockReset();
    h.clearHighlight.mockClear();
    h.sourceStore.origin = { bookHash: 'theme-book', cfi: 'epubcfi(/6/4)' };
    h.sourceStore.target = h.source;
    h.sourceStore.setTarget.mockClear();
    h.request = null;
    h.appService = null;
    h.onDwell = null;
    h.readingData = null;
    h.mutateReadingData.mockReset();
    h.mutateReadingData.mockImplementation(async (_service, initial, mutate) => {
      h.readingData = mutate(h.readingData || initial);
      return h.readingData;
    });
  });

  afterEach(() => cleanup());

  it('saves a selection question locally without opening an AI conversation', async () => {
    h.appService = {} as AppService;
    h.sourceStore.target = null;
    h.request = { bookKey: 'book-view', handled: false, source: h.source, action: 'question' };

    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );

    await waitFor(() => expect(h.readingData?.records).toHaveLength(1));
    expect(h.readingData?.records[0]).toMatchObject({
      kind: 'question',
      status: 'open',
      source: h.source,
      markerStyle: 'underline',
    });
    expect(screen.queryByText('对话正在等待本地保存')).toBeNull();
    expect((await screen.findByRole('status')).textContent).toContain('疑问已留在原文页边');
  });

  it.each([
    'squiggly',
    'highlight',
  ] as const)('uses the remembered %s style for a new toolbar question', async (markerStyle) => {
    localStorage.setItem('moshu-question-marker-style', markerStyle);
    h.appService = {} as AppService;
    h.sourceStore.target = null;
    h.request = { bookKey: 'book-view', handled: false, source: h.source, action: 'question' };

    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );

    await waitFor(() => expect(h.readingData?.records).toHaveLength(1));
    expect(h.readingData?.records[0]?.markerStyle).toBe(markerStyle);
  });

  it('changes the current question style and remembers it for the next question after reopening', async () => {
    h.appService = {} as AppService;
    h.sourceStore.target = null;
    const existing = {
      id: 'question-to-style',
      kind: 'question' as const,
      status: 'open' as const,
      source: h.source,
      userText: '我想保留的疑问',
      originalText: '我想保留的疑问',
      revisions: [],
    };
    h.readingData = { ...emptyReadingData('book'), records: [existing] };
    const reader = render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '笔记与疑问 · 1', hidden: true }));
    fireEvent.click(screen.getByRole('button', { name: '查看记录' }));
    expect(screen.getByRole('radio', { name: '横线' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: '波浪线' }));

    await waitFor(() => expect(h.readingData?.records[0]?.markerStyle).toBe('squiggly'));
    expect(h.readingData?.records[0]).toMatchObject(existing);
    expect(localStorage.getItem('moshu-question-marker-style')).toBe('squiggly');
    expect(screen.getByRole('radio', { name: '波浪线' }).getAttribute('aria-checked')).toBe('true');
    reader.unmount();
    h.request = {
      bookKey: 'book-view',
      handled: false,
      action: 'question',
      source: { ...h.source, cfi: 'epubcfi(/6/4!/4/2:0)' },
    };
    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );
    await waitFor(() => expect(h.readingData?.records).toHaveLength(2));
    expect(h.readingData?.records[1]?.markerStyle).toBe('squiggly');
  });

  it('keeps the existing question and default unchanged when changing its style fails', async () => {
    localStorage.setItem('moshu-question-marker-style', 'highlight');
    h.appService = {} as AppService;
    h.sourceStore.target = null;
    h.readingData = {
      ...emptyReadingData('book'),
      records: [
        {
          id: 'existing-question',
          kind: 'question',
          status: 'open',
          source: h.source,
          userText: '原来的疑问',
          originalText: '原来的疑问',
          revisions: [],
          markerStyle: 'underline',
        },
      ],
    };
    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '笔记与疑问 · 1', hidden: true }));
    fireEvent.click(screen.getByRole('button', { name: '查看记录' }));
    expect(screen.getByRole('radio', { name: '横线' }).getAttribute('aria-checked')).toBe('true');
    h.mutateReadingData.mockRejectedValueOnce(new Error('本地空间不足'));

    fireEvent.click(screen.getByRole('radio', { name: '波浪线' }));

    expect((await screen.findByRole('status')).textContent).toContain('本地空间不足');
    expect(h.readingData.records[0]?.markerStyle).toBe('underline');
    expect(localStorage.getItem('moshu-question-marker-style')).toBe('highlight');
  });

  it.each([
    [null, '横线'],
    ['highlight', '高亮'],
  ] as const)('starts the dwell picker from preference %s and remembers a new choice', async (preference, label) => {
    if (preference) localStorage.setItem('moshu-question-marker-style', preference);
    h.appService = {} as AppService;
    h.sourceStore.target = null;
    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );
    act(() => h.onDwell?.(h.source, { x: 100, y: 100, lineTop: 90, lineBottom: 110 }));
    fireEvent.click(screen.getByRole('button', { name: '打开停留提醒' }));
    expect(screen.getByRole('radio', { name: label }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: '波浪线' }));
    expect(localStorage.getItem('moshu-question-marker-style')).toBe('squiggly');
    fireEvent.click(screen.getByRole('button', { name: '留下疑问' }));

    await waitFor(() => expect(h.readingData?.records).toHaveLength(1));
    expect(h.readingData?.records[0]?.markerStyle).toBe('squiggly');
  });

  it.each([
    'open',
    'resolved',
  ] as const)('keeps an existing %s question intact when the same selection is marked again', async (status) => {
    h.appService = {} as AppService;
    h.sourceStore.target = null;
    const existing = {
      id: 'existing-question',
      kind: 'question' as const,
      status,
      source: h.source,
      userText: '我已经写下的具体疑问',
      originalText: '原来的疑问',
      revisions: [],
    };
    h.readingData = { ...emptyReadingData('book'), records: [existing] };
    h.request = { bookKey: 'book-view', handled: false, source: h.source, action: 'question' };

    const reader = render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );
    await waitFor(() => expect(h.mutateReadingData).toHaveBeenCalledTimes(1));
    h.request = { ...h.request, handled: false };
    reader.rerender(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );
    await waitFor(() => expect(h.mutateReadingData).toHaveBeenCalledTimes(2));

    expect(h.readingData?.records).toEqual([existing]);
    expect(screen.queryByText('对话正在等待本地保存')).toBeNull();
  });

  it('keeps ask requests as conversations without saving a question', async () => {
    h.appService = {} as AppService;
    h.sourceStore.target = null;
    h.request = { bookKey: 'book-view', handled: false, source: h.source, action: 'ask' };

    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );

    await waitFor(() => expect(screen.getByText('对话正在等待本地保存')).not.toBeNull());
    expect(h.mutateReadingData).not.toHaveBeenCalled();
  });

  it('reports a failed local save without claiming the question was saved', async () => {
    h.appService = {} as AppService;
    h.sourceStore.target = null;
    h.mutateReadingData.mockRejectedValueOnce(new Error('本地空间不足，请重试。'));
    h.request = { bookKey: 'book-view', handled: false, source: h.source, action: 'question' };

    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        正文
      </ModeReader>,
    );

    expect((await screen.findByRole('status')).textContent).toContain('本地空间不足，请重试。');
    expect(h.readingData).toBeNull();
    expect(screen.queryByText('对话正在等待本地保存')).toBeNull();
  });

  it('lets the dialogue finish or retry its local save before Escape can close it', async () => {
    h.request = { bookKey: 'book-view', handled: false, source: h.source };
    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        <div>正文</div>
      </ModeReader>,
    );
    await waitFor(() => expect(screen.getByText('对话正在等待本地保存')).not.toBeNull());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('对话正在等待本地保存')).not.toBeNull();
  });

  it('高亮失败时不宣称已定位，并保留目标以便重试', async () => {
    h.highlight.mockResolvedValue(null);

    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        <div>正文</div>
      </ModeReader>,
    );

    await waitFor(() => expect(h.highlight).toHaveBeenCalled());
    expect(screen.queryByText('已定位')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('没有定位到精确句子');
    expect(h.sourceStore.target).toEqual(h.source);
    expect(h.sourceStore.setTarget).not.toHaveBeenCalledWith(null);
  });

  it('高亮成功时才显示已定位，且可手动关闭持久标记', async () => {
    h.highlight.mockResolvedValue(h.clearHighlight);

    render(
      <ModeReader bookKey='book-view' onLibrary={vi.fn()}>
        <div>正文</div>
      </ModeReader>,
    );

    await waitFor(() => expect(screen.getByText('已定位')).not.toBeNull());
    expect(h.sourceStore.target).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '关闭原文标记', hidden: true }));
    expect(h.clearHighlight).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已定位')).toBeNull();
  });
});
