import { readLocalReaderJSON, writeLocalReaderJSON } from '@/services/localReaderPersistence';
import { mergeRestoreItems } from '@/services/localReaderMerge';
import type { PublicReadingSource } from '../active-reading/ai';
import {
  CONVERSATION_SYSTEM,
  conversationHistory,
  conversationInstruction,
  planConversation,
} from './conversation';
import { queryTerms, rankTexts } from './retrieval';
import type { AppService } from '@/types/system';
import type { ReadingRecord } from '../active-reading/data';
import type { ReadingSource } from '../reading-method/types';

export function shouldSendComposerMessage(event: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
}) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

export interface ResearchChapter {
  id: string;
  label: string;
  cfi?: string;
  sectionIndex?: number;
}
export interface ResearchReadingRecord extends ReadingRecord {
  passageId?: string;
  bookVersion?: string;
  contentHash?: string;
  score?: number;
}
export interface ResearchBook {
  hash: string;
  title: string;
  author: string;
  cover?: string | null;
  chapters: ResearchChapter[];
  records: ResearchReadingRecord[];
  loadWarning?: string;
}
export interface ResearchEvidence {
  score?: number;
  relevance?: 'direct' | 'related';
  id: string;
  source: ReadingSource;
  readingNote: string;
  bookVersion?: string;
  contentHash?: string;
}
export interface ResearchCell {
  proposition: string;
  evidence: ResearchEvidence[];
}
export interface ConceptAlignment {
  id: string;
  concept: string;
  terms: Record<string, string>;
  distinction: string;
  confirmed?: boolean;
  mappings?: Record<string, 'equivalent' | 'overlapping' | 'related' | 'distinct' | 'uncertain'>;
}
export type ViewpointRelationType =
  | 'similar'
  | 'complementary'
  | 'different_scope'
  | 'conflicting'
  | 'unanswered';
export const RELATION_LABELS: Record<ViewpointRelationType, string> = {
  similar: '观点相近',
  complementary: '相互补充',
  different_scope: '讨论范围不同',
  conflicting: '确实冲突',
  unanswered: '没有直接回答',
};
export interface Viewpoint {
  id: string;
  questionId: string;
  bookId: string;
  claim: string;
  reasons: string[];
  scope: string;
  authorTerms: string[];
  passageIds: string[];
  status: 'draft' | 'confirmed' | 'rejected';
}
export interface ViewpointRelation {
  id: string;
  questionId: string;
  viewpointIds: string[];
  type: ViewpointRelationType;
  explanation: string;
  passageIds: string[];
  userConfirmed: boolean;
}
export interface TopicMessage {
  id: string;
  questionId: string;
  role: 'user' | 'modian';
  text: string;
  passageIds: string[];
  citationMap?: string[];
  status?: 'streaming' | 'complete' | 'stopped' | 'error';
  sourceReview?: 'checked' | 'unavailable' | 'not-needed';
  publicSources?: PublicReadingSource[];
  searchStatus?: string;
}
export interface ThematicResearch {
  stage: 1 | 2 | 3 | 4 | 5;
  scope: string;
  exclusions: string;
  viewpoints: Viewpoint[];
  relations: ViewpointRelation[];
  messages: TopicMessage[];
  synthesisStep: 'relations' | 'discussion' | 'judgment';
  personalMeaning: string;
  followupDraft: string;
  subQuestionDraft: string;
  currentQuestionIndex: number;
  commonGround: string;
  disagreement: string;
  id: string;
  question: string;
  subQuestions: { id: string; text: string }[];
  selectedBooks: string[];
  bookSelectionManual?: boolean;
  chapters: Record<string, string[]>;
  confirmed: boolean;
  concepts: ConceptAlignment[];
  cells: Record<string, ResearchCell>;
  synthesis: string;
  synthesisEvidence: string[];
  updatedAt: string;
}
export interface ResearchFile {
  version: 1;
  studies: Record<string, ThematicResearch>;
}
export const createResearch = (id: string): ThematicResearch => ({
  id,
  stage: 1,
  scope: '',
  exclusions: '',
  viewpoints: [],
  relations: [],
  messages: [],
  synthesisStep: 'relations',
  personalMeaning: '',
  followupDraft: '',
  subQuestionDraft: '',
  currentQuestionIndex: 0,
  commonGround: '',
  disagreement: '',
  question: '',
  subQuestions: [],
  selectedBooks: [],
  chapters: {},
  confirmed: false,
  concepts: [],
  cells: {},
  synthesis: '',
  synthesisEvidence: [],
  updatedAt: new Date().toISOString(),
});

