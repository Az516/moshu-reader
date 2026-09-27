import { describe, expect, it } from 'vitest';
import type { AppService } from '@/types/system';
import { emptyReadingData, loadReadingData } from '../active-reading/data';
import {
  appendArchiveThought,
  emptyBookNotesData,
  loadBookNotesData,
  mergeBookNotesData,
  mutateBookNotesData,
  updateArchiveReading,
  validateBookNotesData,
} from './data';

function storage() {
  const files = new Map<string, string>();
  const service = {
    exists: async (path: string) => files.has(path),
    readFile: async (path: string) => files.get(path),
    writeFile: async (path: string, _base: string, text: string) => {
      files.set(path, text);
    },
    replaceFile: async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    deleteFile: async (path: string) => {
      files.delete(path);
    },
    createDir: async () => {},
  } as unknown as AppService;
  return { files, service };
}
const book = { hash: 'book', title: 'Book', author: 'Author' };
describe('book note archive persistence', () => {
  it('appends independent records at the same source and edits only the chosen identity', async () => {
    const { service } = storage();
    const source = { bookHash: book.hash, excerpt: 'same passage', cfi: 'epubcfi(/6/2!/4/2)' };
    await Promise.all([
      appendArchiveThought(service, book, 'first', source),
      appendArchiveThought(service, book, 'second', source),
    ]);
    const before = await loadReadingData(service, emptyReadingData(book.hash));
    expect(before.records).toHaveLength(2);
    expect(before.records[0]!.id).not.toBe(before.records[1]!.id);
    await updateArchiveReading(service, book, before.records[0]!.id, 'revised');
    const after = await loadReadingData(service, emptyReadingData(book.hash));
    expect(after.records.map((record) => record.userText)).toEqual(['revised', 'second']);
    expect(after.records[0]!.revisions[0]!.text).toBe('first');
    expect(after.records[0]!.source).toEqual(before.records[0]!.source);
  });
  it('serializes concurrent reflection writes and recovers valid backup', async () => {
    const { service, files } = storage();
    const make = (id: string) => ({
      id,
      title: id,
      text: 'thought',
      references: [],
      createdAt: 'now',
      updatedAt: 'now',
    });
    await Promise.all(
      ['one', 'two'].map((id) =>
        mutateBookNotesData(service, book.hash, (data) => ({
          ...data,
          reflections: [...data.reflections, make(id)],
        })),
      ),
    );
    expect((await loadBookNotesData(service, book.hash)).reflections).toHaveLength(2);
    files.set('book/book-notes.json', '{broken');
    expect((await loadBookNotesData(service, book.hash)).reflections).toHaveLength(1);
  });
  it('rejects malformed or foreign data and preserves conflicting restored drafts', () => {
    const current = emptyBookNotesData('book');
    const reflection = {
      id: 'one',
      title: 'Draft',
      text: 'current',
      references: [],
      createdAt: 'now',
      updatedAt: 'now',
    };
    current.reflections = [reflection];
    expect(() => validateBookNotesData({ ...current, bookHash: 'other' }, 'book')).toThrow();
    expect(() =>
      validateBookNotesData(
        { ...current, reflections: [{ ...reflection, references: 'bad' }] },
        'book',
      ),
    ).toThrow();
    const merged = mergeBookNotesData(current, {
      ...current,
      reflections: [{ ...reflection, text: 'backup' }],
    });
    expect(merged.reflections.map((item) => item.text)).toEqual(['current', 'backup']);
  });
});
