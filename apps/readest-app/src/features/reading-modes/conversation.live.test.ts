/** Opt-in evaluation against the user's configured model. Never part of offline CI. */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { askReadingAI, saveAIConfig } from '../active-reading/ai';
import {
  buildThematicPrompt,
  streamThematicAnswer,
  type ResearchEvidence,
  type TopicMessage,
} from './thematic';
import { searchPassages, type IndexedPassage } from './thematic-passages';
import {
  expandResearchQuery,
  rerankResearchEvidence,
  reviewResearchCitations,
} from './research-assistant';
import { repeatsPreviousAnswer } from './conversation';
import { searchPublicSources, derivePublicSearchQuery } from './dialogue';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
async function configureModel() {
  // Capture credentials in memory only; never put keys in command arguments or reports.
  const config = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `
from pathlib import Path
import sqlite3
for p in (Path.home()/'Library/WebKit/local.activereader.desktop').rglob('localstorage.sqlite3'):
 c=sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True)
 r=c.execute("select value from ItemTable where key='active-reader.ai.v1'").fetchone()
 if r:
  print(r[0].decode('utf-16le') if isinstance(r[0],bytes) else r[0]);break
`,
      ],
      { encoding: 'utf8' },
    ),
  );
  let key = '';
  try {
    key = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Readest Safe Storage', '-a', 'active-reader-ai-key', '-w'],
      { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    throw new Error('Configured model credential is unavailable');
  }
  await saveAIConfig(config, key);
  key = '';
  return config;
}

it.skipIf(process.env['MOSHU_LIVE_AI'] !== '1')(
  'evaluates actual multi-turn answers and local-library relevance',
  async () => {
    const config = await configureModel();
    const root = join(
      homedir(),
      'Library/Application Support/local.activereader.desktop/Readest/Books',
    );
    const passages: IndexedPassage[] = readdirSync(root).flatMap((name) => {
      try {
        return JSON.parse(readFileSync(join(root, name, 'thematic-passages.json'), 'utf8'))
          .passages;
      } catch {
        return [];
      }
    });
    const signal = AbortSignal.timeout(240000);
    const question = '人生的意义';
    const queries = await expandResearchQuery(question, signal);
    const matches = searchPassages(passages, question, { queries, limitPerBook: 8 }).slice(0, 24);
    const candidates: ResearchEvidence[] = matches.map((p) => ({
      id: p.passageId,
      score: p.score,
      source: {
        bookHash: p.bookHash,
        title: p.title,
        author: p.author,
        chapter: p.chapter,
        excerpt: p.excerpt,
        context: p.context,
        cfi: p.cfi,
      },
      readingNote: '',
    }));
    const ranked = await rerankResearchEvidence(question, candidates, signal);
    const history: TopicMessage[] = [];
    const report: { question: string; answer: string; firstChunkMs: number; totalMs: number }[] =
      [];
    for (const q of [
      question,
      '你觉得人生的意义是什么',
      '为什么这么认为',
      '我不同意，我觉得只有快乐才有意义',
      '只说书里怎么讲',
    ]) {
      const start = Date.now();
      let first = 0;
      const result = await streamThematicAnswer(q, ranked.evidence, history, signal, () => {
        first ||= Date.now() - start;
      });
      const checked = await reviewResearchCitations(result.text, ranked.evidence, signal);
      report.push({
        question: q,
        answer: checked.text,
        firstChunkMs: first,
        totalMs: Date.now() - start,
      });
      history.push(
        { id: `${history.length}`, role: 'user', text: q, questionId: 'main', passageIds: [] },
        {
          id: `${history.length + 1}`,
          role: 'modian',
          text: checked.text,
          questionId: 'main',
          passageIds: [],
          status: 'complete',
        },
      );
    }
    const person = await askReadingAI(
      {
        id: 'identity',
        kind: 'question',
        status: 'open',
        userText: '孙宇晨是谁',
        source: {
          title: '这世界既残酷也温柔',
          author: '孙宇晨',
          chapter: '推荐序',
          excerpt: '我们都在北京上学（他在北大，我在清华），毕业后都创业。',
        },
      },
      { genre: '', goal: '', initialThought: '', fourQuestions: ['', '', '', ''] },
      signal,
      () => {},
    );
    report.push({ question: '孙宇晨是谁', answer: person.text, firstChunkMs: 0, totalMs: 0 });
    const empty = await streamThematicAnswer('你觉得人生的意义是什么', [], [], signal, () => {});
    report.push({
      question: '没有相关书籍时的讨论',
      answer: empty.text,
      firstChunkMs: 0,
      totalMs: 0,
    });
    writeFileSync(
      '/tmp/moshu-live-evaluation.json',
      JSON.stringify(
        {
          model: config.model,
          queries,
          candidates: candidates.map((e) => ({
            id: e.id,
            book: e.source.title,
            excerpt: e.source.excerpt,
          })),
          selected: ranked.evidence,
          report,
          followupPrompt: buildThematicPrompt('你觉得呢', ranked.evidence, history),
        },
        null,
        2,
      ),
    );
    expect(ranked.reviewed).toBe(true);
    expect(repeatsPreviousAnswer(report[1]!.answer, report[0]!.answer)).toBe(false);
    expect(person.text).toMatch(/波场|TRON/i);
    expect(empty.text.length).toBeGreaterThan(100);
  },
  300000,
);

it.skipIf(process.env['MOSHU_LIVE_WEB'] !== '1')(
  'checks actual entity lookup and current-event search fallback',
  async () => {
    await configureModel();
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      nativeFetch(
        typeof input === 'string' && input.startsWith('/')
          ? `http://localhost:3000${input}`
          : input,
        init,
      ),
    );
    const signal = AbortSignal.timeout(60000);
    const report = [];
    try {
      for (const question of ['孙宇晨是谁', '易道用车现在怎么样了']) {
        const sources = await searchPublicSources(
          derivePublicSearchQuery(question),
          signal,
          'web',
          { recent: question.includes('现在') },
        );
        const result = await askReadingAI(
          {
            id: 'web',
            kind: 'question',
            status: 'open',
            userText: question,
            source: {
              title: '这世界既残酷也温柔',
              author: '孙宇晨',
              excerpt: '我自己在易到用车的账户充值了8万元。',
            },
          },
          { genre: '', goal: '', initialThought: '', fourQuestions: ['', '', '', ''] },
          signal,
          () => {},
          { publicSources: sources, externalQuestion: true },
        );
        report.push({ question, sources, answer: result.text });
        expect(sources.length).toBeGreaterThan(0);
      }
      writeFileSync('/tmp/moshu-live-web-evaluation.json', JSON.stringify(report, null, 2));
    } finally {
      vi.unstubAllGlobals();
    }
  },
  90000,
);
