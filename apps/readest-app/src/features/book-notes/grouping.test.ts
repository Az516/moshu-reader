import { expect, it } from 'vitest';
import type { BookNote } from '@/types/book';
import { emptyReadingData } from '../active-reading/data';
import { emptyModeState } from '../reading-modes/state';
import { buildArchiveGroups } from './grouping';
import { createBookNotesExport, exportBookNotes } from './export';
import { emptyBookNotesData } from './data';

const book = { hash: 'book', title: 'Book', author: 'Author' };
const cfi = 'epubcfi(/6/2!/4/2)';
it('sorts by actual source positions, separates versions, and preserves repeated chapter labels', () => {
  const readingData = emptyReadingData(book.hash);
  readingData.records = [
    ['late', 'epubcfi(/6/4!/4/6)', undefined],
    ['early', 'epubcfi(/6/2!/4/2)', undefined],
    ['edition', 'epubcfi(/6/2!/4/2)', 'other-edition'],
  ].map(([id, cfi, bookVersion]) => ({
    id: id!,
    userText: id!,
    originalText: id!,
    revisions: [],
    kind: 'understanding',
    status: 'kept',
    source: { cfi, bookVersion, excerpt: 'same text' },
  }));
  const groups = buildArchiveGroups({
    book,
    readingData,
    chapters: [
      { id: 'first', label: '同名章节', order: 0, cfi: 'epubcfi(/6/2!/4)' },
      { id: 'second', label: '同名章节', order: 1, cfi: 'epubcfi(/6/4!/4)' },
    ],
  });
  expect(groups).toHaveLength(3);
  expect(groups.map((group) => group.chapterId)).toEqual(['first', 'first', 'second']);
  expect(groups.at(-1)?.entries[0]?.originalId).toBe('late');
});
it('groups exact same source across origins, retains all thoughts, and never merges equal text at different locations', () => {
  const booknotes: BookNote[] = [
    {
      id: 'native',
      type: 'annotation',
      cfi,
      text: 'quote',
      note: 'first thought',
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: 'highlight',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2)',
      text: 'quote',
      note: '',
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const readingData = emptyReadingData(book.hash);
  readingData.records = [
    {
      id: 'new',
      kind: 'understanding',
      status: 'kept',
      userText: 'second thought',
      originalText: 'second thought',
      revisions: [],
      source: { bookHash: book.hash, cfi, excerpt: 'quote' },
    },
    {
      id: 'free',
      kind: 'question',
      status: 'open',
      userText: 'unanchored',
      originalText: 'unanchored',
      revisions: [],
    },
  ];
  const groups = buildArchiveGroups({ book, booknotes, readingData });
  expect(groups).toHaveLength(3);
  expect(groups.find((group) => group.source?.cfi === cfi)?.entries).toHaveLength(2);
  expect(groups.reduce((sum, group) => sum + group.noteCount, 0)).toBe(3);
  expect(groups.find((group) => group.entries[0]?.originalId === 'free')?.chapter).toBe('全书笔记');
});
it('keeps duplicate chapter titles distinct, includes captures and notebook, and exports every layer', () => {
  const modeState = emptyModeState(book.hash);
  modeState.captures = { 'section:2:two.xhtml': 'chapter thought' };
  const groups = buildArchiveGroups({
    book,
    booknotes: [
      {
        id: 'legacy',
        type: 'notebook',
        cfi: '',
        note: 'old reflection',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    modeState,
    chapters: [{ id: 'two', label: '相同标题', order: 2, sectionIndex: 2, href: 'two.xhtml' }],
  });
  expect(groups.find((group) => group.entries[0]?.origin === 'capture')?.chapterId).toBe('two');
  const data = emptyBookNotesData(book.hash);
  data.reflections.push({
    id: 'r',
    title: 'Finished',
    text: 'new reflection',
    references: [],
    createdAt: 'now',
    updatedAt: 'now',
  });
  const snapshot = createBookNotesExport(book, groups, data);
  const json = JSON.parse(exportBookNotes(snapshot, 'json'));
  expect(json.schemaVersion).toBe(1);
  expect(json.groups).toHaveLength(2);
  for (const format of ['markdown', 'text'] as const) {
    const output = exportBookNotes(snapshot, format);
    expect(output).toContain('old reflection');
    expect(output).toContain('new reflection');
    expect(output).toContain('chapter thought');
  }
});
