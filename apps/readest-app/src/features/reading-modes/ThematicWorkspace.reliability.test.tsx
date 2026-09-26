import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResearch, type ThematicResearch } from './thematic';
import ThematicWorkspace from './ThematicWorkspace';

const h = vi.hoisted(() => ({
  service: { loadBookNav: vi.fn(), loadBookConfig: vi.fn() },
  load: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
  stream: vi.fn(),
  index: vi.fn(),
  search: vi.fn(),
  review: vi.fn(),
  library: [{ hash: 'book', title: '测试书', author: '作者' }],
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: h.service }) }));
vi.mock('@/store/libraryStore', () => {
  const state = { library: h.library, libraryLoaded: true };
  const useLibraryStore = <T,>(selector: (value: typeof state) => T) => selector(state);
  useLibraryStore.getState = () => state;
  return { useLibraryStore };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: { getState: () => ({ getBookData: () => null }) },
}));
vi.mock('@/store/settingsStore', () => {
  const state = { settings: {} };
  return {
    useSettingsStore: Object.assign((select: (value: typeof state) => unknown) => select(state), {
      getState: () => state,
    }),
  };
});
vi.mock('../active-reading/data', async (original) => ({
  ...(await original<typeof import('../active-reading/data')>()),
  loadReadingData: async () => ({ records: [] }),
}));
vi.mock('./thematic', async (original) => ({
  ...(await original<typeof import('./thematic')>()),
  loadThematicResearch: h.load,
  saveThematicResearch: h.save,
  listThematicResearch: h.list,
  streamThematicAnswer: h.stream,
}));
vi.mock('./thematic-passages', () => ({
  buildPassageIndex: h.index,
  searchPassages: h.search,
  searchPassagesAsync: h.search,
}));
vi.mock('./research-assistant', () => ({
  expandResearchQuery: async () => [],
  rerankResearchEvidence: async () => ({ evidence: [], reviewed: true }),
  reviewResearchCitations: h.review,
}));
vi.mock('./dialogue', () => ({
  derivePublicSearchQuery: (query: string) => query,
  searchPublicSources: async () => [],
}));

function study(question = '如何理解人生', failed = false): ThematicResearch {
  return {
    ...createResearch('book'),
    question,
    messages: [
      { id: `q1:${question}`, questionId: 'main', role: 'user', text: question, passageIds: [] },
      {
        id: 'a1',
        questionId: 'main',
        role: 'modian',
        text: '先明确价值与责任。',
        passageIds: [],
        status: 'complete',
      },
      ...(failed
        ? [
            {
              id: 'q2',
              questionId: 'main',
              role: 'user' as const,
              text: '为什么这样判断？',
              passageIds: [],
            },
            {
              id: 'a2',
              questionId: 'main',
              role: 'modian' as const,
              text: '未完成',
              passageIds: [],
              status: 'error' as const,
            },
          ]
        : []),
    ],
  };
}
async function open(initial = study()) {
  h.load.mockResolvedValue(initial);
  const onReturnToBook = vi.fn();
  render(
    <ThematicWorkspace
      bookKey='book-view'
      onReturnToBook={onReturnToBook}
      onOpenSource={vi.fn()}
    />,
  );
  await screen.findByLabelText('继续追问');
  return { onReturnToBook };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  h.service.loadBookNav.mockResolvedValue({ toc: [] });
  h.service.loadBookConfig.mockResolvedValue({ booknotes: [] });
  h.save.mockResolvedValue(undefined);
  h.list.mockResolvedValue([]);
  h.stream.mockResolvedValue({ text: '新的回答', model: 'mock' });
  h.index.mockResolvedValue({ passages: [], warnings: [] });
  h.search.mockResolvedValue([]);
  h.review.mockImplementation(async (text: string) => ({ text, reviewed: true, needed: false }));
});

