import * as CFI from 'foliate-js/epubcfi.js';
import type { TOCItem } from '@/libs/document';
import type { BookNote } from '@/types/book';
import type { ReadingData } from '../active-reading/data';
import type { ReadingSource } from '../reading-method/types';
import type { ModeState } from '../reading-modes/state';
import type { ArchiveChapter, ArchiveEntry, ArchiveGroup } from './types';

export interface ArchiveInput {
  book: { hash: string; title: string; author: string };
  booknotes?: BookNote[];
  readingData?: ReadingData;
  modeState?: ModeState;
  chapters?: ArchiveChapter[];
  toc?: TOCItem[];
}
export function archiveGroupId(
  bookHash: string,
  entry: Pick<ArchiveEntry, 'id' | 'source'>,
): string {
  const source = entry.source;
  return source?.cfi
    ? `passage:${encodeURIComponent(JSON.stringify([bookHash, source.bookVersion || `book-hash:${bookHash}`, source.cfi]))}`
    : `entry:${entry.id}`;
}
const iso = (date: number | undefined) =>
  date && Number.isFinite(date) ? new Date(date).toISOString() : '';
const compareCfi = (a: string, b: string) => {
  try {
    return CFI.compare(a, b);
  } catch {
    return a.localeCompare(b, undefined, { numeric: true });
  }
};
export function buildArchiveGroups(input: ArchiveInput): ArchiveGroup[] {
  const { book, readingData, modeState } = input;
  const chapters = [...(input.chapters || [])];
  const visit = (toc: TOCItem[], parents: string[] = []) => {
    for (const item of toc) {
      if (!chapters.some((chapter) => chapter.href === item.href))
        chapters.push({
          id: `toc:${item.id}:${item.href}`,
          label: [...parents, item.label].join(' / '),
          order: chapters.length,
          href: item.href,
          cfi: item.cfi,
        });
      visit(item.subitems || [], [...parents, item.label]);
    }
  };
  visit(input.toc || []);
  const locate = (source: ReadingSource | undefined, chapterKey?: string): ArchiveChapter => {
    const stored = chapterKey?.match(/^section:(\d+):(.*)$/);
    const section = stored ? Number(stored[1]) : source?.sectionIndex;
    let chapter = stored ? chapters.find((item) => item.href === stored[2]) : undefined;
    if (!chapter && source?.cfi) {
      for (const item of [...chapters]
        .filter((item) => item.cfi)
        .sort((a, b) => compareCfi(a.cfi!, b.cfi!))) {
        try {
          if (CFI.compare(item.cfi!, source.cfi) <= 0) chapter = item;
          else break;
        } catch {
          // An unreadable old locator is retained, never assigned by text or lexical guess.
        }
      }
    }
    if (!chapter && section !== undefined)
      chapter = chapters.find((item) => item.sectionIndex === section);
    const label = source?.chapter || (stored ? '' : chapterKey);
    if (!chapter && label) {
      const matches = chapters.filter(
        (item) => item.label === label || item.label.split(' / ').at(-1) === label,
      );
      if (matches.length === 1) chapter = matches[0];
    }
    if (chapter) return chapter;
    if (section !== undefined)
      return {
        id: `section:${section}`,
        label: label || `第 ${section + 1} 节`,
        order: section,
        sectionIndex: section,
      };
    if (source?.excerpt || source?.cfi || chapterKey)
      return {
        id: 'unlocated',
        label: '待定位记录',
        order: Number.MAX_SAFE_INTEGER - 1,
      };
    return { id: 'book', label: '全书笔记', order: Number.MAX_SAFE_INTEGER };
  };
  const entries: { entry: ArchiveEntry; chapterKey?: string }[] = [];
  for (const note of input.booknotes || []) {
    if (note.deletedAt || (note.bookHash && note.bookHash !== book.hash)) continue;
    const source =
      note.type === 'notebook'
        ? undefined
        : {
            bookHash: book.hash,
            bookVersion: `book-hash:${book.hash}`,
            title: book.title,
            author: book.author,
            cfi: note.cfi || undefined,
            excerpt: note.text || '',
          };
    entries.push({
      entry: {
        id: `native:${note.id}`,
        originalId: note.id,
        origin: 'native',
        kind:
          note.type === 'notebook'
            ? 'notebook'
            : note.note?.trim()
              ? 'note'
              : note.type === 'bookmark'
                ? 'bookmark'
                : 'highlight',
        text: note.note || '',
        createdAt: iso(note.createdAt),
        updatedAt: iso(note.updatedAt),
        source,
        native: note,
      },
    });
  }
  for (const record of readingData?.records || []) {
    if (record.source?.bookHash && record.source.bookHash !== book.hash) continue;
    entries.push({
      entry: {
        id: `reading:${record.id}`,
        originalId: record.id,
        origin: 'reading',
        kind: record.kind === 'question' ? 'question' : 'note',
        text: record.userText,
        createdAt: record.createdAt || '',
        updatedAt: record.updatedAt || record.createdAt || '',
        status: record.status,
        source: record.source,
        reading: record,
      },
    });
  }
  for (const [key, text] of Object.entries(modeState?.captures || {})) {
    if (text.trim())
      entries.push({
        chapterKey: key,
        entry: {
          id: `capture:${key}`,
          originalId: key,
          origin: 'capture',
          kind: 'chapter',
          text,
          createdAt: '',
          updatedAt: '',
        },
      });
  }
  for (const [key, value] of Object.entries(modeState?.reconstructions || {})) {
    const fields = [
      ['问题', value.question],
      ['概念', value.concepts],
      ['主张', value.proposition],
      ['论证', value.argument],
      ['我的判断', value.position],
    ];
    const text = fields
      .filter(([, text]) => text?.trim())
      .map(([label, text]) => `${label}：${text}`)
      .join('\n\n');
    if (text)
      entries.push({
        chapterKey: key,
        entry: {
          id: `reconstruction:${key}`,
          originalId: key,
          origin: 'reconstruction',
          kind: 'chapter',
          text,
          createdAt: '',
          updatedAt: '',
        },
      });
  }
  const groups = new Map<string, ArchiveGroup>();
  for (const { entry, chapterKey } of entries) {
    const chapter = locate(entry.source, chapterKey);
    const id = archiveGroupId(book.hash, entry);
    const existing = groups.get(id);
    const group = existing || {
      id,
      chapterId: chapter.id,
      chapter: chapter.label,
      chapterOrder: chapter.order,
      source: entry.source
        ? { ...entry.source, chapter: entry.source.chapter || chapter.label }
        : undefined,
      excerpt: entry.source?.excerpt || '',
      entries: [],
      noteCount: 0,
      updatedAt: '',
    };
    group.entries.push(entry);
    if (chapter.order < group.chapterOrder) {
      group.chapterId = chapter.id;
      group.chapter = chapter.label;
      group.chapterOrder = chapter.order;
      group.source = entry.source ? { ...entry.source, chapter: chapter.label } : group.source;
    }
    if (entry.text.trim()) group.noteCount++;
    if (entry.updatedAt > group.updatedAt) group.updatedAt = entry.updatedAt;
    if (!group.excerpt && entry.source?.excerpt) group.excerpt = entry.source.excerpt;
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: group.entries.sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    }))
    .sort(
      (a, b) =>
        a.chapterOrder - b.chapterOrder ||
        (a.source?.cfi && b.source?.cfi ? compareCfi(a.source.cfi, b.source.cfi) : 0) ||
        a.id.localeCompare(b.id),
    );
}
