import * as CFI from 'foliate-js/epubcfi.js';
import type { ReadingData, ReadingRecord } from '../active-reading/data';
import type { ReadingSource } from '../reading-method/types';

const ignoredWords = new Set(
  `about after again also author because been before being could does from have into just many more most only other over said should some that their them then there these they this those through very were what when where which while will with would your mean means says
  为什么 什么 怎么 如何 是否 这个 那个 这些 那些 自己 我们 你们 他们 作者 原文 本文 这段 这一句 一句 理解 问题 疑问 意思 认为 知道 可能 应该 因为 所以 如果 但是 还有 已经 可以 没有 一个 一种 一些 这样 那样 稍后 再想`.split(
    /\s+/,
  ),
);
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

function keywords(text: string): Set<string> {
  return new Set(
    [...segmenter.segment(text.toLocaleLowerCase().normalize('NFKC'))]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment)
      .filter(
        (word) =>
          !ignoredWords.has(word) &&
          (/^\p{Script=Han}{2,}$/u.test(word) || /^\p{Letter}{4,}$/u.test(word)),
      ),
  );
}

function follows(original: ReadingSource, passage: ReadingSource): boolean {
  if (
    !original.bookHash ||
    original.bookHash !== passage.bookHash ||
    !original.cfi?.startsWith('epubcfi(') ||
    !passage.cfi?.startsWith('epubcfi(') ||
    original.excerpt.trim() === passage.excerpt.trim()
  )
    return false;
  try {
    // A visible range may start inside the earlier question; compare its start
    // to the question's end, not merely their starting positions.
    return CFI.compare(CFI.collapse(original.cfi, true), CFI.collapse(passage.cfi)) < 0;
  } catch {
    return false;
  }
}

export interface QuestionClue {
  question: ReadingRecord;
  passage: ReadingSource;
  keywords: string[];
}

/** Matching is a reading lead only. No status is changed by finding a lead. */
export function findQuestionFollowup(
  records: ReadingRecord[],
  passage: ReadingSource,
  ignored: ReadonlySet<string> = new Set(),
): QuestionClue | undefined {
  const visibleWords = keywords(passage.excerpt.slice(0, 6000));
  for (const question of records) {
    if (
      question.kind !== 'question' ||
      question.status !== 'open' ||
      ignored.has(question.id) ||
      !question.source ||
      !follows(question.source, passage)
    )
      continue;
    const ownWords = keywords(question.userText);
    const searchWords = ownWords.size >= 2 ? ownWords : keywords(question.source.excerpt);
    const matched = [...searchWords].filter((word) => visibleWords.has(word));
    if (matched.length >= (ownWords.size >= 2 ? 2 : 3))
      return { question, passage, keywords: matched.slice(0, 4) };
  }
  return undefined;
}

/** Called only by the reader's explicit confirmation, against freshly loaded data. */
export function resolveQuestionFollowup(
  data: ReadingData,
  id: string,
  passage: ReadingSource,
  now = new Date().toISOString(),
): ReadingData {
  const question = data.records.find((record) => record.id === id);
  if (data.bookHash !== passage.bookHash || !question || !findQuestionFollowup([question], passage))
    return data;
  return {
    ...data,
    records: data.records.map((record) =>
      record.id === id
        ? { ...record, status: 'resolved', resolutionSource: { ...passage }, updatedAt: now }
        : record,
    ),
  };
}
