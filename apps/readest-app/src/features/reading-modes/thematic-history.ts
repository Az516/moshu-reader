import type { ThematicResearch } from './thematic';

/** Active-book copies and archived snapshots retain their first question's ID. */
export function getTopicIdentity(study: ThematicResearch): string {
  return study.messages.find((message) => message.role === 'user')?.id || study.id;
}

export function getTopicArchiveId(bookHash: string, study: ThematicResearch): string {
  return `${bookHash}:topic:${getTopicIdentity(study)}`;
}

const updatedTime = (study: ThematicResearch): number => Date.parse(study.updatedAt) || 0;

/** Prefer the live snapshot, whose disk timestamp can lag behind streamed content. */
export function mergeTopicHistory(
  studies: readonly ThematicResearch[],
  current?: ThematicResearch,
): ThematicResearch[] {
  const topics = new Map<string, ThematicResearch>();
  for (const study of studies) {
    if (!study.messages.length) continue;
    const identity = getTopicIdentity(study);
    const previous = topics.get(identity);
    if (!previous || updatedTime(study) > updatedTime(previous)) topics.set(identity, study);
  }
  if (current?.messages.length) topics.set(getTopicIdentity(current), current);
  return [...topics.values()].sort((left, right) => updatedTime(right) - updatedTime(left));
}

export interface TopicHistoryGroup {
  label: '今日' | '昨天' | '近7天' | '更早';
  studies: ThematicResearch[];
}

export function groupTopicHistory(
  studies: readonly ThematicResearch[],
  query: string,
  now = new Date(),
): TopicHistoryGroup[] {
  // Calendar boundaries preserve local dates across daylight-saving changes.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const groups: TopicHistoryGroup[] = [
    { label: '今日', studies: [] },
    { label: '昨天', studies: [] },
    { label: '近7天', studies: [] },
    { label: '更早', studies: [] },
  ];
  const search = query.trim().toLowerCase();
  for (const study of mergeTopicHistory(studies)) {
    if (search && !study.question.toLowerCase().includes(search)) continue;
    const time = updatedTime(study);
    const index = time >= +today ? 0 : time >= +yesterday ? 1 : time >= +weekStart ? 2 : 3;
    groups[index]!.studies.push(study);
  }
  return groups.filter((group) => group.studies.length > 0);
}