describe('主题会话本地可靠性', () => {
  it('restores a failed follow-up and retries it without making a new empty topic', async () => {
    await open(study('如何理解人生', true));
    fireEvent.click(await screen.findByRole('button', { name: '重新回答' }));
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(1));
    const [query, , history] = h.stream.mock.calls[0]!;
    expect(query).toBe('为什么这样判断？');
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: '如何理解人生', role: 'user' }),
        expect.objectContaining({ text: '先明确价值与责任。', role: 'modian' }),
      ]),
    );
    await screen.findByText('新的回答');
    const lastSaved = h.save.mock.calls.at(-1)?.[1] as ThematicResearch;
    expect(lastSaved.question).toBe('如何理解人生');
    expect(lastSaved.messages.filter((m) => m.text === '为什么这样判断？')).toHaveLength(1);
    expect(h.save.mock.calls.every(([, data]) => data.id === 'book')).toBe(true);
  });

  it('does not carry a failed request into a different history topic', async () => {
    h.list.mockResolvedValue([{ ...study('另一个主题'), id: 'history-b' }]);
    await open();
    h.stream.mockRejectedValueOnce(new Error('模拟断网'));
    fireEvent.change(screen.getByLabelText('继续追问'), { target: { value: '为什么这样判断？' } });
    fireEvent.submit(screen.getByLabelText('继续追问').closest('form')!);
    await screen.findByRole('button', { name: '重新回答' });
    fireEvent.click(
      within(screen.getByTestId('thematic-history-panel')).getByRole('button', {
        name: /另一个主题/,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '历史主题' })).toBeNull());
    expect(screen.queryByRole('button', { name: '重新回答' })).toBeNull();
    expect(screen.queryByText('为什么这样判断？')).toBeNull();
  });

  it('does not generate while a sidebar topic switch is waiting for its local save', async () => {
    h.list.mockResolvedValue([{ ...study('另一个主题'), id: 'history-b' }]);
    await open();
    let releaseSave!: () => void;
    h.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    fireEvent.click(
      within(screen.getByTestId('thematic-history-panel')).getByRole('button', {
        name: /另一个主题/,
      }),
    );
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    const composer = screen.getByLabelText('继续追问');
    fireEvent.change(composer, { target: { value: '切换期间不应发送' } });
    // Dispatching the form directly also checks the request guard, beyond disabled controls.
    fireEvent.submit(composer.closest('form')!);
    await act(async () => {});
    expect(h.stream).not.toHaveBeenCalled();
    expect(screen.getByText('如何理解人生', { selector: '.thematic-message p' })).not.toBeNull();
    await act(async () => {
      releaseSave();
    });
    await screen.findByText('另一个主题', { selector: '.thematic-message p' });
    expect(h.stream).not.toHaveBeenCalled();
  });

  it('keeps the current topic and conversation context when the target topic cannot be saved', async () => {
    h.list.mockResolvedValue([{ ...study('另一个主题'), id: 'history-b' }]);
    await open();
    h.save.mockImplementation(async (_service: unknown, next: ThematicResearch) => {
      if (next.id === 'book' && next.question === '另一个主题') throw new Error('磁盘已满');
    });
    fireEvent.click(
      within(screen.getByTestId('thematic-history-panel')).getByRole('button', {
        name: /另一个主题/,
      }),
    );
    await screen.findByText('当前主题未能保存，暂未切换，请重试。');
    expect(screen.getByText('如何理解人生', { selector: '.thematic-message p' })).not.toBeNull();
    expect(screen.queryByText('另一个主题', { selector: '.thematic-message p' })).toBeNull();
    fireEvent.change(screen.getByLabelText('继续追问'), { target: { value: '继续当前主题' } });
    fireEvent.submit(screen.getByLabelText('继续追问').closest('form')!);
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(1));
    const history = h.stream.mock.calls[0]![2] as ThematicResearch['messages'];
    expect(history.some((message) => message.text === '如何理解人生')).toBe(true);
    expect(history.some((message) => message.text === '另一个主题')).toBe(false);
    await screen.findByText('新的回答');
  });

  it('retries only the local save after a completed answer fails to persist', async () => {
    const { onReturnToBook } = await open();
    h.save.mockImplementation(async (_service: unknown, next: ThematicResearch) => {
      if (next.messages.at(-1)?.text === '新的回答') throw new Error('磁盘已满');
    });
    fireEvent.change(screen.getByLabelText('继续追问'), { target: { value: '为什么？' } });
    fireEvent.submit(screen.getByLabelText('继续追问').closest('form')!);
    const retrySave = await screen.findByRole('button', { name: '重新保存' });
    expect(h.stream).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '回到正文' }));
    await act(async () => {});
    expect(onReturnToBook).not.toHaveBeenCalled();
    h.save.mockResolvedValue(undefined);
    fireEvent.click(retrySave);
    await waitFor(() => expect(screen.queryByRole('button', { name: '重新保存' })).toBeNull());
    expect(screen.getByText('已保存在本机')).not.toBeNull();
    expect(h.stream).toHaveBeenCalledTimes(1);
    expect((h.save.mock.calls.at(-1)?.[1] as ThematicResearch).messages.at(-1)?.text).toBe(
      '新的回答',
    );
  });

  it('retains older stopped answers when retrying only the latest failed message', async () => {
    const initial = study('如何理解人生', true);
    initial.messages[1]!.status = 'stopped';
    await open(initial);
    fireEvent.click(screen.getByRole('button', { name: '重新回答' }));
    await screen.findByText('新的回答');
    const saved = h.save.mock.calls.at(-1)?.[1] as ThematicResearch;
    expect(saved.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a1', text: '先明确价值与责任。', status: 'stopped' }),
      ]),
    );
    expect(saved.messages.some((message) => message.id === 'a2')).toBe(false);
  });

  it('offers retry after reopening an interrupted streaming checkpoint', async () => {
    const initial = study('如何理解人生', true);
    initial.messages.at(-1)!.status = 'streaming';
    await open(initial);
    expect(screen.getByRole('button', { name: '重新回答' })).not.toBeNull();
    expect(screen.getByText('已停止 · 已保留生成内容')).not.toBeNull();
  });

  it('keeps a finished answer complete when source checking is stopped', async () => {
    await open();
    h.review.mockImplementation(
      (_text: string, _evidence: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    fireEvent.change(screen.getByLabelText('继续追问'), { target: { value: '为什么？' } });
    fireEvent.submit(screen.getByLabelText('继续追问').closest('form')!);
    await waitFor(() => expect(h.review).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '停止回答' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '停止回答' })).toBeNull());
    const saved = h.save.mock.calls.at(-1)?.[1] as ThematicResearch;
    expect(saved.messages.at(-1)).toMatchObject({
      text: '新的回答',
      status: 'complete',
      sourceReview: 'unavailable',
    });
    expect(screen.queryByRole('button', { name: '继续生成' })).toBeNull();
  });

  it('checkpoints partial output and protects leaving while generation is active', async () => {
    const { onReturnToBook } = await open();
    h.stream.mockImplementation(
      (
        _query: string,
        _evidence: unknown,
        _history: unknown,
        signal: AbortSignal,
        onToken: (text: string) => void,
      ) =>
        new Promise((_resolve, reject) => {
          onToken('尚未完成的内容');
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    fireEvent.change(screen.getByLabelText('继续追问'), { target: { value: '接着讨论' } });
    fireEvent.submit(screen.getByLabelText('继续追问').closest('form')!);
    await screen.findByText('尚未完成的内容');
    await waitFor(() =>
      expect(
        h.save.mock.calls.some(
          (call) => (call[1] as ThematicResearch).messages.at(-1)?.status === 'streaming',
        ),
      ).toBe(true),
    );
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '回到正文' }));
    expect(onReturnToBook).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '停止回答' }));
    await screen.findByRole('button', { name: '重新回答' });
  });

  it('does not leave after an older save finishes if a newer question is in flight', async () => {
    const { onReturnToBook } = await open();
    h.save.mockImplementation(async (_service: unknown, next: ThematicResearch) => {
      if (next.messages.at(-1)?.text === '新的回答') throw new Error('磁盘已满');
    });
    fireEvent.change(screen.getByLabelText('继续追问'), { target: { value: '第一追问' } });
    fireEvent.submit(screen.getByLabelText('继续追问').closest('form')!);
    await screen.findByRole('button', { name: '重新保存' });
    let releaseSave: () => void = () => {};
    h.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '回到正文' }));
    h.stream.mockImplementation(
      (_query: string, _evidence: unknown, _history: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    fireEvent.change(screen.getByLabelText('继续追问'), { target: { value: '第二追问' } });
    fireEvent.submit(screen.getByLabelText('继续追问').closest('form')!);
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    await act(async () => {
      releaseSave();
    });
    expect(onReturnToBook).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '停止回答' }));
    await screen.findByRole('button', { name: '重新回答' });
  });

  it('keeps the current topic when archiving it fails before a new topic', async () => {
    await open();
    h.save.mockRejectedValue(new Error('磁盘已满'));
    fireEvent.click(screen.getByText('新主题', { selector: 'button' }));
    const question = await screen.findByLabelText('主题或问题');
    fireEvent.change(question, { target: { value: '一个新问题' } });
    fireEvent.submit(question.closest('form')!);
    await screen.findByText('当前主题尚未归档，请重试保存后再开始新主题。');
    expect(h.stream).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '回到上个主题' }));
    expect(screen.getByText('先明确价值与责任。')).not.toBeNull();
    expect(screen.queryByText('一个新问题', { selector: '.thematic-message p' })).toBeNull();
  });

  it.each([
    true,
    false,
  ])('restores book dialog focus with prior trigger focus: %s', async (focused) => {
    await open({ ...study(), selectedBooks: ['book'] });
    const trigger = screen.getByRole('button', { name: '调整书目' });
    if (focused) trigger.focus();
    else expect(document.activeElement).not.toBe(trigger);
    // fireEvent.click leaves focus unchanged, like a macOS WebKit pointer click.
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '调整研究书目' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const done = within(dialog).getByRole('button', { name: '完成' });
    done.focus();
    fireEvent.keyDown(done, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '关闭书目' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('restores history focus to the visible menu summary after a pointer click', async () => {
    await open();
    const summary = screen.getByLabelText('更多主题阅读操作');
    const menu = summary.closest('details')!;
    menu.open = true;
    expect(document.activeElement).not.toBe(summary);
    fireEvent.click(screen.getByRole('button', { name: '历史主题' }));
    const dialog = await screen.findByRole('dialog', { name: '历史主题' });
    expect(menu.open).toBe(false);
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '关闭主题历史' }), {
      key: 'Escape',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(summary));
  });

  it.each([
    'Escape',
    'close',
  ])('restores a pointer-clicked citation after %s without prior focus', async (closeWith) => {
    const initial = study();
    initial.messages[1] = {
      ...initial.messages[1]!,
      text: '这段原文支持上述理解。[1]',
      citationMap: ['evidence-1'],
      passageIds: ['evidence-1'],
    };
    initial.cells = {
      'main:book': {
        proposition: '',
        evidence: [
          {
            id: 'evidence-1',
            source: { bookHash: 'book', title: '测试书', chapter: '第一章', excerpt: '原文内容' },
            readingNote: '',
          },
        ],
      },
    };
    await open(initial);
    const trigger = screen.getByRole('button', { name: '查看引用 1' });
    screen.getByLabelText('继续追问').focus();
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '引用来源' });
    const close = within(dialog).getByRole('button', { name: /关闭引用/ });
    await waitFor(() => expect(document.activeElement).toBe(close));
    if (closeWith === 'Escape') fireEvent.keyDown(close, { key: 'Escape' });
    else fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
