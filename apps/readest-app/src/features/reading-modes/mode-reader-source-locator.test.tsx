import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    request: null as null | { bookKey: string; handled: boolean; source: typeof source },
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
  useEnv: () => ({ appService: null, envConfig: {} }),
}));

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
vi.mock('./SentenceGuide', () => ({ default: () => null }));
vi.mock('./QuestionFollowup', () => ({
  default: () => null,
  QuestionAnswerLink: () => null,
}));

import ModeReader from './ModeReader';

describe('ModeReader thematic source locator', () => {
  beforeEach(() => {
    h.goTo.mockClear();
    h.highlight.mockReset();
    h.clearHighlight.mockClear();
    h.sourceStore.origin = { bookHash: 'theme-book', cfi: 'epubcfi(/6/4)' };
    h.sourceStore.target = h.source;
    h.sourceStore.setTarget.mockClear();
    h.request = null;
  });

  afterEach(() => cleanup());

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
