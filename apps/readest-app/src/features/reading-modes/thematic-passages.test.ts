import { File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CFI, type BookDoc } from '@/libs/document';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import {
  buildPassageIndex,
  loadBookPassages,
  searchPassages,
  searchPassagesAsync,
  type IndexedPassage,
} from './thematic-passages';

const mocks = vi.hoisted(() => ({ open: vi.fn(), destroy: vi.fn(), construct: vi.fn() }));
vi.mock('@/libs/document', async (original) => ({
  ...(await original<typeof import('@/libs/document')>()),
  DocumentLoader: class {
    constructor(file: File, options?: { nativeFilePath?: string }) {
      mocks.construct(file, options);
    }
    open = mocks.open;
  },
}));

const book: Book = {
  hash: 'book-a',
  title: '行为研究',
  author: '作者甲',
  format: 'EPUB',
  createdAt: 0,
  updatedAt: 0,
};
function fixture() {
  const doc = new DOMParser().parseFromString(
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="cause">拖延的机制</h1><p>拖延有时是一种<strong>情绪回避</strong>。我们暂时逃开令人不适的任务。</p><p>眼前的奖励会维持这种选择。</p><h2 id="practice">行动练习</h2><p>可以先完成一个很小的步骤。</p></body></html>',
    'application/xhtml+xml',
  );
  const parsed = {
    toc: [
      { label: '拖延的机制', href: 'chapter.xhtml#cause' },
      { label: '行动练习', href: 'chapter.xhtml#practice' },
    ],
    sections: [
      {
        id: 'chapter.xhtml',
        cfi: 'epubcfi(/6/2[chapter])',
        linear: 'yes',
        createDocument: async () => doc,
      },
    ],
    splitTOCHref: (href: string) => href.split('#'),
    destroy: mocks.destroy,
  } as unknown as BookDoc;
  mocks.open.mockResolvedValue({ book: parsed, format: 'EPUB' });
  return doc;
}
function storage() {
  const files = new Map<string, string>();
  let file = new NodeFile(['epub version one'], 'book.epub', { lastModified: 1 });
  const service = {
    exists: vi.fn(async (path: string) => files.has(path)),
    readFile: vi.fn(async (path: string) => files.get(path)),
    writeFile: vi.fn(async (path: string, _base: string, value: string) => {
      files.set(path, value);
    }),
    createDir: vi.fn(async () => undefined),
    loadBookContent: vi.fn(async () => ({ file })),
  } as unknown as AppService;
  return {
    service,
    files,
    replace: () => {
      file = new NodeFile(['epub version two'], 'book.epub', { lastModified: 1 });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture();
});
afterEach(() => vi.unstubAllGlobals());

describe('local EPUB passage index', () => {
  it('closes the file promptly and disposes a parser that finishes after cancellation', async () => {
    const { service } = storage();
    const file = (await service.loadBookContent(book)).file;
    const close = vi.fn(async () => undefined);
    Object.assign(file, { close });
    let finishOpen!: (result: { book: BookDoc }) => void;
    mocks.open.mockImplementationOnce(
      () =>
        new Promise<{ book: BookDoc }>((resolve) => {
          finishOpen = resolve;
        }),
    );
    const controller = new AbortController();
    const task = loadBookPassages(service, book, controller.signal);
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalled());
    controller.abort();
    await rejected;
    expect(close).toHaveBeenCalledTimes(1);
    const lateDestroy = vi.fn(async () => undefined);
    finishOpen({ book: { destroy: lateDestroy } as unknown as BookDoc });
    await vi.waitFor(() => expect(lateDestroy).toHaveBeenCalledTimes(1));
    expect(service.writeFile).not.toHaveBeenCalled();
  });

  it('stops reading later hash chunks once cancellation is requested', async () => {
    const { service } = storage();
    const file = new NodeFile(['x'.repeat(3 * 1024 * 1024)], 'large.epub');
    const controller = new AbortController();
    const slice = vi.spyOn(file, 'slice');
    const originalSlice = NodeFile.prototype.slice.bind(file);
    slice.mockImplementation((start, end) => {
      controller.abort();
      return originalSlice(start, end);
    });
    Object.assign(service, { loadBookContent: vi.fn(async () => ({ file })) });
    await expect(loadBookPassages(service, book, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(slice).toHaveBeenCalledTimes(1);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(service.writeFile).not.toHaveBeenCalled();
  });

  it('stops a pending chapter immediately and releases the book without indexing later chapters', async () => {
    const doc = fixture();
    let finishChapter!: (value: Document) => void;
    const first = vi.fn(
      () =>
        new Promise<Document>((resolve) => {
          finishChapter = resolve;
        }),
    );
    const next = vi.fn(async () => doc);
    mocks.open.mockResolvedValueOnce({
      book: {
        sections: [
          { id: 'one', createDocument: first },
          { id: 'two', createDocument: next },
        ],
        toc: [],
        splitTOCHref: (href: string) => href.split('#'),
        destroy: mocks.destroy,
      },
    });
    const { service } = storage();
    const controller = new AbortController();
    const task = buildPassageIndex(service, [book], controller.signal).then(
      () => 'completed',
      (error: unknown) => (error instanceof Error ? error.name : 'error'),
    );
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    controller.abort();
    try {
      expect(
        await Promise.race([
          task,
          new Promise((resolve) => setTimeout(() => resolve('still waiting'), 30)),
        ]),
      ).toBe('AbortError');
      expect(next).not.toHaveBeenCalled();
      expect(service.writeFile).not.toHaveBeenCalled();
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
    } finally {
      finishChapter(doc);
      await task;
    }
    expect(next).not.toHaveBeenCalled();
    expect(service.writeFile).not.toHaveBeenCalled();
  });

  it('gives cancellation priority over a pending cache read', async () => {
    const { service } = storage();
    await loadBookPassages(service, book);
    let release!: (text: string) => void;
    const read = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    Object.assign(service, { readFile: read });
    vi.mocked(service.writeFile).mockClear();
    const controller = new AbortController();
    const task = loadBookPassages(service, book, controller.signal).then(
      () => 'completed',
      (error: unknown) => (error instanceof Error ? error.name : 'error'),
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    controller.abort();
    try {
      expect(
        await Promise.race([
          task,
          new Promise((resolve) => setTimeout(() => resolve('still waiting'), 30)),
        ]),
      ).toBe('AbortError');
    } finally {
      release('{}');
      await task;
    }
    expect(service.writeFile).not.toHaveBeenCalled();
  });

  it('does not rehash the same immutable File but invalidates a replacement with equal size and timestamp', async () => {
    vi.stubGlobal('File', NodeFile);
    const { service, replace } = storage();
    const slice = vi.spyOn(NodeFile.prototype, 'slice');
    try {
      const first = await loadBookPassages(service, book);
      const reads = slice.mock.calls.length;
      await loadBookPassages(service, book);
      expect(slice).toHaveBeenCalledTimes(reads);
      replace();
      const changed = await loadBookPassages(service, book);
      expect(slice.mock.calls.length).toBeGreaterThan(reads);
      expect(changed[0]?.bookVersion).not.toBe(first[0]?.bookVersion);
    } finally {
      slice.mockRestore();
    }
  });
  it('extracts actual text, neighboring context, chapter and a CFI that resolves in the untouched source', async () => {
    const doc = fixture();
    const original = doc.documentElement.outerHTML;
    const { service } = storage();
    const passages = await loadBookPassages(service, book);
    expect(passages).toHaveLength(3);
    expect(passages[0]).toMatchObject({
      bookHash: book.hash,
      title: book.title,
      author: book.author,
      sectionIndex: 0,
      chapter: '拖延的机制',
      excerpt: '拖延有时是一种情绪回避。我们暂时逃开令人不适的任务。',
    });
    expect(passages[0]?.context).toContain('眼前的奖励');
    expect(passages[2]?.chapter).toBe('行动练习');
    const parts = CFI.parse(passages[0]!.cfi);
    (parts.parent ?? parts).shift();
    expect(CFI.toRange(doc, parts).toString()).toBe(passages[0]!.excerpt);
    expect(passages[0]?.bookVersion).toMatch(/^[a-f0-9]{32}$/);
    expect(passages[0]?.contentHash).toMatch(/^[a-f0-9]{32}$/);
    expect(doc.documentElement.outerHTML).toBe(original);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses the native book path for reliable desktop EPUB parsing when available', async () => {
    const { service } = storage();
    const resolveNativeBookFilePath = vi.fn(async () => '/native/books/book.epub');
    Object.assign(service, { resolveNativeBookFilePath });

    await loadBookPassages(service, book);

    expect(resolveNativeBookFilePath).toHaveBeenCalledWith(book);
    expect(mocks.construct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nativeFilePath: '/native/books/book.epub' }),
    );
  });

  it('keeps freshly extracted passages usable when the disposable cache cannot be written', async () => {
    const { service } = storage();
    Object.assign(service, {
      writeFile: vi.fn(async () => Promise.reject(new Error('disk busy'))),
    });

    await expect(loadBookPassages(service, book)).resolves.toHaveLength(3);
  });

  it('reuses the local cache and rebuilds changed bytes even when file size and timestamp match', async () => {
    const { service, replace } = storage();
    const first = await loadBookPassages(service, book);
    const same = await loadBookPassages(service, { ...book, title: '改过的书名' });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(same[0]?.title).toBe('改过的书名');
    expect(same[0]?.passageId).toBe(first[0]?.passageId);
    replace();
    const changed = await loadBookPassages(service, book);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(changed[0]?.bookVersion).not.toBe(first[0]?.bookVersion);
  });

  it('keeps other books searchable when one file fails and explains unsupported formats', async () => {
    const { service } = storage();
    const result = await buildPassageIndex(service, [
      book,
      { ...book, hash: 'pdf', format: 'PDF' },
    ]);
    expect(result.passages).toHaveLength(3);
    expect(result.warnings).toEqual([expect.objectContaining({ bookHash: 'pdf' })]);
    expect(result.warnings[0]?.message).toContain('EPUB');
  });

  it('splits long paragraphs into bounded anchored passages and skips hidden or duplicated blocks', async () => {
    const doc = fixture();
    doc.body.innerHTML = `<h1>长段落</h1><blockquote><p>${'拖延让任务变得更难。'.repeat(220)}</p></blockquote><p hidden=''>不应索引的隐藏文字。</p>`;
    const { service } = storage();
    const passages = await loadBookPassages(service, book);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((passage) => passage.excerpt.length <= 1200)).toBe(true);
    expect(passages.map((passage) => passage.excerpt).join('')).toBe(
      '拖延让任务变得更难。'.repeat(220),
    );
  });

  it('includes textual appendices and EPUBs that use div elements for paragraphs', async () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><h1>附注</h1><div><div>时间折扣也是作者讨论的原因。</div></div></body></html>',
      'text/html',
    );
    mocks.open.mockResolvedValueOnce({
      book: {
        sections: [
          {
            id: 'notes.xhtml',
            cfi: 'epubcfi(/6/4)',
            linear: 'no',
            createDocument: async () => doc,
          },
        ],
        toc: [],
        splitTOCHref: (href: string) => href.split('#'),
        destroy: mocks.destroy,
      },
      format: 'EPUB',
    });
    const { service } = storage();
    const passages = await loadBookPassages(service, book);
    expect(passages).toHaveLength(1);
    expect(passages[0]?.excerpt).toBe('时间折扣也是作者讨论的原因。');
    expect(passages[0]?.chapter).toBe('附注');
  });
});

