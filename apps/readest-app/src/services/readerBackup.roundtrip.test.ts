import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { ZipWriter, Uint8ArrayWriter } from '@zip.js/zip.js';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { emptyReadingData } from '@/features/active-reading/data';
import { emptyModeState } from '@/features/reading-modes/state';
import { createResearch } from '@/features/reading-modes/thematic';
import { addBackupEntriesToZip, restoreFromBackupZip } from './backupService';
import { undoLastLocalRestore } from './localReaderRestore';

afterEach(() => vi.unstubAllGlobals());
function memory(initialBooks: Book[]) {
  const files = new Map<string, string>();
  let books = initialBooks;
  const service = {
    exists: async (path: string, base: string) => files.has(`${base}/${path}`),
    readFile: async (path: string, base: string, mode: string) => {
      const text = files.get(`${base}/${path}`);
      if (text === undefined) throw new Error(`missing ${base}/${path}`);
      return mode === 'text' ? text : new TextEncoder().encode(text).buffer;
    },
    writeFile: async (path: string, base: string, data: string | ArrayBuffer) => {
      files.set(
        `${base}/${path}`,
        typeof data === 'string' ? data : new TextDecoder().decode(data),
      );
    },
    replaceFile: async (from: string, to: string, base: string) => {
      files.set(`${base}/${to}`, files.get(`${base}/${from}`)!);
      files.delete(`${base}/${from}`);
    },
    copyFile: async (from: string, fromBase: string, to: string, toBase: string) => {
      files.set(`${toBase}/${to}`, files.get(`${fromBase}/${from}`)!);
    },
    deleteFile: async (path: string, base: string) => {
      files.delete(`${base}/${path}`);
    },
    createDir: async () => {},
    loadLibraryBooks: async () => books,
    saveLibraryBooks: async (next: Book[]) => {
      books = next;
    },
    loadSettings: async () => ({}),
    saveSettings: async () => {},
    resolveFilePath: async () => '/Books',
    readDirectory: async () =>
      [...files.entries()]
        .filter(([name]) => name.startsWith('Books/'))
        .map(([name, text]) => ({ path: name.slice(6), size: text.length })),
  } as unknown as AppService;
  return { files, service };
}

it('round-trips all local reader documents through a real ZIP into a fresh library, then undoes the import', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  const hash = '1111111111111111111111111111aaaa';
  const book: Book = {
    hash,
    title: 'Synthetic',
    author: 'Author',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
  };
  const source = memory([book]);
  const date = '2026-09-24T00:00:00.000Z';
  const documents: Record<string, unknown> = {
    [`Books/${hash}/reading-method.json`]: {
      ...emptyReadingData(hash),
      records: [
        {
          id: 'note',
          kind: 'understanding',
          status: 'kept',
          userText: 'Synthetic note',
          originalText: 'Synthetic note',
          revisions: [],
        },
      ],
    },
    [`Books/${hash}/reading-modes.json`]: {
      ...emptyModeState(hash),
      captures: { chapter: 'Synthetic thought' },
    },
    [`Books/${hash}/reading-dialogues.json`]: {
      version: 1,
      bookHash: hash,
      conversations: [
        {
          id: 'chat',
          source: { bookHash: hash, excerpt: 'Synthetic quote', cfi: 'epubcfi(/6/2!/4)' },
          createdAt: date,
          updatedAt: date,
          messages: [
            {
              id: 'q',
              role: 'user',
              text: 'Synthetic question',
              status: 'complete',
              updatedAt: date,
            },
          ],
        },
      ],
    },
    'Data/thematic-research.json': {
      version: 1,
      studies: {
        theme: {
          ...createResearch('theme'),
          question: 'Synthetic theme',
          messages: [
            {
              id: 'topic-q',
              questionId: 'main',
              role: 'user',
              text: 'Synthetic theme',
              passageIds: [],
            },
          ],
        },
      },
    },
  };
  for (const [path, value] of Object.entries(documents))
    source.files.set(path, JSON.stringify(value));
  source.files.set('Data/unrelated-secret.json', 'must never enter the archive');
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    useCompressionStream: false,
  });
  await addBackupEntriesToZip(writer, source.service, {});
  const zip = await writer.close();
  const destination = memory([]);
  await restoreFromBackupZip(destination.service, new NodeBlob([zip]) as unknown as Blob);
  for (const [path, value] of Object.entries(documents))
    expect(JSON.parse(destination.files.get(path)!)).toEqual(value);
  expect(destination.files.has('Data/unrelated-secret.json')).toBe(false);
  expect((await destination.service.loadLibraryBooks()).map((item) => item.hash)).toEqual([hash]);
  await undoLastLocalRestore(destination.service);
  expect(await destination.service.loadLibraryBooks()).toEqual([]);
  for (const path of Object.keys(documents)) {
    expect(destination.files.has(path)).toBe(false);
    expect(destination.files.has(`${path}.backup`)).toBe(false);
  }
});
