import { streamText } from 'ai';
import { OpenRouterProvider } from '@/services/ai/providers/OpenRouterProvider';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { isTauriAppPlatform } from '@/services/environment';
import { getSecureItem, setSecureItem, clearSecureItem } from '@/utils/bridge';
import type { ReadingMethodProfile, ReadingMethodRecord } from '../reading-method/types';
import {
  CONVERSATION_SYSTEM,
  conversationHistory,
  conversationInstruction,
  planConversation,
  repeatsPreviousAnswer,
  type ConversationTurn,
} from '../reading-modes/conversation';

const CONFIG_KEY = 'active-reader.ai.v1';
const SECRET_KEY = 'active-reader-ai-key';
let sessionKey = '';
let secureRead: ReturnType<typeof getSecureItem> | null = null;
export interface ReadingAIConfig {
  baseUrl: string;
  model: string;
}
export interface PublicReadingSource {
  title: string;
  url: string;
  excerpt: string;
  retrievedAt: string;
  provider?: string;
  evidence?: 'abstract' | 'bibliographic' | 'search-snippet';
  publishedAt?: string;
}
export interface ReadingAIContext {
  quick?: boolean;
  understood?: boolean;
  publicSources?: PublicReadingSource[];
  externalQuestion?: boolean;
  history?: ConversationTurn[];
  searchStatus?: string;
}
export const defaultAIConfig: ReadingAIConfig = { baseUrl: 'https://api.openai.com/v1', model: '' };

export function loadAIConfig(): ReadingAIConfig {
  const stored = localStorage.getItem(CONFIG_KEY);
  if (!stored) return defaultAIConfig;
  const value = JSON.parse(stored) as ReadingAIConfig;
  return { baseUrl: value.baseUrl || defaultAIConfig.baseUrl, model: value.model || '' };
}
export async function readAIKey(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!isTauriAppPlatform()) return sessionKey;
  // A system authorization prompt can hold the native call indefinitely.
  // Share that call, but let each UI caller cancel or time out independently.
  secureRead ??= getSecureItem({ key: SECRET_KEY }).finally(() => {
    secureRead = null;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('系统钥匙串尚未返回。请完成 Active Reader 的钥匙串授权，再重试。')),
      15000,
    );
    onAbort = () => reject(signal?.reason || new Error('回答已停止。'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  const result = await Promise.race([secureRead, interrupted]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  });
  if (result.error) throw new Error('无法读取系统钥匙串，请重新保存模型配置。');
  return result.value || '';
}
export async function saveAIConfig(config: ReadingAIConfig, key: string, clearKey = false) {
  const url = new URL(config.baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('请输入有效的模型服务地址。');
  if (!config.model.trim()) throw new Error('请填写模型名称。');
  if (isTauriAppPlatform()) {
    if (key || clearKey) {
      const result = clearKey
        ? await clearSecureItem({ key: SECRET_KEY })
        : await setSecureItem({ key: SECRET_KEY, value: key });
      if (!result.success) throw new Error('系统钥匙串保存失败，配置未保存。');
    }
  } else if (key || clearKey) sessionKey = clearKey ? '' : key;
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({
      baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
      model: config.model.trim(),
    }),
  );
}

export function buildReadingPrompt(
  record: ReadingMethodRecord,
  profile: ReadingMethodProfile,
  context: ReadingAIContext = {},
) {
  if (!record.source?.excerpt) throw new Error('这条记录没有绑定原文，请先选择一段文字。');
  if (
    record.source.excerpt.length > 6000 ||
    (record.source.context?.length || 0) > 3000 ||
    record.userText.length > 6000 ||
    profile.goal.length > 1000 ||
    profile.genre.length > 100
  ) {
    throw new Error('本次内容较长，请缩小选文或精简问题后再试。');
  }
  const plan = planConversation(record.userText, context.history);
  const task = context.quick
    ? '只用一句简短的话解释选中的句子，只依据原文与邻文，不延伸、不引入外部资料、不提问。'
    : conversationInstruction(plan);
  const sources = context.quick
    ? []
    : (context.publicSources || []).slice(0, 6).map((source) => ({
        title: source.title.slice(0, 200),
        url: source.url.slice(0, 1000),
        excerpt: source.excerpt.slice(0, 1500),
        retrievedAt: source.retrievedAt,
        publishedAt: source.publishedAt,
        provider: source.provider,
        evidence: source.evidence,
      }));
  return {
    system: CONVERSATION_SYSTEM,
    reasoning:
      !context.quick && ['opinion', 'reason', 'challenge', 'current'].includes(plan.intent),
    history: context.quick ? [] : conversationHistory(context.history || []),
    prompt: `${task}\n阅读目标（仅供背景）：${profile.goal}\n\n今天日期：${new Date().toISOString().slice(0, 10)}\n当前问题：${record.userText}\n\n以下 JSON 是可选的阅读背景（不代表用户只想讨论原文）：\n${JSON.stringify({ title: record.source.title, author: record.source.author, chapter: record.source.chapter, excerpt: record.source.excerpt, nearbyText: record.source.context || '' })}\n\n${sources.length ? `实际检索取得的公开资料，引用时使用对应链接。搜索摘要只代表线索，不能当成已阅读全文：\n${JSON.stringify(sources)}` : '本次没有取得公开资料。可以解释可靠的稳定背景和进行分析，但不得宣称已核实近况。'}\n${context.searchStatus || ''}`,
  };
}

