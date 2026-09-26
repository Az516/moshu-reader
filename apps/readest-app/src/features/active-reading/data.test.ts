import { describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import {
  emptyReadingData,
  exportReadingMarkdown,
  loadReadingData,
  mutateReadingData,
  type ReadingData,
  type ReadingRecord,
} from './data';

function memoryFiles() {
  const files = new Map<string, string>();
  const service = {
    exists: vi.fn<AppService['exists']>(async (path, base) => files.has(`${base}/${path}`)),
    readFile: vi.fn<AppService['readFile']>(async (path, base) => {
      const content = files.get(`${base}/${path}`);
      if (content === undefined) throw new Error('Missing test file');
      return content;
    }),
    writeFile: vi.fn<AppService['writeFile']>(async (path, base, content) => {
      if (typeof content !== 'string') throw new Error('Expected JSON text');
      files.set(`${base}/${path}`, content);
    }),
    replaceFile: async (from: string, to: string, base: string) => {
      files.set(`${base}/${to}`, files.get(`${base}/${from}`)!);
      files.delete(`${base}/${from}`);
    },
    deleteFile: async (path: string, base: string) => {
      files.delete(`${base}/${path}`);
    },
    createDir: vi.fn<AppService['createDir']>(async () => {}),
  } satisfies Pick<
    AppService,
    'exists' | 'readFile' | 'writeFile' | 'createDir' | 'replaceFile' | 'deleteFile'
  >;
  return { files, operations: service, service: service as unknown as AppService };
}

function record(bookHash: string, id: string): ReadingRecord {
  return {
    id,
    kind: 'understanding',
    status: 'open',
    userText: `我的表述 ${id}`,
    originalText: `我的表述 ${id}`,
    revisions: [],
    createdAt: '2026-09-20T00:00:00Z',
    source: { bookHash, cfi: `epubcfi(/6/2[${id}]!/4/2:0)`, excerpt: `原文 ${id}` },
  };
}

const add =
  (item: ReadingRecord) =>
  (data: ReadingData): ReadingData => ({
    ...data,
    records: [...data.records, item],
  });

describe('reading records on disk', () => {
  it('serializes simultaneous updates from two views of the same book without losing records', async () => {
    const { service } = memoryFiles();
    const firstView = emptyReadingData('concurrent-book');
    const staleSecondView = emptyReadingData('concurrent-book');

    await Promise.all([
      mutateReadingData(service, firstView, add(record(firstView.bookHash, 'first'))),
      mutateReadingData(service, staleSecondView, add(record(firstView.bookHash, 'second'))),
    ]);

    expect((await loadReadingData(service, firstView)).records.map((item) => item.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('keeps concurrent books and their source excerpts in separate files', async () => {
    const { service } = memoryFiles();
    const left = emptyReadingData('left-book');
    const right = emptyReadingData('right-book');
    await Promise.all([
      mutateReadingData(service, left, add(record(left.bookHash, 'left'))),
      mutateReadingData(service, right, add(record(right.bookHash, 'right'))),
    ]);

    expect((await loadReadingData(service, left)).records).toEqual([record(left.bookHash, 'left')]);
    expect((await loadReadingData(service, right)).records).toEqual([
      record(right.bookHash, 'right'),
    ]);
  });

  it('rejects a source belonging to another book before creating files', async () => {
    const { service, operations } = memoryFiles();
    const initial = emptyReadingData('target-book');
    await expect(
      mutateReadingData(service, initial, add(record('different-book', 'wrong-source'))),
    ).rejects.toThrow();
    expect(operations.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a foreign source already present in the file and leaves the bytes intact', async () => {
    const { service, files, operations } = memoryFiles();
    const initial = emptyReadingData('persisted-book');
    const content = JSON.stringify({ ...initial, records: [record('other-book', 'foreign')] });
    files.set('Books/persisted-book/reading-method.json', content);

    await expect(loadReadingData(service, initial)).rejects.toThrow();
    expect(files.get('Books/persisted-book/reading-method.json')).toBe(content);
    expect(operations.writeFile).not.toHaveBeenCalled();
  });

  it('retains the previous document as a backup when saving a newer draft', async () => {
    const { service, files } = memoryFiles();
    const initial = emptyReadingData('revision-book');
    const original = record(initial.bookHash, 'draft');
    const saved = await mutateReadingData(service, initial, add(original));
    await mutateReadingData(service, initial, (data) => ({
      ...data,
      records: data.records.map((item) => ({
        ...item,
        userText: '修改后的理解',
        revisions: [...item.revisions, { text: item.userText, at: '2026-09-20T01:00:00Z' }],
      })),
    }));

    const backup: unknown = JSON.parse(
      files.get('Books/revision-book/reading-method.json.backup') || 'null',
    );
    expect(backup).toEqual(saved);
    const reloaded = await loadReadingData(service, initial);
    expect(reloaded.records[0]).toMatchObject({
      originalText: original.userText,
      userText: '修改后的理解',
      revisions: [{ text: original.userText, at: '2026-09-20T01:00:00Z' }],
    });
  });

  it('allows the next queued edit to succeed after an earlier write fails', async () => {
    const { service, operations } = memoryFiles();
    const initial = emptyReadingData('retry-book');
    operations.writeFile.mockRejectedValueOnce(new Error('Disk unavailable'));
    const outcomes = await Promise.allSettled([
      mutateReadingData(service, initial, add(record(initial.bookHash, 'failed'))),
      mutateReadingData(service, initial, add(record(initial.bookHash, 'retry'))),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'fulfilled']);
    expect((await loadReadingData(service, initial)).records.map((item) => item.id)).toEqual([
      'retry',
    ]);
  });
});

describe('reading Markdown export', () => {
  it('keeps both the question anchor and the reader-confirmed answering passage in exports', () => {
    const initial = emptyReadingData('export-answer');
    const item = record(initial.bookHash, 'question');
    const resolutionSource = {
      bookHash: initial.bookHash,
      bookVersion: 'book-hash:export-answer',
      title: '书名快照',
      author: '作者快照',
      chapter: '后来的一章',
      cfi: 'epubcfi(/6/8!/4/2:0)',
      excerpt: '读者认为回答了疑问的后文。',
    };
    const markdown = exportReadingMarkdown({
      ...initial,
      records: [{ ...item, status: 'resolved', resolutionSource }],
    });
    expect(markdown).toContain(item.source!.cfi);
    expect(markdown).toContain('读者确认的解答原文');
    expect(markdown).toContain(resolutionSource.excerpt);
    expect(markdown).toContain(resolutionSource.cfi);
    expect(markdown).toContain(resolutionSource.chapter);
    expect(markdown).toContain(resolutionSource.bookVersion);
    expect(markdown).toContain(resolutionSource.title);
    expect(markdown).toContain(resolutionSource.author);
    expect(markdown).toContain('不是完整文件校验值');
    expect(markdown).toContain('旧记录未单独保存版本');
  });

  it('separates quoted source, personal drafts and model feedback and includes exact source locations', () => {
    const initial = emptyReadingData('export-book', '测试书', '测试作者');
    const item = record(initial.bookHash, 'export');
    const data = {
      ...initial,
      apiKey: 'synthetic-secret-not-for-export',
      records: [
        {
          ...item,
          userText: '我修订后的理解',
          revisions: [{ text: '我的第二稿', at: '2026-09-20T02:00:00Z' }],
          source: {
            ...item.source,
            excerpt: '第一行原文\n第二行原文',
            context: '必要邻文',
            chapter: '第一章',
          },
          aiText: '模型提供的核对建议',
          aiInputText: '本次模型实际对照的原稿',
          model: 'test-model',
          aiHistory: [
            {
              text: '上一次建议',
              model: 'older-test-model',
              at: '2026-09-20T01:00:00Z',
              inputText: '上次模型实际对照的原稿',
            },
          ],
        },
      ],
    };

    const markdown = exportReadingMarkdown(data);
    expect(markdown).toContain('### 原文\n\n> 第一行原文\n> 第二行原文');
    expect(markdown).toContain(`原文位置（EPUB CFI）：${item.source?.cfi}`);
    expect(markdown).toContain('> 必要邻文');
    expect(markdown).toContain('### 我的内容\n\n我修订后的理解');
    expect(markdown).toContain(`最初表述：\n\n> ${item.originalText}`);
    expect(markdown).toContain('> 我的第二稿');
    expect(markdown).toContain('### 小墨建议');
    expect(markdown).toContain('模型：test-model');
    expect(markdown).toContain('本次对照的个人表述：\n\n> 本次模型实际对照的原稿');
    expect(markdown).toContain('当时的表述：\n\n> 上次模型实际对照的原稿');
    expect(markdown).toContain('上一次建议');
    expect(markdown).not.toContain(data.apiKey);
    expect(markdown.indexOf('### 原文')).toBeLessThan(markdown.indexOf('### 我的内容'));
    expect(markdown.indexOf('### 我的内容')).toBeLessThan(markdown.indexOf('### 小墨建议'));
  });
});
