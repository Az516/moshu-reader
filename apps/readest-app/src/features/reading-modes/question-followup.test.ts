import { describe, expect, it } from 'vitest';
import { emptyReadingData, type ReadingRecord } from '../active-reading/data';
import type { ReadingSource } from '../reading-method/types';
import { findQuestionFollowup, resolveQuestionFollowup } from './question-followup';

const original: ReadingSource = {
  bookHash: 'book',
  cfi: 'epubcfi(/6/2!/4/2:0)',
  excerpt: 'Why does the White Rabbit carry a pocket watch?',
};
const question: ReadingRecord = {
  id: 'question-1',
  kind: 'question',
  status: 'open',
  source: original,
  userText: 'Why does the rabbit carry a pocket watch?',
  originalText: 'Why does the rabbit carry a pocket watch?',
  revisions: [],
};
const later: ReadingSource = {
  bookHash: 'book',
  cfi: 'epubcfi(/6/2!/4/8:0)',
  excerpt: 'The rabbit checks the watch again because the appointment is approaching.',
};

describe('conservative local question follow-up', () => {
  it('offers a later same-book passage with several matching terms without resolving it', () => {
    const clue = findQuestionFollowup([question], later);
    expect(clue?.keywords).toEqual(expect.arrayContaining(['rabbit', 'watch']));
    expect(clue?.question).toBe(question);
    expect(question.status).toBe('open');
  });

  it('matches meaningful Chinese words without requiring a model', () => {
    const chinese = {
      ...question,
      userText: '为什么劳动分工提高生产效率？',
      source: { ...original, excerpt: '劳动分工会影响生产效率。' },
    };
    expect(
      findQuestionFollowup([chinese], {
        ...later,
        excerpt: '劳动分工使工人不断重复操作，生产效率因此提高。',
      })?.keywords.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('does not match other books, missing anchors, or earlier passages', () => {
    for (const passage of [
      { ...later, bookHash: 'other' },
      { ...later, cfi: undefined },
      { ...later, cfi: 'invalid' },
      { ...later, cfi: original.cfi },
      { ...later, cfi: 'epubcfi(/6/2!/4/1:0)' },
    ])
      expect(findQuestionFollowup([question], passage)).toBeUndefined();
    expect(findQuestionFollowup([{ ...question, source: undefined }], later)).toBeUndefined();
  });

  it('does not treat a visible range that overlaps the original question as later text', () => {
    const overlapping = {
      ...question,
      source: { ...original, cfi: 'epubcfi(/6/2!/4,/2:0,/10:20)' },
    };
    expect(findQuestionFollowup([overlapping], later)).toBeUndefined();
  });

  it('ignores closed questions, other record kinds, and clues already dismissed this session', () => {
    for (const status of ['resolved', 'discarded', 'kept'] as const)
      expect(findQuestionFollowup([{ ...question, status }], later)).toBeUndefined();
    expect(findQuestionFollowup([{ ...question, kind: 'understanding' }], later)).toBeUndefined();
    expect(findQuestionFollowup([question], later, new Set([question.id]))).toBeUndefined();
  });

  it('requires at least two distinct meaningful words with real word boundaries', () => {
    expect(
      findQuestionFollowup([question], { ...later, excerpt: 'Only a rabbit appears.' }),
    ).toBeUndefined();
    expect(
      findQuestionFollowup([question], { ...later, excerpt: 'Rabbits enjoy watching.' }),
    ).toBeUndefined();
    expect(
      findQuestionFollowup(
        [
          {
            ...question,
            userText: 'What does this mean?',
            source: { ...original, excerpt: 'This is what the author says.' },
          },
        ],
        { ...later, excerpt: 'This is what the author means.' },
      ),
    ).toBeUndefined();
  });

  it('does not offer a verbatim copy of the original excerpt as a new clue', () => {
    expect(
      findQuestionFollowup([question], { ...later, excerpt: original.excerpt }),
    ).toBeUndefined();
  });

  it('explicit confirmation preserves the question anchor and saves the answering passage', () => {
    const data = { ...emptyReadingData('book'), records: [question] };
    const resolved = resolveQuestionFollowup(data, question.id, later, '2026-09-21T00:00:00Z');
    expect(resolved.records[0]).toMatchObject({
      status: 'resolved',
      source: original,
      resolutionSource: later,
      updatedAt: '2026-09-21T00:00:00Z',
    });
    expect(data.records[0]?.status).toBe('open');
  });

  it('revalidates the latest stored record before applying the confirmation', () => {
    const data = {
      ...emptyReadingData('book'),
      records: [{ ...question, status: 'discarded' as const }],
    };
    expect(resolveQuestionFollowup(data, question.id, later)).toBe(data);
    expect(resolveQuestionFollowup(data, question.id, { ...later, bookHash: 'other' })).toBe(data);
  });
});
