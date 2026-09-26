import { describe, expect, it } from 'vitest';
import { createResearch, type ThematicResearch } from './thematic';
import {
  getTopicArchiveId,
  getTopicIdentity,
  groupTopicHistory,
  mergeTopicHistory,
} from './thematic-history';

function study(
  id: string,
  firstUserId: string,
  question: string,
  updatedAt: string,
): ThematicResearch {
  return {
    ...createResearch(id),
    question,
    updatedAt,
    messages: [
      { id: firstUserId, role: 'user', questionId: 'main', text: question, passageIds: [] },
    ],
  };
}

describe('theme history identity and presentation', () => {
  it('keeps identity across active-slot copies and repeated legacy archives', () => {
    const original = study('book', 'question-1', '一个问题', '2026-09-24T00:00:00Z');
    const archive = { ...original, id: 'book:legacy-uuid' };
    expect(getTopicIdentity(original)).toBe('question-1');
    expect(getTopicIdentity(archive)).toBe(getTopicIdentity(original));
    expect(getTopicArchiveId('book', original)).toBe('book:topic:question-1');
    expect(getTopicArchiveId('book', archive)).toBe(getTopicArchiveId('book', original));
    expect(getTopicIdentity(createResearch('legacy-without-messages'))).toBe(
      'legacy-without-messages',
    );
  });

  it('keeps the newest duplicate, preserves equal-title topics, filters empty studies and does not mutate input', () => {
    const old = study('book:old', 'q1', '同名主题', '2026-09-22T00:00:00Z');
    const latest = study('book', 'q1', '同名主题', '2026-09-24T00:00:00Z');
    const different = study('other', 'q2', '同名主题', '2026-09-23T00:00:00Z');
    const input = [old, different, latest, createResearch('empty')];
    const snapshot = structuredClone(input);
    expect(mergeTopicHistory(input)).toEqual([latest, different]);
    expect(input).toEqual(snapshot);
  });

  it('prefers the live current snapshot even when its disk timestamp has not advanced', () => {
    const stored = study('archive', 'q1', '已有主题', '2026-09-24T00:00:00Z');
    const current = {
      ...stored,
      id: 'book',
      updatedAt: '2026-09-23T00:00:00Z',
      messages: [
        ...stored.messages,
        {
          id: 'answer-1',
          questionId: 'main',
          role: 'modian' as const,
          text: '正在生成的内容',
          passageIds: [],
          status: 'streaming' as const,
        },
      ],
    };
    expect(mergeTopicHistory([stored], current)).toEqual([current]);
    expect(mergeTopicHistory([stored], createResearch('empty'))).toEqual([stored]);
  });

  it('groups by local calendar days and searches trimmed case-insensitive question titles', () => {
    const now = new Date(2026, 8, 24, 12);
    const dated = (id: string, day: number, hour: number, title = 'Reading') =>
      study(id, `q-${id}`, title, new Date(2026, 8, day, hour).toISOString());
    const today = dated('today', 24, 0, 'Reading Aristotle');
    const yesterday = dated('yesterday', 23, 23, 'READING history');
    const recent = dated('recent', 18, 12, 'Reading notes');
    const old = dated('old', 17, 12, '旧主题');
    expect(groupTopicHistory([old, recent, yesterday, today], '', now)).toEqual([
      { label: '今日', studies: [today] },
      { label: '昨天', studies: [yesterday] },
      { label: '近7天', studies: [recent] },
      { label: '更早', studies: [old] },
    ]);
    expect(groupTopicHistory([old, today, yesterday, recent], '  reADING  ', now)).toEqual([
      { label: '今日', studies: [today] },
      { label: '昨天', studies: [yesterday] },
      { label: '近7天', studies: [recent] },
    ]);
    expect(groupTopicHistory([today], '没有匹配', now)).toEqual([]);
  });
});
