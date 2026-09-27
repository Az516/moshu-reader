import type { BookNote } from '@/types/book';
import type { LocalRestoreConflict } from '@/services/localReaderMerge';
import type { ReadingRecord } from '../active-reading/data';
import type { ReadingSource } from '../reading-method/types';

export interface ArchiveEntry {
  /** Namespaced original identity, e.g. reading:<id> or native:<id>. */
  id: string;
  originalId: string;
  origin: 'native' | 'reading' | 'capture' | 'reconstruction';
  kind: 'note' | 'question' | 'highlight' | 'bookmark' | 'chapter' | 'notebook';
  text: string;
  createdAt: string;
  updatedAt: string;
  status?: string;
  source?: ReadingSource;
  native?: BookNote;
  reading?: ReadingRecord;
}

export interface ArchiveGroup {
  id: string;
  chapterId: string;
  chapter: string;
  chapterOrder: number;
  source?: ReadingSource;
  excerpt: string;
  entries: ArchiveEntry[];
  noteCount: number;
  updatedAt: string;
}

export interface BookReflection {
  id: string;
  title: string;
  text: string;
  /** ArchiveEntry IDs; the text remains independently editable. */
  references: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BookAnalysisReport {
  id: string;
  title: string;
  text: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  scope: string;
  entryIds: string[];
  reflectionIds: string[];
  /** Fingerprint of the complete chosen input, used to detect newer material. */
  inputVersion: string;
  coverage: {
    entries: number;
    reflections: number;
    totalEntries: number;
    totalReflections: number;
  };
}

export interface BookNotesData {
  version: 1;
  bookHash: string;
  reflections: BookReflection[];
  reports: BookAnalysisReport[];
  updatedAt: string;
  restoreConflicts?: LocalRestoreConflict[];
}

export interface ArchiveChapter {
  id: string;
  label: string;
  order: number;
  sectionIndex?: number;
  href?: string;
  cfi?: string;
}

export interface BookNotesExport {
  schemaVersion: 1;
  exportedAt: string;
  book: { hash: string; title: string; author: string };
  groups: ArchiveGroup[];
  reflections: BookReflection[];
  reports: BookAnalysisReport[];
}
