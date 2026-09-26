'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FiArrowLeft,
  FiArrowUpRight,
  FiBookOpen,
  FiCheck,
  FiSend,
  FiSettings,
  FiX,
  FiPlus,
  FiSquare,
  FiRefreshCw,
  FiClock,
  FiGlobe,
  FiSliders,
  FiMoreHorizontal,
  FiSearch,
  FiChevronsLeft,
  FiSidebar,
  FiFileText,
  FiCopy,
} from 'react-icons/fi';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { writeTextToClipboard } from '@/utils/clipboard';
import AnswerMarkdown from './AnswerMarkdown';
import { planConversation } from './conversation';
import {
  expandResearchQuery,
  rerankResearchEvidence,
  reviewResearchCitations,
} from './research-assistant';
import { searchPublicSources, derivePublicSearchQuery } from './dialogue';
import type { PublicReadingSource } from '../active-reading/ai';
import { useLibraryStore } from '@/store/libraryStore';
import type { TOCItem } from '@/libs/document';
import { emptyReadingData, loadReadingData } from '../active-reading/data';
import type { ReadingSource } from '../reading-method/types';
import {
  balanceEvidence,
  citedPassageIds,
  streamThematicAnswer,
  buildKnowledgeBase,
  cellKey,
  createResearch,
  loadThematicResearch,
  listThematicResearch,
  recommendBooks,
  saveThematicResearch,
  shouldSendComposerMessage,
  type ResearchBook,
  type ResearchChapter,
  type ResearchEvidence,
  type ResearchReadingRecord,
  type ThematicResearch,
  type TopicMessage,
} from './thematic';
import IconButton from './IconButton';
import ModianMascot from './ModianMascot';
import ThematicDialog from './ThematicDialog';
import ThematicAppearance from './ThematicAppearance';
import {
  getTopicIdentity,
  getTopicArchiveId,
  mergeTopicHistory,
  groupTopicHistory,
} from './thematic-history';
import LocalReaderRecoveryNotice from '@/components/LocalReaderRecoveryNotice';
import './thematic.css';

interface ThematicWorkspaceProps {
  bookKey: string;
  onReturnToBook: () => void;
  onOpenSource: (source: ReadingSource) => void;
  onSwitchMode?: () => void;
  onSettings?: () => void;
  onLibrary?: () => void;
  onOpenNotes?: () => void;
}

const flattenChapters = (items: TOCItem[]): ResearchChapter[] =>
  items.flatMap((item) => [
    { id: item.href || `${item.id}`, label: item.label, cfi: item.cfi },
    ...flattenChapters(item.subitems ?? []),
  ]);

function mergeEvidence(previous: ResearchEvidence[], current: ResearchEvidence[]) {
  return [...new Map([...previous, ...current].map((item) => [item.id, item])).values()];
}

