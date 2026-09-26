import { rankTexts, rankTextsAsync, queryTerms } from './retrieval';
import { waitForWork, yieldToReader } from './async-work';
import { CFI, DocumentLoader, type BookDoc, type TOCItem } from '@/libs/document';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { isTauriAppPlatform } from '@/services/environment';
import { NativeFile, type ClosableFile } from '@/utils/file';
import { md5 } from '@/utils/md5';

export interface IndexedPassage {
  passageId: string;
  bookHash: string;
  title: string;
  author: string;
  chapter: string;
  sectionIndex: number;
  cfi: string;
  excerpt: string;
  context: string;
  contentHash: string;
  bookVersion: string;
}
export type ThematicPassage = IndexedPassage;
interface PassageFile {
  version: 1;
  bookHash: string;
  bookVersion: string;
  passages: IndexedPassage[];
}
const BLOCKS = 'p,li,blockquote,pre,figcaption,td,div';
const EXCLUDED = 'script,style,nav,svg,[hidden],[aria-hidden="true"]';
const flattenToc = (items: TOCItem[]): TOCItem[] =>
  items.flatMap((item) => [item, ...flattenToc(item.subitems ?? [])]);
const cleanText = (text: string) => text.replace(/\s+/g, ' ').trim();

function* passageRanges(element: Element) {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: { node: Node; start: number; end: number }[] = [];
  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(EXCLUDED)) continue;
    const start = text.length;
    text += node.textContent ?? '';
    nodes.push({ node, start, end: text.length });
  }
  let start = 0;
  while (start < text.length) {
    while (/\s/u.test(text[start] ?? '') && start < text.length) start++;
    if (start >= text.length) break;
    let end = Math.min(text.length, start + 1200);
    if (end < text.length) {
      const punctuation = [...text.slice(start, end).matchAll(/[。！？.!?；;\n]/gu)].at(-1);
      if (punctuation && punctuation.index > 400) end = start + punctuation.index + 1;
      // Do not split UTF-16 surrogate pairs at a hard length boundary.
      if (/[\uD800-\uDBFF]/u.test(text[end - 1] ?? '')) end--;
    }
    const first = nodes.find((part) => start >= part.start && start < part.end);
    const last = nodes.find((part) => end > part.start && end <= part.end);
    if (!first || !last) break;
    const range = doc.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    const excerpt = cleanText(text.slice(start, end));
    if (excerpt) yield { range, text: excerpt };
    start = end;
  }
}

