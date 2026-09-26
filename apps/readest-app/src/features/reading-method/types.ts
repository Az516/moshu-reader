export interface ReadingMethodProfile {
  genre: string;
  goal: string;
  initialThought: string;
  fourQuestions: [string, string, string, string];
}

export interface ReadingSource {
  excerpt: string;
  chapter?: string;
  cfi?: string;
  bookHash?: string;
  /** Snapshot identity; `book-hash:` identifies the library's partial-file hash, not a full digest. */
  bookVersion?: string;
  title?: string;
  author?: string;
  sectionIndex?: number;
  context?: string;
}

export type ReadingRecordKind = 'question' | 'understanding' | 'judgment' | 'review';
export type ReadingRecordStatus = 'open' | 'resolved' | 'kept' | 'discarded';
export type ReadingMethodTab = 'prepare' | 'questions' | 'reflect' | 'review';

export interface ReadingMethodRecord {
  id: string;
  kind: ReadingRecordKind;
  userText: string;
  aiText?: string;
  aiInputText?: string;
  status: ReadingRecordStatus;
  source?: ReadingSource;
  createdAt?: string;
  updatedAt?: string;
}

export type CreateReadingRecord = Omit<ReadingMethodRecord, 'id'>;
export type ReadingRecordPatch = Partial<CreateReadingRecord>;

export interface ReadingMethodPanelProps {
  /** Use the stable book hash so drafts from similarly named books stay separate. */
  bookId?: string;
  bookTitle: string;
  bookAuthor?: string;
  profile: ReadingMethodProfile;
  source?: ReadingSource;
  records: ReadingMethodRecord[];
  onProfileChange: (profile: ReadingMethodProfile) => void | Promise<void>;
  onCreateRecord: (
    input: CreateReadingRecord,
  ) => ReadingMethodRecord | void | Promise<ReadingMethodRecord | void>;
  onUpdateRecord: (id: string, patch: ReadingRecordPatch) => void | Promise<void>;
  onGoToSource: (source: ReadingSource) => void;
  /** Persist AI responses in records; this component never replaces the reader's words. */
  onAskAI: (record: ReadingMethodRecord) => void | Promise<void>;
  onExport: () => void | Promise<void>;
  onOpenContents?: () => void;
  initialTab?: ReadingMethodTab;
  focusRequest?: {
    tab: ReadingMethodTab;
    nonce: number;
    kind?: ReadingRecordKind;
  };
  className?: string;
}
