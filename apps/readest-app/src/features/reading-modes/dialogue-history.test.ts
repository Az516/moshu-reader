import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import {
  createDialogueConversation,
  mergeDialogueFiles,
  prepareDialogueTurn,
  restoreDialogueConversation,
  validateDialogueFile,
  loadDialogueFile,
  saveDialogueConversation,
  type DialogueFile,
} from './dialogue-history';
import { conversationHistory } from './conversation';

const source = { bookHash: 'book', excerpt: '原文内容', cfi: 'epubcfi(/6/2)' };
afterEach(() => vi.restoreAllMocks());
const failed = () => {
  const session = createDialogueConversation(source);
  session.messages = [
    {
      id: 'user',
      role: 'user',
      text: '原文是什么意思？',
      status: 'complete',
      updatedAt: session.updatedAt,
    },
    {
      id: 'answer',
      role: 'assistant',
      text: '尚未说完的判断',
      status: 'stopped',
      replyTo: 'user',
      updatedAt: session.updatedAt,
    },
  ];
  return session;
};

describe('local passage dialogue history', () => {
  it('retries the original question without duplicating it or including the failed answer', () => {
    const turn = prepareDialogueTurn(failed(), '', 'retry');
    expect(turn.inputText).toBe('原文是什么意思？');
    expect(turn.conversation.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(turn.history).toEqual([]);
    expect(turn.responseId).toBe('answer');
  });

  it('includes partial content only when explicitly continuing, and reuses the same response', () => {
    const session = failed();
    expect(conversationHistory(session.messages)).toEqual([
      { role: 'user', content: '原文是什么意思？' },
    ]);
    const turn = prepareDialogueTurn(session, '', 'continue');
    expect(turn.prefix).toBe('尚未说完的判断');
    expect(turn.responseId).toBe('answer');
    expect(turn.conversation.messages).toHaveLength(1);
    expect(conversationHistory(turn.history).at(-1)?.content).toBe('尚未说完的判断');
  });

  it('restores an interrupted stream as stopped and retains its exact source snapshot', () => {
    const session = failed();
    session.messages[1]!.status = 'streaming';
    const restored = restoreDialogueConversation(session);
    expect(restored.messages[1]!.status).toBe('stopped');
    expect(restored.source).toEqual(source);
    expect(session.messages[1]!.status).toBe('streaming');
  });

  it('rejects unknown versions, malformed messages and foreign book sources', () => {
    const file: DialogueFile = { version: 1, bookHash: 'book', conversations: [failed()] };
    expect(() => validateDialogueFile(file, 'book')).not.toThrow();
    expect(() => validateDialogueFile({ ...file, version: 2 }, 'book')).toThrow();
    expect(() => validateDialogueFile(file, 'different')).toThrow();
    expect(() =>
      validateDialogueFile(
        { ...file, conversations: [{ ...failed(), messages: [{ role: 'assistant' }] }] },
        'book',
      ),
    ).toThrow();
  });

  it('preserves divergent imported histories instead of overwriting a local answer', () => {
    const local = failed();
    local.messages[1]!.status = 'complete';
    const imported = structuredClone(local);
    imported.messages[1]!.text = '备份中另一条完整回答';
    const merged = mergeDialogueFiles(
      { version: 1, bookHash: 'book', conversations: [local] },
      { version: 1, bookHash: 'book', conversations: [imported] },
    );
    expect(merged.conversations).toHaveLength(2);
    expect(new Set(merged.conversations.map((item) => item.id)).size).toBe(2);
    expect(
      merged.conversations.flatMap((item) => item.messages).map((item) => item.text),
    ).toContain('备份中另一条完整回答');
  });

  it('stores conversations without login or network access and preserves concurrent additions', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Networking is disabled'));
    const files = new Map<string, string>();
    const service = {
      exists: vi.fn(async (path: string) => files.has(path)),
      readFile: vi.fn(async (path: string) => files.get(path)!),
      writeFile: vi.fn(async (path: string, _base: string, text: string) => {
        files.set(path, text);
      }),
      createDir: vi.fn(async () => {}),
      deleteFile: vi.fn(async (path: string) => {
        files.delete(path);
      }),
      replaceFile: vi.fn(async (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      }),
    } as unknown as AppService;
    const original = failed();
    await saveDialogueConversation(service, 'book', original);
    const left = structuredClone(original);
    const right = structuredClone(original);
    left.messages.push({
      id: 'left',
      role: 'user',
      text: '左窗格的问题',
      status: 'complete',
      updatedAt: left.updatedAt,
    });
    right.messages.push({
      id: 'right',
      role: 'user',
      text: '右窗格的问题',
      status: 'complete',
      updatedAt: right.updatedAt,
    });
    await Promise.all([
      saveDialogueConversation(service, 'book', left),
      saveDialogueConversation(service, 'book', right),
    ]);
    const restored = await loadDialogueFile(service, 'book');
    expect(restored.conversations[0]!.messages.map((message) => message.id)).toEqual([
      'user',
      'answer',
      'left',
      'right',
    ]);
    expect(files.has('book/reading-dialogues.json.backup')).toBe(true);
    expect(network).not.toHaveBeenCalled();
  });
});