async function extractPassages(
  book: Book,
  parsed: BookDoc,
  bookVersion: string,
  signal?: AbortSignal,
): Promise<IndexedPassage[]> {
  const result: IndexedPassage[] = [];
  const toc = flattenToc(parsed.toc ?? []);
  for (let sectionIndex = 0; sectionIndex < parsed.sections.length; sectionIndex++) {
    await yieldToReader(signal);
    const section = parsed.sections[sectionIndex]!;
    const doc = await waitForWork(section.createDocument(), signal);
    signal?.throwIfAborted();
    if (!doc?.documentElement) continue;
    const chapterItems = toc.filter((item) => {
      const path = String(parsed.splitTOCHref(item.href)[0] ?? '');
      return path === section.id || path === section.href;
    });
    const headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const blocks = Array.from(doc.querySelectorAll(BLOCKS)).filter(
      (element) => !element.closest(EXCLUDED) && !element.querySelector(BLOCKS),
    );
    const sectionPassages: IndexedPassage[] = [];
    let sliceStart = performance.now();
    for (const element of blocks) {
      signal?.throwIfAborted();
      let chapter = chapterItems[0]?.label?.trim() || `第 ${sectionIndex + 1} 节`;
      for (const item of chapterItems) {
        const fragment = String(parsed.splitTOCHref(item.href)[1] ?? '');
        const anchor = fragment ? doc.getElementById(decodeURIComponent(fragment)) : null;
        if (
          anchor &&
          (anchor === element ||
            anchor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
        )
          chapter = item.label.trim();
      }
      for (const heading of headings)
        if (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
          chapter = cleanText(heading.textContent ?? '') || chapter;
        }
      for (const { range, text } of passageRanges(element)) {
        if (performance.now() - sliceStart >= 8) {
          await yieldToReader(signal);
          sliceStart = performance.now();
        }
        const cfi = CFI.joinIndir(
          section.cfi || CFI.fake.fromIndex(sectionIndex),
          CFI.fromRange(range),
        );
        const contentHash = md5(text);
        sectionPassages.push({
          passageId: `${book.hash}:${md5(`${cfi}\n${contentHash}`)}`,
          bookHash: book.hash,
          title: book.title,
          author: book.author,
          chapter,
          sectionIndex,
          cfi,
          excerpt: text,
          context: '',
          contentHash,
          bookVersion,
        });
      }
    }
    for (let index = 0; index < sectionPassages.length; index++) {
      if (index % 128 === 0 && performance.now() - sliceStart >= 8) {
        await yieldToReader(signal);
        sliceStart = performance.now();
      }
      const passage = sectionPassages[index]!;
      passage.context = sectionPassages
        .slice(Math.max(0, index - 1), index + 2)
        .map((item) => item.excerpt)
        .join('\n')
        .slice(0, 3600);
    }
    for (const passage of sectionPassages) result.push(passage);
  }
  return result;
}

function isPassageFile(
  value: unknown,
  bookHash: string,
  bookVersion: string,
): value is PassageFile {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<PassageFile>;
  return (
    data.version === 1 &&
    data.bookHash === bookHash &&
    data.bookVersion === bookVersion &&
    Array.isArray(data.passages) &&
    data.passages.every(
      (passage) =>
        passage &&
        passage.bookHash === bookHash &&
        passage.bookVersion === bookVersion &&
        [
          'passageId',
          'cfi',
          'excerpt',
          'context',
          'chapter',
          'contentHash',
          'title',
          'author',
        ].every(
          (key) => typeof (passage as unknown as Record<string, unknown>)[key] === 'string',
        ) &&
        Number.isInteger(passage.sectionIndex) &&
        passage.sectionIndex >= 0,
    )
  );
}

const immutableVersions = new WeakMap<File, string>();

async function bookContentVersion(file: File, signal?: AbortSignal) {
  // Only a real, immutable File snapshot has a safe identity cache. NativeFile
  // and RemoteFile read mutable backing storage: metadata/size are insufficient.
  const immutable = Object.getPrototypeOf(file) === File.prototype;
  const cached = immutable ? immutableVersions.get(file) : undefined;
  signal?.throwIfAborted();
  if (cached) return cached;
  const hash = md5.create();
  for (let start = 0; start < file.size; start += 1024 * 1024) {
    await yieldToReader(signal);
    const bytes = await waitForWork(file.slice(start, start + 1024 * 1024).arrayBuffer(), signal);
    signal?.throwIfAborted();
    hash.update(new Uint8Array(bytes));
  }
  signal?.throwIfAborted();
  const version = hash.hex();
  if (immutable) immutableVersions.set(file, version);
  return version;
}

const closeFile = async (file: File) => {
  await (file as ClosableFile).close?.();
};

/** Derived, local book cache. Byte hashing avoids stale anchors after in-place file edits. */
export async function loadBookPassages(
  service: AppService,
  book: Book,
  signal?: AbortSignal,
): Promise<IndexedPassage[]> {
  signal?.throwIfAborted();
  if (book.format !== 'EPUB')
    throw new Error('本地原文检索目前支持 EPUB；这本书尚未建立段落索引。');
  let nativeFilePath: string | null = null;
  if (typeof service.resolveNativeBookFilePath === 'function') {
    try {
      nativeFilePath = await waitForWork(service.resolveNativeBookFilePath(book), signal);
    } catch {
      signal?.throwIfAborted();
      // Browser-backed and remote books keep using the service file.
    }
  }
  let file: File;
  if (nativeFilePath && isTauriAppPlatform()) {
    const nativeFile = new NativeFile(nativeFilePath, `${book.hash}.epub`);
    try {
      // The regular desktop reader prefers an asset-protocol RemoteFile. That
      // is efficient for small page ranges, but WebKit rejects the multi-MB
      // ranges used while hashing a whole book. The local index therefore
      // opens the same managed path with the native file handle.
      file = await waitForWork(nativeFile.open(), signal, closeFile);
    } catch {
      // open() may have acquired a handle before a later stat/read failed.
      void nativeFile.close().catch(() => undefined);
      signal?.throwIfAborted();
      file = (
        await waitForWork(service.loadBookContent(book), signal, ({ file }) => closeFile(file))
      ).file;
    }
  } else {
    file = (await waitForWork(service.loadBookContent(book), signal, ({ file }) => closeFile(file)))
      .file;
  }
  let parsed: BookDoc | undefined;
  try {
    const bookVersion = await bookContentVersion(file, signal);
    const path = `${book.hash}/thematic-passages.json`;
    if (await waitForWork(service.exists(path, 'Books'), signal)) {
      try {
        const content = await waitForWork(service.readFile(path, 'Books', 'text'), signal);
        await yieldToReader(signal);
        const cached: unknown = JSON.parse(content as string);
        if (isPassageFile(cached, book.hash, bookVersion))
          return cached.passages.map((passage) => ({
            ...passage,
            title: book.title,
            author: book.author,
          }));
      } catch {
        signal?.throwIfAborted();
        // This file is a disposable index, so damaged cache data can be rebuilt.
      }
    }
    signal?.throwIfAborted();
    parsed = (
      await waitForWork(
        new DocumentLoader(file, { nativeFilePath: nativeFilePath ?? undefined }).open(),
        signal,
        async ({ book }) => {
          await book.destroy?.();
        },
      )
    ).book;
    const passages = await extractPassages(book, parsed, bookVersion, signal);
    signal?.throwIfAborted();
    if (!passages.length) throw new Error('这本 EPUB 没有可提取的正文段落，暂不能检索原文。');
    const cache: PassageFile = { version: 1, bookHash: book.hash, bookVersion, passages };
    try {
      await waitForWork(service.createDir(book.hash, 'Books'), signal);
      await yieldToReader(signal);
      const content = JSON.stringify(cache);
      signal?.throwIfAborted();
      await waitForWork(service.writeFile(path, 'Books', content), signal);
    } catch {
      signal?.throwIfAborted();
      // The index is derived data. A cache write failure must not discard the
      // passages we have already extracted for the current thematic answer.
    }
    return passages;
  } finally {
    try {
      await parsed?.destroy?.();
    } finally {
      await closeFile(file);
    }
  }
}

export async function buildPassageIndex(
  service: AppService,
  books: Book[],
  signal?: AbortSignal,
  onProgress?: (done: number, total: number, title: string) => void,
) {
  const passages: IndexedPassage[] = [];
  const warnings: { bookHash: string; message: string }[] = [];
  let done = 0;
  for (const book of books.filter((book) => !book.deletedAt)) {
    signal?.throwIfAborted();
    onProgress?.(++done, books.length, book.title);
    try {
      const loaded = await loadBookPassages(service, book, signal);
      signal?.throwIfAborted();
      for (const passage of loaded) passages.push(passage);
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push({
        bookHash: book.hash,
        message: error instanceof Error ? error.message : '原文索引建立失败。',
      });
    }
  }
  return { passages, warnings };
}

export interface PassageSearchOptions {
  bookHashes?: string[];
  /** User-reviewed author terminology, keyed by book hash. */
  authorTerms?: Record<string, string[]>;
  limitPerBook?: number;
  queries?: string[];
}
/** Local candidate retrieval. Semantic query expansion and reranking run on bounded candidates. */
export function searchPassages(
  passages: IndexedPassage[],
  question: string,
  options: PassageSearchOptions = {},
) {
  if (!question.trim()) return [];
  const scoped = passages.filter(
    (passage) => !options.bookHashes || options.bookHashes.includes(passage.bookHash),
  );
  const baseQueries = [question, ...(options.queries ?? [])];
  const baseTerms = new Set(baseQueries.flatMap(queryTerms));
  const authorTerms = Object.fromEntries(
    Object.entries(options.authorTerms ?? {}).map(([book, terms]) => [
      book,
      terms.flatMap(queryTerms),
    ]),
  );
  const expanded = baseQueries.concat(Object.values(options.authorTerms ?? {}).flat());
  const matches = rankTexts(scoped, expanded, (passage) => passage.excerpt)
    .filter(({ item, matchedTerms }) =>
      matchedTerms.some(
        (term) => baseTerms.has(term) || authorTerms[item.bookHash]?.includes(term),
      ),
    )
    .map(({ item, score, matchedTerms }) => ({ ...item, score, matchedTerms }));
  const counts = new Map<string, number>();
  const limit = Math.max(1, Math.min(20, options.limitPerBook ?? 5));
  return matches.filter((passage) => {
    const count = counts.get(passage.bookHash) ?? 0;
    counts.set(passage.bookHash, count + 1);
    return count < limit;
  });
}

/** Cancellable counterpart for whole-library searches; synchronous API remains for small callers. */
export async function searchPassagesAsync(
  passages: IndexedPassage[],
  question: string,
  options: PassageSearchOptions & { signal?: AbortSignal } = {},
) {
  const { signal } = options;
  signal?.throwIfAborted();
  if (!question.trim()) return [];
  const scope = options.bookHashes ? new Set(options.bookHashes) : undefined;
  const scoped: IndexedPassage[] = [];
  for (let index = 0; index < passages.length; index++) {
    const passage = passages[index]!;
    if (!scope || scope.has(passage.bookHash)) scoped.push(passage);
    if (index % 2048 === 2047) await yieldToReader(signal);
  }
  const baseQueries = [question, ...(options.queries ?? [])];
  const baseTerms = new Set(baseQueries.flatMap(queryTerms));
  const authorTerms = Object.fromEntries(
    Object.entries(options.authorTerms ?? {}).map(([book, terms]) => [
      book,
      new Set(terms.flatMap(queryTerms)),
    ]),
  );
  const ranked = await rankTextsAsync(
    scoped,
    baseQueries.concat(Object.values(options.authorTerms ?? {}).flat()),
    (passage) => passage.excerpt,
    signal,
  );
  const counts = new Map<string, number>();
  const limit = Math.max(1, Math.min(20, options.limitPerBook ?? 5));
  const matches: (IndexedPassage & { score: number; matchedTerms: string[] })[] = [];
  for (let index = 0; index < ranked.length; index++) {
    const { item, score, matchedTerms } = ranked[index]!;
    const count = counts.get(item.bookHash) ?? 0;
    if (
      count < limit &&
      matchedTerms.some((term) => baseTerms.has(term) || authorTerms[item.bookHash]?.has(term))
    ) {
      matches.push({ ...item, score, matchedTerms });
      counts.set(item.bookHash, count + 1);
    }
    if (index % 2048 === 2047) await yieldToReader(signal);
  }
  signal?.throwIfAborted();
  return matches;
}