const passage = (bookHash: string, excerpt: string, index: number): IndexedPassage => ({
  passageId: `${bookHash}-${index}`,
  bookHash,
  title: '样书',
  author: '作者',
  chapter: '章节',
  sectionIndex: 0,
  cfi: `epubcfi(/6/2!/4/${index})`,
  excerpt,
  context: '',
  contentHash: excerpt,
  bookVersion: 'version',
});
describe('keyword and author-term retrieval', () => {
  it('keeps asynchronous retrieval equivalent and lets cancellation interrupt a large scan', async () => {
    const passages = Array.from({ length: 3000 }, (_, index) =>
      passage(`${index % 10}`, `拖延的原因与眼前奖励 ${index}`, index),
    );
    expect(await searchPassagesAsync(passages, '拖延', { limitPerBook: 2 })).toEqual(
      searchPassages(passages, '拖延', { limitPerBook: 2 }),
    );
    const controller = new AbortController();
    const task = searchPassagesAsync(passages, '拖延', { signal: controller.signal });
    setTimeout(() => controller.abort(), 0);
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('returns relevant original passages and uses author terms only for that book', () => {
    const passages = [
      passage('a', '拖延会减轻眼前的不适。', 1),
      passage('b', '时间折扣让人偏好眼前奖励。', 2),
      passage('c', '时间折扣改变选择。', 3),
      passage('a', '森林中的树木。', 4),
    ];
    const found = searchPassages(passages, '一个人为什么会拖延？', {
      authorTerms: { b: ['时间折扣'] },
    });
    expect(found.map((item) => item.bookHash).sort()).toEqual(['a', 'b']);
    expect(found.find((item) => item.bookHash === 'b')?.matchedTerms).toContain('时间折扣');
    expect(searchPassages(passages, '星系形成')).toEqual([]);
    expect(searchPassages(passages, '')).toEqual([]);
  });

  it('limits results per book and keeps the user-selected scope', () => {
    const passages = Array.from({ length: 8 }, (_, index) =>
      passage(index < 6 ? 'a' : 'b', `拖延的原因 ${index}`, index),
    );
    const found = searchPassages(passages, '拖延', { limitPerBook: 2, bookHashes: ['a'] });
    expect(found).toHaveLength(2);
    expect(found.every((item) => item.bookHash === 'a' && item.score > 0)).toBe(true);
  });
});
