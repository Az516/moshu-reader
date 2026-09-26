import { describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import type { ReadingRecord } from '../active-reading/data';
import {
  attachEvidence,
  createResearch,
  getEvidenceGaps,
  loadThematicResearch,
  recommendBooks,
  saveThematicResearch,
  type ResearchBook,
  confirmViewpoint,
  parseViewpoint,
  parseRelation,
  exportThematicMarkdown,
  buildKnowledgeBase,
  shouldSendComposerMessage,
} from './thematic';

const record = (bookHash = 'book-a'): ReadingRecord => ({
  id: 'note-1',
  kind: 'understanding',
  status: 'kept',
  userText: '即时奖励影响选择',
  originalText: '即时奖励影响选择',
  revisions: [],
  source: {
    bookHash,
    chapter: '奖励与拖延',
    cfi: 'epubcfi(/6/2!/4)',
    excerpt: '人们偏好眼前的奖励。',
  },
});
const books: ResearchBook[] = [
  {
    hash: 'book-a',
    title: '行为研究',
    author: '作者甲',
    chapters: [{ id: 'c1', label: '奖励与拖延' }],
    records: [record()],
  },
  {
    hash: 'book-b',
    title: '植物图谱',
    author: '作者乙',
    chapters: [{ id: 'c2', label: '树木' }],
    records: [],
  },
];
function storage() {
  const files = new Map<string, string>();
  return {
    files,
    service: {
      exists: vi.fn(async (path: string) => files.has(path)),
      replaceFile: async (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      deleteFile: async (path: string) => {
        files.delete(path);
      },
      readFile: vi.fn(async (path: string) => files.get(path)!),
      writeFile: vi.fn(async (path: string, _base: string, value: string) => {
        files.set(path, value);
      }),
    } as unknown as AppService,
  };
}

describe('thematic research', () => {
  it('sends on Enter and keeps Shift+Enter for an intentional line break', () => {
    expect(shouldSendComposerMessage({ key: 'Enter', shiftKey: false })).toBe(true);
    expect(shouldSendComposerMessage({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(shouldSendComposerMessage({ key: 'a', shiftKey: false })).toBe(false);
  });

  it('explains matching book and chapter recommendations without selecting a scope', () => {
    const recommendations = recommendBooks('为什么会拖延？', books);
    expect(recommendations[0]?.book.hash).toBe('book-a');
    expect(recommendations[0]?.reasons.join(' ')).toContain('奖励与拖延');
    expect(recommendations[0]?.chapterIds).toEqual(['c1']);
    expect(recommendations[1]?.score).toBe(0);
    expect(createResearch('book-a').selectedBooks).toEqual([]);
    expect(createResearch('book-a').confirmed).toBe(false);
  });
  it('does not invent relevant books for an unrelated or empty question', () => {
    expect(recommendBooks('星系的形成', books).every((item) => item.score === 0)).toBe(true);
    expect(recommendBooks('', books).every((item) => item.score === 0)).toBe(true);
  });
  it('builds a compact knowledge base from related books, passages and the reader’s notes', () => {
    const knowledge = buildKnowledgeBase('为什么会拖延？', books);
    expect(knowledge.books.map((book) => book.hash)).toEqual(['book-a']);
    expect(knowledge.evidence[0]).toMatchObject({
      id: 'book-a:note-1',
      readingNote: '即时奖励影响选择',
      source: { bookHash: 'book-a', cfi: 'epubcfi(/6/2!/4)' },
    });
  });
  it('gives every relevant book room in the answer instead of exhausting the budget on the first', () => {
    const library = Array.from(
      { length: 6 },
      (_, i): ResearchBook => ({
        hash: `b${i}`,
        title: `人生 ${i}`,
        author: '',
        chapters: [],
        records: Array.from({ length: 8 }, (_, n) => ({
          ...record(`b${i}`),
          id: `${n}`,
          passageId: `p${i}-${n}`,
          source: { bookHash: `b${i}`, cfi: 'epubcfi(/6/2!/4)', excerpt: '人生'.repeat(350) },
        })),
      }),
    );
    const { evidence } = buildKnowledgeBase('人生', library);
    expect(new Set(evidence.map((item) => item.source.bookHash)).size).toBe(6);
    expect(evidence.every((item) => item.source.title?.startsWith('人生'))).toBe(true);
  });
  it('keeps a source snapshot and book version when attaching an analysis record', () => {
    const research = { ...createResearch('book-a'), selectedBooks: ['book-a'], confirmed: true };
    const next = attachEvidence(research, 'q1', 'book-a', record());
    expect(next.cells['q1::book-a']?.evidence[0]?.source).toMatchObject({
      bookHash: 'book-a',
      cfi: 'epubcfi(/6/2!/4)',
      excerpt: '人们偏好眼前的奖励。',
    });
    expect(next.cells['q1::book-a']?.proposition).toBe('');
    expect(
      attachEvidence(next, 'q1', 'book-a', record()).cells['q1::book-a']?.evidence,
    ).toHaveLength(1);
  });
  it('rejects cross-book, unanchored and out-of-scope evidence', () => {
    const research = { ...createResearch('book-a'), selectedBooks: ['book-a'], confirmed: true };
    expect(() => attachEvidence(research, 'q1', 'book-a', record('book-b'))).toThrow();
    expect(() => attachEvidence(research, 'q1', 'book-b', record('book-b'))).toThrow();
    expect(() =>
      attachEvidence(research, 'q1', 'book-a', { ...record(), source: undefined }),
    ).toThrow();
  });
  it('asks about evidence gaps without generating the reader’s judgment', () => {
    const research = {
      ...createResearch('book-a'),
      question: '拖延的原因',
      selectedBooks: ['book-a', 'book-b'],
      synthesis: '我认为存在多种原因。',
    };
    expect(getEvidenceGaps(research).join(' ')).toContain('原文');
    expect(research.synthesis).toBe('我认为存在多种原因。');
  });
  it('persists independent research scopes and reloads their source chains', async () => {
    const { service } = storage();
    const first = {
      ...createResearch('book-a'),
      question: '拖延的原因',
      selectedBooks: ['book-a'],
      confirmed: true,
    };
    await saveThematicResearch(service, attachEvidence(first, 'q1', 'book-a', record()));
    await saveThematicResearch(service, { ...createResearch('book-b'), question: '树木如何生长' });
    expect(
      (await loadThematicResearch(service, 'book-a')).cells['q1::book-a']?.evidence[0]?.source.cfi,
    ).toBe('epubcfi(/6/2!/4)');
    expect((await loadThematicResearch(service, 'book-b')).question).toBe('树木如何生长');
  });
  it('rejects an extracted viewpoint with invented passage IDs', () => {
    expect(() =>
      parseViewpoint(
        JSON.stringify({ claim: '无法验证', passageIds: ['invented'] }),
        'main',
        'book-a',
        [],
      ),
    ).toThrow();
  });
  it('confirms only source-backed author viewpoints', () => {
    const evidence = [{ id: 'book-a:note-1', source: record().source!, readingNote: '' }];
    const viewpoint = parseViewpoint(
      JSON.stringify({
        claim: '偏好即时奖励',
        reasons: ['即时偏好'],
        passageIds: ['book-a:note-1'],
      }),
      'main',
      'book-a',
      evidence,
    );
    expect(viewpoint.status).toBe('draft');
    expect(confirmViewpoint(viewpoint, evidence).status).toBe('confirmed');
    expect(() => confirmViewpoint({ ...viewpoint, bookId: 'book-b' }, evidence)).toThrow();
  });
  it('exports the full research method and preserves original citations', () => {
    const study = attachEvidence(
      {
        ...createResearch('book-a'),
        question: '拖延的原因',
        selectedBooks: ['book-a'],
        scope: '原因与干预',
        exclusions: '临床诊断',
      },
      'main',
      'book-a',
      record(),
    );
    const output = exportThematicMarkdown(study, books);
    expect(output).toContain('临床诊断');
    expect(output).toContain('中立术语');
    expect(output).toContain('观点清单');
    expect(output).toContain('epubcfi(/6/2!/4)');
  });
  it('returns to the same research after following a citation into another book', async () => {
    const { service } = storage();
    await saveThematicResearch(service, {
      ...createResearch('book-a'),
      question: '跨书问题',
      selectedBooks: ['book-a', 'book-b'],
    });
    const resumed = await loadThematicResearch(service, 'book-b');
    expect(resumed.id).toBe('book-a');
    expect(resumed.question).toBe('跨书问题');
    await saveThematicResearch(service, { ...resumed, synthesis: '沿用同一份研究' });
    expect((await loadThematicResearch(service, 'book-a')).synthesis).toBe('沿用同一份研究');
  });
  it('preserves an indexed passage identity and full book version without rewriting its ID', () => {
    const indexedRecord = {
      ...record(),
      passageId: 'book-a:passage-digest',
      bookVersion: 'full-file-digest',
      contentHash: 'text-digest',
    };
    const study = attachEvidence(
      { ...createResearch('book-a'), selectedBooks: ['book-a'] },
      'main',
      'book-a',
      indexedRecord,
    );
    expect(study.cells['main::book-a']?.evidence[0]).toMatchObject({
      id: 'book-a:passage-digest',
      bookVersion: 'full-file-digest',
      contentHash: 'text-digest',
    });
  });
  it('does not infer a cross-author relation from a single author', () => {
    const evidence = [{ id: 'book-a:note-1', source: record().source!, readingNote: '' }];
    const viewpoint = confirmViewpoint(
      parseViewpoint(
        JSON.stringify({ claim: '偏好即时奖励', passageIds: ['book-a:note-1'] }),
        'main',
        'book-a',
        evidence,
      ),
      evidence,
    );
    expect(() =>
      parseRelation(
        JSON.stringify({
          viewpointIds: [viewpoint.id],
          type: 'different_scope',
          explanation: '未提供第二位作者',
          passageIds: ['book-a:note-1'],
        }),
        'main',
        [viewpoint],
        evidence,
      ),
    ).toThrow();
  });
  it('preserves a malformed file instead of silently overwriting it', async () => {
    const { service, files } = storage();
    files.set('thematic-research.json', '{invalid');
    await expect(saveThematicResearch(service, createResearch('book-a'))).rejects.toThrow();
    expect(files.get('thematic-research.json')).toBe('{invalid');
  });
});
