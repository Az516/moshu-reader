import { File as NodeFile } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { loadBookPassages, searchPassages } from './thematic-passages';

describe('real EPUB passage indexing without an open reader', () => {
  it('retrieves original paragraphs and resolves their CFIs after reopening the book', async () => {
    const bytes = readFileSync(
      resolve(process.cwd(), 'src/__tests__/fixtures/data/sample-alice.epub'),
    );
    const file = new NodeFile([bytes], 'sample-alice.epub', {
      type: 'application/epub+zip',
      lastModified: 0,
    }) as unknown as File;
    const book: Book = {
      hash: 'fixture-alice',
      title: 'Alice in Wonderland',
      author: 'Lewis Carroll',
      format: 'EPUB',
      createdAt: 0,
      updatedAt: 0,
    };
    const files = new Map<string, string>();
    const service = {
      loadBookContent: async () => ({ file }),
      exists: async (path: string) => files.has(path),
      readFile: async (path: string) => files.get(path),
      createDir: async () => undefined,
      writeFile: async (path: string, _base: string, text: string) => {
        files.set(path, text);
      },
    } as unknown as AppService;
    const passages = await loadBookPassages(service, book);
    expect(passages.length).toBeGreaterThan(10);
    const found = searchPassages(passages, 'Rabbit');
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(5);
    const reopened = (await new DocumentLoader(file).open()).book;
    try {
      for (const passage of found) {
        const resolved = reopened.resolveCFI?.(passage.cfi);
        expect(resolved?.index).toBe(passage.sectionIndex);
        const doc = await reopened.sections[passage.sectionIndex]!.createDocument();
        const range = resolved?.anchor?.(doc);
        expect(typeof range).not.toBe('number');
        expect(range?.toString().replace(/\s+/g, ' ').trim()).toBe(passage.excerpt);
      }
    } finally {
      await reopened.destroy?.();
    }
  });
});
