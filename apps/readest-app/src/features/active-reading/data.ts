import { readLocalReaderJSON, writeLocalReaderJSON } from '@/services/localReaderPersistence';
import {
  mergeRestoreItems,
  mergeRestoreConflicts,
  stableJSON,
  type LocalRestoreConflict,
} from '@/services/localReaderMerge';
import type { AppService } from '@/types/system';
import type { HighlightStyle } from '@/types/book';
import type {
  ReadingMethodProfile,
  ReadingMethodRecord,
  ReadingSource,
} from '../reading-method/types';

export interface ReadingRecord extends ReadingMethodRecord {
  originalText: string;
  revisions: { text: string; at: string }[];
  model?: string;
  aiInputText?: string;
  aiHistory?: { text: string; model?: string; at: string; inputText?: string }[];
  /** Later passage explicitly confirmed by the reader; source remains the original question. */
  resolutionSource?: ReadingSource;
  /** Visual treatment for the exact passage that carries a saved question. */
  markerStyle?: HighlightStyle;
}

export interface ReadingData {
  version: 1;
  bookHash: string;
  bookTitle: string;
  bookAuthor: string;
  profile: ReadingMethodProfile;
  records: ReadingRecord[];
  updatedAt: string;
  restoreConflicts?: LocalRestoreConflict[];
}

export const emptyReadingData = (
  bookHash: string,
  bookTitle = '',
  bookAuthor = '',
): ReadingData => ({
  version: 1,
  bookHash,
  bookTitle,
  bookAuthor,
  profile: { genre: 'nonfiction', goal: '', initialThought: '', fourQuestions: ['', '', '', ''] },
  records: [],
  updatedAt: new Date().toISOString(),
});

const filename = (hash: string) => `${hash}/reading-method.json`;
const pending = new Map<string, Promise<ReadingData>>();

export function validateReadingData(value: unknown, hash: string): asserts value is ReadingData {
  const data = value as ReadingData | null;
  if (
    !data ||
    data.version !== 1 ||
    data.bookHash !== hash ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.profile?.fourQuestions) ||
    data.profile.fourQuestions.length !== 4 ||
    data.records.some(
      (record) => !record || typeof record.id !== 'string' || typeof record.userText !== 'string',
    )
  ) {
    throw new Error('阅读记录格式无法识别，原文件已保留。');
  }
  if (data.records.some((record) => record.source?.bookHash && record.source.bookHash !== hash))
    throw new Error('记录包含其他书籍的原文，原文件已保留。');
}
export async function loadReadingData(
  service: AppService,
  initial: ReadingData,
): Promise<ReadingData> {
  return readLocalReaderJSON(
    service,
    filename(initial.bookHash),
    'Books',
    (value) => validateReadingData(value, initial.bookHash),
    initial,
  );
}
export function mergeReadingData(current: ReadingData, incoming: ReadingData): ReadingData {
  validateReadingData(current, current.bookHash);
  validateReadingData(incoming, current.bookHash);
  const conflicts: LocalRestoreConflict[] = [];
  if (stableJSON(current.profile) !== stableJSON(incoming.profile))
    conflicts.push({ path: 'profile', current: current.profile, incoming: incoming.profile });
  return {
    ...incoming,
    ...current,
    records: mergeRestoreItems(current.records, incoming.records),
    restoreConflicts: mergeRestoreConflicts(
      current.restoreConflicts,
      incoming.restoreConflicts,
      conflicts,
    ),
  };
}

