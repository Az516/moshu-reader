import type { ReadingMethodProfile, ReadingRecordKind, ReadingSource } from './types';

export interface ComposerDraft {
  userText: string;
  source?: ReadingSource;
}

export interface ReadingMethodDrafts {
  profile?: ReadingMethodProfile;
  composers: Record<ReadingRecordKind, ComposerDraft>;
  recordEdits: Record<string, string>;
}

export function emptyDrafts(): ReadingMethodDrafts {
  return {
    composers: {
      question: { userText: '' },
      understanding: { userText: '' },
      judgment: { userText: '' },
      review: { userText: '' },
    },
    recordEdits: {},
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSource(value: unknown): ReadingSource | undefined {
  if (!isObject(value) || typeof value['excerpt'] !== 'string') return undefined;
  return {
    excerpt: value['excerpt'],
    ...(typeof value['chapter'] === 'string' ? { chapter: value['chapter'] } : {}),
    ...(typeof value['cfi'] === 'string' ? { cfi: value['cfi'] } : {}),
    ...(typeof value['bookHash'] === 'string' ? { bookHash: value['bookHash'] } : {}),
    ...(typeof value['sectionIndex'] === 'number' ? { sectionIndex: value['sectionIndex'] } : {}),
    ...(typeof value['context'] === 'string' ? { context: value['context'] } : {}),
  };
}

/** Draft storage is best-effort; saved records remain the parent's responsibility. */
export function readDrafts(key: string): ReadingMethodDrafts {
  const drafts = emptyDrafts();
  if (typeof window === 'undefined') return drafts;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (!isObject(raw) || raw['version'] !== 1 || !isObject(raw['drafts'])) return drafts;
    const value = raw['drafts'];
    const profile = value['profile'];
    if (
      isObject(profile) &&
      typeof profile['genre'] === 'string' &&
      typeof profile['goal'] === 'string' &&
      typeof profile['initialThought'] === 'string' &&
      Array.isArray(profile['fourQuestions']) &&
      profile['fourQuestions'].length === 4 &&
      profile['fourQuestions'].every((question) => typeof question === 'string')
    ) {
      drafts.profile = {
        genre: profile['genre'],
        goal: profile['goal'],
        initialThought: profile['initialThought'],
        fourQuestions: [...profile['fourQuestions']] as ReadingMethodProfile['fourQuestions'],
      };
    }
    if (isObject(value['composers'])) {
      for (const kind of Object.keys(drafts.composers) as ReadingRecordKind[]) {
        const composer = value['composers'][kind];
        if (isObject(composer) && typeof composer['userText'] === 'string') {
          drafts.composers[kind] = {
            userText: composer['userText'],
            source: readSource(composer['source']),
          };
        }
      }
    }
    if (isObject(value['recordEdits'])) {
      for (const [id, userText] of Object.entries(value['recordEdits'])) {
        if (typeof userText === 'string') drafts.recordEdits[id] = userText;
      }
    }
  } catch {
    // An unavailable/corrupt draft cache must never prevent opening a book.
  }
  return drafts;
}

export function writeDrafts(key: string, drafts: ReadingMethodDrafts): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const hasDraft =
      drafts.profile !== undefined ||
      Object.values(drafts.composers).some((draft) => draft.userText || draft.source) ||
      Object.keys(drafts.recordEdits).length > 0;
    if (hasDraft) {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, drafts }));
    } else {
      window.localStorage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}
