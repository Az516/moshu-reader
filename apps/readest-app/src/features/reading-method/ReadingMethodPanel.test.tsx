import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingMethodPanel from './ReadingMethodPanel';
import type { ReadingMethodPanelProps, ReadingSource } from './types';

const sourceA: ReadingSource = {
  bookHash: 'book-a',
  excerpt: '原文甲：机会成本取决于放弃的最佳选择。',
  chapter: '第一章',
  cfi: 'epubcfi(/6/2!/4/2)',
};
const sourceB: ReadingSource = {
  ...sourceA,
  excerpt: '原文乙：这个概念有适用条件。',
  cfi: 'epubcfi(/6/2!/4/4)',
};

function createProps(overrides: Partial<ReadingMethodPanelProps> = {}): ReadingMethodPanelProps {
  return {
    bookId: 'book-a',
    bookTitle: '阅读测试书',
    profile: { genre: '', goal: '', initialThought: '', fourQuestions: ['', '', '', ''] },
    records: [],
    source: sourceA,
    onProfileChange: vi.fn(),
    onCreateRecord: vi.fn(),
    onUpdateRecord: vi.fn(),
    onAskAI: vi.fn(),
    onGoToSource: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});

afterEach(() => cleanup());

describe('ReadingMethodPanel data boundaries', () => {
  it('keeps a failed draft and its original source across a new selection and sidebar remount', async () => {
    const onCreateRecord = vi.fn().mockRejectedValue(new Error('暂时无法保存'));
    const props = createProps({ onCreateRecord, initialTab: 'reflect' });
    const view = render(<ReadingMethodPanel {...props} />);
    fireEvent.change(await screen.findByLabelText('我的理解'), {
      target: { value: '我最初的理解' },
    });
    view.rerender(<ReadingMethodPanel {...props} source={sourceB} />);
    fireEvent.click(screen.getByRole('button', { name: '保存我的想法' }));
    await screen.findByText('暂时无法保存');

    expect(onCreateRecord.mock.calls[0]?.[0]).toMatchObject({
      userText: '我最初的理解',
      source: sourceA,
    });
    expect((screen.getByLabelText('我的理解') as HTMLTextAreaElement).value).toBe('我最初的理解');
    view.unmount();

    render(<ReadingMethodPanel {...props} source={sourceB} />);
    expect(((await screen.findByLabelText('我的理解')) as HTMLTextAreaElement).value).toBe(
      '我最初的理解',
    );
    expect(screen.getByText(sourceA.excerpt)).toBeTruthy();
    expect(props.onAskAI).not.toHaveBeenCalled();
  });

  it('separates drafts between books and never attaches another book’s selected text', async () => {
    const props = createProps({ initialTab: 'reflect' });
    const view = render(<ReadingMethodPanel {...props} />);
    fireEvent.change(await screen.findByLabelText('我的理解'), { target: { value: '甲书笔记' } });

    view.rerender(<ReadingMethodPanel {...props} bookId='book-b' bookTitle='另一本书' />);
    expect(((await screen.findByLabelText('我的理解')) as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText(sourceA.excerpt)).toBeNull();
    fireEvent.change(screen.getByLabelText('我的理解'), { target: { value: '独立想法' } });
    fireEvent.click(screen.getByRole('button', { name: '保存我的想法' }));
    await waitFor(() => expect(props.onCreateRecord).toHaveBeenCalled());
    expect(vi.mocked(props.onCreateRecord).mock.calls[0]?.[0].source).toBeUndefined();

    view.rerender(<ReadingMethodPanel {...props} />);
    expect(((await screen.findByLabelText('我的理解')) as HTMLTextAreaElement).value).toBe(
      '甲书笔记',
    );
  });

  it('disables a repeated 小墨 request and preserves the reader’s words after a 小墨 failure', async () => {
    let rejectRequest: (error: Error) => void = () => {};
    const onAskAI = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const props = createProps({
      initialTab: 'reflect',
      onAskAI,
      records: [
        {
          id: 'thought-1',
          kind: 'understanding',
          userText: '这是我的原稿',
          status: 'open',
          source: sourceA,
        },
      ],
    });
    render(<ReadingMethodPanel {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '请小墨核对' }));
    const pendingButton = screen.getByRole('button', {
      name: '正在对照原文…',
    }) as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);
    fireEvent.click(pendingButton);
    expect(onAskAI).toHaveBeenCalledTimes(1);

    await act(async () => rejectRequest(new Error('模型暂时不可用')));
    expect(await screen.findByText('模型暂时不可用')).toBeTruthy();
    expect(screen.getByText('这是我的原稿')).toBeTruthy();
    expect(props.onUpdateRecord).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '请小墨核对' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('does not reveal review text or send profile edits to 小墨 automatically', async () => {
    const props = createProps({ initialTab: 'review' });
    const view = render(<ReadingMethodPanel {...props} />);
    await screen.findByLabelText('我的回忆');
    expect(screen.queryByText(sourceA.excerpt)).toBeNull();
    fireEvent.change(screen.getByLabelText('我的回忆'), {
      target: { value: '我记得需要比较不同选择' },
    });
    fireEvent.click(screen.getByRole('button', { name: '展开原文' }));
    expect(screen.getByText(sourceA.excerpt)).toBeTruthy();
    expect(props.onAskAI).not.toHaveBeenCalled();

    view.rerender(<ReadingMethodPanel {...props} focusRequest={{ tab: 'prepare', nonce: 1 }} />);
    fireEvent.change(await screen.findByLabelText('我为什么想读？'), {
      target: { value: '理解经济学' },
    });
    expect(props.onProfileChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存阅读卡' }));
    await waitFor(() =>
      expect(props.onProfileChange).toHaveBeenCalledWith(
        expect.objectContaining({ goal: '理解经济学' }),
      ),
    );
    expect(props.onAskAI).not.toHaveBeenCalled();
  });
});
