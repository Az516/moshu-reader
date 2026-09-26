import { describe, expect, it, vi } from 'vitest';
import { buildThematicPrompt, citedPassageIds, streamThematicAnswer } from './thematic';

const stream = vi.hoisted(() => vi.fn());
vi.mock('../active-reading/ai', () => ({ streamConversationText: stream }));
const evidence = [
  {
    id: 'actual-book:note-1',
    source: {
      title: '我的书',
      author: '作者',
      chapter: '一',
      excerpt: '人生的意义。',
      cfi: 'epubcfi(/6/2)',
    },
    readingNote: '我把它理解为当下的选择。',
  },
];

describe('thematic streaming and citation contract', () => {
  it('sends real notes and book identities, and only resolves supplied citation numbers', () => {
    const prompt = buildThematicPrompt('人生', evidence);
    expect(prompt.prompt).toContain('当下的选择');
    expect(prompt.prompt).toContain('我的书');
    expect(prompt.system).toContain('Markdown');
    expect(citedPassageIds('观点[1]，编造来源[98]，重复[1]', evidence)).toEqual([
      'actual-book:note-1',
    ]);
  });
  it('publishes partial text before the generation finishes instead of buffering JSON', async () => {
    let finish!: () => void;
    stream.mockImplementation(async (_prompt, _signal, onChunk) => {
      onChunk('## 人生\n\n');
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      onChunk('## 人生\n\n关注当下。[1]');
      return { text: '## 人生\n\n关注当下。[1]', model: 'test' };
    });
    const onChunk = vi.fn();
    const task = streamThematicAnswer('人生', evidence, [], new AbortController().signal, onChunk);
    await vi.waitFor(() => expect(onChunk).toHaveBeenCalledWith('## 人生\n\n'));
    finish();
    expect((await task).text).toContain('[1]');
    expect(onChunk).toHaveBeenCalledTimes(2);
  });
});
