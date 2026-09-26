'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  PiArrowLeft,
  PiArrowRight,
  PiBookOpen,
  PiCaretDown,
  PiChatCircleText,
  PiGear,
  PiBookmarkSimple,
  PiPushPin,
  PiDotsThree,
  PiHeadphones,
  PiTextAa,
  PiList,
  PiX,
} from 'react-icons/pi';
import Dropdown from '@/components/Dropdown';
import LocalReaderRecoveryNotice from '@/components/LocalReaderRecoveryNotice';
import ViewMenu from '@/app/reader/components/ViewMenu';
import { showTransientHighlight } from '@/app/reader/utils/transientHighlight';
import { useThemeSourceReturn } from './source-return';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { eventDispatcher } from '@/utils/event';
import { applyReadingLayout } from './layout';
import { useReaderChrome } from './useReaderChrome';
import { useViewportWidth } from './useViewportWidth';
import type { HighlightStyle } from '@/types/book';
import type { ReadingSource } from '../reading-method/types';
import {
  emptyReadingData,
  loadReadingData,
  mutateReadingData,
  type ReadingRecord,
} from '../active-reading/data';
import { useReadingSession, sourceFromSelection } from '../active-reading/session';
import { AIConnection } from '../active-reading/ReadingWorkspace';
import SentenceGuide from '../focus-guide/SentenceGuide';
import ModeSelector, { modeNames } from './ModeSelector';
import IconButton from './IconButton';
import ReadingBackgroundMenu from './ReadingBackgroundMenu';
import ModianMascot from './ModianMascot';
import { flattenToc } from './BookMap';
import ChapterReview from './ChapterReview';
import DialogueCard from './DialogueCard';
import ThematicWorkspace from './ThematicWorkspace';
import QuestionMarkers from './QuestionMarkers';
import QuestionFollowup, { QuestionAnswerLink } from './QuestionFollowup';
import { useChapterCapture } from './chapter-capture';
import {
  loadModeState,
  mutateModeState,
  switchMode,
  remindersAllowed,
  localDate,
  atSectionEnd,
  chapterStorageKey,
  pageLayoutSettings,
  readChapterEntry,
  type ModeState,
  type ReadingMode,
} from './state';
import './modes.css';

