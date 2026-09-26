import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { emptyReadingData, type ReadingData } from '../active-reading/data';
import DialogueCard from './DialogueCard';
import { createDialogueConversation } from './dialogue-history';

const mocks = vi.hoisted(() => ({
  service: {},
  ask: vi.fn(),
  load: vi.fn(),
  mutate: vi.fn(),
  search: vi.fn(),
  loadDialogues: vi.fn(),
  saveDialogue: vi.fn(),
  review: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.service }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({ booksData: { book: { book: { title: '样书', author: '作者' } } } }),
}));
vi.mock('../active-reading/ai', () => ({ askReadingAI: mocks.ask }));
vi.mock('./dialogue-history', async (original) => ({
  ...(await original<typeof import('./dialogue-history')>()),
  loadDialogueFile: mocks.loadDialogues,
  saveDialogueConversation: mocks.saveDialogue,
}));
vi.mock('./research-assistant', () => ({ reviewResearchCitations: mocks.review }));
vi.mock('../active-reading/data', async (original) => ({
  ...(await original<typeof import('../active-reading/data')>()),
  loadReadingData: mocks.load,
  mutateReadingData: mocks.mutate,
}));
vi.mock('./dialogue', async (original) => ({
  ...(await original<typeof import('./dialogue')>()),
  searchPublicSources: mocks.search,
}));

const source = {
  bookHash: 'book',
  excerpt: '只有理解作者的问题，才可能准确评价他的答案。',
  cfi: 'epubcfi(/6/2)',
  chapter: '第一章',
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(emptyReadingData('book'));
  mocks.loadDialogues.mockResolvedValue({ version: 1, bookHash: 'book', conversations: [] });
  mocks.saveDialogue.mockImplementation(async (_service, bookHash, conversation) => ({
    version: 1,
    bookHash,
    conversations: [conversation],
  }));
  mocks.review.mockImplementation(async (text: string) => ({ text, reviewed: true, needed: true }));
  mocks.mutate.mockImplementation(
    async (_service: unknown, initial: ReadingData, mutate: (data: ReadingData) => ReadingData) =>
      mutate(initial),
  );
  mocks.ask.mockResolvedValue({ text: '先看看作者给出的条件。', model: 'test-model' });
  mocks.search.mockResolvedValue([
    {
      title: '易到用车近况',
      url: 'https://example.com/yidao',
      excerpt: '截至 2025 年的公开报道摘要。',
      provider: '网页检索',
      retrievedAt: '2026-09-23T00:00:00.000Z',
      publishedAt: '2025-02-20T00:00:00.000Z',
    },
  ]);
});

