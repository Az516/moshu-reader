import { yieldToReader } from './async-work.ts';

const stop = new Set([
  '一个',
  '哪些',
  '什么',
  '为什么',
  '如何',
  '是否',
  '怎么',
  '觉得',
  '认为',
  '意义是什么',
  'the',
  'is',
  'are',
  'why',
  'how',
  'what',
  'does',
  'and',
  'of',
  'to',
  'in',
]);
export function queryTerms(text: string) {
  const value = text
    .toLocaleLowerCase()
    .replace(/你觉得|你认为|为什么|是什么|怎么样|如何|是否|怎么|一个人|哪些|什么|怎样/g, ' ');
  const terms = new Set<string>();
  for (const part of value.match(/[\p{Script=Han}]+|[a-z0-9]{2,}/gu) ?? []) {
    if (/^[a-z0-9]/.test(part)) terms.add(part);
    else {
      if (part.length >= 3 && part.length <= 12) terms.add(part);
      for (let i = 0; i < part.length - 1; i++) terms.add(part.slice(i, i + 2));
    }
  }
  return [...terms].filter((term) => !stop.has(term));
}

interface RankedText<T> {
  item: T;
  score: number;
  matchedTerms: string[];
}

/** Shared scoring steps keep synchronous callers and the cancellable UI path equivalent. */
function* rankSteps<T>(
  items: T[],
  queries: string[],
  getText: (item: T) => string,
): Generator<void, RankedText<T>[]> {
  const weightedTerms = new Map<string, number>();
  queries.forEach((query, i) => {
    for (const term of queryTerms(query))
      weightedTerms.set(term, Math.max(weightedTerms.get(term) ?? 0, i === 0 ? 1 : 0.65));
  });
  const docs: { item: T; text: string }[] = [];
  const frequencies = new Map<string, number>();
  let totalLength = 0;
  for (const item of items) {
    const text = getText(item).toLocaleLowerCase();
    docs.push({ item, text });
    totalLength += text.length;
    for (const term of weightedTerms.keys()) {
      if (text.includes(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
    if (docs.length % 64 === 0) yield;
  }
  const average = totalLength / Math.max(1, docs.length) || 1;
  let matches: RankedText<T>[] = [];
  for (let index = 0; index < docs.length; index++) {
    const { item, text } = docs[index]!;
    let score = 0;
    const matchedTerms: string[] = [];
    for (const [term, weight] of weightedTerms) {
      let count = 0;
      let offset = text.indexOf(term);
      while (offset !== -1) {
        count++;
        offset = text.indexOf(term, offset + term.length);
      }
      if (!count) continue;
      matchedTerms.push(term);
      const df = frequencies.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score +=
        ((weight * idf * (count * 2.2)) / (count + 1.2 * (0.25 + (0.75 * text.length) / average))) *
        Math.min(3, term.length / 2);
    }
    if (score > 0) matches.push({ item, score, matchedTerms });
    if (index % 64 === 63) yield;
  }
  // Stable merge sort can yield between batches, unlike one large Array.sort call.
  let target: RankedText<T>[] = new Array(matches.length);
  for (let width = 1; width < matches.length; width *= 2) {
    for (let start = 0; start < matches.length; start += 2 * width) {
      const middle = Math.min(start + width, matches.length);
      const end = Math.min(start + 2 * width, matches.length);
      let left = start,
        right = middle;
      for (let index = start; index < end; index++) {
        target[index] =
          right >= end || (left < middle && matches[left]!.score >= matches[right]!.score)
            ? matches[left++]!
            : matches[right++]!;
        if (index % 256 === 255) yield;
      }
    }
    [matches, target] = [target, matches];
  }
  return matches;
}

/** Local BM25-style scoring for small synchronous consumers. */
export function rankTexts<T>(items: T[], queries: string[], getText: (item: T) => string) {
  const steps = rankSteps(items, queries, getText);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/** Search without monopolizing input/paint, including the sorting phase. */
export async function rankTextsAsync<T>(
  items: T[],
  queries: string[],
  getText: (item: T) => string,
  signal?: AbortSignal,
) {
  await yieldToReader(signal);
  const steps = rankSteps(items, queries, getText);
  let sliceStart = performance.now();
  let next = steps.next();
  while (!next.done) {
    signal?.throwIfAborted();
    if (performance.now() - sliceStart >= 8) {
      await yieldToReader(signal);
      sliceStart = performance.now();
    }
    next = steps.next();
  }
  signal?.throwIfAborted();
  return next.value;
}