export default function ModeReader({
  bookKey,
  children,
  onLibrary,
}: {
  bookKey: string;
  children: ReactNode;
  onLibrary: () => void;
}) {
  const { appService, envConfig } = useEnv();
  const hash = bookKey.split('-')[0]!;
  const sourceReturn = useThemeSourceReturn((s) => s.origin);
  const sourceTarget = useThemeSourceReturn((s) => s.target);
  const currentBook = useRef(hash);
  currentBook.current = hash;
  const rootRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    setPinned(localStorage.getItem('moshu-toolbar-pinned') === 'true');
  }, []);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [dwellExpanded, setDwellExpanded] = useState(false);
  const bookData = useBookDataStore((s) => s.booksData[hash]);
  const progress = useBookProgress(bookKey);
  const view = useReaderStore((s) => s.viewStates[bookKey]?.view);
  const viewSettings = useReaderStore((s) => s.viewStates[bookKey]?.viewSettings);
  const chrome = useReaderChrome(rootRef, view);
  const inited = useReaderStore((s) => s.viewStates[bookKey]?.inited);
  const sidebarVisible = useSidebarStore((s) => s.isSideBarVisible);
  const sidebarPinned = useSidebarStore((s) => s.isSideBarPinned);
  const viewportWidth = useViewportWidth();
  const sidebarObscures =
    sidebarVisible && (!sidebarPinned || (viewportWidth !== null && viewportWidth < 640));
  const request = useReadingSession((s) => s.request);
  const [state, setState] = useState<ModeState | null>(null);
  const [selector, setSelector] = useState(false);
  const choosing = !state?.mode || selector;
  const thematicOpen = state?.mode === 'thematic';
  const hideSidebar = choosing || thematicOpen;
  useEffect(() => {
    if (!hideSidebar) return;
    const wasVisible = useSidebarStore.getState().isSideBarVisible;
    useSidebarStore.getState().setSideBarVisible(false);
    return () => {
      if (wasVisible) useSidebarStore.getState().setSideBarVisible(true);
    };
  }, [hideSidebar]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [records, setRecords] = useState<ReadingRecord[]>([]);
  const [dialogue, setDialogue] = useState<{ source: ReadingSource; quick?: boolean } | null>(null);
  const [dwell, setDwell] = useState<ReadingSource | null>(null);
  const [dwellStyle, setDwellStyle] = useState<HighlightStyle>('highlight');
  const [activeQuestion, setActiveQuestion] = useState<ReadingRecord | null>(null);
  const [message, setMessage] = useState('');
  const [locatedSource, setLocatedSource] = useState<ReadingSource | null>(null);
  const sourceHighlightClear = useRef<(() => void) | null>(null);
  const sourceHighlightPage = useRef(progress?.page);
  const alive = useRef(true);
  const book = bookData?.book;
  const doc = bookData?.bookDoc;
  const chapter = progress?.sectionLabel || `第 ${(progress?.index || 0) + 1} 节`;
  const chapterKey = chapterStorageKey(progress?.index ?? 0, progress?.sectionHref);
  const chapterLabels = flattenToc(doc?.toc || []).map((item) => item.label);
  const reconstruction = state
    ? readChapterEntry(state.reconstructions, chapterKey, chapter, chapterLabels)
    : undefined;
  const { capture, setCapture, clearDraft } = useChapterCapture(
    chapterKey,
    state ? (readChapterEntry(state.captures, chapterKey, chapter, chapterLabels) ?? '') : '',
  );
  const atChapterEnd = Boolean(
    progress &&
      view &&
      atSectionEnd(
        progress.fraction,
        progress.index,
        view.getSectionFractions(),
        progress.range?.toString() || '',
      ),
  );
  const reloadRecords = useCallback(async () => {
    if (!appService) return;
    const data = await loadReadingData(
      appService,
      emptyReadingData(hash, book?.title, book?.author),
    );
    if (alive.current && currentBook.current === hash) setRecords(data.records);
  }, [appService, hash, book?.title, book?.author]);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setDialogue(null);
    setDwell(null);
    setActiveQuestion(null);
    setRecords([]);
    useNotebookStore.getState().setNotebookVisible(false);
    if (appService)
      void Promise.all([
        loadModeState(appService, hash).then((s) => {
          if (!cancelled) setState(s);
        }),
        reloadRecords(),
      ]).catch((e: unknown) => setMessage(e instanceof Error ? e.message : '读取失败'));
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [appService, hash, reloadRecords]);
  useEffect(() => {
    if (request?.bookKey !== bookKey || request.handled) return;
    useReadingSession.setState({ request: { ...request, handled: true } });
    useNotebookStore.getState().setNotebookVisible(false);
    if (request.source) {
      eventDispatcher.dispatchSync('dismiss-reading-selection', { bookKey });
      setDialogue({ source: request.source });
    } else setSelector(true);
  }, [request, bookKey]);
  const change = async (mutate: (value: ModeState) => ModeState) => {
    if (!appService) throw new Error('书库尚未就绪');
    try {
      const next = await mutateModeState(appService, hash, mutate);
      if (alive.current && currentBook.current === hash) setState(next);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '保存失败');
      throw e;
    }
  };
  const selectMode = async (mode: ReadingMode) => {
    await change((s) => switchMode(s, mode));
    setSelector(false);
    setDwell(null);
    setDialogue(null);
    setReviewOpen(false);
  };
  const turnPage = (direction: 'prev' | 'next') => {
    eventDispatcher.dispatchSync('dismiss-reading-selection', { bookKey });
    setLocatedSource(null);
    void view?.[direction]();
  };
  const openSource = (source: ReadingSource) => {
    if (!source.cfi || !source.bookHash) {
      setMessage('这条记录缺少可定位原文。');
      return;
    }
    if (state?.mode === 'thematic')
      useThemeSourceReturn.getState().setOrigin({ bookHash: hash, cfi: view?.lastLocation?.cfi });
    useThemeSourceReturn.getState().setTarget(source);
    setLocatedSource(null);
    setDialogue(null);
    setQuestionsOpen(false);
    setActiveQuestion(null);
    if (source.bookHash !== hash) {
      if (appService)
        void mutateModeState(appService, source.bookHash, (s) => switchMode(s, 'analytical'))
          .then(() =>
            eventDispatcher.dispatch('open-book-in-reader', {
              bookHash: source.bookHash!,
              cfi: source.cfi!,
            }),
          )
          .catch(() => setMessage('原书暂时无法打开。'));
    } else {
      void selectMode('analytical');
    }
  };
  const saveQuestion = async (source: ReadingSource, markerStyle: HighlightStyle) => {
    if (!appService) return;
    const now = new Date().toISOString();
    const record: ReadingRecord = {
      id: crypto.randomUUID(),
      kind: 'question',
      status: 'open',
      userText: '这一句，我想稍后再想。',
      originalText: '这一句，我想稍后再想。',
      revisions: [],
      source,
      markerStyle,
      createdAt: now,
      updatedAt: now,
    };
    await mutateReadingData(appService, emptyReadingData(hash, book?.title, book?.author), (s) => ({
      ...s,
      records: [...s.records, record],
    }));
    await reloadRecords();
    setDwell(null);
    setMessage('疑问已留在原文页边，继续读吧。');
  };
  const currentSource = () => {
    if (!view || !progress?.range) return undefined;
    try {
      for (const { doc: sourceDoc, index } of view.renderer.getContents()) {
        const selection = sourceDoc.getSelection();
        if (selection && !selection.isCollapsed && selection.rangeCount)
          return sourceFromSelection(bookKey, {
            key: 'dialogue',
            index: index ?? progress.index,
            page: progress.page,
            text: selection.toString(),
            range: selection.getRangeAt(0),
          });
      }
      const range = progress.range.cloneRange();
      const node =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      const block = node?.closest('p,li,blockquote') || node;
      if (block) range.selectNodeContents(block);
      return sourceFromSelection(bookKey, {
        key: 'dialogue',
        index: progress.index,
        page: progress.page,
        text: range.toString().slice(0, 6000),
        range,
      });
    } catch {
      return undefined;
    }
  };
  const openDialogue = () => {
    const source = currentSource();
    if (source) {
      // Preserve the excerpt and CFI before clearing the live selection.
      eventDispatcher.dispatchSync('dismiss-reading-selection', { bookKey });
      setDialogue({ source });
    } else setMessage('请先在正文中选择一句话，再与小墨对话。');
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        openDialogue();
      }
      if (e.key === 'Escape') {
        // The dialogue owns cancellation and durable local saving. Let its
        // Escape handler finish that work before it calls onClose.
        if (rootRef.current?.querySelector('[data-modian-dialogue]')) return;
        setDwell(null);
        setDialogue(null);
        setReviewOpen(false);
        setSettingsOpen(false);
        setQuestionsOpen(false);
        setActiveQuestion(null);
        setSelector(false);
      }
    };
    window.addEventListener('keydown', key);
    const docs = view?.renderer.getContents().map((c) => c.doc) || [];
    docs.forEach((d) => d.addEventListener('keydown', key));
    return () => {
      window.removeEventListener('keydown', key);
      docs.forEach((d) => d.removeEventListener('keydown', key));
    };
  });
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4200);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    setDwell(null);
  }, [chapterKey]);
  useEffect(() => {
    if (!sourceHighlightClear.current || sourceHighlightPage.current === progress?.page) return;
    sourceHighlightClear.current?.();
    sourceHighlightClear.current = null;
    setLocatedSource(null);
  }, [progress?.page]);
  useEffect(
    () => () => {
      sourceHighlightClear.current?.();
    },
    [],
  );
  useEffect(() => {
    if (!inited || !view || thematicOpen || !sourceTarget?.cfi || sourceTarget.bookHash !== hash)
      return;
    let cancelled = false;
    const reveal = async () => {
      try {
        await view.goTo(sourceTarget.cfi!);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (cancelled) return;
        sourceHighlightClear.current?.();
        const clear = await showTransientHighlight(view, sourceTarget.cfi!, {
          color: '#c78625',
          persistent: true,
        });
        if (cancelled) return;
        if (typeof clear !== 'function') {
          setMessage('原文已打开，但没有定位到精确句子，可重新尝试。');
          return;
        }
        sourceHighlightClear.current = clear;
        sourceHighlightPage.current = progress?.page;
        setLocatedSource(sourceTarget);
        useThemeSourceReturn.getState().setTarget(null);
      } catch {
        if (!cancelled) {
          setMessage('原文定位失败，可重新尝试。');
        }
      }
    };
    void reveal();
    return () => {
      cancelled = true;
    };
  }, [hash, inited, progress?.page, sourceTarget, thematicOpen, view]);
  if (!book || !doc) return <>{children}</>;
  const thematic = state?.mode === 'thematic';
  const unresolved = records.filter((r) => r.kind === 'question' && r.status === 'open');
  const openToc = () => {
    const config = useBookDataStore.getState().getConfig(bookKey);
    if (config?.viewSettings)
      useBookDataStore.getState().setConfig(bookKey, {
        viewSettings: { ...config.viewSettings, sideBarTab: 'toc' },
      });
    const sidebar = useSidebarStore.getState();
    sidebar.setSideBarBookKey(bookKey);
    sidebar.setSideBarVisible(true);
  };
  const setSpread = async (spreadMode: 'none' | 'auto') => {
    if (layoutBusy) return;
    const store = useReaderStore.getState();
    const settings = store.getViewSettings(bookKey);
    const currentView = store.getView(bookKey);
    if (!settings || !currentView) return;
    setLayoutBusy(true);
    setDwell(null);
    try {
      const next = {
        ...settings,
        ...pageLayoutSettings(spreadMode),
        scrolled: false,
        webtoonMode: false,
      };
      store.setViewSettings(bookKey, next);
      await applyReadingLayout(currentView, spreadMode);
      const config = useBookDataStore.getState().getConfig(bookKey);
      if (config && store.getViewState(bookKey)?.isPrimary)
        await useBookDataStore
          .getState()
          .saveConfig(envConfig, bookKey, config, useSettingsStore.getState().settings);
    } catch {
      setMessage('页面布局切换失败，请重试。');
    } finally {
      setLayoutBusy(false);
    }
  };
  return (
    <div
      ref={rootRef}
      className='moshu-root'
      data-choosing={choosing}
      data-mode={state?.mode || 'choose'}
      data-traffic-light={Boolean(appService?.hasTrafficLight && (!sidebarVisible || thematic))}
      data-chrome={chrome.visible || pinned || choosing ? 'visible' : 'hidden'}
    >
      {!thematic && (
        <button
          type='button'
          className='moshu-chrome-reveal'
          aria-label='显示阅读工具栏'
          onFocus={chrome.reveal}
          onClick={chrome.reveal}
        />
      )}
      <header
        className='moshu-topbar eink-bordered'
        style={{ display: thematic && !choosing ? 'none' : undefined }}
      >
        <button
          type='button'
          className='moshu-brand'
          onClick={onLibrary}
          aria-label='墨书 · 返回书库'
        >
          <ModianMascot mood='reading' size={38} motion='idle' />
          墨书
        </button>
        {!choosing && (
          <button
            type='button'
            className='moshu-mode-pill eink-bordered'
            onClick={() => setSelector(true)}
          >
            {modeNames[state!.mode!]}
            <PiCaretDown />
            <span>切换模式</span>
          </button>
        )}
        <div className='moshu-top-actions'>
          <IconButton
            label={pinned ? '取消固定工具栏' : '固定工具栏'}
            purpose='控制阅读工具栏是否常驻'
            aria-pressed={pinned}
            onClick={() => {
              localStorage.setItem('moshu-toolbar-pinned', String(!pinned));
              setPinned(!pinned);
            }}
          >
            <PiPushPin />
          </IconButton>
          {!choosing && !thematic && (
            <>
              <button type='button' className='moshu-toc-toggle' onClick={openToc}>
                <PiList />
                目录
              </button>
              <div className='moshu-spread-toggle eink-bordered' role='group' aria-label='页面布局'>
                <button
                  type='button'
                  disabled={layoutBusy}
                  aria-pressed={viewSettings?.spreadMode === 'none'}
                  onClick={() => void setSpread('none')}
                >
                  单页
                </button>
                <button
                  type='button'
                  disabled={layoutBusy}
                  aria-pressed={viewSettings?.spreadMode !== 'none'}
                  onClick={() => void setSpread('auto')}
                >
                  双页
                </button>
              </div>
              <button
                type='button'
                aria-pressed={state!.follow}
                className='moshu-follow-toggle'
                onClick={() => void change((s) => ({ ...s, follow: !s.follow }))}
              >
                字句跟随 <span>{state!.follow ? '开' : '关'}</span>
              </button>
              <IconButton
                label='朗读'
                purpose='播放或停止当前书籍朗读'
                onClick={() =>
                  eventDispatcher.dispatch(
                    useReaderStore.getState().getViewState(bookKey)?.ttsEnabled
                      ? 'tts-stop'
                      : 'tts-speak',
                    { bookKey },
                  )
                }
              >
                <PiHeadphones />
              </IconButton>
              <Dropdown
                label='更多阅读工具'
                showTooltip={false}
                className='dropdown-end dropdown-bottom'
                buttonClassName='moshu-icon-button'
                toggleButton={<PiDotsThree />}
              >
                <ViewMenu key={bookKey} bookKey={bookKey} />
              </Dropdown>
              <ReadingBackgroundMenu
                onCustom={() => {
                  const settings = useSettingsStore.getState();
                  settings.setRequestedPanel('Theme');
                  settings.setSettingsDialogBookKey(bookKey);
                  settings.setSettingsDialogOpen(true);
                }}
              />
              <IconButton
                label='字体与阅读设置'
                purpose='调整字体、翻页和通用阅读能力'
                onClick={() => {
                  useSettingsStore.getState().setSettingsDialogBookKey(bookKey);
                  useSettingsStore.getState().setSettingsDialogOpen(true);
                }}
              >
                <PiTextAa />
              </IconButton>
            </>
          )}
          <IconButton
            label='小墨设置'
            purpose='管理模型连接和提醒'
            onClick={() => setSettingsOpen(true)}
          >
            <PiGear />
          </IconButton>
        </div>
      </header>
      {!thematic && <LocalReaderRecoveryNotice service={appService} />}
      {message && (
        <div className='moshu-status' role='status'>
          {message}
          <button type='button' aria-label='关闭消息' onClick={() => setMessage('')}>
            知道了
          </button>
        </div>
      )}
      <div
        className='moshu-reader-body'
        style={{ display: choosing || thematic ? 'none' : undefined }}
      >
        <main className='moshu-reading-page'>
          <div className='moshu-book-canvas'>{children}</div>
          {sourceReturn && (
            <div className='moshu-source-navigation'>
              <button
                type='button'
                className='moshu-source-return eink-bordered'
                onClick={async () => {
                  if (!appService) return;
                  const origin = sourceReturn;
                  sourceHighlightClear.current?.();
                  sourceHighlightClear.current = null;
                  setLocatedSource(null);
                  await mutateModeState(appService, origin.bookHash, (s) =>
                    switchMode(s, 'thematic'),
                  );
                  if (origin.bookHash === hash) {
                    if (origin.cfi) await view?.goTo(origin.cfi);
                    await selectMode('thematic');
                  } else
                    eventDispatcher.dispatch('open-book-in-reader', {
                      bookHash: origin.bookHash,
                      cfi: origin.cfi || '',
                    });
                  useThemeSourceReturn.getState().setOrigin(null);
                  useThemeSourceReturn.getState().setTarget(null);
                }}
              >
                <PiArrowLeft />
                返回主题对话
              </button>
              {locatedSource && (
                <div className='moshu-source-located eink-bordered' role='status'>
                  <span>已定位</span>
                  <strong>{locatedSource.chapter || '引用原文'}</strong>
                  <small>金色标记会保留到翻页或手动关闭</small>
                  <button
                    type='button'
                    aria-label='关闭原文标记'
                    onClick={() => {
                      sourceHighlightClear.current?.();
                      sourceHighlightClear.current = null;
                      setLocatedSource(null);
                    }}
                  >
                    <PiX aria-hidden='true' />
                  </button>
                </div>
              )}
            </div>
          )}
          <footer className='moshu-page-footer eink-bordered'>
            {state?.mode === 'quick' && atChapterEnd ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (capture.trim())
                    void change((s) => ({
                      ...s,
                      captures: { ...s.captures, [chapterKey]: capture.trim() },
                    })).then(() => {
                      clearDraft(capture);
                      setMessage('本章的一句话已保存。');
                    });
                }}
              >
                <label htmlFor='chapter-capture'>本章抓到什么？</label>
                <input
                  id='chapter-capture'
                  aria-label='本章一句话'
                  placeholder='作者这一章正在解决什么问题？'
                  value={capture}
                  onChange={(e) => setCapture(e.target.value)}
                />
                <IconButton
                  type='submit'
                  label='保存一句话'
                  purpose='记住这一章的问题'
                  shortcut='Enter'
                >
                  <PiArrowRight />
                </IconButton>
              </form>
            ) : state?.mode === 'analytical' && atChapterEnd ? (
              <button type='button' onClick={() => setReviewOpen(true)}>
                <PiBookOpen />
                章末重构 <span>作者的问题 → 核心命题 → 论证链 → 本章位置</span>
              </button>
            ) : (
              <span className='moshu-chapter-label'>{chapter}</span>
            )}
            <div className='moshu-navigation'>
              <IconButton
                label='上一页'
                purpose='回到前一页'
                shortcut='←'
                onClick={() => turnPage('prev')}
              >
                <PiArrowLeft />
              </IconButton>
              <input
                aria-label='阅读进度'
                type='range'
                min='0'
                max='1000'
                value={Math.round((progress?.fraction || 0) * 1000)}
                onChange={(event) => {
                  eventDispatcher.dispatchSync('dismiss-reading-selection', { bookKey });
                  setLocatedSource(null);
                  void view?.goToFraction(Number(event.target.value) / 1000);
                }}
              />
              <span>{Math.round((progress?.fraction || 0) * 100)}%</span>
              <IconButton
                label='下一页'
                purpose='继续阅读'
                shortcut='→'
                onClick={() => turnPage('next')}
              >
                <PiArrowRight />
              </IconButton>
            </div>
          </footer>
          <div className='moshu-reading-actions' role='group' aria-label='笔记与对话'>
            <button
              className='moshu-question-entry eink-bordered'
              type='button'
              onClick={() => setQuestionsOpen(true)}
            >
              <PiBookmarkSimple aria-hidden='true' />
              笔记与疑问 {unresolved.length ? `· ${unresolved.length}` : ''}
            </button>
            <button
              className='moshu-dialogue-entry eink-bordered'
              type='button'
              onClick={openDialogue}
            >
              <PiChatCircleText aria-hidden='true' />
              呼叫小墨 <kbd>⌘E</kbd>
            </button>
          </div>
        </main>
      </div>
      {choosing && state && (
        <ModeSelector
          book={book}
          onSelect={(m) => void selectMode(m)}
          onCancel={state.mode ? () => setSelector(false) : undefined}
        />
      )}
      {thematic && !choosing && (
        <ThematicWorkspace
          key={bookKey}
          bookKey={bookKey}
          onReturnToBook={() => void selectMode('analytical')}
          onOpenSource={openSource}
          onSwitchMode={() => setSelector(true)}
          onSettings={() => setSettingsOpen(true)}
          onLibrary={onLibrary}
          onOpenNotes={() => {
            void selectMode('analytical').then(() => setQuestionsOpen(true));
          }}
        />
      )}
      {inited && (
        <SentenceGuide
          bookKey={bookKey}
          enabled={Boolean(state?.follow)}
          variant={state?.mode === 'quick' ? 'focus-window' : 'emphasis'}
          remindersEnabled={Boolean(state?.mode === 'quick' && remindersAllowed(state))}
          paused={
            sidebarObscures ||
            layoutBusy ||
            choosing ||
            thematic ||
            Boolean(
              dialogue ||
                (dwell && dwellExpanded) ||
                reviewOpen ||
                settingsOpen ||
                activeQuestion ||
                questionsOpen,
            )
          }
          onDwell={(source) => {
            setDwellStyle('underline');
            setDwellExpanded(false);
            setDwell(source);
          }}
        />
      )}
      {!choosing && !thematic && !sidebarObscures && (
        <QuestionMarkers bookKey={bookKey} records={records} onOpen={setActiveQuestion} />
      )}
      <QuestionFollowup
        bookKey={bookKey}
        records={records}
        enabled={Boolean(
          inited &&
            !choosing &&
            !thematic &&
            !dialogue &&
            !dwell &&
            !questionsOpen &&
            !activeQuestion &&
            !reviewOpen &&
            !settingsOpen,
        )}
        onResolved={reloadRecords}
        onOpenSource={openSource}
      />
      {dwell && !dwellExpanded && (
        <aside className='moshu-dwell-nudge eink-bordered' aria-label='停留提醒'>
          <button type='button' onClick={() => setDwellExpanded(true)}>
            <ModianMascot mood='question' size={28} motion='enter' />
            在这里停了一会，要记点什么吗？
          </button>
          <IconButton label='忽略提醒' purpose='继续阅读' onClick={() => setDwell(null)}>
            <PiX />
          </IconButton>
        </aside>
      )}
      {dwell && dwellExpanded && (
        <section className='moshu-dwell-card' aria-label='小墨停留提醒'>
          <header>
            <ModianMascot mood='question' size={42} motion='enter' />
            <div>
              <span>这段原文</span>
              <h3>留作疑问，或聊一聊</h3>
            </div>
            <IconButton
              label='收起提醒'
              purpose='60 秒内不再打扰'
              shortcut='Esc'
              onClick={() => setDwell(null)}
            >
              <PiX />
            </IconButton>
          </header>
          <blockquote>{dwell.excerpt}</blockquote>
          <div className='moshu-mark-style' role='radiogroup' aria-label='疑问标记样式'>
            {(
              [
                ['highlight', '荧光'],
                ['underline', '横线'],
                ['squiggly', '波浪'],
              ] as const
            ).map(([style, label]) => (
              <button
                key={style}
                type='button'
                role='radio'
                aria-checked={dwellStyle === style}
                className={dwellStyle === style ? 'is-active' : ''}
                onClick={() => setDwellStyle(style)}
              >
                <span className={`moshu-mark-sample is-${style}`}>字</span>
                {label}
              </button>
            ))}
          </div>
          <div className='moshu-dwell-actions'>
            <button
              type='button'
              className='is-primary'
              onClick={() =>
                void saveQuestion(dwell, dwellStyle).catch(() => setMessage('保存失败，请重试。'))
              }
            >
              <PiBookmarkSimple />
              留下疑问
            </button>
            <button
              type='button'
              onClick={() => {
                setDialogue({ source: dwell, quick: true });
                setDwell(null);
              }}
            >
              <PiBookOpen />
              打开对话
            </button>
          </div>
          <footer>
            <button
              type='button'
              onClick={() =>
                void change((s) => ({ ...s, quietDate: localDate() })).then(() => setDwell(null))
              }
            >
              今天不再提醒
            </button>
            <button type='button' onClick={() => setDwell(null)}>
              继续阅读
              <PiArrowRight />
            </button>
          </footer>
        </section>
      )}
      {dialogue && (
        <DialogueCard
          key={`${dialogue.source.cfi}-${dialogue.quick}`}
          bookKey={bookKey}
          source={dialogue.source}
          quick={dialogue.quick}
          onClose={() => setDialogue(null)}
          onSaved={() => {
            void reloadRecords();
          }}
          onRemoved={() => {
            void reloadRecords();
          }}
        />
      )}
      {reviewOpen && state && (
        <ChapterReview
          key={chapterKey}
          chapter={chapter}
          value={reconstruction}
          onSave={(value) =>
            change((s) => ({
              ...s,
              reconstructions: { ...s.reconstructions, [chapterKey]: value },
            }))
          }
          onClose={() => setReviewOpen(false)}
        />
      )}
      {settingsOpen && (
        <div className='moshu-overlay'>
          <section className='moshu-sheet' role='dialog' aria-label='小墨设置'>
            <header>
              <h2>小墨，按你的节奏陪读</h2>
              <IconButton
                label='关闭设置'
                purpose='返回阅读'
                shortcut='Esc'
                onClick={() => setSettingsOpen(false)}
              >
                <PiX />
              </IconButton>
            </header>
            <label className='moshu-check'>
              <input
                type='checkbox'
                checked={state?.reminders ?? true}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  void change((s) => ({ ...s, reminders: checked }));
                }}
              />
              停留提醒 · 同一句 5 秒后轻声提醒
            </label>
            <p className='moshu-muted'>60 秒内不重复，每章最多三次。关闭后会一直保持安静。</p>
            {state?.quietDate === localDate() && (
              <button type='button' onClick={() => void change((s) => ({ ...s, quietDate: '' }))}>
                恢复今天的提醒
              </button>
            )}
            <AIConnection />
          </section>
        </div>
      )}
      {questionsOpen && (
        <div className='moshu-overlay'>
          <section className='moshu-sheet' role='dialog' aria-label='存疑与思考'>
            <header>
              <h2>笔记与疑问</h2>
              <IconButton
                label='关闭思考'
                purpose='继续阅读'
                shortcut='Esc'
                onClick={() => setQuestionsOpen(false)}
              >
                <PiX />
              </IconButton>
            </header>
            <button
              type='button'
              className='moshu-native-notes'
              onClick={() => {
                setQuestionsOpen(false);
                const config = useBookDataStore.getState().getConfig(bookKey);
                if (config?.viewSettings)
                  useBookDataStore.getState().setConfig(bookKey, {
                    viewSettings: { ...config.viewSettings, sideBarTab: 'annotations' },
                  });
                useSidebarStore.getState().setSideBarBookKey(bookKey);
                useSidebarStore.getState().setSideBarVisible(true);
              }}
            >
              <PiBookmarkSimple />
              书中划线与批注 ·{' '}
              {
                (bookData.config?.booknotes ?? []).filter(
                  (n) => !n.deletedAt && n.type === 'annotation',
                ).length
              }
              <PiArrowRight />
            </button>
            {!records.length && <p>选择正文，打开“对话”，留下第一条思考。</p>}
            {records.map((record) => (
              <article className='moshu-record' key={record.id}>
                <small>
                  {record.source?.chapter} ·{' '}
                  {record.kind === 'question'
                    ? record.status === 'resolved'
                      ? '已解决'
                      : '待解疑问'
                    : '我的思考'}
                </small>
                <p>{record.userText}</p>
                <blockquote>{record.source?.excerpt}</blockquote>
                <button
                  type='button'
                  onClick={() => {
                    setActiveQuestion(record);
                    setQuestionsOpen(false);
                  }}
                >
                  查看记录
                </button>
                {record.source && (
                  <button type='button' onClick={() => openSource(record.source!)}>
                    回到原文
                  </button>
                )}
                <QuestionAnswerLink record={record} onOpenSource={openSource} />
              </article>
            ))}
            <button
              type='button'
              className='moshu-primary'
              onClick={() => {
                setQuestionsOpen(false);
                void selectMode('thematic');
              }}
            >
              带着这些思考，进入主题阅读
            </button>
          </section>
        </div>
      )}
      {activeQuestion && (
        <section className='moshu-question-card moshu-sheet' aria-label='页边疑问'>
          <header>
            <h3>{activeQuestion.status === 'resolved' ? '这条疑问已有答案' : '稍后再想'}</h3>
            <IconButton
              label='关闭疑问'
              purpose='继续阅读'
              shortcut='Esc'
              onClick={() => setActiveQuestion(null)}
            >
              <PiX />
            </IconButton>
          </header>
          <blockquote>{activeQuestion.source?.excerpt}</blockquote>
          <p>{activeQuestion.userText}</p>
          <footer>
            <QuestionAnswerLink record={activeQuestion} onOpenSource={openSource} />
            {activeQuestion.source && (
              <button
                type='button'
                onClick={() => {
                  setDialogue({ source: activeQuestion.source! });
                  setActiveQuestion(null);
                }}
              >
                与小墨对话
              </button>
            )}
            <button
              type='button'
              className='moshu-primary'
              onClick={async () => {
                if (!appService) return;
                await mutateReadingData(appService, emptyReadingData(hash), (s) => ({
                  ...s,
                  records: s.records.map((r) =>
                    r.id === activeQuestion.id
                      ? { ...r, status: r.status === 'resolved' ? 'open' : 'resolved' }
                      : r,
                  ),
                }));
                await reloadRecords();
                setActiveQuestion(null);
              }}
            >
              {' '}
              {activeQuestion.status === 'resolved' ? '重新存疑' : '我已找到答案'}
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
