'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  BookmarkCheck,
  BookmarkPlus,
  CircleCheck,
  CircleHelp,
  Globe2,
  Send,
  X,
} from 'lucide-react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import type { ReadingSource } from '../reading-method/types';
import { askReadingAI, type PublicReadingSource } from '../active-reading/ai';
import {
  emptyReadingData,
  loadReadingData,
  mutateReadingData,
  type ReadingData,
  type ReadingRecord,
} from '../active-reading/data';
import {
  createDialogueRecord,
  derivePublicSearchQuery,
  searchPublicSources,
  serializeDialogueAnswer,
  type PublicSourceProvider,
} from './dialogue';
import AnswerMarkdown from './AnswerMarkdown';
import ModianMascot from './ModianMascot';
import { planConversation } from './conversation';
import { shouldSendComposerMessage } from './thematic';
import { reviewResearchCitations } from './research-assistant';
import {
  createDialogueConversation,
  loadDialogueFile,
  prepareDialogueTurn,
  restoreDialogueConversation,
  sameDialogueSource,
  saveDialogueConversation,
  type DialogueConversation,
  type DialogueMessage,
} from './dialogue-history';
import './dialogue.css';
import './dialogue-history.css';

export interface DialogueCardProps {
  bookKey: string;
  source: ReadingSource;
  onClose: () => void;
  onSaved: (record: ReadingRecord) => void;
  onRemoved?: (recordId: string) => void;
  quick?: boolean;
}

interface DialogueResult {
  text: string;
  model: string;
  inputText: string;
  sources: PublicReadingSource[];
}

const normalizedSourceText = (value = '') => value.replace(/\s+/g, ' ').trim();

const matchesDialogueSource = (record: ReadingRecord, source: ReadingSource, bookHash: string) => {
  const saved = record.source;
  if (!saved || record.status === 'discarded') return false;
  if ((saved.bookHash || bookHash) !== bookHash) return false;
  if (source.cfi && saved.cfi) return source.cfi === saved.cfi;
  return (
    normalizedSourceText(source.excerpt) === normalizedSourceText(saved.excerpt) &&
    (!source.chapter || !saved.chapter || source.chapter === saved.chapter)
  );
};

const markersForSource = (data: ReadingData, source: ReadingSource, bookHash: string) =>
  data.records.reduce<{ question?: string; note?: string }>((markers, record) => {
    if (!matchesDialogueSource(record, source, bookHash)) return markers;
    markers[record.kind === 'question' ? 'question' : 'note'] = record.id;
    return markers;
  }, {});

