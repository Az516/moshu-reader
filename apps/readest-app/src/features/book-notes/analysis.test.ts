import { describe, expect, it, vi } from 'vitest';
import type { ReadingPrompt } from '../active-reading/ai';
import type { ArchiveGroup, BookReflection } from './types';
import {
  analysisInputVersion,
  buildAnalysisBatches,
  runNotesAnalysis,
  type AnalysisProgress,
} from './analysis';

vi.mock('../active-reading/ai', () => ({ streamReadingText: vi.fn() }));

const group = (id: string, text: string, chapterId = 'chapter-1'): ArchiveGroup => ({
  id,
  chapterId,
  chapter: chapterId,
  chapterOrder: 0,
  excerpt: `原文-${id}`,
  entries: [
    {
      id: `reading:${id}`,
      originalId: id,
      origin: 'reading',
      kind: 'note',
      text,
      createdAt: '2026-09-27T00:00:00Z',
      updatedAt: '2026-09-27T00:00:00Z',
    },
  ],
  noteCount: 1,
  updatedAt: '2026-09-27T00:00:00Z',
});
const reflection: BookReflection = {
  id: 'reflection-1',
  title: '读后感',
  text: '我的感悟',
  references: [],
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
};

describe('complete book notes analysis', () => {
  it('splits long excerpts and notes without dropping their beginning, middle, or tail', () => {
    const longText = '开头🙂' + '思考\n'.repeat(10000) + '不可丢失的结尾';
    const source = { ...group('long', longText), excerpt: '原文'.repeat(12000) };
    const batches = buildAnalysisBatches([source], [reflection]);
    const fragments = batches.flatMap((batch) => batch.fragments);
    expect(
      fragments
        .filter((part) => part.kind === 'note')
        .map((part) => part.text)
        .join(''),
    ).toBe(longText);
    expect(
      fragments
        .filter((part) => part.kind === 'passage')
        .map((part) => part.text)
        .join(''),
    ).toBe(source.excerpt);
    expect(
      fragments
        .filter((part) => part.kind === 'reflection')
        .map((part) => part.text)
        .join(''),
    ).toBe(reflection.text);
    expect(batches.every((batch) => JSON.stringify(batch.fragments).length <= 18000)).toBe(true);
    expect(
      fragments.filter((part) => part.kind === 'note').every((part) => part.id === 'reading:long'),
    ).toBe(true);
  });

  it('processes every chapter, retains real citations, and reports complete coverage', async () => {
    const groups = Array.from({ length: 23 }, (_, index) =>
      group(`note-${index}`, `第${index}条私人笔记`, `chapter-${index}`),
    );
    const prompts: ReadingPrompt[] = [];
    const progress: AnalysisProgress[] = [];
    const stream = vi.fn(
      async (prompt: ReadingPrompt, _signal: AbortSignal, onText: (text: string) => void) => {
        prompts.push(prompt);
        const text = '分析 [笔记](#note-reading%3Anote-22) [虚构](#note-missing)';
        onText(text);
        return { text, model: 'local-test-model' };
      },
    );
    const result = await runNotesAnalysis(
      {
        bookTitle: '测试书',
        groups,
        reflections: [reflection],
        task: '梳理变化',
        scope: '本书',
        signal: new AbortController().signal,
        onProgress: (value) => progress.push(value),
      },
      stream,
    );
    const rawPrompts = prompts.filter((prompt) => prompt.prompt.includes('原始资料'));
    for (let index = 0; index < 23; index++)
      expect(rawPrompts.some((prompt) => prompt.prompt.includes(`第${index}条私人笔记`))).toBe(
        true,
      );
    expect(result.entryIds).toHaveLength(23);
    expect(result.reflectionIds).toEqual(['reflection-1']);
    expect(result.coverage).toEqual({
      entries: 23,
      totalEntries: 23,
      reflections: 1,
      totalReflections: 1,
    });
    expect(result.text).toContain('#note-reading%3Anote-22');
    expect(result.text).not.toContain('#note-missing');
    expect(progress.at(-1)?.phase).toBe('complete');
  });

  it('reduces every long intermediate result without truncating its tail', async () => {
    const prompts: ReadingPrompt[] = [];
    let raw = 0;
    const stream = vi.fn(async (prompt: ReadingPrompt) => {
      prompts.push(prompt);
      const text = prompt.prompt.includes('原始资料')
        ? `${'中间结论'.repeat(1800)}尾部证据-${raw++}`
        : '整合完成 [笔记](#note-reading%3Aa)';
      return { text, model: 'local-test-model' };
    });
    await runNotesAnalysis(
      {
        bookTitle: '测试书',
        groups: [group('a', 'A', 'one'), group('b', 'B', 'two'), group('c', 'C', 'three')],
        reflections: [],
        task: '总结',
        scope: '本书',
        signal: new AbortController().signal,
      },
      stream,
    );
    const synthesis = prompts
      .filter((prompt) => !prompt.prompt.includes('原始资料'))
      .map((prompt) => prompt.prompt)
      .join('\n');
    expect(synthesis).toContain('尾部证据-0');
    expect(synthesis).toContain('尾部证据-1');
    expect(synthesis).toContain('尾部证据-2');
  });

  it('does not return a completed report when cancelled between batches', async () => {
    const controller = new AbortController();
    const stream = vi.fn(async () => {
      controller.abort();
      return { text: '不完整', model: 'local-test-model' };
    });
    await expect(
      runNotesAnalysis(
        {
          bookTitle: '测试书',
          groups: [group('a', 'A'), group('b', 'B', 'two')],
          reflections: [],
          task: '总结',
          scope: '本书',
          signal: controller.signal,
        },
        stream,
      ),
    ).rejects.toThrow();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty collection before contacting a model', async () => {
    const stream = vi.fn();
    await expect(
      runNotesAnalysis(
        {
          bookTitle: '测试书',
          groups: [],
          reflections: [],
          task: '总结',
          scope: '本书',
          signal: new AbortController().signal,
        },
        stream,
      ),
    ).rejects.toThrow('没有可分析');
    expect(stream).not.toHaveBeenCalled();
  });

  it('includes question state and fingerprints changes to unresolved questions', () => {
    const source = group('question', '这个解释是否适用于我的情况？');
    source.entries[0]!.kind = 'question';
    source.entries[0]!.status = 'open';
    const version = analysisInputVersion([source], []);
    const note = buildAnalysisBatches([source], [])
      .flatMap((batch) => batch.fragments)
      .find((fragment) => fragment.kind === 'note');
    expect(note).toMatchObject({ recordKind: 'question', status: 'open' });
    source.entries[0]!.status = 'resolved';
    expect(analysisInputVersion([source], [])).not.toBe(version);
  });
});
