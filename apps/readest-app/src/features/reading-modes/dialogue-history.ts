import type { AppService } from '@/types/system';
import { readLocalReaderJSON, writeLocalReaderJSON } from '@/services/localReaderPersistence';
import type { ReadingSource } from '../reading-method/types';
import type { PublicReadingSource } from '../active-reading/ai';

export interface DialogueMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'streaming' | 'complete' | 'stopped' | 'error';
  updatedAt: string;
  replyTo?: string;
  model?: string;
  sources?: PublicReadingSource[];
  bookReference?: boolean;
  searchStatus?: string;
  sourceReview?: 'checked' | 'unavailable' | 'not-needed';
}
export interface DialogueConversation {
  id: string;
  source: ReadingSource;
  createdAt: string;
  updatedAt: string;
  messages: DialogueMessage[];
}
export interface DialogueFile {
  version: 1;
  bookHash: string;
  conversations: DialogueConversation[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalStrings = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => value[key] === undefined || typeof value[key] === 'string');

export function validateDialogueFile(
  value: unknown,
  bookHash: string,
): asserts value is DialogueFile {
  const fail = () => {
    throw new Error('本地对话文件格式不正确，原文件已保留。');
  };
  if (
    !object(value) ||
    value['version'] !== 1 ||
    value['bookHash'] !== bookHash ||
    !Array.isArray(value['conversations'])
  )
    return fail();
  const ids = new Set<string>();
  for (const session of value['conversations']) {
    if (
      !object(session) ||
      typeof session['id'] !== 'string' ||
      !session['id'] ||
      ids.has(session['id']) ||
      !date(session['createdAt']) ||
      !date(session['updatedAt']) ||
      !Array.isArray(session['messages'])
    )
      return fail();
    ids.add(session['id']);
    const source = session['source'];
    if (
      !object(source) ||
      source['bookHash'] !== bookHash ||
      typeof source['excerpt'] !== 'string' ||
      !optionalStrings(source, ['cfi', 'chapter', 'title', 'author', 'context', 'bookVersion']) ||
      (source['sectionIndex'] !== undefined &&
        (!Number.isInteger(source['sectionIndex']) || Number(source['sectionIndex']) < 0))
    )
      return fail();
    const messageIds = new Set<string>();
    for (const message of session['messages']) {
      if (
        !object(message) ||
        typeof message['id'] !== 'string' ||
        !message['id'] ||
        messageIds.has(message['id']) ||
        !['user', 'assistant'].includes(String(message['role'])) ||
        typeof message['text'] !== 'string' ||
        !['streaming', 'complete', 'stopped', 'error'].includes(String(message['status'])) ||
        !date(message['updatedAt']) ||
        !optionalStrings(message, ['replyTo', 'model', 'searchStatus']) ||
        (message['bookReference'] !== undefined && typeof message['bookReference'] !== 'boolean') ||
        (message['sourceReview'] !== undefined &&
          !['checked', 'unavailable', 'not-needed'].includes(String(message['sourceReview'])))
      )
        return fail();
      messageIds.add(message['id']);
      if (
        message['sources'] !== undefined &&
        (!Array.isArray(message['sources']) ||
          !message['sources'].every(
            (item: unknown) =>
              object(item) &&
              ['title', 'url', 'excerpt', 'retrievedAt'].every(
                (key) => typeof item[key] === 'string',
              ) &&
              /^https?:\/\//.test(String(item['url'])) &&
              optionalStrings(item, ['provider', 'publishedAt']) &&
              (item['evidence'] === undefined ||
                ['abstract', 'bibliographic', 'search-snippet'].includes(String(item['evidence']))),
          ))
      )
        return fail();
    }
    const messages: Record<string, unknown>[] = session['messages'];
    if (
      messages.some(
        (message) =>
          message['replyTo'] !== undefined &&
          !messages.some(
            (parent) => parent['id'] === message['replyTo'] && parent['role'] === 'user',
          ),
      )
    )
      return fail();
  }
}

export function createDialogueConversation(source: ReadingSource): DialogueConversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    source: { ...source },
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function restoreDialogueConversation(session: DialogueConversation): DialogueConversation {
  return {
    ...session,
    source: { ...session.source },
    messages: session.messages.map((message) => ({
      ...message,
      status: message.status === 'streaming' ? 'stopped' : message.status,
    })),
  };
}

export function sameDialogueSource(a: ReadingSource, b: ReadingSource) {
  return (
    a.bookHash === b.bookHash &&
    a.bookVersion === b.bookVersion &&
    a.cfi === b.cfi &&
    a.sectionIndex === b.sectionIndex &&
    a.excerpt === b.excerpt
  );
}

export function prepareDialogueTurn(
  session: DialogueConversation,
  input: string,
  action: 'send' | 'retry' | 'continue' = 'send',
) {
  const previous = session.messages.at(-1);
  const interrupted =
    previous?.role === 'assistant' && ['stopped', 'error'].includes(previous.status)
      ? previous
      : undefined;
  const original =
    interrupted &&
    session.messages.find(
      (message) => message.id === interrupted.replyTo && message.role === 'user',
    );
  if (action !== 'send' && (!original || !interrupted)) throw new Error('当前没有可以重试的回答。');
  const now = new Date().toISOString();
  const user: DialogueMessage =
    original && action !== 'send'
      ? original
      : {
          id: crypto.randomUUID(),
          role: 'user',
          text: input.trim(),
          status: 'complete',
          updatedAt: now,
        };
  if (!user.text) throw new Error('先输入一条消息。');
  const base =
    action === 'send'
      ? [...session.messages, user]
      : session.messages.filter((message) => message.id !== interrupted!.id);
  const history =
    action === 'continue'
      ? session.messages.map((message) =>
          message.id === interrupted!.id ? { ...message, status: 'complete' as const } : message,
        )
      : action === 'retry'
        ? session.messages.slice(
            0,
            session.messages.findIndex((message) => message.id === user.id),
          )
        : session.messages;
  return {
    conversation: { ...session, messages: base, updatedAt: now },
    user,
    history,
    inputText:
      action === 'continue' ? '接着刚才未完成的回答继续，不要重复已显示的内容。' : user.text,
    responseId: action === 'send' ? crypto.randomUUID() : interrupted!.id,
    prefix: action === 'continue' ? interrupted!.text : '',
  };
}

/** Backup imports never silently replace a differing message or source snapshot. */
export function mergeDialogueFiles(current: DialogueFile, incoming: DialogueFile): DialogueFile {
  validateDialogueFile(current, current.bookHash);
  validateDialogueFile(incoming, current.bookHash);
  const conversations = [...current.conversations];
  for (const addition of incoming.conversations) {
    const index = conversations.findIndex((session) => session.id === addition.id);
    if (index === -1) {
      conversations.push(addition);
      continue;
    }
    const local = conversations[index]!;
    const localMessages = new Map(local.messages.map((message) => [message.id, message]));
    const conflicting =
      !sameDialogueSource(local.source, addition.source) ||
      addition.messages.some((message) => {
        const existing = localMessages.get(message.id);
        return (
          existing &&
          (existing.text !== message.text ||
            existing.role !== message.role ||
            existing.replyTo !== message.replyTo)
        );
      });
    if (conflicting) {
      // Deduplicate repeat imports of a branch while preserving its complete context.
      const duplicate = conversations.some(
        (session) =>
          sameDialogueSource(session.source, addition.source) &&
          JSON.stringify(session.messages) === JSON.stringify(addition.messages),
      );
      if (!duplicate) conversations.push({ ...addition, id: crypto.randomUUID() });
    } else {
      for (const message of addition.messages) {
        const existing = localMessages.get(message.id);
        if (!existing || message.updatedAt > existing.updatedAt)
          localMessages.set(message.id, message);
      }
      conversations[index] = {
        ...(addition.updatedAt > local.updatedAt ? addition : local),
        messages: [...localMessages.values()],
      };
    }
  }
  return { ...current, conversations };
}

export async function loadDialogueFile(
  service: AppService,
  bookHash: string,
): Promise<DialogueFile> {
  return readLocalReaderJSON(
    service,
    `${bookHash}/reading-dialogues.json`,
    'Books',
    (value) => validateDialogueFile(value, bookHash),
    { version: 1, bookHash, conversations: [] },
  );
}

const queues = new WeakMap<AppService, Map<string, Promise<unknown>>>();
export function saveDialogueConversation(
  service: AppService,
  bookHash: string,
  session: DialogueConversation,
): Promise<DialogueFile> {
  let queue = queues.get(service);
  if (!queue) {
    queue = new Map();
    queues.set(service, queue);
  }
  const task = (queue.get(bookHash) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const current = await loadDialogueFile(service, bookHash);
      const previous = current.conversations.find((item) => item.id === session.id);
      const messages = new Map(previous?.messages.map((message) => [message.id, message]));
      for (const message of session.messages) {
        const existing = messages.get(message.id);
        if (!existing || message.updatedAt >= existing.updatedAt) messages.set(message.id, message);
      }
      const conversations = current.conversations.filter((item) => item.id !== session.id);
      const next: DialogueFile = {
        ...current,
        conversations: [...conversations, { ...session, messages: [...messages.values()] }],
      };
      validateDialogueFile(next, bookHash);
      await service.createDir(bookHash, 'Books');
      await writeLocalReaderJSON(
        service,
        `${bookHash}/reading-dialogues.json`,
        'Books',
        next,
        (value) => validateDialogueFile(value, bookHash),
      );
      return next;
    });
  queue.set(bookHash, task);
  void task
    .finally(() => {
      if (queue.get(bookHash) === task) queue.delete(bookHash);
    })
    .catch(() => {});
  return task;
}
