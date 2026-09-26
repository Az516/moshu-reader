import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expandResearchQuery,
  rerankResearchEvidence,
  reviewResearchCitations,
} from './research-assistant';
import { balanceEvidence, buildKnowledgeBase, type ResearchEvidence } from './thematic';
const stream = vi.hoisted(() => vi.fn());
vi.mock('../active-reading/ai', () => ({ streamReadingText: stream }));
const evidence: ResearchEvidence[] = [
  {
    id: 'a',
    score: 10,
    source: {
      bookHash: 'a',
      title: '生命',
      excerpt: '我们可以赋予自己的人生意义。',
      cfi: 'epubcfi(/6/2)',
    },
    readingNote: '',
  },
  {
    id: 'b',
    score: 1,
    source: {
      bookHash: 'b',
      title: '行动',
      excerpt: '明确锻炼的好处有助于坚持。',
      cfi: 'epubcfi(/6/2)',
    },
    readingNote: '这是我对习惯的理解。',
  },
];
beforeEach(() => vi.clearAllMocks());
describe('semantic selection and claim-level review', () => {
  it('expands a question without sending the library and does not invent results on failure', async () => {
    stream.mockResolvedValueOnce({ text: '{"queries":["生命价值","活着的理由"]}' });
    expect(await expandResearchQuery('人生的意义', new AbortController().signal)).toEqual([
      '生命价值',
      '活着的理由',
    ]);
    expect(stream.mock.calls[0]?.[0].prompt).toBe('人生的意义');
    stream.mockResolvedValueOnce({ text: 'malformed' });
    expect(await expandResearchQuery('人生', new AbortController().signal)).toEqual([]);
  });
  it('accepts fewer books or no matches instead of filling a quota with weak material', async () => {
    stream.mockResolvedValueOnce({ text: '{"matches":[{"index":1,"relevance":"direct"}]}' });
    const result = await rerankResearchEvidence(
      '人生的意义',
      evidence,
      new AbortController().signal,
    );
    expect(result.evidence.map((e) => e.id)).toEqual(['a']);
    stream.mockResolvedValueOnce({ text: '{"matches":[]}' });
    expect(
      (await rerankResearchEvidence('星系', evidence, new AbortController().signal)).evidence,
    ).toEqual([]);
  });
  it('deduplicates sources and preserves relevance ordering rather than book quotas', () => {
    expect(
      balanceEvidence([evidence[1]!, evidence[0]!, { ...evidence[0]!, id: 'duplicate' }]).map(
        (e) => e.id,
      ),
    ).toEqual(['a', 'b']);
  });
  it('keeps semantically retrieved passages even when their vocabulary differs from the question', () => {
    const result = buildKnowledgeBase('为什么活着', [
      {
        hash: 'a',
        title: '生命',
        author: '作者',
        chapters: [],
        records: [
          {
            id: 'a',
            passageId: 'a',
            score: 3,
            kind: 'understanding',
            status: 'open',
            userText: '',
            originalText: '',
            revisions: [],
            source: evidence[0]!.source,
          },
        ],
      },
    ]);
    expect(result.evidence.map((e) => e.id)).toEqual(['a']);
    expect(buildKnowledgeBase('为什么活着', [], []).evidence).toEqual([]);
  });
  it('removes invented citation numbers and fixes an unsupported attribution without changing independent analysis', async () => {
    stream.mockResolvedValueOnce({
      text: JSON.stringify({
        corrections: [
          { index: 1, replacement: '这条笔记谈的是坚持锻炼的方法。[2]' },
          { index: 2, replacement: '另一分析。' },
        ],
      }),
    });
    const result = await reviewResearchCitations(
      '我更看重关系和责任。\n\n作者认为坚持就是人生的意义。[2]\n\n另一观点。[99]',
      evidence,
      new AbortController().signal,
    );
    expect(result.text).toContain('我更看重关系和责任。');
    expect(result.text).not.toContain('作者认为坚持就是');
    expect(result.text).not.toContain('[99]');
    expect(result.reviewed).toBe(true);
  });
  it('does not present a failed review as verified and propagates cancellation', async () => {
    stream.mockRejectedValue(new Error('offline'));
    expect(
      (await reviewResearchCitations('判断。[1]', evidence, new AbortController().signal)).reviewed,
    ).toBe(false);
    const abort = new AbortController();
    abort.abort();
    await expect(rerankResearchEvidence('意义', evidence, abort.signal)).rejects.toThrow();
  });
  it('checks linked public claims against retrieved snippets and rejects invented links', async () => {
    stream.mockResolvedValueOnce({
      text: JSON.stringify({
        corrections: [
          { index: 1, replacement: '这份报道仅说明当年的情况，不能确认现在仍在运营。' },
        ],
      }),
    });
    const result = await reviewResearchCitations(
      '现在仍在运营。[报道](https://invented.example/report)',
      [],
      new AbortController().signal,
      {
        publicSources: [
          {
            title: '历史报道',
            url: 'https://example.com/old',
            excerpt: '2020 年公司仍在运营。',
            retrievedAt: '2026-01-01',
            publishedAt: '2020-01-01',
          },
        ],
      },
    );
    expect(result.needed).toBe(true);
    expect(result.reviewed).toBe(true);
    expect(result.text).not.toContain('invented.example');
    expect(stream.mock.calls[0]?.[0].prompt).toContain('2020 年公司仍在运营');
  });
  it('reviews unnumbered passage attribution when requested by ordinary dialogue', async () => {
    stream.mockResolvedValueOnce({
      text: JSON.stringify({
        corrections: [
          { index: 1, replacement: '原文只说人可以赋予自己意义，没有声称它是唯一来源。' },
        ],
      }),
    });
    const result = await reviewResearchCitations(
      '作者说意义只有唯一来源。',
      evidence,
      new AbortController().signal,
      { reviewAll: true },
    );
    expect(result.needed).toBe(true);
    expect(result.text).not.toContain('作者说意义只有');
    expect(result.reviewed).toBe(true);
  });
  it('does not mark unreviewed invented links as checked during a review outage', async () => {
    stream.mockRejectedValueOnce(new Error('offline'));
    const result = await reviewResearchCitations(
      '结论。[来源](https://invented.example)',
      [],
      new AbortController().signal,
      { publicSources: [] },
    );
    expect(result.reviewed).toBe(false);
    expect(result.text).not.toContain('https://invented.example');
  });
  it('also checks autolinks and bare web URLs rendered by Markdown', async () => {
    stream.mockRejectedValueOnce(new Error('offline'));
    const result = await reviewResearchCitations(
      '资料见 <https://invented.example/a> 或 https://invented.example/b。',
      [],
      new AbortController().signal,
    );
    expect(result.needed).toBe(true);
    expect(result.reviewed).toBe(false);
    expect(result.text).not.toContain('https://invented.example');
  });
});
