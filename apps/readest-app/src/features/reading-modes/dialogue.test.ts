import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDialogueRecord,
  derivePublicSearchQuery,
  searchPublicSources,
  serializeDialogueAnswer,
  shouldAutoSearchPublicSources,
} from './dialogue';

afterEach(() => vi.unstubAllGlobals());

describe('dialogue records', () => {
  it('recognizes current real-world questions and derives a focused search query', () => {
    expect(shouldAutoSearchPublicSources('易道用车现在怎么样了')).toBe(true);
    expect(derivePublicSearchQuery('易道用车现在怎么样了')).toBe('易到用车');
    expect(shouldAutoSearchPublicSources('这段话的前提是什么？')).toBe(false);
  });

  it('keeps a question and its original anchor when the reader leaves it unresolved', () => {
    const source = { bookHash: 'book', excerpt: '原文', cfi: 'epubcfi(/6/2)' };
    const record = createDialogueRecord(source, '我还没有想通', false, true);
    expect(record).toMatchObject({
      kind: 'question',
      status: 'open',
      source,
      originalText: '我还没有想通',
    });
  });

  it('preserves a reader objection without a comprehension gate', () => {
    const source = { bookHash: 'book', excerpt: '原文' };
    expect(createDialogueRecord(source, '我反对这个结论', false).kind).toBe('judgment');
    expect(createDialogueRecord(source, '我反对这个结论', true).kind).toBe('judgment');
  });

  it('saves public sources separately from the model inference', () => {
    const text = serializeDialogueAnswer('小墨的解释', [
      {
        title: '词条',
        url: 'https://zh.wikipedia.org/wiki/test',
        excerpt: '检索到的摘要',
        retrievedAt: '2026-09-20',
      },
    ]);
    expect(text).toContain('小墨回答');
    expect(text).toContain('公开资料');
    expect(text).toContain('https://zh.wikipedia.org/wiki/test');
  });
});

describe('real public source retrieval', () => {
  it('drops unrelated web hits and falls back to dated news results', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<rss><channel><item><title>易经入门</title><link>https://example.com/unrelated</link><description>卦象说明</description></item></channel></rss>',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<rss><channel><item><title>易到用车报道</title><link>https://example.com/news</link><description>平台相关报道摘要</description><pubDate>Thu, 20 Feb 2025 08:00:00 GMT</pubDate></item></channel></rss>',
      });
    vi.stubGlobal('fetch', request);
    const sources = await searchPublicSources('易到用车', new AbortController().signal, 'web');
    expect(sources.map((source) => source.url)).toEqual(['https://example.com/news']);
    expect(sources[0]?.provider).toBe('新闻检索');
    expect(request.mock.calls[1]?.[0]).toContain('provider=news');
  });

  it('turns web-search RSS results into dated, linked evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `<?xml version="1.0"?><rss><channel><item>
          <title>易到用车近况</title>
          <link>https://example.com/status</link>
          <description>司机余额问题仍未完全解决。</description>
          <pubDate>Thu, 20 Feb 2025 08:00:00 GMT</pubDate>
        </item></channel></rss>`,
      }),
    );
    const sources = await searchPublicSources('易到用车', new AbortController().signal, 'web');
    expect(sources[0]).toMatchObject({
      title: '易到用车近况',
      url: 'https://example.com/status',
      excerpt: '司机余额问题仍未完全解决。',
      provider: '网页检索',
      publishedAt: '2025-02-20T08:00:00.000Z',
    });
  });

  it('retrieves academic sources and labels missing abstracts as bibliographic leads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            items: [
              {
                DOI: '10.1234/example',
                title: ['Adler and social interest'],
                author: [{ given: 'A.', family: 'Reader' }],
              },
            ],
          },
        }),
      }),
    );
    const sources = await searchPublicSources('Adler', new AbortController().signal, 'crossref');
    expect(sources[0]).toMatchObject({
      title: 'Adler and social interest',
      url: 'https://doi.org/10.1234/example',
      provider: 'Crossref',
      evidence: 'bibliographic',
    });
    expect(sources[0]?.excerpt).toContain('未取得摘要或全文');
  });

  it('keeps retrieved academic abstracts readable without rendering publisher HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            items: [
              {
                DOI: '10.1234/example',
                title: ['A paper'],
                abstract: '<jats:p>Social interest &amp; well-being.</jats:p>',
              },
            ],
          },
        }),
      }),
    );
    const sources = await searchPublicSources('Adler', new AbortController().signal, 'crossref');
    expect(sources[0]?.excerpt).toBe('Social interest & well-being.');
    expect(sources[0]?.evidence).toBe('abstract');
  });
  it('requests public search with a cancellable signal and returns linked source excerpts', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: [
            {
              pageid: 12,
              title: '社会兴趣',
              extract: '阿德勒提出的概念。',
              fullurl: 'https://zh.wikipedia.org/wiki/社会兴趣',
            },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    const sources = await searchPublicSources('社会兴趣', signal);
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('gsrsearch='),
      expect.objectContaining({ signal }),
    );
    expect(sources[0]).toMatchObject({
      title: '社会兴趣',
      excerpt: '阿德勒提出的概念。',
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent('社会兴趣')}`,
    });
  });

  it('fails explicitly instead of producing fabricated evidence when search fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(searchPublicSources('问题', new AbortController().signal)).rejects.toThrow(
      '公开资料',
    );
  });

  it('rejects malformed results and does not invent a source when no result exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { pages: [] } }) }),
    );
    await expect(searchPublicSources('问题', new AbortController().signal)).rejects.toThrow(
      '没有找到',
    );
  });
});