export async function askReadingAI(
  record: ReadingMethodRecord,
  profile: ReadingMethodProfile,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  context: ReadingAIContext = {},
): Promise<{ text: string; model: string }> {
  return streamConversationText(
    buildReadingPrompt(record, profile, context),
    signal,
    onChunk,
    context.quick ? 320 : 1800,
  );
}

export interface ReadingPrompt {
  reasoning?: boolean;
  system: string;
  prompt: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export async function streamReadingText(
  prompt: ReadingPrompt,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  maxOutputTokens = 3200,
): Promise<{ text: string; model: string }> {
  signal.throwIfAborted();
  const config = loadAIConfig();
  const key = await readAIKey(signal);
  signal.throwIfAborted();
  if (!config.model || !key)
    throw new Error('请先展开“模型连接”，填写服务地址、模型名称和 API Key。');
  const provider = new OpenRouterProvider({
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    provider: 'openrouter',
    openrouterBaseUrl: config.baseUrl,
    openrouterModel: config.model,
    openrouterApiKey: key,
  });
  const result = streamText({
    model: provider.getModel(),
    system: prompt.system,
    ...(prompt.history?.length
      ? { messages: [...prompt.history, { role: 'user' as const, content: prompt.prompt }] }
      : { prompt: prompt.prompt }),
    abortSignal: signal,
    maxRetries: 0,
    maxOutputTokens:
      prompt.reasoning && new URL(config.baseUrl).hostname === 'api.deepseek.com'
        ? Math.max(8192, maxOutputTokens)
        : maxOutputTokens,
    timeout: { totalMs: 120000, chunkMs: 45000 },
    // Keep quick helpers fast; substantive discussions use the configured model
    // reasoning mode with room for both reasoning and the visible answer.
    providerOptions:
      new URL(config.baseUrl).hostname === 'api.deepseek.com'
        ? { openrouter: { thinking: { type: prompt.reasoning ? 'enabled' : 'disabled' } } }
        : undefined,
    // Errors are handled below and shown in the reading panel. Do not log the
    // provider error object, which can contain the user's submitted passage.
    onError: () => {},
  });
  let text = '';
  for await (const part of result.fullStream) {
    if (part.type === 'abort')
      throw new Error(signal.aborted ? '回答已停止。' : '模型响应超时，请稍后重试。');
    if (part.type === 'error') throw part.error;
    if (part.type === 'text-delta') {
      text += part.text;
      onChunk(text);
    }
  }
  signal.throwIfAborted();
  if (!text.trim()) throw new Error('模型没有返回文字，请检查服务与模型配置后重试。');
  return { text, model: config.model };
}

/** Hold only the opening until it can be checked; the rest still streams as generated. */
export async function streamConversationText(
  prompt: ReadingPrompt,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  maxOutputTokens = 3200,
) {
  const previous =
    [...(prompt.history ?? [])].reverse().find((turn) => turn.role === 'assistant')?.content ?? '';
  const opening = new AbortController();
  let repeated = false;
  let released =
    previous.replace(/[^\p{L}\p{N}]/gu, '').length < 120 ||
    /(?:重述|重复一遍|再说一遍|重新列出)/.test(prompt.prompt.split('\n\n')[0] ?? '');
  try {
    const result = await streamReadingText(
      prompt,
      AbortSignal.any([signal, opening.signal]),
      (text) => {
        if (!released && text.length < 180) return;
        if (!released) {
          repeated = repeatsPreviousAnswer(text, previous);
          if (repeated) {
            opening.abort();
            return;
          }
          released = true;
        }
        onChunk(text);
      },
      maxOutputTokens,
    );
    if (!released && repeatsPreviousAnswer(result.text, previous)) {
      repeated = true;
      throw new Error('Repeated opening');
    }
    if (!released) onChunk(result.text);
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (!repeated) throw error;
    return streamReadingText(
      {
        ...prompt,
        system: `${prompt.system}\n刚才的开场几乎复述了上一轮。重新回答最新问题，直接提供新的判断或理由，不重列旧标题和作者摘要。`,
      },
      signal,
      onChunk,
      maxOutputTokens,
    );
  }
}
