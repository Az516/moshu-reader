import { describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import { addBackupEntriesToZip, restoreFromBackupZip } from './backupService';
import { getLastLocalRestore, undoLastLocalRestore } from './localReaderRestore';
import { emptyReadingData } from '@/features/active-reading/data';
import { createResearch } from '@/features/reading-modes/thematic';
const fixture = vi.hoisted(() => ({
  entries: [] as { filename: string; directory: boolean; getData: () => Promise<Uint8Array> }[],
}));
vi.mock('@/utils/zip', () => ({ configureZip: vi.fn() }));
vi.mock('@zip.js/zip.js', () => ({
  Uint8ArrayReader: class {},
  Uint8ArrayWriter: class {},
  BlobReader: class {},
  ZipReader: class {
    async getEntries() {
      return fixture.entries;
    }
    async close() {}
  },
}));
const hash = '1111111111111111111111111111aaaa';
const book = {
  hash,
  title: 'Synthetic',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};
function storage() {
  const files = new Map<string, string>();
  let books = [book];
  const service = {
    exists: async (path: string, base: string) => files.has(`${base}/${path}`),
    readFile: async (path: string, base: string, mode: string) => {
      const text = files.get(`${base}/${path}`);
      if (text === undefined) throw new Error('missing');
      return mode === 'binary' ? new TextEncoder().encode(text).buffer : text;
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
    loadLibraryBooks: async () => structuredClone(books),
    saveLibraryBooks: async (next: typeof books) => {
      books = next;
    },
    loadSettings: async () => ({}),
    saveSettings: async () => {},
    resolveFilePath: async () => '/synthetic/Books',
    readDirectory: async () =>
      [...files.entries()]
        .filter(([name]) => name.startsWith('Books/'))
        .map(([name, text]) => ({ path: name.slice(6), size: text.length })),
  } as unknown as AppService;
  return { files, service };
}
const setArchive = (values: Record<string, unknown>) => {
  fixture.entries = Object.entries(values).map(([filename, value]) => ({
    filename,
    directory: false,
    getData: async () => new TextEncoder().encode(JSON.stringify(value)),
  }));
};
describe('Active Reader backup and reversible restore', () => {
  it('includes versioned metadata and thematic history in the library archive', async () => {
    const { files, service } = storage();
    files.set(
      'Data/thematic-research.json',
      JSON.stringify({ version: 1, studies: { topic: createResearch('topic') } }),
    );
    const names: string[] = [];
    await addBackupEntriesToZip(
      {
        add: async (name: string) => {
          names.push(name);
        },
      } as never,
      service,
      {},
    );
    expect(names).toContain('active-reader-backup.json');
    expect(names).toContain('active-reader/thematic-research.json');
  });
  it('fails explicitly when a reader file disappears after the directory listing', async () => {
    const { files, service } = storage();
    files.set(`Books/${hash}/reading-method.json`, JSON.stringify(emptyReadingData(hash)));
    vi.spyOn(service, 'exists').mockResolvedValue(false);
    await expect(
      addBackupEntriesToZip({ add: async () => {} } as never, service, {}),
    ).rejects.toThrow();
  });
  it('restores old records without losing new ones and can undo to the exact previous local bytes', async () => {
    const { files, service } = storage();
    const record = (id: string) => ({
      id,
      kind: 'understanding',
      status: 'kept',
      userText: id,
      originalText: id,
      revisions: [],
    });
    const before = JSON.stringify({ ...emptyReadingData(hash), records: [record('new')] });
    files.set(`Books/${hash}/reading-method.json`, before);
    setArchive({
      'library.json': [book],
      [`${hash}/reading-method.json`]: { ...emptyReadingData(hash), records: [record('old')] },
    });
    await restoreFromBackupZip(service, new Blob());
    expect(
      JSON.parse(files.get(`Books/${hash}/reading-method.json`)!).records.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual(['new', 'old']);
    await undoLastLocalRestore(service);
    expect(files.get(`Books/${hash}/reading-method.json`)).toBe(before);
    expect(files.has(`Books/${hash}/reading-method.json.backup`)).toBe(false);
  });
  it('merges thematic history and dialogue branches from the versioned archive', async () => {
    const { files, service } = storage();
    const date = '2026-09-24T00:00:00.000Z';
    const conversation = (text: string) => ({
      id: 'dialogue',
      source: { bookHash: hash, excerpt: 'Synthetic quote' },
      createdAt: date,
      updatedAt: date,
      messages: [{ id: 'user', role: 'user', text, status: 'complete', updatedAt: date }],
    });
    files.set(
      'Data/thematic-research.json',
      JSON.stringify({ version: 1, studies: { current: createResearch('current') } }),
    );
    files.set(
      `Books/${hash}/reading-dialogues.json`,
      JSON.stringify({ version: 1, bookHash: hash, conversations: [conversation('current')] }),
    );
    setArchive({
      'library.json': [book],
      'active-reader-backup.json': {
        version: 1,
        files: ['active-reader/thematic-research.json', `${hash}/reading-dialogues.json`],
      },
      'active-reader/thematic-research.json': {
        version: 1,
        studies: { previous: createResearch('previous') },
      },
      [`${hash}/reading-dialogues.json`]: {
        version: 1,
        bookHash: hash,
        conversations: [conversation('old')],
      },
    });
    await restoreFromBackupZip(service, new Blob());
    expect(Object.keys(JSON.parse(files.get('Data/thematic-research.json')!).studies)).toEqual([
      'current',
      'previous',
    ]);
    expect(
      JSON.parse(files.get(`Books/${hash}/reading-dialogues.json`)!).conversations.map(
        (session: { messages: { text: string }[] }) => session.messages[0]!.text,
      ),
    ).toEqual(['current', 'old']);
    expect((await getLastLocalRestore(service))?.differences).toHaveLength(2);
  });
  it('retains a usable pre-restore snapshot after a later write fails', async () => {
    const { files, service } = storage();
    files.set(`Books/${hash}/first.txt`, 'before');
    setArchive({
      'library.json': [book],
      [`${hash}/first.txt`]: 'imported',
      [`${hash}/second.txt`]: 'failure',
    });
    const originalWrite = service.writeFile;
    vi.spyOn(service, 'writeFile').mockImplementation(async (path, base, content) => {
      if (path.endsWith('second.txt')) throw new Error('disk full');
      return originalWrite(path, base, content);
    });
    await expect(restoreFromBackupZip(service, new Blob())).rejects.toThrow('disk full');
    expect((await getLastLocalRestore(service))?.state).toBe('ready');
    await undoLastLocalRestore(service);
    expect(files.get(`Books/${hash}/first.txt`)).toBe('before');
    expect(files.has(`Books/${hash}/second.txt`)).toBe(false);
  });
  it('aborts restore before editing live files if snapshot creation fails', async () => {
    const { files, service } = storage();
    files.set(`Books/${hash}/first.txt`, 'before');
    setArchive({ 'library.json': [book], [`${hash}/first.txt`]: 'imported' });
    vi.spyOn(service, 'copyFile').mockRejectedValue(new Error('snapshot disk full'));
    await expect(restoreFromBackupZip(service, new Blob())).rejects.toThrow('snapshot disk full');
    expect(files.get(`Books/${hash}/first.txt`)).toBe('before');
  });

  it('rejects malformed incoming reader files before modifying the live library', async () => {
    const { files, service } = storage();
    const before = JSON.stringify(emptyReadingData(hash));
    files.set(`Books/${hash}/reading-method.json`, before);
    setArchive({ 'library.json': [book], [`${hash}/reading-method.json`]: { version: 99 } });
    await expect(restoreFromBackupZip(service, new Blob())).rejects.toThrow();
    expect(files.get(`Books/${hash}/reading-method.json`)).toBe(before);
  });
});