export function recommendBooks(question: string, books: ResearchBook[]) {
  const terms = queryTerms(question);
  const matches = (text: string) => terms.some((term) => text.toLocaleLowerCase().includes(term));
  return books
    .map((book) => {
      const titleMatch = matches(`${book.title} ${book.author}`);
      const chapters = book.chapters.filter((chapter) => matches(chapter.label));
      const records = book.records.filter(
        (record) =>
          record.status !== 'discarded' &&
          (Boolean(record.passageId && record.score) ||
            matches(
              `${record.userText} ${record.source?.excerpt ?? ''} ${record.source?.chapter ?? ''}`,
            )),
      );
      const reasons = [
        ...(titleMatch ? ['书名或作者与问题中的词语相符'] : []),
        ...chapters.slice(0, 2).map((chapter) => `目录「${chapter.label}」包含相关词语`),
        ...(records.length ? [`${records.length} 处候选原文或阅读思考包含相关词语`] : []),
      ];
      return {
        book,
        score: Number(titleMatch) * 3 + chapters.length * 2 + records.length,
        reasons,
        chapterIds: chapters.map((chapter) => chapter.id),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Build the small, local knowledge base used for one thematic answer.
 * Indexed passages already represent a query match; saved reading records are
 * included when their book was selected so the reader's own notes can be cited
 * beside the original passage they were anchored to.
 */
export function buildKnowledgeBase(
  question: string,
  books: ResearchBook[],
  selectedBookIds?: string[],
): { books: ResearchBook[]; evidence: ResearchEvidence[] } {
  if (!question.trim()) return { books: [], evidence: [] };
  const recommendations = recommendBooks(question, books);
  const selected =
    selectedBookIds !== undefined
      ? new Set(selectedBookIds)
      : new Set(recommendations.filter((item) => item.score > 0).map((item) => item.book.hash));
  const selectedBooks = recommendations
    .filter((item) => selected.has(item.book.hash))
    .map((item) => item.book);
  const terms = queryTerms(question);
  const candidates = selectedBooks.flatMap((book) =>
    book.records
      .filter(
        (record) =>
          record.status !== 'discarded' &&
          (record.passageId ||
            terms.some((term) =>
              `${record.userText} ${record.source?.excerpt ?? ''} ${record.source?.chapter ?? ''}`
                .toLocaleLowerCase()
                .includes(term),
            )),
      )
      .sort((a, b) => Number(Boolean(b.userText.trim())) - Number(Boolean(a.userText.trim())))
      .flatMap((record) => {
        const source = record.source;
        if (!source?.excerpt || (!source.cfi && source.sectionIndex === undefined)) return [];
        return [
          {
            id: evidenceIdForRecord(book.hash, record),
            source: { ...source, bookHash: book.hash, title: book.title, author: book.author },
            readingNote: record.userText,
            bookVersion: record.bookVersion ?? book.hash,
            contentHash: record.contentHash,
            score: record.score,
          },
        ];
      }),
  );
  const ranked = rankTexts(
    candidates,
    [question],
    (item) => `${item.source.excerpt} ${item.readingNote} ${item.source.chapter ?? ''}`,
  );
  const scores = new Map(ranked.map(({ item, score }) => [item.id, score]));
  const evidence = balanceEvidence(
    candidates
      .map((item) => ({ ...item, score: item.score ?? scores.get(item.id) ?? 0 }))
      .filter((item) => item.score > 0),
  );
  return { books: selectedBooks, evidence };
}

/** Rank by relevance and deduplicate; no book is owed an evidence slot. */
export function balanceEvidence(items: ResearchEvidence[]) {
  const seen = new Set<string>();
  let chars = 0;
  return [...items]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .filter((item) => {
      const identity = `${item.source.bookHash}:${item.source.excerpt.trim()}:${item.readingNote.trim()}`;
      if (seen.has(item.id) || seen.has(identity)) return false;
      const size =
        item.source.excerpt.length +
        item.readingNote.length +
        Math.min(1200, item.source.context?.length ?? 0);
      if (seen.size >= 48 || chars + size > 26000) return false;
      seen.add(item.id);
      seen.add(identity);
      chars += size;
      return true;
    });
}

export function citedPassageIds(text: string, evidence: ResearchEvidence[]) {
  return [
    ...new Set(
      [...text.matchAll(/\[(\d+)\]/g)].flatMap((match) => {
        const item = evidence[Number(match[1]) - 1];
        return item ? [item.id] : [];
      }),
    ),
  ];
}

export function buildThematicPrompt(
  question: string,
  evidence: ResearchEvidence[],
  history: TopicMessage[] = [],
  context: { publicSources?: PublicReadingSource[]; searchStatus?: string } = {},
) {
  const plan = planConversation(question, history);
  const independentDiscussion =
    plan.sourceScope === 'all' &&
    ['opinion', 'reason', 'challenge', 'apply'].includes(plan.intent) &&
    !/书里|书中|作者|原文|引用|这些书/.test(question);
  const sources = independentDiscussion ? [] : evidence;
  return {
    reasoning: true,
    system: `${CONVERSATION_SYSTEM}\n使用资料中的主要事实或作者观点时在句末标注本轮编号，如 [1]。只能引用实际支持该说法的资料，不能把邻文的观点归到选文，也不能把用户笔记当作者原话。对一般分析无需硬凑引用。`,
    history: conversationHistory(history),
    prompt: `${conversationInstruction(plan)}\n\n今天日期：${new Date().toISOString().slice(0, 10)}\n最新问题：${question.slice(0, 6000)}\n\n本轮可引用资料（编号仅在本轮有效；可以一条也不引用）：\n${JSON.stringify(
      sources.map((item, index) => ({
        number: index + 1,
        book: item.source.title,
        author: item.source.author,
        chapter: item.source.chapter,
        excerpt: item.source.excerpt,
        nearbyText: item.source.context?.slice(0, 1600),
        readerNote: item.readingNote,
        relevance: item.relevance,
      })),
    )}\n公开资料（只能引用实际链接）：${JSON.stringify(context.publicSources ?? [])}\n${context.searchStatus ?? ''}\n${independentDiscussion ? '本轮重点是对话与推理，先前的书籍结论已经讨论过，不重新列举作者、引文或资料概览。' : ''}\n${!sources.length ? '本轮没有提供书中引用。不要把未找到材料说成问题无法讨论；遵守读者的来源范围。' : ''}`,
  };
}

export async function streamThematicAnswer(
  question: string,
  evidence: ResearchEvidence[],
  history: TopicMessage[],
  signal: AbortSignal,
  onChunk: (text: string) => void,
  context: { publicSources?: PublicReadingSource[]; searchStatus?: string } = {},
) {
  const { streamConversationText } = await import('../active-reading/ai');
  return streamConversationText(
    buildThematicPrompt(question, evidence, history, context),
    signal,
    onChunk,
    history.length && !/详细|展开|深入|长文/.test(question) ? 1200 : 2400,
  );
}

export const cellKey = (questionId: string, bookHash: string) => `${questionId}::${bookHash}`;
export const evidenceIdForRecord = (bookHash: string, record: ResearchReadingRecord) =>
  record.passageId || `${bookHash}:${record.id}`;
export function attachEvidence(
  research: ThematicResearch,
  questionId: string,
  bookHash: string,
  record: ResearchReadingRecord,
): ThematicResearch {
  const source = record.source;
  if (!research.selectedBooks.includes(bookHash)) throw new Error('请先把这本书加入研究范围。');
  if (
    !source?.excerpt ||
    (!source.cfi && source.sectionIndex === undefined) ||
    (source.bookHash && source.bookHash !== bookHash)
  )
    throw new Error('这条记录没有可核对的本书原文位置。');
  const key = cellKey(questionId, bookHash);
  const previous = research.cells[key] ?? { proposition: '', evidence: [] };
  const id = evidenceIdForRecord(bookHash, record);
  if (previous.evidence.some((item) => item.id === id)) return research;
  return {
    ...research,
    cells: {
      ...research.cells,
      [key]: {
        ...previous,
        evidence: [
          ...previous.evidence,
          {
            id,
            source: { ...source, bookHash },
            readingNote: record.userText,
            bookVersion: record.bookVersion ?? bookHash,
            contentHash: record.contentHash,
          },
        ],
      },
    },
  };
}
export function getEvidenceGaps(research: ThematicResearch): string[] {
  const activeCells = Object.entries(research.cells)
    .filter(([key]) => research.selectedBooks.some((hash) => key.endsWith(`::${hash}`)))
    .map(([, cell]) => cell);
  if (!activeCells.some((cell) => cell.evidence.length))
    return ['你的判断可以先从哪一条书中原文得到支持？请先为作者观点选择一处原文。'];
  const questions: string[] = [];
  if (activeCells.some((cell) => cell.proposition.trim() && !cell.evidence.length))
    questions.push('观点清单里有命题还没有原文依据：它是作者明说的，还是你的推断？');
  const represented = new Set(
    activeCells.flatMap((cell) => cell.evidence.map((item) => item.source.bookHash)),
  );
  if (research.selectedBooks.some((hash) => !represented.has(hash)))
    questions.push('有研究书目尚未提供原文。补入证据后，你的判断还成立吗？');
  if (!research.synthesisEvidence.length)
    questions.push('你的综合判断依赖哪几条书中证据？请勾选引用，让读者能回到原文。');
  if (!research.synthesis.trim())
    questions.push('先用自己的话写出暂时的判断：这些作者在哪一点相同，又在哪一点分歧？');
  if (!questions.length)
    questions.push('这些作者是在回答同一个问题吗？哪一条原文最可能限制或反驳你的判断？');
  return questions;
}

const FILENAME = 'thematic-research.json';
const pending = new WeakMap<AppService, Promise<void>>();
export function validateResearchFile(data: unknown): asserts data is ResearchFile {
  if (
    !data ||
    typeof data !== 'object' ||
    !('version' in data) ||
    data.version !== 1 ||
    !('studies' in data) ||
    !data.studies ||
    typeof data.studies !== 'object' ||
    Array.isArray(data.studies)
  )
    throw new Error('主题研究文件格式无法识别，原文件已保留。');
  for (const study of Object.values(data.studies)) {
    if (
      !study ||
      typeof study !== 'object' ||
      typeof study.id !== 'string' ||
      typeof study.question !== 'string' ||
      !Array.isArray(study.subQuestions) ||
      !Array.isArray(study.selectedBooks) ||
      !Array.isArray(study.concepts) ||
      !Array.isArray(study.synthesisEvidence) ||
      !study.cells ||
      !study.chapters ||
      typeof study.synthesis !== 'string'
    )
      throw new Error('主题研究记录不完整，原文件已保留。');
  }
}
export async function readResearchFile(service: AppService): Promise<ResearchFile> {
  return readLocalReaderJSON(service, FILENAME, 'Data', validateResearchFile, {
    version: 1,
    studies: {},
  });
}
export function mergeResearchFiles(current: ResearchFile, incoming: ResearchFile): ResearchFile {
  validateResearchFile(current);
  validateResearchFile(incoming);
  return {
    version: 1,
    studies: Object.fromEntries(
      mergeRestoreItems(Object.values(current.studies), Object.values(incoming.studies)).map(
        (study) => [study.id, study],
      ),
    ),
  };
}
export async function loadThematicResearch(
  service: AppService,
  id: string,
): Promise<ThematicResearch> {
  await pending.get(service)?.catch(() => undefined);
  const file = await readResearchFile(service);
  const existing =
    file.studies[id] ??
    Object.values(file.studies)
      .filter((study) => study.selectedBooks.includes(id))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return { ...createResearch(existing?.id ?? id), ...existing };
}
export async function listThematicResearch(service: AppService): Promise<ThematicResearch[]> {
  await pending.get(service)?.catch(() => undefined);
  return Object.values((await readResearchFile(service)).studies)
    .filter((study) => study.messages?.length)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function saveThematicResearch(
  service: AppService,
  research: ThematicResearch,
): Promise<void> {
  const previous = pending.get(service);
  const task = (async () => {
    await previous?.catch(() => undefined);
    const file = await readResearchFile(service);
    file.studies[research.id] = { ...research, updatedAt: new Date().toISOString() };
    await writeLocalReaderJSON(service, FILENAME, 'Data', file, validateResearchFile);
  })();
  pending.set(service, task);
  void task
    .finally(() => {
      if (pending.get(service) === task) pending.delete(service);
    })
    .catch(() => undefined);
  return task;
}

export function validatePassageIds(
  ids: string[],
  evidence: ResearchEvidence[],
  bookId?: string,
): boolean {
  return (
    ids.length > 0 &&
    ids.every((id) =>
      evidence.some(
        (item) =>
          item.id === id &&
          (!bookId || item.source.bookHash === bookId) &&
          !!item.source.excerpt &&
          (!!item.source.cfi || item.source.sectionIndex !== undefined),
      ),
    )
  );
}
export function confirmViewpoint(viewpoint: Viewpoint, evidence: ResearchEvidence[]): Viewpoint {
  if (
    !viewpoint.claim.trim() ||
    !validatePassageIds(viewpoint.passageIds, evidence, viewpoint.bookId)
  )
    throw new Error('观点需要本书可定位的原文依据，才能确认。');
  return { ...viewpoint, status: 'confirmed' };
}
export function parseViewpoint(
  text: string,
  questionId: string,
  bookId: string,
  evidence: ResearchEvidence[],
): Viewpoint {
  const parsed = parseObject(text);
  const claim = typeof parsed['claim'] === 'string' ? parsed['claim'].trim() : '';
  const passageIds = stringArray(parsed['passageIds']);
  if (!claim || !validatePassageIds(passageIds, evidence, bookId))
    throw new Error('小墨没有返回可核对的本书观点，原文已保留，请手动核对。');
  return {
    id: crypto.randomUUID(),
    questionId,
    bookId,
    claim,
    reasons: stringArray(parsed['reasons']),
    scope: typeof parsed['scope'] === 'string' ? parsed['scope'] : '',
    authorTerms: stringArray(parsed['authorTerms']),
    passageIds,
    status: 'draft',
  };
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
function parseObject(text: string): Record<string, unknown> {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed: unknown = JSON.parse(clean);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('小墨的返回格式无法核对，请重试。');
  return parsed as Record<string, unknown>;
}
export function parseRelation(
  text: string,
  questionId: string,
  viewpoints: Viewpoint[],
  evidence: ResearchEvidence[],
): ViewpointRelation {
  const parsed = parseObject(text);
  const viewpointIds = stringArray(parsed['viewpointIds']);
  const passageIds = stringArray(parsed['passageIds']);
  if (
    typeof parsed['type'] !== 'string' ||
    !(parsed['type'] in RELATION_LABELS) ||
    new Set(viewpoints.filter((item) => viewpointIds.includes(item.id)).map((item) => item.bookId))
      .size < 2 ||
    viewpointIds.some(
      (id) =>
        !viewpoints.some(
          (item) => item.id === id && item.questionId === questionId && item.status === 'confirmed',
        ),
    ) ||
    !validatePassageIds(passageIds, evidence) ||
    passageIds.some(
      (id) =>
        !viewpoints.some(
          (viewpoint) => viewpointIds.includes(viewpoint.id) && viewpoint.passageIds.includes(id),
        ),
    ) ||
    typeof parsed['explanation'] !== 'string'
  )
    throw new Error('关系分析未通过观点与原文引用核对，请重试。');
  return {
    id: crypto.randomUUID(),
    questionId,
    viewpointIds,
    passageIds,
    type: parsed['type'] as ViewpointRelationType,
    explanation: parsed['explanation'],
    userConfirmed: false,
  };
}
export function parseTopicAnswer(
  text: string,
  questionId: string,
  evidence: ResearchEvidence[],
): TopicMessage {
  const parsed = parseObject(text);
  const passageIds = stringArray(parsed['passageIds']);
  if (
    typeof parsed['text'] !== 'string' ||
    !parsed['text'].trim() ||
    !validatePassageIds(passageIds, evidence)
  )
    throw new Error('这次回答没有有效原文引用，未作为依据保存。请缩小问题后重试。');
  return { id: crypto.randomUUID(), questionId, role: 'modian', text: parsed['text'], passageIds };
}

export async function askThematicModel(
  task: string,
  question: string,
  evidence: ResearchEvidence[],
  signal: AbortSignal,
): Promise<string> {
  const { askReadingAI } = await import('../active-reading/ai');
  const excerpt = evidence
    .map((item) => `[${item.id}] ${item.source.chapter || ''}\n${item.source.excerpt}`)
    .join('\n\n');
  if (!excerpt || excerpt.length > 6000)
    throw new Error('请保留少量相关原文（合计不超过 6000 字）再请小墨整理。');
  const response = await askReadingAI(
    {
      id: 'thematic-request',
      kind: 'question',
      status: 'open',
      userText: task,
      source: { excerpt, chapter: '主题研究的已选原文' },
    },
    {
      genre: '主题阅读',
      goal: question.slice(0, 1000),
      initialThought: '',
      fourQuestions: ['', '', '', ''],
    },
    signal,
    () => {},
  );
  return response.text;
}

export function exportThematicMarkdown(research: ThematicResearch, books: ResearchBook[]): string {
  const selected = books.filter((book) => research.selectedBooks.includes(book.hash));
  const lines = [
    `# ${research.question || '主题研究'}`,
    '',
    `研究范围：${research.scope}`,
    `暂不讨论：${research.exclusions}`,
    '',
    '## 共同问题',
    research.question,
    ...research.subQuestions.map((item) => `- ${item.text}`),
    '',
    '## 研究书目',
    ...selected.map((book) => `- ${book.title} · ${book.author}（版本 ${book.hash}）`),
    '',
    '## 中立术语',
  ];
  for (const concept of research.concepts)
    lines.push(
      `### ${concept.concept || '未命名术语'}${concept.confirmed ? '' : '（待确认）'}`,
      ...selected.map((book) => `- ${book.title}：${concept.terms[book.hash] || '未对齐'}`),
      concept.distinction,
      '',
    );
  lines.push('## 观点清单');
  for (const viewpoint of research.viewpoints)
    lines.push(
      `### ${books.find((book) => book.hash === viewpoint.bookId)?.title || viewpoint.bookId}（${viewpoint.status}）`,
      viewpoint.claim,
      ...viewpoint.reasons.map((reason) => `- ${reason}`),
      `适用范围：${viewpoint.scope}`,
      `原文引用：${viewpoint.passageIds.join('、')}`,
      '',
    );
  lines.push('## 关系分析');
  for (const relation of research.relations)
    lines.push(
      `### ${RELATION_LABELS[relation.type]}${relation.userConfirmed ? '' : '（待确认）'}`,
      relation.explanation,
      `原文引用：${relation.passageIds.join('、')}`,
      '',
    );
  lines.push(
    '## 综合讨论',
    '### 共同点',
    research.commonGround,
    '### 核心争议与不同范围',
    research.disagreement,
    '### 我的判断',
    research.synthesis,
    '### 这和我有什么关系',
    research.personalMeaning,
    '',
    '## 引用目录',
  );
  const evidence = new Map(
    Object.values(research.cells)
      .flatMap((cell) => cell.evidence)
      .map((item) => [item.id, item]),
  );
  for (const item of evidence.values())
    lines.push(
      `### ${item.id}`,
      `书籍：${books.find((book) => book.hash === item.source.bookHash)?.title || item.source.bookHash}`,
      `章节：${item.source.chapter || '未命名'}`,
      `版本：${item.bookVersion || item.source.bookHash}`,
      `位置：${item.source.cfi || `章节 ${item.source.sectionIndex}`}`,
      '',
      ...item.source.excerpt.split('\n').map((line) => `> ${line}`),
      '',
      `原阅读思考：${item.readingNote}`,
      '',
    );
  return lines.join('\n');
}
