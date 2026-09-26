import type { ReadingRecord } from '../active-reading/data';
import type { PublicReadingSource } from '../active-reading/ai';
import type { ReadingSource } from '../reading-method/types';
import { isTauriAppPlatform } from '@/services/environment';

import { planConversation } from './conversation';
import { rankTexts } from './retrieval';

export const shouldAutoSearchPublicSources = (text: string) => planConversation(text).web;

export function derivePublicSearchQuery(text: string) {
  return text
    .trim()
    .replace(/易道用车/gu, '易到用车')
    .replace(/[?？!！。\s]+$/g, '')
    .replace(/；(?:那|所以)?(?:他|她|它|这家公司|这个人).*$/u, '')
    .replace(/(?:是谁|是何人|是什么人)[？?]*$/u, '')
    .replace(
      /(?:现在|目前|如今|最近|最新)?(?:到底)?(?:怎么样|如何|什么情况|现状|近况)(?:了|呢|了呢)?$/u,
      '',
    )
    .replace(/(?:现在|目前|如今|最近|最新)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function createDialogueRecord(
  source: ReadingSource,
  text: string,
  _understood: boolean,
  forceQuestion = false,
): ReadingRecord {
  const userText = text.trim();
  if (!source.bookHash || !source.excerpt.trim()) throw new Error('请先选择本书的一段原文。');
  if (!userText) throw new Error('先写下你的理解或疑问。');
  const now = new Date().toISOString();
  const kind =
    forceQuestion || /[？?]|为什么|如何|是否|疑问|不明白|不理解/.test(userText)
      ? 'question'
      : /反对|反驳|不同意|错误|不成立|不充分|漏洞|但是/.test(userText)
        ? 'judgment'
        : 'understanding';
  return {
    id: crypto.randomUUID(),
    kind,
    status: kind === 'question' ? 'open' : 'kept',
    userText,
    originalText: userText,
    revisions: [],
    source: { ...source },
    createdAt: now,
    updatedAt: now,
  };
}

interface WikipediaResponse {
  error?: unknown;
  query?: {
    pages?: {
      pageid?: number;
      title?: string;
      extract?: string;
      fullurl?: string;
      index?: number;
    }[];
  };
}

export type PublicSourceProvider = 'web' | 'wikipedia' | 'crossref';
interface CrossrefResponse {
  message?: {
    items?: {
      DOI?: string;
      title?: string[];
      abstract?: string;
      author?: { given?: string; family?: string }[];
    }[];
  };
}

const plainText = (value: string) =>
  new DOMParser().parseFromString(value, 'text/html').body.textContent?.trim() || '';

const hasTauriRuntime = () =>
  isTauriAppPlatform() &&
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in (window as Window & { __TAURI_INTERNALS__?: unknown });

async function publicFetch(url: string, signal: AbortSignal) {
  if (hasTauriRuntime()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, { signal });
  }
  return globalThis.fetch(url, { signal });
}

function parseWebSearch(xml: string, provider = '网页检索'): PublicReadingSource[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('网页检索返回了无法读取的结果。');
  const retrievedAt = new Date().toISOString();
  return [...document.querySelectorAll('item')]
    .map((item): PublicReadingSource | null => {
      const title = item.querySelector('title')?.textContent?.trim() || '';
      const url = item.querySelector('link')?.textContent?.trim() || '';
      const excerpt = plainText(item.querySelector('description')?.textContent || '');
      const rawDate = item.querySelector('pubDate')?.textContent?.trim() || '';
      const date = rawDate ? new Date(rawDate) : null;
      if (!title || !url || !excerpt || !/^https?:\/\//.test(url)) return null;
      return {
        title,
        url,
        excerpt: excerpt.slice(0, 1500),
        provider,
        evidence: 'search-snippet',
        retrievedAt,
        publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined,
      };
    })
    .filter((item): item is PublicReadingSource => Boolean(item))
    .slice(0, 30);
}

export async function searchPublicSources(
  query: string,
  signal: AbortSignal,
  provider: PublicSourceProvider = 'wikipedia',
  options: { recent?: boolean } = {},
): Promise<PublicReadingSource[]> {
  signal.throwIfAborted();
  if (!query.trim()) throw new Error('请填写公开资料的检索词。');
  if (provider === 'web') {
    const focused = derivePublicSearchQuery(query) || query.trim().slice(0, 180);
    const collected: PublicReadingSource[] = [];
    for (const engine of options.recent ? (['news', 'web'] as const) : (['web', 'news'] as const)) {
      signal.throwIfAborted();
      const params =
        engine === 'news'
          ? new URLSearchParams({ q: focused, hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' })
          : new URLSearchParams({ q: focused, format: 'rss', mkt: 'zh-CN' });
      const target = `${engine === 'news' ? 'https://news.google.com/rss/search' : 'https://www.bing.com/search'}?${params}`;
      try {
        const response = await publicFetch(
          hasTauriRuntime()
            ? target
            : `/api/public-search?query=${encodeURIComponent(focused)}&provider=${engine}`,
          AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        );
        if (!response.ok) continue;
        const candidates = parseWebSearch(
          await response.text(),
          engine === 'news' ? '新闻检索' : '网页检索',
        );
        const sources = rankTexts(
          candidates,
          [focused],
          (source) => `${source.title} ${source.excerpt}`,
        )
          .map(({ item }) => item)
          .filter((item) => {
            if (!/^[\p{Script=Han}]{2,12}$/u.test(focused)) return true;
            const alias = focused.replace(/(?:用车|出行|集团|公司)$/, '');
            const text = `${item.title} ${item.excerpt}`;
            return text.includes(focused) || (alias.length >= 2 && text.includes(alias));
          })
          .slice(0, 5);
        if (sources.length && !options.recent) return sources;
        collected.push(...sources.slice(0, 3));
      } catch {
        signal.throwIfAborted();
      }
    }
    if (collected.length)
      return [...new Map(collected.map((source) => [source.url, source])).values()].slice(0, 6);
    throw new Error('网页检索没有找到可用结果，本次不能核实近况。');
  }

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query.trim().slice(0, 180),
    gsrlimit: '3',
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    exchars: '1200',
    exlimit: '3',
    inprop: 'url',
    format: 'json',
    formatversion: '2',
    origin: '*',
  });
  let response: Response;
  try {
    const crossrefParams = new URLSearchParams({
      query: query.trim().slice(0, 180),
      rows: '3',
      select: 'DOI,title,abstract,URL,author,published',
    });
    response = await publicFetch(
      provider === 'crossref'
        ? `https://api.crossref.org/works?${crossrefParams}`
        : `https://zh.wikipedia.org/w/api.php?${params}`,
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('公开资料检索未完成，请检查网络后重试，或关闭公开资料只对照原文。', {
      cause: error,
    });
  }
  if (!response.ok) throw new Error(`公开资料服务暂时不可用（${response.status}），尚未取得资料。`);
  if (provider === 'crossref') {
    const result = (await response.json()) as CrossrefResponse;
    if (!Array.isArray(result.message?.items)) throw new Error('公开资料没有找到相关学术文献。');
    const sources: PublicReadingSource[] = result.message.items
      .filter((item) => item.DOI && item.title?.[0])
      .slice(0, 3)
      .map((item) => {
        const abstract = item.abstract ? plainText(item.abstract) : '';
        const author = (item.author || [])
          .slice(0, 3)
          .map((name) => [name.given, name.family].filter(Boolean).join(' '))
          .join('、');
        return {
          title: plainText(item.title![0]!),
          url: `https://doi.org/${encodeURIComponent(item.DOI!).replace(/%2F/g, '/')}`,
          excerpt: abstract
            ? abstract.slice(0, 1500)
            : `仅书目信息，未取得摘要或全文，不能据此核实观点。${author ? `作者：${author}。` : ''}`,
          provider: 'Crossref',
          evidence: abstract ? 'abstract' : 'bibliographic',
          retrievedAt: new Date().toISOString(),
        };
      });
    if (!sources.length) throw new Error('公开资料没有找到相关学术文献。请调整关键词后重试。');
    return sources;
  }
  const result = (await response.json()) as WikipediaResponse;
  if (result.error || !Array.isArray(result.query?.pages))
    throw new Error('公开资料没有找到相关结果。请换用书中概念作为检索词。');
  const retrievedAt = new Date().toISOString();
  const sources = result.query.pages
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .filter((page) => page.title && page.extract?.trim() && page.pageid)
    .slice(0, 3)
    .map((page) => ({
      title: page.title!,
      excerpt: page.extract!.slice(0, 1500),
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(page.title!.replace(/ /g, '_'))}`,
      retrievedAt,
      provider: '维基百科',
      evidence: 'abstract' as const,
    }));
  if (!sources.length) throw new Error('公开资料没有找到可用摘要。请调整检索词后重试。');
  return sources;
}

export function serializeDialogueAnswer(text: string, sources: PublicReadingSource[]) {
  return [
    '小墨回答',
    text,
    sources.length ? '\n公开资料 · 检索所得，需核对' : '\n本次未附公开资料。',
    ...sources.map(
      (source) =>
        `${source.title}\n${source.url}\n${source.excerpt}\n来源：${source.provider || '公开资料'} · ${source.evidence === 'bibliographic' ? '仅书目线索' : source.evidence === 'search-snippet' ? '搜索摘要' : '摘要'}${source.publishedAt ? `\n发布时间：${source.publishedAt}` : ''}\n检索时间：${source.retrievedAt}`,
    ),
  ].join('\n\n');
}