export default function ThematicWorkspace({
  bookKey,
  onReturnToBook,
  onOpenSource,
  onSwitchMode,
  onSettings,
  onLibrary,
  onOpenNotes,
}: ThematicWorkspaceProps) {
  const { appService } = useEnv();
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const appearancePreference = useThemeStore((state) => state.readerThemeMode);
  const library = useLibraryStore((state) => state.library);
  const libraryKey = library
    .filter((book) => !book.deletedAt)
    .map((book) => book.hash)
    .sort()
    .join(',');
  const bookHash = bookKey.split('-')[0]!;
  const [research, setResearch] = useState<ThematicResearch>(() => createResearch(bookHash));
  const researchRef = useRef(research);
  const [books, setBooks] = useState<ResearchBook[]>([]);
  const [indexedRecords, setIndexedRecords] = useState<Record<string, ResearchReadingRecord[]>>({});
  const [question, setQuestion] = useState('');
  const [message, setMessage] = useState('');
  const [showBooks, setShowBooks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [indexStatus, setIndexStatus] = useState('');
  const [saveStatus, setSaveStatus] = useState('已保存在本机');
  const [error, setError] = useState('');
  const [allowWeb, setAllowWeb] = useState(true);
  const requestRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const followBottom = useRef(true);
  const mounted = useRef(true);
  const [newTopic, setNewTopic] = useState(false);
  const [citation, setCitation] = useState<ResearchEvidence | null>(null);
  const pendingSave = useRef<ThematicResearch | null>(null);
  const [saveError, setSaveError] = useState('');
  const loadedBook = useRef<string | null>(null);
  const lastMessage = research.messages.at(-1);
  const retryMessage =
    lastMessage?.role === 'user'
      ? lastMessage
      : lastMessage?.status === 'error' || lastMessage?.status === 'stopped'
        ? [...research.messages].reverse().find((item) => item.role === 'user')
        : undefined;
  const retryQuery = retryMessage?.text ?? '';
  const [history, setHistory] = useState<ThematicResearch[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historyDialog, setHistoryDialog] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [switchingTopic, setSwitchingTopic] = useState(false);
  const switchingTopicRef = useRef(false);
  const [copiedMessage, setCopiedMessage] = useState('');
  const historyGroups = groupTopicHistory(mergeTopicHistory(history, research), historyQuery);
  const controlsBusy = loading || Boolean(busy) || switchingTopic;

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    void listThematicResearch(appService)
      .then((studies) => {
        if (!cancelled) {
          setHistory((previous) => mergeTopicHistory([...studies, ...previous]));
          setHistoryError('');
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryError('历史主题读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, [appService, bookHash]);
  useEffect(() => {
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (!pendingSave.current && !requestRef.current && !switchingTopicRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectUnsaved);
    return () => window.removeEventListener('beforeunload', protectUnsaved);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      let liveBooks = useLibraryStore.getState().library.filter((book) => !book.deletedAt);
      if (!useLibraryStore.getState().libraryLoaded) {
        const stored = await appService.loadLibraryBooks();
        useLibraryStore.getState().setLibrary(stored);
        liveBooks = stored.filter((book) => !book.deletedAt);
      }
      const loadBooks = async () => {
        const result: ResearchBook[] = new Array(liveBooks.length);
        let nextBook = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, liveBooks.length) }, async () => {
            while (!cancelled && nextBook < liveBooks.length) {
              const index = nextBook++;
              const book = liveBooks[index]!;
              const current = useBookDataStore.getState().getBookData(book.hash);
              const [readings, navigation, config] = await Promise.allSettled([
                loadReadingData(appService, emptyReadingData(book.hash, book.title, book.author)),
                appService.loadBookNav(book),
                appService.loadBookConfig(book, useSettingsStore.getState().settings),
              ]);
              const toc =
                current?.bookDoc?.toc ??
                (navigation.status === 'fulfilled' ? navigation.value?.toc : []) ??
                [];
              result[index] = {
                hash: book.hash,
                title: book.title,
                author: book.author,
                cover: book.coverImageUrl,
                chapters: flattenChapters(toc),
                records: [
                  ...(readings.status === 'fulfilled'
                    ? readings.value.records.filter((record) => record.status !== 'discarded')
                    : []),
                  ...(config.status === 'fulfilled'
                    ? (config.value.booknotes ?? [])
                        .filter((note) => !note.deletedAt && note.text && note.cfi)
                        .map((note) => ({
                          id: `annotation:${note.id}`,
                          kind: 'understanding' as const,
                          status: 'kept' as const,
                          userText: note.note || '',
                          originalText: note.note || '',
                          revisions: [],
                          source: {
                            bookHash: book.hash,
                            title: book.title,
                            author: book.author,
                            excerpt: note.text!,
                            cfi: note.cfi,
                          },
                        }))
                    : []),
                ],
                loadWarning:
                  readings.status === 'rejected' ? '这本书的阅读笔记暂时没有载入。' : undefined,
              };
            }
          }),
        );
        return result;
      };
      const [study, loadedBooks] = await Promise.all([
        loadThematicResearch(appService, bookHash),
        loadBooks(),
      ]);
      if (cancelled) return;
      // A library refresh must not replace a live or unsaved conversation.
      if (loadedBook.current !== bookHash) {
        loadedBook.current = bookHash;
        const restored = {
          ...study,
          messages: study.messages.map((item) =>
            item.status === 'streaming' ? { ...item, status: 'stopped' as const } : item,
          ),
        };
        researchRef.current = restored;
        setResearch(restored);
        setQuestion(study.question);
      }
      setBooks(loadedBooks);
      setLoading(false);
    };
    void load().catch(() => {
      if (!cancelled) {
        setError('主题阅读暂时无法读取，已有本地文件没有被改动。');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      requestRef.current?.abort();
    };
  }, [appService, bookHash, libraryKey]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && followBottom.current) scroller.scrollTop = scroller.scrollHeight;
  }, [research.messages, busy]);

  const persist = async (next: ThematicResearch): Promise<boolean> => {
    next = { ...next, updatedAt: new Date().toISOString() };
    researchRef.current = next;
    pendingSave.current = next;
    if (mounted.current) {
      setResearch(next);
      setSaveStatus('正在保存…');
    }
    try {
      if (!appService) throw new Error('本地存储尚未就绪');
      await saveThematicResearch(appService, next);
      if (mounted.current)
        setHistory((previous) =>
          mergeTopicHistory(previous, { ...next, updatedAt: new Date().toISOString() }),
        );
      // Older writes may complete while a newer snapshot is being saved.
      if (pendingSave.current === next) {
        pendingSave.current = null;
        if (mounted.current) {
          setSaveStatus('已保存在本机');
          setSaveError('');
        }
      }
      return true;
    } catch {
      if (mounted.current && pendingSave.current === next) {
        setSaveStatus('保存失败');
        setSaveError('本次更改尚未保存，请重新保存。');
      }
      return false;
    }
  };

  const safelyLeave = async (action: () => void) => {
    if (requestRef.current || switchingTopicRef.current) return;
    while (pendingSave.current) {
      if (!(await persist(pendingSave.current)) || requestRef.current || switchingTopicRef.current)
        return;
    }
    if (requestRef.current || switchingTopicRef.current) return;
    action();
  };

  const switchStudy = async (study: ThematicResearch) => {
    if (!appService || requestRef.current || switchingTopicRef.current) return;
    if (getTopicIdentity(study) === getTopicIdentity(researchRef.current)) {
      setNewTopic(false);
      setHistoryDialog(null);
      return;
    }
    switchingTopicRef.current = true;
    setSwitchingTopic(true);
    try {
      while (pendingSave.current) if (!(await persist(pendingSave.current))) return;
      const current = researchRef.current;
      if (current.messages.length) {
        const archived = { ...current, id: getTopicArchiveId(bookHash, current) };
        await saveThematicResearch(appService, archived);
        setHistory((previous) => mergeTopicHistory(previous, archived));
      }
      const restored = {
        ...study,
        id: bookHash,
        messages: study.messages.map((item) =>
          item.status === 'streaming' ? { ...item, status: 'stopped' as const } : item,
        ),
      };
      restored.updatedAt = new Date().toISOString();
      await saveThematicResearch(appService, restored);
      researchRef.current = restored;
      setResearch(restored);
      setHistory((previous) => mergeTopicHistory(previous, restored));
      setSaveStatus('已保存在本机');
      setSaveError('');
      setQuestion(study.question);
      setMessage('');
      setNewTopic(false);
      setHistoryDialog(null);
      setError('');
      setIndexStatus('');
      followBottom.current = true;
    } catch {
      setError('当前主题未能保存，暂未切换，请重试。');
    } finally {
      switchingTopicRef.current = false;
      setSwitchingTopic(false);
    }
  };

  const startNewTopic = () =>
    void safelyLeave(() => {
      setNewTopic(true);
      setQuestion('');
      setMessage('');
      setError('');
      setHistoryDialog(null);
    });

  const enrichedBooks = useMemo(
    () =>
      books.map((book) => ({
        ...book,
        records: [...book.records, ...(indexedRecords[book.hash] ?? [])],
      })),
    [books, indexedRecords],
  );
  const recommendations = useMemo(
    () => recommendBooks(question || research.question, enrichedBooks),
    [question, research.question, enrichedBooks],
  );
  const storedEvidence = useMemo(
    () => [
      ...new Map(
        Object.values(research.cells)
          .flatMap((cell) => cell.evidence)
          .map((item) => [item.id, item]),
      ).values(),
    ],
    [research.cells],
  );
  const evidenceById = useMemo(
    () => new Map(storedEvidence.map((item) => [item.id, item])),
    [storedEvidence],
  );

  const retrieve = async (query: string, signal: AbortSignal) => {
    if (!appService) return enrichedBooks;
    setIndexStatus('正在本机检索书中原文和你的笔记…');
    const { buildPassageIndex, searchPassagesAsync } = await import('./thematic-passages');
    const indexTask = buildPassageIndex(
      appService,
      useLibraryStore.getState().library.filter((book) => !book.deletedAt),
      signal,
      (done, total, title) => {
        if (mounted.current) setIndexStatus(`正在检索 ${done}/${total} · ${title}`);
      },
    );
    signal.throwIfAborted();
    const [result, queries] = await Promise.all([indexTask, expandResearchQuery(query, signal)]);
    signal.throwIfAborted();
    const matches = await searchPassagesAsync(result.passages, query, {
      limitPerBook: 8,
      queries,
      signal,
    });
    const records: Record<string, ResearchReadingRecord[]> = {};
    for (const passage of matches) {
      (records[passage.bookHash] ??= []).push({
        id: passage.passageId,
        passageId: passage.passageId,
        bookVersion: passage.bookVersion,
        contentHash: passage.contentHash,
        score: passage.score,
        kind: 'understanding',
        status: 'open',
        userText: '',
        originalText: '',
        revisions: [],
        source: {
          bookHash: passage.bookHash,
          bookVersion: passage.bookVersion,
          title: passage.title,
          author: passage.author,
          excerpt: passage.excerpt,
          chapter: passage.chapter,
          cfi: passage.cfi,
          sectionIndex: passage.sectionIndex,
          context: passage.context,
        },
      });
    }
    setIndexedRecords(records);
    const warningDetail = matches.length === 0 ? result.warnings[0]?.message : undefined;
    setIndexStatus(
      `已在本机找到 ${matches.length} 处相关原文${result.warnings.length ? `，${result.warnings.length} 本书暂未完成检索${warningDetail ? `（${warningDetail}）` : ''}` : ''}`,
    );
    return books.map((book) => ({
      ...book,
      records: [...book.records, ...(records[book.hash] ?? [])],
    }));
  };

  const run = async (
    query: string,
    _analyzeLibrary: boolean,
    retry = false,
    continuing = false,
  ) => {
    if (!query.trim() || requestRef.current || switchingTopicRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const before = researchRef.current;
    // Retrieval scope never decides whether a conversation is replaced.
    const fresh = newTopic && !retry && !continuing;
    if (retry && query.trim() !== retryMessage?.text) {
      requestRef.current = null;
      return;
    }
    const base = fresh ? createResearch(bookHash) : before;
    if (fresh && before.messages.length) {
      try {
        if (!appService) throw new Error('本地存储尚未就绪');
        setBusy('正在保存当前主题…');
        if (pendingSave.current && !(await persist(pendingSave.current))) {
          requestRef.current = null;
          setBusy('');
          return;
        }
        const archived = { ...before, id: getTopicArchiveId(bookHash, before) };
        await saveThematicResearch(appService, archived);
        setHistory((previous) => mergeTopicHistory(previous, archived));
      } catch {
        requestRef.current = null;
        setBusy('');
        setError('当前主题尚未归档，请重试保存后再开始新主题。');
        return;
      }
    }
    const userMessage: TopicMessage = {
      id: crypto.randomUUID(),
      questionId: 'main',
      role: 'user',
      text: query.trim(),
      passageIds: [],
    };
    const responseId = crypto.randomUUID();
    const last = base.messages.at(-1);
    const pastMessages =
      retry && last?.role === 'modian' && ['error', 'stopped'].includes(last.status || '')
        ? base.messages.slice(0, -1)
        : base.messages;
    let scope: ThematicResearch = {
      ...base,
      question: base.question || query.trim(),
      stage: 2,
      messages:
        retry && pastMessages.at(-1)?.role === 'user'
          ? pastMessages
          : [...pastMessages, userMessage],
    };
    researchRef.current = scope;
    setResearch(scope);
    setNewTopic(false);
    setMessage('');
    const conversation = (
      retry
        ? pastMessages.filter(
            (item, i) =>
              !(
                i === pastMessages.length - 1 &&
                item.role === 'user' &&
                item.text === query.trim()
              ),
          )
        : base.messages
    ).map((item) =>
      continuing && item.id === base.messages.at(-1)?.id && item.status === 'stopped'
        ? { ...item, status: 'complete' as const }
        : item,
    );
    const plan = planConversation(query, conversation, scope.question);
    setBusy(plan.retrieval === 'reuse' ? '正在接着讨论…' : '正在检索书库…');
    setError('');
    followBottom.current = true;
    let answer = '';
    let generationComplete = false;
    let lastCheckpoint = 0;
    let evidence: ResearchEvidence[] = [];
    let publicSources: PublicReadingSource[] = [];
    let sourceReview: TopicMessage['sourceReview'];
    let searchStatus = '';
    let frame = 0;
    const update = (status: TopicMessage['status']) => {
      const response: TopicMessage = {
        id: responseId,
        questionId: 'main',
        role: 'modian',
        text: answer,
        citationMap: evidence.map((item) => item.id),
        passageIds: citedPassageIds(answer, evidence),
        status,
        sourceReview,
        publicSources,
        searchStatus,
      };
      const next = {
        ...scope,
        messages: [...scope.messages, response],
        synthesis: answer,
        synthesisEvidence: response.passageIds,
      };
      researchRef.current = next;
      pendingSave.current = next;
      if (mounted.current) setResearch(next);
      return next;
    };
    try {
      // Store the question before retrieval or any model request starts.
      if (!(await persist(scope))) return;
      let selectedIds = scope.selectedBooks;
      if (
        plan.retrieval === 'search' &&
        (plan.sourceScope === 'books' || !['background', 'current'].includes(plan.intent))
      ) {
        const liveBooks = await retrieve(plan.query, controller.signal);
        controller.signal.throwIfAborted();
        const knowledge = buildKnowledgeBase(
          plan.query,
          liveBooks,
          scope.bookSelectionManual ? scope.selectedBooks : undefined,
        );
        setBusy('正在筛选相关原文与笔记…');
        const ranked = await rerankResearchEvidence(
          plan.query,
          knowledge.evidence,
          controller.signal,
        );
        evidence = ranked.evidence;
        selectedIds = !scope.bookSelectionManual
          ? [...new Set(evidence.map((item) => item.source.bookHash!))]
          : knowledge.books.map((book) => book.hash);
        setIndexStatus(
          evidence.length
            ? `本轮使用 ${evidence.length} 处候选依据${ranked.reviewed ? '' : ' · 语义筛选暂未完成'}`
            : '本轮没有找到合适的书中依据',
        );
      } else if (plan.retrieval === 'reuse') {
        const lastAnswer = [...base.messages].reverse().find((item) => item.role === 'modian');
        const ids = new Set(lastAnswer?.citationMap ?? lastAnswer?.passageIds ?? []);
        evidence = balanceEvidence(
          storedEvidence.filter(
            (item) => ids.has(item.id) && selectedIds.includes(item.source.bookHash || ''),
          ),
        ).slice(0, 8);
        setIndexStatus('沿用相关上下文，继续讨论');
      }
      if (allowWeb && plan.web) {
        setBusy('正在查找公开资料…');
        try {
          publicSources = await searchPublicSources(
            derivePublicSearchQuery(plan.query),
            controller.signal,
            'web',
            { recent: plan.intent === 'current' },
          );
          searchStatus = `已检索 ${publicSources.length} 条公开资料`;
        } catch {
          controller.signal.throwIfAborted();
          searchStatus = '本轮未取得可用公开资料，不能核实近况';
        }
      } else if (plan.web) searchStatus = '联网已关闭，不能核实近况';
      const cells = { ...scope.cells };
      for (const id of selectedIds)
        cells[cellKey('main', id)] = {
          proposition: '',
          evidence: mergeEvidence(
            cells[cellKey('main', id)]?.evidence ?? [],
            evidence.filter((item) => item.source.bookHash === id),
          ),
        };
      scope = { ...scope, cells, selectedBooks: selectedIds, confirmed: true };
      await persist(scope);
      controller.signal.throwIfAborted();
      setBusy('正在回答…');
      const result = await streamThematicAnswer(
        query.trim(),
        evidence,
        conversation,
        controller.signal,
        (value) => {
          answer = value;
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              const checkpoint = update('streaming');
              if (Date.now() - lastCheckpoint >= 1000) {
                lastCheckpoint = Date.now();
                void persist(checkpoint);
              }
            });
        },
        { publicSources, searchStatus },
      );
      cancelAnimationFrame(frame);
      answer = result.text;
      generationComplete = true;
      sourceReview = 'unavailable';
      await persist(update('complete'));
      setBusy('正在核对来源…');
      const review = await reviewResearchCitations(answer, evidence, controller.signal, {
        publicSources,
      });
      answer = review.text;
      sourceReview = !review.needed ? 'not-needed' : review.reviewed ? 'checked' : 'unavailable';
      await persist(update('complete'));
    } catch (caught) {
      cancelAnimationFrame(frame);
      if (generationComplete) sourceReview = 'unavailable';
      await persist(
        update(generationComplete ? 'complete' : controller.signal.aborted ? 'stopped' : 'error'),
      );
      if (mounted.current && !controller.signal.aborted)
        setError(caught instanceof Error ? caught.message : '暂时无法回答，请重试。');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mounted.current) setBusy('');
    }
  };

  const toggleBook = (hash: string) => {
    const selectedBooks = researchRef.current.selectedBooks.includes(hash)
      ? researchRef.current.selectedBooks.filter((id) => id !== hash)
      : [...researchRef.current.selectedBooks, hash];
    void persist({
      ...researchRef.current,
      selectedBooks,
      bookSelectionManual: true,
      confirmed: true,
      stage: 2,
    });
  };

  const renderCitations = (message: TopicMessage) => {
    const citations = message.passageIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is ResearchEvidence => Boolean(item));
    if (!citations.length) return null;
    return (
      <details className='thematic-sources'>
        <summary>{citations.length} 个依据</summary>
        <div>
          {citations.map((citation) => {
            const book = books.find((item) => item.hash === citation.source.bookHash);
            return (
              <article key={citation.id}>
                <span>{citation.readingNote.trim() ? '我的笔记' : '书中原文'}</span>
                <strong>
                  {book?.title || citation.source.title || '未命名书籍'} ·{' '}
                  {citation.source.chapter || '未命名章节'}
                </strong>
                <blockquote>{citation.source.excerpt}</blockquote>
                {citation.readingNote.trim() && <p>我的笔记：{citation.readingNote}</p>}
                <button
                  type='button'
                  onClick={() => void safelyLeave(() => onOpenSource(citation.source))}
                >
                  回到这一处 <FiArrowUpRight aria-hidden />
                </button>
              </article>
            );
          })}
        </div>
      </details>
    );
  };

  const sidebarContents = (inDialog = false) => (
    <>
      <div className='thematic-sidebar-brand'>
        <strong>墨书</strong>
        <button
          type='button'
          aria-label={inDialog ? '关闭主题历史' : '收起主题历史'}
          onClick={() => (inDialog ? setHistoryDialog(null) : setSidebarCollapsed(true))}
        >
          {inDialog ? <FiX aria-hidden /> : <FiChevronsLeft aria-hidden />}
        </button>
      </div>
      <button
        type='button'
        className='thematic-new-topic eink-bordered'
        disabled={controlsBusy}
        onClick={startNewTopic}
      >
        <FiPlus aria-hidden /> 新主题
      </button>
      <label className='thematic-history-search eink-bordered'>
        <FiSearch aria-hidden />
        <input
          type='search'
          aria-label='搜索主题历史'
          placeholder='搜索主题'
          value={historyQuery}
          onChange={(event) => setHistoryQuery(event.target.value)}
        />
      </label>
      <nav className='thematic-history-list' aria-label='主题对话历史'>
        {historyError && (
          <div className='thematic-history-empty' role='status'>
            {historyError}
            <button
              type='button'
              onClick={() => {
                if (appService)
                  void listThematicResearch(appService)
                    .then((studies) => {
                      setHistory((previous) => mergeTopicHistory([...studies, ...previous]));
                      setHistoryError('');
                    })
                    .catch(() => setHistoryError('历史主题读取失败'));
              }}
            >
              重新读取
            </button>
          </div>
        )}
        {!historyError && !historyGroups.length && (
          <p className='thematic-history-empty'>
            {historyQuery.trim()
              ? '没有找到匹配的主题'
              : loading
                ? '正在读取本机历史…'
                : '开始一次讨论，主题会保存在这里。'}
          </p>
        )}
        {historyGroups.map((group) => (
          <section key={group.label}>
            <h2>{group.label}</h2>
            {group.studies.map((study) => (
              <button
                type='button'
                key={getTopicIdentity(study)}
                className='thematic-history-item'
                aria-current={
                  !newTopic && getTopicIdentity(study) === getTopicIdentity(research)
                    ? 'page'
                    : undefined
                }
                disabled={controlsBusy}
                onClick={() => void switchStudy(study)}
              >
                <span>{study.question || '未命名主题'}</span>
                <small>
                  {study.selectedBooks.length} 本书 ·{' '}
                  {new Date(study.updatedAt).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </small>
              </button>
            ))}
          </section>
        ))}
      </nav>
      <div className='thematic-sidebar-footer'>
        {onLibrary && (
          <button type='button' disabled={controlsBusy} onClick={() => void safelyLeave(onLibrary)}>
            <FiBookOpen aria-hidden /> 我的书库
          </button>
        )}
        {onSettings && (
          <button type='button' onClick={onSettings}>
            <FiSettings aria-hidden /> 设置
          </button>
        )}
        <ThematicAppearance />
        <small>保存在本机</small>
      </div>
    </>
  );

  return (
    <section
      className={`thematic-workspace${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
      aria-label='主题阅读工作区'
      data-testid='thematic-workspace'
      data-appearance={isDarkMode ? 'dark' : 'light'}
      data-appearance-preference={appearancePreference}
    >
      <aside
        className='thematic-sidebar'
        data-testid='thematic-history-panel'
        aria-label='主题历史'
      >
        {sidebarContents()}
      </aside>
      <div className='thematic-content'>
        <header className='thematic-toolbar'>
          <div className='thematic-toolbar-start'>
            <button
              type='button'
              className='thematic-history-toggle'
              aria-label='打开主题历史'
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                if (window.matchMedia('(max-width: 900px)').matches) setHistoryDialog('主题历史');
                else setSidebarCollapsed(false);
              }}
            >
              <FiSidebar aria-hidden />
            </button>
            <button
              type='button'
              className='thematic-back'
              aria-label='回到正文'
              disabled={controlsBusy}
              onClick={() => void safelyLeave(onReturnToBook)}
            >
              <FiArrowLeft aria-hidden /> <span>回到正文</span>
            </button>
          </div>
          <strong title={research.question}>
            {newTopic ? '新主题' : research.question || '主题阅读'}
          </strong>
          <div className='thematic-toolbar-actions'>
            <button
              type='button'
              className='thematic-book-count'
              aria-label='调整书目'
              disabled={controlsBusy}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                setShowBooks(true);
              }}
            >
              <FiBookOpen aria-hidden />
              <span>{research.selectedBooks.length} 本书</span>
            </button>
            <button
              type='button'
              className='thematic-open-sources'
              aria-label='原文与笔记'
              disabled={loading}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                setShowSources(true);
              }}
            >
              <FiFileText aria-hidden />
              <span>原文与笔记</span>
            </button>
            <details className='thematic-toolbar-more'>
              <summary aria-label='更多主题阅读操作'>
                <FiMoreHorizontal aria-hidden />
              </summary>
              <div className='eink-bordered'>
                <button
                  type='button'
                  disabled={controlsBusy}
                  onClick={(event) => {
                    const menu = event.currentTarget.closest('details');
                    menu?.removeAttribute('open');
                    menu?.querySelector('summary')?.focus();
                    setHistoryDialog('历史主题');
                  }}
                >
                  <FiClock aria-hidden />
                  历史主题
                </button>
                <button
                  type='button'
                  onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    const settings = useSettingsStore.getState();
                    settings.setRequestedPanel('Theme');
                    settings.setSettingsDialogBookKey(bookKey);
                    settings.setSettingsDialogOpen(true);
                  }}
                >
                  <FiSliders aria-hidden />
                  阅读背景与字体
                </button>
                {onSwitchMode && (
                  <button
                    type='button'
                    disabled={controlsBusy}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      void safelyLeave(onSwitchMode);
                    }}
                  >
                    <FiBookOpen aria-hidden />
                    切换阅读模式
                  </button>
                )}
                {onSettings && (
                  <button
                    type='button'
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      onSettings();
                    }}
                  >
                    <FiSettings aria-hidden />
                    小墨设置
                  </button>
                )}
              </div>
            </details>
          </div>
        </header>

        <LocalReaderRecoveryNotice service={appService} />
        {loading ? (
          <div className='thematic-loading' role='status' aria-live='polite'>
            <ModianMascot mood='research' size={64} motion='working' />
            <span>小墨正在整理本机书库和阅读笔记…</span>
          </div>
        ) : (
          <>
            <main
              ref={scrollRef}
              className='thematic-main'
              aria-busy={Boolean(busy)}
              onScroll={(event) => {
                const el = event.currentTarget;
                followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
              }}
            >
              {(!research.messages.length || newTopic) && (
                <section className='thematic-intro'>
                  <span>让你的书库一起回答</span>
                  <h1>你想弄清什么？</h1>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(question, true);
                    }}
                  >
                    <textarea
                      aria-label='主题或问题'
                      rows={2}
                      maxLength={500}
                      value={question}
                      placeholder='输入一个主题或问题，例如：人为什么会拖延？'
                      onChange={(event) => {
                        setQuestion(event.target.value);
                        setError('');
                      }}
                      onKeyDown={(event) => {
                        if (
                          shouldSendComposerMessage({
                            key: event.key,
                            shiftKey: event.shiftKey,
                            isComposing: event.nativeEvent.isComposing,
                          }) &&
                          question.trim() &&
                          !busy
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <button type='submit' disabled={!question.trim() || controlsBusy}>
                      开始分析
                      <FiSend aria-hidden />
                    </button>
                  </form>
                  <button
                    type='button'
                    className='thematic-intro-scope'
                    disabled={controlsBusy}
                    aria-label={allowWeb ? '自动联网已开启' : '联网已关闭'}
                    aria-pressed={allowWeb}
                    onClick={() => setAllowWeb((value) => !value)}
                  >
                    {allowWeb ? <FiGlobe aria-hidden /> : <FiBookOpen aria-hidden />}
                    {allowWeb ? '本地书籍 · 自动联网' : '仅本地书籍'}
                  </button>
                </section>
              )}

              {!newTopic && busy && indexStatus && (
                <p className='thematic-index-status' role='status'>
                  {indexStatus}
                </p>
              )}

              {!newTopic && (
                <section className='thematic-conversation' aria-label='主题对话'>
                  {!research.messages.length && !busy && (
                    <div className='thematic-empty'>
                      <ModianMascot mood='reading' size={62} motion='enter' />
                      <p>小墨会先在本机找出相关书籍，再从原文和你的笔记中检索回答。</p>
                    </div>
                  )}
                  {research.messages.map((item) => (
                    <article key={item.id} className={`thematic-message is-${item.role}`}>
                      {item.role === 'user' ? (
                        <p>{item.text}</p>
                      ) : (
                        <>
                          <div className='thematic-assistant-label'>
                            <ModianMascot mood='research' size={54} motion='none' />
                            <strong>小墨</strong>
                            <span>跨书讨论</span>
                          </div>
                          <AnswerMarkdown
                            text={item.text}
                            citationCount={item.citationMap?.length}
                            onCitation={(index) =>
                              setCitation(evidenceById.get(item.citationMap?.[index] || '') ?? null)
                            }
                          />
                          {item.status === 'stopped' && (
                            <small className='thematic-message-status'>
                              已停止 · 已保留生成内容
                            </small>
                          )}
                          {item.status === 'error' && (
                            <small className='thematic-message-status'>回答中断</small>
                          )}
                          {renderCitations(item)}
                          <div className='thematic-message-actions'>
                            <button
                              type='button'
                              onClick={async () => {
                                if (await writeTextToClipboard(item.text))
                                  setCopiedMessage(item.id);
                                else setError('暂时无法复制，请重试。');
                              }}
                            >
                              {copiedMessage === item.id ? (
                                <FiCheck aria-hidden />
                              ) : (
                                <FiCopy aria-hidden />
                              )}
                              {copiedMessage === item.id ? '已复制' : '复制'}
                            </button>
                            {onOpenNotes && (
                              <button
                                type='button'
                                disabled={controlsBusy}
                                onClick={() => void safelyLeave(onOpenNotes)}
                              >
                                <FiFileText aria-hidden />
                                笔记与疑问
                              </button>
                            )}
                          </div>
                          {item.publicSources?.length ? (
                            <details className='thematic-sources'>
                              <summary>检索资料 · {item.publicSources.length}</summary>
                              {item.publicSources.map((source) => (
                                <p key={source.url}>
                                  <a href={source.url} target='_blank' rel='noopener noreferrer'>
                                    {source.title}
                                  </a>
                                  <small> · 搜索摘要</small>
                                </p>
                              ))}
                            </details>
                          ) : null}
                          {item.searchStatus && (
                            <small className='thematic-message-status'>{item.searchStatus}</small>
                          )}
                          {item.sourceReview === 'checked' && (
                            <small className='thematic-message-status'>
                              已按本轮提供的来源核对
                            </small>
                          )}
                          {item.sourceReview === 'unavailable' && (
                            <small className='thematic-message-status'>
                              来源检查暂未完成，可展开原文核对
                            </small>
                          )}
                        </>
                      )}
                    </article>
                  ))}
                  {busy && (
                    <div className='thematic-thinking' role='status' aria-live='polite'>
                      <ModianMascot mood='research' size={42} motion='working' />
                      <span>{busy}</span>
                    </div>
                  )}
                </section>
              )}
            </main>

            <footer className='thematic-footer'>
              {research.messages.length > 0 && !newTopic && (
                <form
                  className='thematic-composer'
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(message, false);
                  }}
                >
                  <textarea
                    aria-label='继续追问'
                    rows={2}
                    value={message}
                    placeholder='继续追问，或写下你的理解…'
                    onChange={(event) => {
                      setMessage(event.target.value);
                      setError('');
                    }}
                    onKeyDown={(event) => {
                      if (
                        shouldSendComposerMessage({
                          key: event.key,
                          shiftKey: event.shiftKey,
                          isComposing: event.nativeEvent.isComposing,
                        }) &&
                        message.trim() &&
                        !busy
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className='thematic-composer-tools'>
                    <button
                      type='button'
                      className='thematic-search-scope'
                      disabled={controlsBusy}
                      aria-label={allowWeb ? '自动联网已开启' : '联网已关闭'}
                      aria-pressed={allowWeb}
                      title='需要外部资料时自动检索；点击切换'
                      onClick={() => setAllowWeb((value) => !value)}
                    >
                      {allowWeb ? <FiGlobe aria-hidden /> : <FiBookOpen aria-hidden />}
                      {allowWeb ? '本地书籍 · 自动联网' : '仅本地书籍'}
                    </button>
                    {busy ? (
                      <button
                        type='button'
                        aria-label='停止回答'
                        onClick={() => requestRef.current?.abort()}
                      >
                        <FiSquare aria-hidden />
                      </button>
                    ) : (
                      <button
                        type='submit'
                        aria-label='发送追问'
                        disabled={!message.trim() || controlsBusy}
                      >
                        <FiSend aria-hidden />
                      </button>
                    )}
                  </div>
                </form>
              )}

              {(error || saveError) && (
                <p className='thematic-error' role='alert'>
                  {saveError || error}
                </p>
              )}
              {saveError && !busy && (
                <button
                  type='button'
                  className='thematic-retry'
                  onClick={() => {
                    if (pendingSave.current) void persist(pendingSave.current);
                  }}
                >
                  重新保存
                </button>
              )}
              {research.messages.at(-1)?.status === 'stopped' &&
                research.messages.at(-1)?.text &&
                !busy &&
                !newTopic && (
                  <button
                    type='button'
                    className='thematic-retry'
                    onClick={() =>
                      void run(
                        '接着刚才未完成的回答继续，不要重复已显示的内容。',
                        false,
                        false,
                        true,
                      )
                    }
                  >
                    继续生成
                  </button>
                )}
              {retryQuery && !busy && !newTopic && (
                <button
                  type='button'
                  className='thematic-retry'
                  onClick={() => void run(retryQuery, false, true)}
                >
                  <FiRefreshCw aria-hidden />
                  重新回答
                </button>
              )}
              {newTopic && research.messages.length > 0 && (
                <button type='button' className='thematic-retry' onClick={() => setNewTopic(false)}>
                  回到上个主题
                </button>
              )}
              <small className='thematic-save-status'>{saveStatus}</small>
            </footer>
          </>
        )}
      </div>
      {historyDialog && (
        <ThematicDialog
          label={historyDialog}
          className='thematic-history-dialog'
          onClose={() => setHistoryDialog(null)}
        >
          {sidebarContents(true)}
        </ThematicDialog>
      )}
      {showSources && (
        <ThematicDialog
          label='原文与笔记'
          className='thematic-drawer thematic-evidence-drawer'
          onClose={() => setShowSources(false)}
        >
          <header>
            <div>
              <span>本次讨论的依据</span>
              <h2>原文与笔记</h2>
            </div>
            <button type='button' aria-label='关闭原文与笔记' onClick={() => setShowSources(false)}>
              <FiX aria-hidden />
            </button>
          </header>
          <p>每条依据都保留书籍出处；点击原文可以回到书中核对。</p>
          <div className='thematic-evidence-list'>
            {!storedEvidence.length && (
              <p>本次讨论还没有引用原文。提问后，相关书摘与笔记会出现在这里。</p>
            )}
            {storedEvidence.map((entry) => (
              <article key={entry.id}>
                <small>{entry.readingNote.trim() ? '书中原文 · 我的笔记' : '书中原文'}</small>
                <h3>{entry.source.title || '未命名书籍'}</h3>
                {entry.source.chapter && <small>{entry.source.chapter}</small>}
                <blockquote>{entry.source.excerpt}</blockquote>
                {entry.readingNote.trim() && <p>{entry.readingNote}</p>}
                <button
                  type='button'
                  disabled={controlsBusy}
                  onClick={() => void safelyLeave(() => onOpenSource(entry.source))}
                >
                  查看上下文 <FiArrowUpRight aria-hidden />
                </button>
              </article>
            ))}
          </div>
          {onOpenNotes && (
            <footer>
              <span>本机保存的阅读记录</span>
              <button
                type='button'
                disabled={controlsBusy}
                onClick={() =>
                  void safelyLeave(() => {
                    setShowSources(false);
                    onOpenNotes();
                  })
                }
              >
                本书笔记与疑问
              </button>
            </footer>
          )}
        </ThematicDialog>
      )}
      {citation && (
        <ThematicDialog
          label='引用来源'
          className='thematic-citation-card eink-bordered'
          onClose={() => setCitation(null)}
        >
          <header>
            <strong>
              {citation.source.title} · {citation.source.chapter || '原文'}
            </strong>
            <IconButton
              label='关闭引用'
              purpose='返回回答'
              autoFocus
              onClick={() => setCitation(null)}
            >
              <FiX />
            </IconButton>
          </header>
          <blockquote>{citation.source.excerpt}</blockquote>
          {citation.readingNote && (
            <p>
              <strong>我的笔记</strong>
              <br />
              {citation.readingNote}
            </p>
          )}
          <button
            type='button'
            onClick={() => void safelyLeave(() => onOpenSource(citation.source))}
          >
            在书中打开 <FiArrowUpRight />
          </button>
        </ThematicDialog>
      )}
      {showBooks && (
        <ThematicDialog
          label='调整研究书目'
          className='thematic-drawer'
          onClose={() => setShowBooks(false)}
        >
          <header>
            <div>
              <span>本次知识库</span>
              <h2>哪些书与这个问题有关？</h2>
            </div>
            <button type='button' aria-label='关闭书目' onClick={() => setShowBooks(false)}>
              <FiX aria-hidden />
            </button>
          </header>
          <p>小墨已按书名、目录、相关原文和你的笔记排序。你可以随时调整。</p>
          <div className='thematic-library-list'>
            {recommendations.map(({ book, reasons, score }) => {
              const selected = research.selectedBooks.includes(book.hash);
              return (
                <label key={book.hash} className={selected ? 'is-selected' : ''}>
                  <input
                    type='checkbox'
                    checked={selected}
                    onChange={() => toggleBook(book.hash)}
                  />
                  {book.cover ? <img src={book.cover} alt='' /> : <FiBookOpen aria-hidden />}
                  <span>
                    <strong>{book.title}</strong>
                    <small>{book.author || '作者未填写'}</small>
                    <em>{reasons.join('；') || '暂未发现直接匹配，可手动加入'}</em>
                  </span>
                  {selected ? <FiCheck aria-hidden /> : score > 0 ? <b>相关</b> : null}
                </label>
              );
            })}
          </div>
          <footer>
            <span>已选 {research.selectedBooks.length} 本</span>
            <button type='button' onClick={() => setShowBooks(false)}>
              完成
            </button>
          </footer>
        </ThematicDialog>
      )}
    </section>
  );
}