// Serialize modifications per book, including writes from another open view.
export function mutateReadingData(
  service: AppService,
  initial: ReadingData,
  mutate: (data: ReadingData) => ReadingData,
): Promise<ReadingData> {
  const previous = pending.get(initial.bookHash);
  const task = (async () => {
    await previous?.catch(() => undefined);
    const current = await loadReadingData(service, initial);
    const next = mutate(current);
    if (next.bookHash !== initial.bookHash) throw new Error('无法把记录写入另一本书。');
    if (
      next.records.some(
        (record) => record.source?.bookHash && record.source.bookHash !== initial.bookHash,
      )
    )
      throw new Error('不能保存其他书籍的原文。');
    next.updatedAt = new Date().toISOString();
    await writeLocalReaderJSON(service, filename(initial.bookHash), 'Books', next, (value) =>
      validateReadingData(value, initial.bookHash),
    );
    return next;
  })();
  pending.set(initial.bookHash, task);
  void task
    .finally(() => {
      if (pending.get(initial.bookHash) === task) pending.delete(initial.bookHash);
    })
    .catch(() => undefined);
  return task;
}

const quote = (value: string) =>
  value
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
export function exportReadingMarkdown(data: ReadingData): string {
  const headings = ['全书讲什么', '作者具体怎样说', '我的判断', '对我的意义'];
  const kinds = { question: '疑问', understanding: '理解', judgment: '判断', review: '回顾' };
  const statuses = { open: '待处理', resolved: '已解决', kept: '保留', discarded: '放弃' };
  const sourceIdentity = (source: ReadingSource) => [
    `引用书名：${source.title || data.bookTitle || '未记录'}`,
    `引用作者：${source.author || data.bookAuthor || '未记录'}`,
    `书籍版本：${source.bookVersion || `book-hash:${source.bookHash || data.bookHash}（旧记录未单独保存版本）`}`,
  ];
  const lines = [
    `# ${data.bookTitle} · 阅读记录`,
    '',
    `作者：${data.bookAuthor || '未填写'}`,
    `书库文件标识：${data.bookHash}`,
    '版本中的 book-hash 使用书库已有文件标识（部分 MD5），不是完整文件校验值。',
    `导出时间：${new Date().toISOString()}`,
    '',
    '## 读前',
    '',
    `阅读目标：${data.profile.goal}`,
    `初步判断：${data.profile.initialThought}`,
    '',
    '## 阅读四问',
    '',
  ];
  data.profile.fourQuestions.forEach((answer, i) =>
    lines.push(`### ${headings[i]}`, '', answer || '尚未填写', ''),
  );
  for (const record of data.records) {
    lines.push(
      `## ${kinds[record.kind]} · ${statuses[record.status]}`,
      '',
      `记录时间：${record.createdAt || ''}`,
      '',
    );
    if (record.source) {
      lines.push(
        '### 原文',
        '',
        quote(record.source.excerpt),
        '',
        ...sourceIdentity(record.source),
        `章节：${record.source.chapter || '未命名'}`,
        `原文位置（EPUB CFI）：${record.source.cfi || '无可定位位置'}`,
        '',
      );
      if (record.source.context)
        lines.push('原文邻文（请求小墨对照时使用）：', '', quote(record.source.context), '');
    }
    if (record.resolutionSource) {
      lines.push(
        '### 读者确认的解答原文',
        '',
        quote(record.resolutionSource.excerpt),
        '',
        ...sourceIdentity(record.resolutionSource),
        `章节：${record.resolutionSource.chapter || '未命名'}`,
        `解答原文位置（EPUB CFI）：${record.resolutionSource.cfi || '无可定位位置'}`,
        '',
      );
    }
    lines.push('### 我的内容', '', record.userText, '');
    if (record.originalText !== record.userText)
      lines.push('最初表述：', '', quote(record.originalText), '');
    for (const revision of record.revisions)
      lines.push(`修改前（${revision.at}）：`, '', quote(revision.text), '');
    if (record.aiText)
      lines.push(
        '### 小墨建议',
        '',
        `模型：${record.model || '未记录'}`,
        '',
        '本次对照的个人表述：',
        '',
        quote(record.aiInputText || record.originalText),
        '',
        record.aiText,
        '',
      );
    for (const response of record.aiHistory ?? [])
      lines.push(
        `此前小墨建议（${response.at}，${response.model || '未记录'}）：`,
        '',
        '当时的表述：',
        '',
        quote(response.inputText || ''),
        '',
        response.text,
        '',
      );
  }
  return lines.join('\n');
}
