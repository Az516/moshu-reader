import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AnalysisPanel from './AnalysisPanel';
import type { NotesAnalysisInput } from './analysis';
import type { ArchiveGroup, BookAnalysisReport } from './types';

const analyze = vi.hoisted(() => vi.fn());
vi.mock('./analysis', () => ({ runNotesAnalysis: analyze }));
vi.mock('../active-reading/ReadingWorkspace', () => ({ AIConnection: () => null }));
vi.mock('../reading-modes/ModianMascot', () => ({ default: () => null }));

const group = (id: string, chapterId: string): ArchiveGroup => ({
  id,
  chapterId,
  chapter: chapterId,
  chapterOrder: 0,
  excerpt: '原文',
  entries: [
    {
      id: `reading:${id}`,
      originalId: id,
      origin: 'reading',
      kind: 'note',
      text: '想法',
      createdAt: '',
      updatedAt: '',
    },
  ],
  noteCount: 1,
  updatedAt: '',
});
const result: BookAnalysisReport = {
  id: 'report',
  title: '理解的变化',
  text: '分析完成 [笔记](#note-reading%3Aa)',
  model: 'test-model',
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
  scope: '本书',
  entryIds: ['reading:a'],
  reflectionIds: [],
  inputVersion: 'version',
  coverage: { entries: 1, totalEntries: 1, reflections: 0, totalReflections: 0 },
};
const props = () => ({
  bookTitle: '测试书',
  groups: [group('a', '第一章'), group('b', '第二章')],
  reflections: [
    {
      id: 'reflection',
      title: '我的感悟',
      text: '我的原稿',
      references: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
  reports: [],
  currentChapter: '第一章',
  selectedGroupId: 'a',
  onSaveReport: vi.fn().mockResolvedValue(undefined),
  onSaveReflection: vi.fn().mockResolvedValue(undefined),
  onOpenGroup: vi.fn(),
  onClose: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  analyze.mockResolvedValue(result);
});
afterEach(cleanup);

describe('notes analysis panel', () => {
  it('sends only the chosen chapter and saves AI text as a new reflection on request', async () => {
    const callbacks = props();
    render(<AnalysisPanel {...callbacks} />);
    fireEvent.change(screen.getByLabelText('分析范围'), { target: { value: 'chapter' } });
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
    await waitFor(() => expect(callbacks.onSaveReport).toHaveBeenCalledWith(result));
    const input = analyze.mock.calls[0]![0] as NotesAnalysisInput;
    expect(input.groups.map((value) => value.id)).toEqual(['a']);
    expect(input.reflections).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '存为感悟草稿' }));
    await waitFor(() => expect(callbacks.onSaveReflection).toHaveBeenCalledTimes(1));
    const draft = callbacks.onSaveReflection.mock.calls[0]![0];
    expect(draft.id).not.toBe('reflection');
    expect(draft.text).toBe(result.text);
    expect(draft.references).toEqual(['reading:a']);
    expect(callbacks.reflections[0]!.text).toBe('我的原稿');
  });

  it('retains a completed result when local saving fails and offers save retry', async () => {
    const callbacks = props();
    callbacks.onSaveReport.mockRejectedValueOnce(new Error('本地写入失败'));
    render(<AnalysisPanel {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
    await screen.findByText('分析已完成，但保存失败：本地写入失败');
    expect(screen.getByRole('heading', { name: '理解的变化' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存分析' }));
    await screen.findByText('已保存');
    expect(callbacks.onSaveReport).toHaveBeenCalledTimes(2);
  });

  it('aborts generation without saving a report', async () => {
    analyze.mockImplementation(
      (input: NotesAnalysisInput) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('stopped')), {
            once: true,
          });
        }),
    );
    const callbacks = props();
    render(<AnalysisPanel {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '开始分析' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止分析' }));
    await screen.findByText('已停止。这次尚未完成的分析没有保存。');
    expect(callbacks.onSaveReport).not.toHaveBeenCalled();
  });
});
