import { describe, expect, it } from 'vitest';
import { planConversation, repeatsPreviousAnswer } from './conversation';

const history = [
  { role: 'user' as const, text: '人生的意义' },
  { role: 'assistant' as const, text: '书中提出了几种不同观点。' },
];
describe('question-led conversation', () => {
  it('changes from a topic overview to a reasoned position without re-running the book report', () => {
    expect(planConversation('你觉得人生的意义是什么', history)).toMatchObject({
      intent: 'opinion',
      retrieval: 'reuse',
      sourceScope: 'all',
    });
    expect(planConversation('你觉得呢', history).query).toContain('人生');
    expect(planConversation('为什么这么认为', history).intent).toBe('reason');
    expect(planConversation('我不同意，只有快乐才有意义', history).intent).toBe('challenge');
  });
  it('recognizes identity, current facts, and contextual follow-ups without searching philosophical opinions', () => {
    expect(planConversation('孙宇晨是谁').web).toBe(true);
    expect(planConversation('易道用车现在怎么样了').intent).toBe('current');
    expect(planConversation('你觉得人生的意义是什么').web).toBe(false);
    expect(
      planConversation('他现在怎么样了', [{ role: 'user', text: '孙宇晨是谁' }]).query,
    ).toContain('孙宇晨');
    expect(planConversation('你觉得量子计算是什么', history).retrieval).toBe('search');
  });
  it('honors explicit book-only and offline instructions across follow-ups and explicit scope changes', () => {
    const scoped = [{ role: 'user' as const, text: '只根据书里的内容，讨论人生的意义' }];
    expect(planConversation('你觉得呢', scoped).sourceScope).toBe('books');
    expect(planConversation('不用局限于书，说说你的看法', scoped).sourceScope).toBe('all');
    expect(planConversation('不要联网，孙宇晨是谁').web).toBe(false);
  });
  it('flags near-verbatim recycling but permits a short necessary quotation', () => {
    const old =
      '人生的意义在这些材料里没有被当成一个标准答案。有人主张自己赋予，有人把它落在行动与惯性上。'.repeat(
        4,
      );
    expect(repeatsPreviousAnswer(old.replace('这些', '上述'), old)).toBe(true);
    expect(
      repeatsPreviousAnswer('你提到“自己赋予”。我更倾向于从关系和责任来解释，理由如下。', old),
    ).toBe(false);
  });
});
