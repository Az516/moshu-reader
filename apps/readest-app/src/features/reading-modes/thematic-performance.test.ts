import { File as NodeFile } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { buildPassageIndex, searchPassagesAsync } from './thematic-passages';

const PARAGRAPHS_PER_BOOK = 100;
const text =
  '拖延与行动的关系可以通过任务分解来观察。眼前奖励影响选择，具体目标帮助读者迈出下一步。';
const chapter = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>合成章节</title></head><body><h1>行动与选择</h1>${Array.from({ length: PARAGRAPHS_PER_BOOK }, (_, i) => `<p>${i} ${text.repeat(5)}</p>`).join('')}</body></html>`;
const bytes = zipSync({
  mimetype: strToU8('application/epub+zip'),
  'META-INF/container.xml': strToU8(
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  ),
  'content.opf': strToU8(
    '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">synthetic-benchmark</dc:identifier><dc:title>合成测试书籍</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  ),
  'chapter.xhtml': strToU8(chapter),
});

function syntheticLibrary(count: number) {
  const books: Book[] = Array.from({ length: count }, (_, index) => ({
    hash: `synthetic-${index}`,
    title: `合成书 ${index}`,
    author: '测试生成',
    format: 'EPUB',
    createdAt: 0,
    updatedAt: 0,
  }));
  const sourceFiles = new Map(
    books.map((book) => [book.hash, new NodeFile([bytes], `${book.hash}.epub`)]),
  );
  const indexFiles = new Map<string, string>();
  const service = {
    loadBookContent: async (book: Book) => ({ file: sourceFiles.get(book.hash)! }),
    exists: async (path: string) => indexFiles.has(path),
    readFile: async (path: string) => indexFiles.get(path),
    writeFile: async (path: string, _base: string, value: string) => {
      indexFiles.set(path, value);
    },
    createDir: async () => undefined,
  } as unknown as AppService;
  return { books, service };
}

it.skipIf(process.env['MOSHU_SYNTHETIC_BENCH'] !== '1')(
  'records repeatable synthetic EPUB cold/warm index and retrieval baselines',
  async () => {
    vi.stubGlobal('File', NodeFile);
    const results: Record<string, unknown>[] = [];
    try {
      for (const count of [10, 100, 1000]) {
        const { service, books } = syntheticLibrary(count);
        let maxEventLoopGapMs = 0;
        let peakRssBytes = process.memoryUsage().rss;
        let previous = performance.now();
        const monitor = setInterval(() => {
          const now = performance.now();
          maxEventLoopGapMs = Math.max(maxEventLoopGapMs, now - previous);
          previous = now;
          peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        }, 5);
        try {
          let start = performance.now();
          const cold = await buildPassageIndex(service, books);
          const coldIndexMs = performance.now() - start;
          expect(cold.warnings).toEqual([]);
          expect(cold.passages).toHaveLength(count * PARAGRAPHS_PER_BOOK);
          start = performance.now();
          const warm = await buildPassageIndex(service, books);
          const warmIndexMs = performance.now() - start;
          expect(warm.passages).toHaveLength(cold.passages.length);
          const searchMs: number[] = [];
          for (let run = 0; run < 5; run++) {
            start = performance.now();
            const matches = await searchPassagesAsync(warm.passages, '拖延与行动的关系', {
              limitPerBook: 8,
              queries: ['任务分解 眼前奖励'],
            });
            searchMs.push(performance.now() - start);
            expect(matches).toHaveLength(count * 8);
          }
          const controller = new AbortController();
          let abortedAt = 0;
          const cancelled = buildPassageIndex(service, books, controller.signal);
          setTimeout(() => {
            abortedAt = performance.now();
            controller.abort();
          }, 5);
          await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
          results.push({
            books: count,
            passages: warm.passages.length,
            coldIndexMs,
            warmIndexMs,
            searchMs,
            abortToSettledMs: performance.now() - abortedAt,
            maxEventLoopGapMs,
            peakRssBytes,
          });
        } finally {
          clearInterval(monitor);
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
    const output = {
      recordedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        engine: 'Vitest jsdom; actual EPUB parser; in-memory AppService',
      },
      fixture: {
        paragraphsPerBook: PARAGRAPHS_PER_BOOK,
        charactersPerParagraph: text.length * 5,
        compressedBytesPerBook: bytes.length,
        chapterBytesPerBook: strToU8(chapter).length,
        allBooksMatch: true,
      },
      limits:
        'Synthetic highly compressible books; warm lane reuses immutable File snapshots. Excludes native disk/WebKit/model/network. Native mutable files still receive complete byte hashing; this is a baseline, not a user-device SLO.',
      results,
    };
    writeFileSync(
      resolve(process.cwd(), 'bench/thematic-baseline.json'),
      `${JSON.stringify(output, null, 2)}\n`,
    );
  },
  180_000,
);
