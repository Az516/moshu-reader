import type { AppService } from '@/types/system';
import { readLocalReaderJSON, writeLocalReaderJSON } from '@/services/localReaderPersistence';
import { mergeRestoreConflicts, mergeRestoreItems } from '@/services/localReaderMerge';
import { emptyReadingData, mutateReadingData } from '../active-reading/data';
import type { ReadingRecordKind, ReadingSource } from '../reading-method/types';
import type { BookAnalysisReport, BookNotesData, BookReflection } from './types';

export const emptyBookNotesData = (bookHash: string): BookNotesData => ({
  version: 1,
  bookHash,
  reflections: [],
  reports: [],
  updatedAt: new Date().toISOString(),
});
const file = (hash: string) => `${hash}/book-notes.json`;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const document = (value: unknown): value is Record<string, unknown> =>
  object(value) &&
  ['id', 'title', 'text', 'createdAt', 'updatedAt'].every((key) => typeof value[key] === 'string');
const reflection = (value: unknown): value is BookReflection =>
  document(value) && strings(value['references']);
const coverage = (value: unknown) =>
  object(value) &&
  ['entries', 'reflections', 'totalEntries', 'totalReflections'].every(
    (key) => Number.isInteger(value[key]) && (value[key] as number) >= 0,
  );
const report = (value: unknown): value is BookAnalysisReport =>
  document(value) &&
  ['model', 'scope', 'inputVersion'].every((key) => typeof value[key] === 'string') &&
  strings(value['entryIds']) &&
  strings(value['reflectionIds']) &&
  coverage(value['coverage']);

export function validateBookNotesData(
  value: unknown,
  hash: string,
): asserts value is BookNotesData {
  if (
    !object(value) ||
    value['version'] !== 1 ||
    value['bookHash'] !== hash ||
    typeof value['updatedAt'] !== 'string' ||
    !Array.isArray(value['reflections']) ||
    !value['reflections'].every(reflection) ||
    !Array.isArray(value['reports']) ||
    !value['reports'].every(report)
  )
    throw new Error('本书笔记档案无法读取，原文件已保留。');
}
export function loadBookNotesData(service: AppService, hash: string): Promise<BookNotesData> {
  return readLocalReaderJSON(
    service,
    file(hash),
    'Books',
    (value) => validateBookNotesData(value, hash),
    emptyBookNotesData(hash),
  );
}
export function mergeBookNotesData(current: BookNotesData, incoming: BookNotesData): BookNotesData {
  validateBookNotesData(current, current.bookHash);
  validateBookNotesData(incoming, current.bookHash);
  return {
    ...current,
    reflections: mergeRestoreItems(current.reflections, incoming.reflections),
    reports: mergeRestoreItems(current.reports, incoming.reports),
    restoreConflicts: mergeRestoreConflicts(current.restoreConflicts, incoming.restoreConflicts),
  };
}
const pending = new WeakMap<AppService, Map<string, Promise<BookNotesData>>>();
export function mutateBookNotesData(
  service: AppService,
  hash: string,
  mutate: (data: BookNotesData) => BookNotesData,
): Promise<BookNotesData> {
  let queue = pending.get(service);
  if (!queue) {
    queue = new Map();
    pending.set(service, queue);
  }
  const task = (queue.get(hash) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const next = mutate(await loadBookNotesData(service, hash));
      next.updatedAt = new Date().toISOString();
      validateBookNotesData(next, hash);
      await writeLocalReaderJSON(service, file(hash), 'Books', next, (value) =>
        validateBookNotesData(value, hash),
      );
      return next;
    });
  queue.set(hash, task);
  const currentQueue = queue;
  void task
    .finally(() => {
      if (currentQueue.get(hash) === task) currentQueue.delete(hash);
    })
    .catch(() => undefined);
  return task;
}
export function appendArchiveThought(
  service: AppService,
  book: { hash: string; title: string; author: string },
  text: string,
  source?: ReadingSource,
  kind: ReadingRecordKind = 'understanding',
) {
  if (!text.trim()) return Promise.reject(new Error('请先写下想法。'));
  const now = new Date().toISOString();
  return mutateReadingData(
    service,
    emptyReadingData(book.hash, book.title, book.author),
    (data) => ({
      ...data,
      records: [
        ...data.records,
        {
          id: crypto.randomUUID(),
          kind,
          status: kind === 'question' ? 'open' : 'kept',
          userText: text.trim(),
          originalText: text.trim(),
          revisions: [],
          source: source
            ? {
                ...source,
                bookHash: source.bookHash || book.hash,
                bookVersion: source.bookVersion || `book-hash:${book.hash}`,
              }
            : undefined,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );
}
export function updateArchiveReading(
  service: AppService,
  book: { hash: string; title: string; author: string },
  id: string,
  text: string,
) {
  if (!text.trim()) return Promise.reject(new Error('笔记内容不能为空。'));
  return mutateReadingData(
    service,
    emptyReadingData(book.hash, book.title, book.author),
    (data) => {
      if (!data.records.some((record) => record.id === id))
        throw new Error('这条笔记已不在当前书籍中。');
      return {
        ...data,
        records: data.records.map((record) =>
          record.id !== id || record.userText === text.trim()
            ? record
            : {
                ...record,
                userText: text.trim(),
                updatedAt: new Date().toISOString(),
                revisions: [
                  ...(record.revisions || []),
                  { text: record.userText, at: new Date().toISOString() },
                ],
              },
        ),
      };
    },
  );
}