export default function DialogueCard({
  bookKey,
  source: selectedSource,
  onClose,
  onSaved,
  onRemoved,
  quick = false,
}: DialogueCardProps) {
  const { appService } = useEnv();
  const bookHash = bookKey.split('-')[0]!;
  const [source, setSource] = useState(selectedSource);
  const bookData = useBookDataStore((state) => state.booksData[bookHash]);
  const initial = useMemo(
    () => emptyReadingData(bookHash, bookData?.book?.title || '', bookData?.book?.author || ''),
    [bookHash, bookData?.book?.title, bookData?.book?.author],
  );
  const [data, setData] = useState<ReadingData | null>(null);
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [text, setText] = useState('');
  const [publicEnabled, setPublicEnabled] = useState(true);
  const [publicProvider, setPublicProvider] = useState<PublicSourceProvider>('web');
  const [searchTerm, setSearchTerm] = useState('');
  const [streamedAnswer, setStreamedAnswer] = useState('');
  const [result, setResult] = useState<DialogueResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [savedStatus, setSavedStatus] = useState('');
  const [sessions, setSessions] = useState<DialogueConversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const sessionRef = useRef(createDialogueConversation({ ...selectedSource, bookHash }));
  const pendingSave = useRef<DialogueConversation | null>(null);
  const historyReady = useRef<Promise<void>>(Promise.resolve());
  const closeRequested = useRef(false);
  const [savedMarkers, setSavedMarkers] = useState<{
    question?: string;
    note?: string;
  }>({});
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const quickStarted = useRef(false);
  const headingId = useId();
  const closeRef = useRef(onClose);
  const followBottom = useRef(true);
  const partialRef = useRef('');
  const messageLogRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  closeRef.current = onClose;

  useEffect(() => {
    mounted.current = true;
    if (appService)
      void loadReadingData(appService, initial)
        .then((value) => {
          if (mounted.current) {
            setData(value);
          }
        })
        .catch((reason: unknown) => {
          if (mounted.current)
            setError(reason instanceof Error ? reason.message : '阅读记录读取失败。');
        });
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        controller.current?.abort();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [appService, bookHash, initial]);

  useEffect(() => {
    if (data) setSavedMarkers(markersForSource(data, source, bookHash));
  }, [data, source, bookHash]);

  const openSession = (session: DialogueConversation, resetInput = true) => {
    const restored = restoreDialogueConversation(session);
    sessionRef.current = restored;
    setSource(restored.source);
    setMessages(restored.messages);
    if (resetInput) setText('');
    setStreamedAnswer('');
    setError('');
    setSavedStatus('');
    if (resetInput) setShowHistory(false);
    const answer = [...restored.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.status === 'complete');
    const question = restored.messages.find((message) => message.id === answer?.replyTo);
    setResult(
      answer && question
        ? {
            text: answer.text,
            model: answer.model || '',
            inputText: question.text,
            sources: answer.sources || [],
          }
        : null,
    );
  };

  useEffect(() => {
    let cancelled = false;
    setHistoryError('');
    const original = { ...selectedSource, bookHash };
    historyReady.current = (async () => {
      if (!appService) return;
      try {
        const file = await loadDialogueFile(appService, bookHash);
        if (cancelled) return;
        setSessions(file.conversations);
        const recent = [...file.conversations]
          .filter((session) => sameDialogueSource(session.source, original))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        openSession(recent || createDialogueConversation(original), false);
      } catch (reason) {
        if (!cancelled)
          setHistoryError(reason instanceof Error ? reason.message : '本地对话历史读取失败。');
      }
    })();
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, [appService, bookHash, selectedSource]);

  const persistSession = async (next: DialogueConversation) => {
    pendingSave.current = next;
    if (mounted.current) {
      setSaving(true);
      setSaveError('');
    }
    try {
      if (!appService) throw new Error('书库尚未就绪');
      const file = await saveDialogueConversation(appService, bookHash, next);
      if (pendingSave.current === next) {
        pendingSave.current = null;
        if (mounted.current) {
          setSessions(file.conversations);
          setSaveError('');
        }
      }
      return true;
    } catch {
      if (mounted.current && pendingSave.current === next)
        setSaveError('对话尚未保存到本机，请重试本地保存。');
      return false;
    } finally {
      if (mounted.current && (pendingSave.current === next || !pendingSave.current))
        setSaving(false);
    }
  };

  useEffect(() => {
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (messageLogRef.current && followBottom.current)
      messageLogRef.current.scrollTop = messageLogRef.current.scrollHeight;
  }, [messages, streamedAnswer, phase]);

  async function ask(quickPrompt = false, action: 'send' | 'retry' | 'continue' = 'send') {
    if (controller.current || busy) return;
    await historyReady.current;
    if (controller.current || historyError || pendingSave.current) return;
    closeRequested.current = false;
    setError('');
    setSavedStatus('');
    const active = sessionRef.current;
    if (quickPrompt && active.messages.length) return;
    if (active.source.bookHash !== bookHash) {
      setError('所选原文不属于这本书，请重新选择。');
      return;
    }
    let turn: ReturnType<typeof prepareDialogueTurn>;
    try {
      turn = prepareDialogueTurn(active, quickPrompt ? '请解释这句话。' : text.trim(), action);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '先输入一条消息。');
      return;
    }
    const { inputText, history } = turn;
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(
      () => abort.abort(new DOMException('模型响应超时，请重试。', 'TimeoutError')),
      150000,
    );
    setBusy(true);
    setShowHistory(false);
    setResult(null);
    setStreamedAnswer('');
    partialRef.current = turn.prefix;
    followBottom.current = true;
    const plan = planConversation(inputText, history);
    const externalQuestion = plan.intent === 'current' || plan.intent === 'background';
    const usePublicSources = !quickPrompt && publicEnabled && plan.web;
    let publicSources: PublicReadingSource[] = [];
    let searchStatus = usePublicSources ? '' : publicEnabled ? '本轮未联网' : '联网已关闭';
    let sourceReview: DialogueMessage['sourceReview'];
    let generationComplete = false;
    let model = '';
    let checkpoint = 0;
    const update = (status: DialogueMessage['status']) => {
      const now = new Date().toISOString();
      const response: DialogueMessage = {
        id: turn.responseId,
        replyTo: turn.user.id,
        role: 'assistant',
        text: partialRef.current,
        status,
        updatedAt: now,
        model,
        sources: publicSources,
        bookReference: quickPrompt || plan.intent === 'explain' || plan.sourceScope === 'books',
        searchStatus,
        sourceReview,
      };
      const next = {
        ...turn.conversation,
        updatedAt: now,
        messages: [...turn.conversation.messages, response],
      };
      sessionRef.current = next;
      if (mounted.current) setMessages(next.messages);
      return next;
    };
    try {
      // Persist the accepted question before sending it to a model. A failed
      // local write remains independently retryable without rerunning AI.
      if (!(await persistSession(update('streaming')))) {
        pendingSave.current = update('error');
        return;
      }
      if (mounted.current) setText('');
      abort.signal.throwIfAborted();
      const publicQuery = searchTerm.trim() || derivePublicSearchQuery(plan.query) || inputText;
      setPhase(usePublicSources ? '正在查找公开资料…' : '正在思考…');
      if (usePublicSources) {
        try {
          publicSources = await searchPublicSources(publicQuery, abort.signal, publicProvider, {
            recent: plan.intent === 'current',
          });
          searchStatus = `已检索 ${publicSources.length} 条公开资料`;
        } catch {
          abort.signal.throwIfAborted();
          searchStatus = '本轮检索未取得可用资料，不能核实近况';
        }
      }
      abort.signal.throwIfAborted();
      if (mounted.current) setPhase('正在回答…');
      const record = createDialogueRecord(
        {
          ...active.source,
          bookHash,
          title: active.source.title || bookData?.book?.title,
          author: active.source.author || bookData?.book?.author,
        },
        inputText,
        false,
      );
      const combine = (value: string) => (turn.prefix ? `${turn.prefix}\n\n${value}` : value);
      const response = await askReadingAI(
        record,
        data?.profile || initial.profile,
        abort.signal,
        (value) => {
          partialRef.current = combine(value);
          const next = update('streaming');
          // Bounded checkpoints retain streamed content across an app crash.
          if (Date.now() - checkpoint >= 1000) {
            checkpoint = Date.now();
            void persistSession(next);
          }
        },
        { quick: quickPrompt, publicSources, externalQuestion, history, searchStatus },
      );
      partialRef.current = combine(response.text);
      model = response.model;
      generationComplete = true;
      if (mounted.current) setPhase('正在核对来源…');
      const review = await reviewResearchCitations(
        partialRef.current,
        [{ id: active.id, source: active.source, readingNote: '' }],
        abort.signal,
        { publicSources, reviewAll: true },
      );
      partialRef.current = review.text;
      sourceReview = review.needed ? (review.reviewed ? 'checked' : 'unavailable') : 'not-needed';
      await persistSession(update('complete'));
      if (mounted.current) {
        setResult({ text: review.text, model, inputText: turn.user.text, sources: publicSources });
        setStreamedAnswer('');
      }
    } catch (reason) {
      const stopped =
        abort.signal.aborted &&
        !(
          abort.signal.reason instanceof DOMException && abort.signal.reason.name === 'TimeoutError'
        );
      if (generationComplete) sourceReview = 'unavailable';
      await persistSession(update(generationComplete ? 'complete' : stopped ? 'stopped' : 'error'));
      if (mounted.current) {
        setStreamedAnswer('');
        if (generationComplete)
          setResult({
            text: partialRef.current,
            model,
            inputText: turn.user.text,
            sources: publicSources,
          });
        setError(
          generationComplete
            ? '来源核对未完成，回答已保留。'
            : stopped
              ? '本次回答已停止。'
              : reason instanceof Error
                ? reason.message
                : '小墨暂时无法回答，请重试。',
        );
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) controller.current = null;
      if (mounted.current) {
        setBusy(false);
        setPhase('');
      }
      if (closeRequested.current && !pendingSave.current) onClose();
    }
  }

  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    if (quick && data && !quickStarted.current) {
      quickStarted.current = true;
      void askRef.current(true);
    }
  }, [quick, data]);

  async function toggleSavedMarker(forceQuestion: boolean) {
    setError('');
    setSavedStatus('');
    if (!appService) {
      setError('书库尚未就绪，请稍后再试。');
      return;
    }
    if (source.bookHash && source.bookHash !== bookHash) {
      setError('所选原文不属于这本书，请重新选择。');
      return;
    }
    const marker = forceQuestion ? 'question' : 'note';
    const existingId = savedMarkers[marker];
    setBusy(true);
    try {
      if (existingId) {
        const next = await mutateReadingData(appService, initial, (current) => ({
          ...current,
          records: current.records.filter((record) => record.id !== existingId),
        }));
        if (mounted.current) {
          setData(next);
          setSavedMarkers((current) => ({ ...current, [marker]: undefined }));
          setSavedStatus(forceQuestion ? '已取消疑问标记' : '已取消笔记标记');
          onRemoved?.(existingId);
        }
        return;
      }
      const inputText =
        text.trim() ||
        result?.inputText ||
        [...messages].reverse().find((message) => message.role === 'user')?.text ||
        (forceQuestion ? '这句话我有疑问。' : '这句话我想稍后再看。');
      const record = createDialogueRecord({ ...source, bookHash }, inputText, false, forceQuestion);
      if (!forceQuestion) {
        record.kind = 'understanding';
        record.status = 'kept';
      }
      if (result && result.inputText === inputText) {
        record.aiText = serializeDialogueAnswer(result.text, result.sources);
        record.aiInputText = result.inputText;
        record.model = result.model;
      }
      let savedRecord = record;
      const next = await mutateReadingData(appService, initial, (current) => {
        const existing = current.records.find(
          (item) =>
            matchesDialogueSource(item, source, bookHash) &&
            (item.kind === 'question') === forceQuestion,
        );
        if (existing) {
          savedRecord = existing;
          return current;
        }
        return { ...current, records: [...current.records, record] };
      });
      if (mounted.current) {
        setData(next);
        if (savedRecord.id === record.id) onSaved(record);
        setSavedMarkers((current) => ({ ...current, [marker]: savedRecord.id }));
        setSavedStatus(
          forceQuestion ? '已标记为疑问，再次点击可取消' : '已标记为笔记，再次点击可取消',
        );
      }
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : '保存失败，内容仍保留在对话中。');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const close = () => {
    if (controller.current) {
      closeRequested.current = true;
      controller.current.abort();
      return;
    }
    if (pendingSave.current) {
      setSaveError('对话尚未保存到本机，请先重试本地保存。');
      return;
    }
    onClose();
  };
  closeRef.current = close;
  const canSave = Boolean(source.excerpt.trim() || text.trim() || result);
  const mascotMood = busy ? 'research' : error ? 'question' : 'reading';
  return (
    <section
      className='modian-dialogue eink-bordered'
      role='dialog'
      aria-modal='false'
      aria-labelledby={headingId}
      data-modian-dialogue
    >
      <header className='modian-dialogue-heading'>
        <div className='modian-dialogue-avatar' aria-hidden>
          <ModianMascot
            mood={mascotMood}
            size={40}
            motion={busy ? 'working' : savedStatus ? 'success' : 'enter'}
          />
        </div>
        <div>
          <h2 id={headingId}>与小墨对话</h2>
          <span>{bookData?.book?.title || '当前阅读'}</span>
        </div>
        <button
          type='button'
          className='modian-history-toggle'
          aria-label='本书对话历史'
          disabled={busy || Boolean(saveError)}
          onClick={() => setShowHistory((value) => !value)}
        >
          历史
        </button>
        <button
          type='button'
          className='modian-dialogue-close'
          aria-label='关闭对话'
          onClick={close}
        >
          <X size={18} aria-hidden='true' />
        </button>
      </header>

      {showHistory && (
        <section className='modian-local-history eink-bordered' aria-label='本书对话历史'>
          <header>
            <strong>本书对话 · 仅保存在本机</strong>
            <button
              type='button'
              disabled={busy || saving || Boolean(saveError)}
              onClick={() =>
                openSession(createDialogueConversation({ ...selectedSource, bookHash }))
              }
            >
              新对话
            </button>
          </header>
          {!sessions.length && <p>还没有保存的对话。</p>}
          {[...sessions]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((session) => (
              <button
                type='button'
                key={session.id}
                disabled={busy || saving || Boolean(saveError)}
                onClick={() => openSession(session)}
              >
                <strong>
                  {session.messages.find((message) => message.role === 'user')?.text ||
                    '未命名对话'}
                </strong>
                <span>
                  {session.source.chapter || '选文'} · {session.source.excerpt.slice(0, 60)}
                </span>
                <small>{new Date(session.updatedAt).toLocaleString()}</small>
              </button>
            ))}
        </section>
      )}

      <details className='modian-dialogue-context'>
        <summary>
          <BookOpen size={15} aria-hidden='true' />
          本次引用 · {source.chapter || '当前章节'}
        </summary>
        <blockquote>{source.excerpt}</blockquote>
      </details>

      <div
        ref={messageLogRef}
        className='modian-dialogue-messages'
        role='log'
        aria-label='对话消息'
        onScroll={(event) => {
          const el = event.currentTarget;
          followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
        }}
      >
        {!messages.length && !streamedAnswer && (
          <p className='modian-dialogue-empty'>可以问原文，也可以聊背景、看法和你的想法。</p>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`modian-message is-${message.role}`}>
            {message.role === 'user' ? (
              <p>{message.text}</p>
            ) : (
              <AnswerMarkdown text={message.text} />
            )}
            {message.status === 'stopped' && (
              <small className='modian-answer-state'>已停止 · 已保留生成内容</small>
            )}
            {message.status === 'error' && (
              <small className='modian-answer-state'>回答中断 · 已保留生成内容</small>
            )}
            {message.sourceReview === 'checked' && (
              <small className='modian-answer-state'>来源已核对</small>
            )}
            {message.sourceReview === 'unavailable' && (
              <small className='modian-answer-state'>来源核对未完成，请展开资料核对</small>
            )}
            {message.role === 'assistant' &&
              Boolean(message.bookReference || message.sources?.length) && (
                <details className='modian-message-sources'>
                  <summary>
                    提供的资料 · {(message.bookReference ? 1 : 0) + (message.sources?.length ?? 0)}
                  </summary>
                  {message.bookReference && (
                    <div className='modian-source-book'>
                      <BookOpen size={14} aria-hidden='true' />
                      <span>
                        <strong>{source.chapter || '当前章节'}</strong>
                        <small>{source.excerpt}</small>
                      </span>
                    </div>
                  )}
                  {message.sources?.map((item) => (
                    <a key={item.url} href={item.url} target='_blank' rel='noopener noreferrer'>
                      <Globe2 size={14} aria-hidden='true' />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.provider}
                          {item.evidence === 'search-snippet' ? ' · 搜索摘要' : ''}
                          {item.publishedAt ? ` · ${item.publishedAt.slice(0, 10)}` : ''}
                        </small>
                      </span>
                    </a>
                  ))}
                </details>
              )}
            {message.searchStatus && (
              <small className='modian-dialogue-status'>{message.searchStatus}</small>
            )}
          </article>
        ))}
        {(streamedAnswer || phase) && (
          <article className='modian-message is-assistant' aria-live='polite'>
            <AnswerMarkdown text={streamedAnswer || phase} />
          </article>
        )}
      </div>

      {!busy && ['stopped', 'error'].includes(messages.at(-1)?.status || '') && (
        <div className='modian-dialogue-recovery'>
          <button
            type='button'
            disabled={Boolean(saveError)}
            onClick={() => void ask(false, 'retry')}
          >
            重新回答
          </button>
          {messages.at(-1)?.text && (
            <button
              type='button'
              disabled={Boolean(saveError)}
              onClick={() => void ask(false, 'continue')}
            >
              继续生成
            </button>
          )}
        </div>
      )}

      {publicEnabled && (
        <details className='modian-dialogue-search-options'>
          <summary>搜索选项</summary>
          <div className='modian-dialogue-search'>
            <select
              aria-label='公开资料来源'
              value={publicProvider}
              disabled={busy}
              onChange={(event) => setPublicProvider(event.target.value as PublicSourceProvider)}
            >
              <option value='web'>公开网页</option>
              <option value='crossref'>学术文献 · Crossref</option>
              <option value='wikipedia'>百科词条 · 维基百科</option>
            </select>
            <input
              aria-label='公开资料检索词'
              value={searchTerm}
              maxLength={180}
              disabled={busy}
              placeholder='留空则从消息自动提取关键词'
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
        </details>
      )}

      <div className='modian-dialogue-composer eink-bordered'>
        <textarea
          ref={composerRef}
          autoFocus
          aria-label='输入消息'
          value={text}
          maxLength={6000}
          rows={2}
          disabled={busy}
          placeholder='输入消息…'
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              shouldSendComposerMessage({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
              })
            ) {
              event.preventDefault();
              void ask();
            }
          }}
        />
        <div className='modian-dialogue-compose-actions'>
          <button
            type='button'
            className={publicEnabled ? 'is-active' : ''}
            aria-label='自动联网'
            title={
              publicEnabled ? '自动联网：需要外部资料时检索，点击关闭' : '联网已关闭，点击开启'
            }
            disabled={busy}
            aria-pressed={publicEnabled}
            onClick={() => setPublicEnabled((value) => !value)}
          >
            <Globe2 size={17} aria-hidden='true' />
          </button>
          <button
            type='button'
            data-marker-kind='question'
            className={`modian-marker-action ${savedMarkers.question ? 'is-active' : ''}`}
            aria-label={savedMarkers.question ? '取消疑问标记' : '标记疑问'}
            aria-pressed={Boolean(savedMarkers.question)}
            title={savedMarkers.question ? '已标记为疑问，点击取消' : '把当前内容标记为疑问'}
            disabled={(!canSave && !savedMarkers.question) || busy}
            onClick={() => void toggleSavedMarker(true)}
          >
            {savedMarkers.question ? (
              <CircleCheck size={17} aria-hidden='true' />
            ) : (
              <CircleHelp size={17} aria-hidden='true' />
            )}
            <span>{savedMarkers.question ? '取消疑问' : '疑问'}</span>
          </button>
          <button
            type='button'
            data-marker-kind='note'
            className={`modian-marker-action ${savedMarkers.note ? 'is-active' : ''}`}
            aria-label={savedMarkers.note ? '取消笔记标记' : '标记笔记'}
            aria-pressed={Boolean(savedMarkers.note)}
            title={savedMarkers.note ? '已标记为笔记，点击取消' : '把当前内容标记为笔记'}
            disabled={(!canSave && !savedMarkers.note) || busy}
            onClick={() => void toggleSavedMarker(false)}
          >
            {savedMarkers.note ? (
              <BookmarkCheck size={17} aria-hidden='true' />
            ) : (
              <BookmarkPlus size={17} aria-hidden='true' />
            )}
            <span>{savedMarkers.note ? '取消笔记' : '笔记'}</span>
          </button>
          {busy ? (
            <button
              type='button'
              className='modian-send'
              onClick={() => controller.current?.abort()}
            >
              停止
            </button>
          ) : (
            <button
              type='button'
              className='modian-send'
              aria-label='发送'
              disabled={!text.trim() || Boolean(saveError) || Boolean(historyError)}
              onClick={() => void ask()}
            >
              <Send size={17} aria-hidden='true' />
            </button>
          )}
        </div>
      </div>
      {historyError && (
        <p className='modian-dialogue-error' role='alert'>
          {historyError}
        </p>
      )}
      {saveError ? (
        <div className='modian-local-save-error' role='alert'>
          <span>{saveError}</span>
          <button
            type='button'
            disabled={saving}
            onClick={() => {
              if (pendingSave.current) void persistSession(pendingSave.current);
            }}
          >
            重试本地保存
          </button>
        </div>
      ) : (
        messages.length > 0 && (
          <small className='modian-local-save-state'>
            {saving ? '正在保存到本机…' : '对话已保存在本机'}
          </small>
        )
      )}
      {(savedStatus || error) && (
        <p
          className={error ? 'modian-dialogue-error' : 'modian-dialogue-status'}
          role={error ? 'alert' : 'status'}
        >
          {error || savedStatus}
        </p>
      )}
    </section>
  );
}