describe('小墨浮动对话', () => {
  it('focuses the composer as soon as the dialogue opens', async () => {
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('输入消息')));
  });

  it('uses a normal chat layout with the selected passage as collapsible context', () => {
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('log', { name: '对话消息' })).not.toBeNull();
    expect(screen.getByText('本次引用 · 第一章')).not.toBeNull();
    expect(screen.queryByText('写下你的问题或想法')).toBeNull();
    expect(screen.queryByText('回答分区：书中原文 / 公开资料 / 小墨推断')).toBeNull();
    expect(screen.getByLabelText('输入消息')).not.toBeNull();
    expect(screen.getByRole('button', { name: '发送' })).not.toBeNull();
    expect(screen.queryByText(/作者的结论是什么/)).toBeNull();
    expect(screen.getByRole('button', { name: '标记疑问' }).getAttribute('data-marker-kind')).toBe(
      'question',
    );
    expect(screen.getByRole('button', { name: '标记笔记' }).getAttribute('data-marker-kind')).toBe(
      'note',
    );
    expect(screen.getByText('疑问')).not.toBeNull();
    expect(screen.getByText('笔记')).not.toBeNull();
    expect(screen.getByRole('heading', { name: '与小墨对话' })).not.toBeNull();
  });

  it('lets an anchored passage be marked before the reader types', async () => {
    const onSaved = vi.fn();
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={onSaved} onClose={vi.fn()} />,
    );
    const marker = screen.getByRole('button', { name: '标记笔记' });
    expect((marker as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(marker));
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'understanding',
        source,
        userText: '这句话我想稍后再看。',
      }),
    );
  });

  it('restores an existing passage marker and cancels it after reopening', async () => {
    const persisted = emptyReadingData('book');
    persisted.records.push({
      id: 'saved-question',
      kind: 'question',
      status: 'open',
      userText: '这句话是什么意思？',
      originalText: '这句话是什么意思？',
      revisions: [],
      source,
    });
    mocks.load.mockResolvedValue(persisted);
    mocks.mutate.mockImplementation(
      async (
        _service: unknown,
        _initial: ReadingData,
        mutate: (data: ReadingData) => ReadingData,
      ) => mutate(persisted),
    );
    const onRemoved = vi.fn();
    render(
      <DialogueCard
        bookKey='book-view'
        source={source}
        onSaved={vi.fn()}
        onRemoved={onRemoved}
        onClose={vi.fn()}
      />,
    );
    const cancel = await screen.findByRole('button', { name: '取消疑问标记' });
    expect(cancel.getAttribute('aria-pressed')).toBe('true');
    await act(async () => fireEvent.click(cancel));
    expect(onRemoved).toHaveBeenCalledWith('saved-question');
  });

  it('saves the reader’s understanding without requiring a model connection', async () => {
    const onSaved = vi.fn();
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={onSaved} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), {
      target: { value: '作者先提出条件，再给出结论。' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '标记笔记' })));
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'understanding', userText: '作者先提出条件，再给出结论。' }),
    );
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('keeps the explicit note action as a note even when its text contains a question', async () => {
    const onSaved = vi.fn();
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={onSaved} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), {
      target: { value: '为什么作者先提条件？这里先记下。' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '标记笔记' })));
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'understanding', status: 'kept' }),
    );
  });
  it('persists an anchored question before closing the card', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={onSaved} onClose={onClose} />,
    );
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('输入消息'), {
      target: { value: '这个前提是否充分？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '标记疑问' }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'question',
          status: 'open',
          source,
          userText: '这个前提是否充分？',
        }),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it.each([
    ['疑问', '标记疑问', '取消疑问标记', '已标记为疑问', '已取消疑问标记'],
    ['笔记', '标记笔记', '取消笔记标记', '已标记为笔记', '已取消笔记标记'],
  ] as const)('shows a reversible %s marker instead of saving duplicates', async (_kind, saveLabel, cancelLabel, savedMessage, removedMessage) => {
    const onSaved = vi.fn();
    const onRemoved = vi.fn();
    render(
      <DialogueCard
        bookKey='book-view'
        source={source}
        onSaved={onSaved}
        onRemoved={onRemoved}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '先留在这里。' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: saveLabel })));
    const saved = onSaved.mock.calls[0]?.[0];
    expect(saved).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(savedMessage);
    expect(screen.getByRole('button', { name: cancelLabel }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    await act(async () => fireEvent.click(screen.getByRole('button', { name: cancelLabel })));
    expect(onRemoved).toHaveBeenCalledWith(saved.id);
    expect(screen.getByRole('status').textContent).toContain(removedMessage);
    expect(screen.getByRole('button', { name: saveLabel }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('keeps follow-up turns in the same conversation', async () => {
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), {
      target: { value: '我认为作者要求先了解问题。' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    expect(screen.getByText('我认为作者要求先了解问题。')).not.toBeNull();
    expect(screen.getByText('先看看作者给出的条件。')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('输入消息'), {
      target: { value: '这个条件在哪里？' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    expect(mocks.ask.mock.calls[1]?.[0].userText).toBe('这个条件在哪里？');
    expect(mocks.ask.mock.calls[1]?.[4].history).toContainEqual(
      expect.objectContaining({ role: 'assistant', text: '先看看作者给出的条件。' }),
    );
  });

  it('sends on Enter and automatically grounds a current real-world question', async () => {
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    const composer = screen.getByLabelText('输入消息');
    fireEvent.change(composer, { target: { value: '易道用车现在怎么样了' } });
    await act(async () => fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false }));
    expect(mocks.search).toHaveBeenCalledWith('易到用车', expect.any(AbortSignal), 'web', {
      recent: true,
    });
    expect(mocks.ask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.objectContaining({ externalQuestion: true, publicSources: expect.any(Array) }),
    );
  });

  it('keeps a write failure visible without reporting a saved record', async () => {
    mocks.mutate.mockRejectedValueOnce(new Error('磁盘写入失败'));
    const onSaved = vi.fn();
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={onSaved} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '疑问' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '标记疑问' })));
    expect(screen.getByRole('alert').textContent).toContain('磁盘写入失败');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('lets the user disable automatic lookup and still answers a background question', async () => {
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '自动联网' }));
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '孙宇晨是谁' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.ask.mock.calls[0]?.[4]).toMatchObject({
      searchStatus: '联网已关闭',
      publicSources: [],
    });
    expect(screen.getByText('联网已关闭')).not.toBeNull();
  });

  it('keeps conversation usable after a search outage without claiming verification', async () => {
    mocks.search.mockRejectedValueOnce(new Error('unavailable'));
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '孙宇晨是谁' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    expect(mocks.ask.mock.calls[0]?.[4]).toMatchObject({
      publicSources: [],
      searchStatus: expect.stringContaining('未取得'),
    });
    expect(screen.getByText('先看看作者给出的条件。')).not.toBeNull();
  });

  it('labels interrupted answers and retries without duplicating the original question', async () => {
    mocks.ask.mockImplementationOnce(async (_record, _profile, _signal, onChunk) => {
      onChunk('一段尚未说完的判断');
      throw new Error('网络中断');
    });
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '作者什么意思？' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    expect(screen.getByText('回答中断 · 已保留生成内容')).not.toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新回答' })));
    expect(screen.getAllByText('作者什么意思？')).toHaveLength(1);
    expect(mocks.ask.mock.calls[1]?.[4].history).toEqual([]);
    expect(mocks.saveDialogue.mock.calls.at(-1)?.[2].messages.at(-1)?.status).toBe('complete');
  });

  it('restores local history with the original source and retries local save without calling AI', async () => {
    const history = createDialogueConversation({
      ...source,
      cfi: 'epubcfi(/6/4)',
      excerpt: '另一段原文',
    });
    history.messages.push({
      id: 'old-question',
      role: 'user',
      text: '旧问题',
      status: 'complete',
      updatedAt: history.updatedAt,
    });
    mocks.loadDialogues.mockResolvedValue({
      version: 1,
      bookHash: 'book',
      conversations: [history],
    });
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '本书对话历史' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /旧问题/ })));
    expect(screen.getByText('另一段原文')).not.toBeNull();
    mocks.saveDialogue.mockRejectedValueOnce(new Error('磁盘失败'));
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '继续解释' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    expect(mocks.ask).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试本地保存' })));
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.saveDialogue.mock.calls.at(-1)?.[2].source.excerpt).toBe('另一段原文');
  });

  it('shows substantive source review corrections and stores the reviewed answer', async () => {
    mocks.review.mockResolvedValueOnce({
      text: '原文没有支持这一归因。',
      reviewed: true,
      needed: true,
    });
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '作者什么意思？' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    expect(screen.getByText('原文没有支持这一归因。')).not.toBeNull();
    expect(screen.getByText('来源已核对')).not.toBeNull();
    expect(mocks.saveDialogue.mock.calls.at(-1)?.[2].messages.at(-1)?.text).toBe(
      '原文没有支持这一归因。',
    );
  });

  it('keeps the card open when stopping via Escape cannot save and retries only the disk write', async () => {
    let diskFailed = true;
    mocks.saveDialogue.mockImplementation(async (_service, bookHash, conversation) => {
      if (diskFailed && conversation.messages.at(-1)?.status === 'stopped')
        throw new Error('Disk unavailable');
      return { version: 1, bookHash, conversations: [conversation] };
    });
    mocks.ask.mockImplementationOnce(async (_record, _profile, signal: AbortSignal, onChunk) => {
      onChunk('生成中的原文解释');
      await new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
      return { text: '', model: 'mock' };
    });
    const onClose = vi.fn();
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={onClose} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '解释原文' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    await waitFor(() => expect(screen.getByText('生成中的原文解释')).not.toBeNull());
    await act(async () => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重试本地保存' })).not.toBeNull();
    diskFailed = false;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试本地保存' })));
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭对话' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('continues the interrupted response in place while normal follow-up excludes partial history', async () => {
    mocks.ask.mockImplementationOnce(async (_record, _profile, _signal, onChunk) => {
      onChunk('第一部分。');
      throw new Error('offline');
    });
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '解释原文' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    mocks.ask.mockResolvedValueOnce({ text: '接下来的解释。', model: 'mock' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '继续生成' })));
    expect(screen.getAllByText('解释原文')).toHaveLength(1);
    expect(mocks.ask.mock.calls[1]?.[4].history.at(-1)).toMatchObject({
      text: '第一部分。',
      status: 'complete',
    });
    const saved = mocks.saveDialogue.mock.calls.at(-1)?.[2];
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[1].text).toBe('第一部分。\n\n接下来的解释。');
  });
  it('stopping source review preserves a completed answer without offering duplicate continuation', async () => {
    mocks.review.mockImplementationOnce(
      async (_text, _evidence, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    );
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '解释原文' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    await waitFor(() => expect(screen.getByText('正在核对来源…')).not.toBeNull());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止' })));
    expect(screen.queryByRole('button', { name: '继续生成' })).toBeNull();
    expect(screen.getByText('来源核对未完成，请展开资料核对')).not.toBeNull();
    expect(mocks.saveDialogue.mock.calls.at(-1)?.[2].messages.at(-1)).toMatchObject({
      text: '先看看作者给出的条件。',
      status: 'complete',
      sourceReview: 'unavailable',
    });
  });
  it('saving a note after a failed follow-up uses that question without reusing an earlier answer', async () => {
    const onSaved = vi.fn();
    render(
      <DialogueCard bookKey='book-view' source={source} onSaved={onSaved} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '第一个问题' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    mocks.ask.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '第二个问题' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '标记笔记' })));
    expect(onSaved.mock.calls[0]?.[0].userText).toBe('第二个问题');
    expect(onSaved.mock.calls[0]?.[0].aiText).toBeUndefined();
  });
});
