'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  PiArrowLeft,
  PiArrowRight,
  PiBookOpen,
  PiCaretRight,
  PiDownloadSimple,
  PiMagnifyingGlass,
  PiNotePencil,
  PiPlus,
  PiSparkle,
  PiX,
} from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { updateBooknoteNoteText } from '@/utils/updateBooknoteNoteText';
import {
  applyNoteBubbleTransition,
  decideNoteBubbleTransition,
} from '@/app/reader/utils/annotatorUtil';
import { makeSafeFilename } from '@/utils/misc';
import {
  emptyReadingData,
  loadReadingData,
  mutateReadingData,
  type ReadingData,
} from '../active-reading/data';
import type { ReadingSource } from '../reading-method/types';
import type { ModeState } from '../reading-modes/state';
import ModianMascot from '../reading-modes/ModianMascot';
import { flattenToc } from '../reading-modes/BookMap';
import {
  appendArchiveThought,
  emptyBookNotesData,
  loadBookNotesData,
  mutateBookNotesData,
  updateArchiveReading,
} from './data';
import { archiveGroupId, buildArchiveGroups } from './grouping';
import { createBookNotesExport, exportBookNotes } from './export';
import {
  clampPanels,
  COMPACT_WIDTH,
  defaultPanelSizes,
  readPanelSizes,
  resizePanels,
  type PanelSizes,
} from './panels';
import type {
  ArchiveChapter,
  ArchiveEntry,
  ArchiveGroup,
  BookAnalysisReport,
  BookNotesData,
  BookReflection,
} from './types';
import PanelDivider from './PanelDivider';
import NoteDetail from './NoteDetail';
import ReflectionEditor from './ReflectionEditor';
import AnalysisPanel from './AnalysisPanel';
import './book-notes.css';

const PANEL_KEY = 'moshu.book-notes.panels.v1';
const when = (value: string) =>
  value ? new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '';

export default function BookNotesWorkspace({
  bookKey,
  open,
  request,
  modeState,
  onClose,
  onOpenSource,
  onRecordsChanged,
}: {
  bookKey: string;
  open: boolean;
  request: { nonce: number; source?: ReadingSource; draft?: string };
  modeState: ModeState;
  onClose: () => void;
  onOpenSource: (source: ReadingSource) => void;
  onRecordsChanged: () => void;
}) {
  const { appService, envConfig } = useEnv();
  const hash = bookKey.split('-')[0]!;
  const bookData = useBookDataStore((state) => state.booksData[hash]);
  const book = bookData?.book;
  const doc = bookData?.bookDoc;
  const initial = useMemo(
    () => emptyReadingData(hash, book?.title, book?.author),
    [hash, book?.title, book?.author],
  );
  const [reading, setReading] = useState<ReadingData>(initial);
  const [notes, setNotes] = useState<BookNotesData>(() => emptyBookNotesData(hash));
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'notes' | 'reflections'>('notes');
  const [chapter, setChapter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('chapter');
  const [selected, setSelected] = useState('');
  const [source, setSource] = useState<{ value: ReadingSource; id: string }>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reflectionId, setReflectionId] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState('all');
  const [includeReflections, setIncludeReflections] = useState(true);
  const [includeReports, setIncludeReports] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [sizes, setSizes] = useState<PanelSizes>(defaultPanelSizes);
  const [width, setWidth] = useState(1440);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const root = useRef<HTMLElement>(null);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const loadSequence = useRef(0);
  const pending = useRef(new Map<string, BookReflection>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const writing = useRef<Promise<void> | null>(null);
  const liveNotes = useRef(notes);
  liveNotes.current = notes;

  const flush = useCallback(async () => {
    if (writing.current) await writing.current;
    if (!appService || !pending.current.size) return;
    const snapshot = new Map(pending.current);
    pending.current.clear();
    setSaveStatus('saving');
    const task = mutateBookNotesData(appService, hash, (current) => {
      const documents = new Map(current.reflections.map((item) => [item.id, item]));
      snapshot.forEach((item, id) => documents.set(id, item));
      return { ...current, reflections: [...documents.values()] };
    })
      .then(() => {
        if (!pending.current.size) setSaveStatus('saved');
      })
      .catch((reason: unknown) => {
        snapshot.forEach((item, id) => {
          if (!pending.current.has(id)) pending.current.set(id, item);
        });
        setSaveStatus('error');
        setError(reason instanceof Error ? reason.message : '感悟未能保存，请重试。');
        throw reason;
      })
      .finally(() => {
        if (writing.current === task) writing.current = null;
      });
    writing.current = task;
    await task;
  }, [appService, hash]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      void flush().catch(() => undefined);
    },
    [flush],
  );
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current.size || writing.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onBlur = () => {
      void flush().catch(() => undefined);
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('blur', onBlur);
    };
  }, [flush]);

  const load = useCallback(async () => {
    if (!appService) return;
    const sequence = ++loadSequence.current;
    setError('');
    try {
      await flush();
      const [records, saved] = await Promise.all([
        loadReadingData(appService, initial),
        loadBookNotesData(appService, hash),
      ]);
      if (loadSequence.current !== sequence) return;
      setReading(records);
      setNotes((current) => {
        const documents = new Map(saved.reflections.map((item) => [item.id, item]));
        for (const item of current.reflections) {
          const stored = documents.get(item.id);
          if (!stored || item.updatedAt > stored.updatedAt) documents.set(item.id, item);
        }
        pending.current.forEach((item, id) => documents.set(id, item));
        return { ...saved, reflections: [...documents.values()] };
      });
      setLoaded(true);
    } catch (reason) {
      if (sequence === loadSequence.current)
        setError(reason instanceof Error ? reason.message : '笔记未能读取，请重试。');
    }
  }, [appService, initial, hash, flush]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  useEffect(() => {
    if (!request.source) return;
    setTab('notes');
    setChapter('all');
    setQuery('');
    setSource({
      value: request.source,
      id: archiveGroupId(hash, { id: `draft:${request.nonce}`, source: request.source }),
    });
    setSelected('');
  }, [request.nonce, request.source, hash]);
  useEffect(() => {
    if (!open || !root.current) return;
    const element = root.current;
    const previous = document.activeElement;
    const siblings = [...(element.parentElement?.children || [])].filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== element,
    );
    const before = siblings.map((child) => ({ child, inert: child.inert }));
    siblings.forEach((child) => {
      child.inert = true;
    });
    element.focus({ preventScroll: true });
    return () => {
      before.forEach(({ child, inert }) => {
        child.inert = inert;
      });
      if (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[inert]'))
        previous.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    try {
      setSizes(readPanelSizes(localStorage.getItem(PANEL_KEY)));
    } catch {
      /* Defaults remain usable. */
    }
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(PANEL_KEY, JSON.stringify(sizes));
      } catch {
        /* Widths are optional preferences. */
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [sizes]);

  const chapters = useMemo<ArchiveChapter[]>(() => {
    if (!doc) return [];
    return flattenToc(doc.toc || []).map((item, order) => {
      let sectionIndex: number | undefined;
      try {
        const [path] = doc.splitTOCHref(item.href);
        const index = doc.sections.findIndex(
          (section) => section.id === path || section.href === path,
        );
        if (index >= 0) sectionIndex = index;
      } catch {
        /* Old TOC entries may not resolve. */
      }
      return {
        id: `toc:${item.id}:${item.href}`,
        label: item.label,
        order,
        sectionIndex,
        href: item.href,
        cfi: item.cfi,
      };
    });
  }, [doc]);
  const groups = useMemo(
    () =>
      book
        ? buildArchiveGroups({
            book,
            booknotes: bookData?.config?.booknotes,
            readingData: reading,
            modeState,
            chapters,
            toc: doc?.toc,
          })
        : [],
    [book, bookData?.config?.booknotes, reading, modeState, chapters, doc],
  );
  const importedDraft = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded || !request.draft || importedDraft.current === request.nonce) return;
    const id = archiveGroupId(hash, { id: `draft:${request.nonce}`, source: request.source });
    setDrafts((current) => ({
      ...current,
      [id]: current[id] ? `${current[id]}\n\n${request.draft}` : request.draft!,
    }));
    importedDraft.current = request.nonce;
  }, [loaded, request, hash]);
  const chapterGroups = useMemo(() => {
    const entries = new Map<
      string,
      { id: string; label: string; count: number; groups: ArchiveGroup[] }
    >();
    for (const group of groups) {
      const item = entries.get(group.chapterId) || {
        id: group.chapterId,
        label: group.chapterId === 'book' ? '独立笔记' : group.chapter,
        count: 0,
        groups: [],
      };
      item.count += group.noteCount;
      item.groups.push(group);
      entries.set(group.chapterId, item);
    }
    return [...entries.values()];
  }, [groups]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = groups.filter(
      (group) =>
        (chapter === 'all' || group.chapterId === chapter) &&
        (!needle ||
          `${group.excerpt} ${group.entries.map((entry) => entry.text).join(' ')}`
            .toLocaleLowerCase()
            .includes(needle)),
    );
    return sort === 'recent'
      ? [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : filtered;
  }, [groups, chapter, query, sort]);
  const activeGroup = useMemo<ArchiveGroup | undefined>(() => {
    if (source)
      return (
        groups.find((group) => group.id === source.id) || {
          id: source.id,
          chapterId: 'unlocated',
          chapter: source.value.chapter || '当前原文',
          chapterOrder: 0,
          source: source.value,
          excerpt: source.value.excerpt,
          entries: [],
          noteCount: 0,
          updatedAt: '',
        }
      );
    if (selected === 'new-independent')
      return {
        id: 'new-independent',
        chapterId: 'book',
        chapter: '独立笔记',
        chapterOrder: 0,
        excerpt: '',
        entries: [],
        noteCount: 0,
        updatedAt: '',
      };
    return groups.find((group) => group.id === selected);
  }, [groups, selected, source]);
  const hasDetail = loaded && tab === 'notes' && Boolean(activeGroup);
  const actualSizes = clampPanels(width, sizes, hasDetail);
  const noteCount = groups.reduce((count, group) => count + group.noteCount, 0);
  const passageCount = groups.filter((group) => group.source?.cfi || group.excerpt).length;
  const reflection =
    notes.reflections.find((item) => item.id === reflectionId) || notes.reflections[0];

  const updateReflection = (value: BookReflection) => {
    pending.current.set(value.id, value);
    setNotes((current) => ({
      ...current,
      reflections: current.reflections.some((item) => item.id === value.id)
        ? current.reflections.map((item) => (item.id === value.id ? value : item))
        : [...current.reflections, value],
    }));
    setSaveStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 400);
  };
  const newReflection = (reference?: ArchiveGroup) => {
    const now = new Date().toISOString();
    const value: BookReflection = {
      id: crypto.randomUUID(),
      title: '',
      text: '',
      references: reference?.entries.map((entry) => entry.id) || [],
      createdAt: now,
      updatedAt: now,
    };
    updateReflection(value);
    setReflectionId(value.id);
    setTab('reflections');
  };
  const openGroup = (id: string) => {
    setSelected(id);
    setSource(undefined);
    setChapter('all');
    setQuery('');
    setTab('notes');
    setAnalysisOpen(false);
  };
  const close = async () => {
    try {
      await flush();
      if (pending.current.size) await flush();
      setAnalysisOpen(false);
      setExportOpen(false);
      onClose();
    } catch {
      /* The visible editor keeps its unsaved text. */
    }
  };
  const append = async (text: string, question: boolean) => {
    if (!appService || !book || !activeGroup) return;
    loadSequence.current++;
    const id = activeGroup.id;
    const next = await appendArchiveThought(
      appService,
      book,
      text,
      activeGroup.source,
      question ? 'question' : 'understanding',
    );
    setReading(next);
    onRecordsChanged();
    setDrafts((current) => (current[id] === text ? { ...current, [id]: '' } : current));
    if (!activeGroup.source?.cfi) {
      setSource(undefined);
      setSelected(`entry:reading:${next.records.at(-1)!.id}`);
    }
  };
  const edit = async (entry: ArchiveEntry, text: string) => {
    if (!appService || !book) return;
    loadSequence.current++;
    if (entry.origin === 'reading') {
      setReading(await updateArchiveReading(appService, book, entry.originalId, text));
      onRecordsChanged();
      return;
    }
    if (entry.origin !== 'native') throw new Error('请在原章节中修改这条章节思考。');
    const store = useBookDataStore.getState();
    const config = store.getConfig(bookKey);
    if (!config) throw new Error('书籍尚未就绪。');
    const change = updateBooknoteNoteText(
      config.booknotes || [],
      entry.originalId,
      text,
      Date.now(),
    );
    if (!change) throw new Error('这条批注已不存在。');
    const updated = store.updateBooknotes(bookKey, change.booknotes);
    if (!updated) throw new Error('批注未能更新。');
    await store.saveConfig(envConfig, bookKey, updated, useSettingsStore.getState().settings);
    applyNoteBubbleTransition(
      useReaderStore.getState().getViewsById(hash),
      change.updatedBooknote,
      decideNoteBubbleTransition(change.previousNoteText, text),
    );
  };
  const resolve = async (entry: ArchiveEntry) => {
    if (!appService) return;
    loadSequence.current++;
    setReading(
      await mutateReadingData(appService, initial, (current) => ({
        ...current,
        records: current.records.map((record) =>
          record.id === entry.originalId
            ? {
                ...record,
                status: record.status === 'resolved' ? 'open' : 'resolved',
                updatedAt: new Date().toISOString(),
              }
            : record,
        ),
      })),
    );
    onRecordsChanged();
  };
  const saveReport = async (report: BookAnalysisReport) => {
    if (!appService) throw new Error('书库尚未就绪。');
    await flush();
    const next = await mutateBookNotesData(appService, hash, (current) => ({
      ...current,
      reports: [...current.reports.filter((item) => item.id !== report.id), report],
    }));
    setNotes((current) => ({ ...current, reports: next.reports }));
  };
  const exportData = async (format: 'markdown' | 'text' | 'json') => {
    if (!appService || !book) return;
    setExportBusy(true);
    setExportMessage('');
    try {
      await flush();
      const chosen =
        exportScope === 'selected'
          ? activeGroup
            ? [activeGroup]
            : []
          : exportScope === 'visible'
            ? visible
            : groups;
      const value = createBookNotesExport(book, chosen, {
        ...liveNotes.current,
        reflections: includeReflections ? liveNotes.current.reflections : [],
        reports: includeReports ? liveNotes.current.reports : [],
      });
      const extensions = { markdown: 'md', text: 'txt', json: 'json' };
      await appService.saveFile(
        `${makeSafeFilename(book.title)}-本书笔记.${extensions[format]}`,
        exportBookNotes(value, format),
        {
          mimeType:
            format === 'json'
              ? 'application/json'
              : format === 'markdown'
                ? 'text/markdown'
                : 'text/plain',
        },
      );
      setExportMessage('资料已交给文件保存窗口。');
    } catch (reason) {
      setExportMessage(reason instanceof Error ? reason.message : '导出失败，请重试。');
    } finally {
      setExportBusy(false);
    }
  };

  if (!book) return null;
  return (
    <section
      ref={root}
      className='book-notes-workspace'
      aria-label='本书笔记'
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || analysisOpen || exportOpen) return;
        const controls = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"], summary, a[href]',
          ) || []),
        ].filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === root.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      hidden={!open}
      data-compact={width < COMPACT_WIDTH}
      data-detail={hasDetail}
      style={
        {
          '--notes-nav-width': `${actualSizes.navigation}px`,
          '--notes-detail-width': `${actualSizes.detail}px`,
        } as CSSProperties
      }
    >
      <header className='book-notes-topbar'>
        <span className='book-notes-brand'>
          <ModianMascot mood='reading' size={32} motion='none' />
          墨书
        </span>
        <button type='button' onClick={() => void close()}>
          <PiArrowLeft /> 返回阅读
        </button>
      </header>
      <div className='book-notes-layout'>
        <aside
          className='book-notes-sidebar'
          aria-label={tab === 'notes' ? '笔记章节' : '感悟列表'}
        >
          <div className='book-notes-sidebar-spacer' />
          {tab === 'notes' ? (
            <>
              <h2>章节</h2>
              <button
                type='button'
                className={chapter === 'all' ? 'is-active' : ''}
                aria-pressed={chapter === 'all'}
                onClick={() => setChapter('all')}
              >
                <span>全部笔记</span>
                <small>{noteCount}</small>
              </button>
              {chapterGroups.map((item) => (
                <button
                  type='button'
                  key={item.id}
                  className={chapter === item.id ? 'is-active' : ''}
                  aria-pressed={chapter === item.id}
                  onClick={() => setChapter(item.id)}
                >
                  <span>{item.label}</span>
                  <small>{item.count}</small>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className='book-notes-sidebar-title'>
                <h2>我的感悟</h2>
                <button
                  type='button'
                  className='book-notes-icon'
                  aria-label='新建感悟'
                  disabled={!loaded}
                  onClick={() => newReflection()}
                >
                  <PiPlus />
                </button>
              </div>
              {notes.reflections.map((item) => (
                <button
                  type='button'
                  key={item.id}
                  className={`book-notes-document ${item.id === reflection?.id ? 'is-active' : ''}`}
                  onClick={() => setReflectionId(item.id)}
                >
                  <span>{item.title || '未命名感悟'}</span>
                  <small>{when(item.updatedAt)} 更新</small>
                </button>
              ))}
            </>
          )}
          <div className='book-notes-companion'>
            <ModianMascot mood='reading' size={50} motion='none' />
            <span>每次理解，都留在这里。</span>
          </div>
        </aside>
        <PanelDivider
          label='调整目录与内容宽度'
          value={actualSizes.navigation}
          min={172}
          max={Math.min(
            420,
            width - (hasDetail && width >= COMPACT_WIDTH ? actualSizes.detail : 0) - 316,
          )}
          onMove={(delta) =>
            setSizes(resizePanels(width, actualSizes, 'navigation', delta, hasDetail))
          }
        />
        <main className='book-notes-main'>
          <div className='book-notes-book-header'>
            <div className='book-notes-book-identity'>
              {book.coverImageUrl ? (
                <img src={book.coverImageUrl} alt={`${book.title}封面`} />
              ) : (
                <PiBookOpen className='book-notes-coverless' />
              )}
              <div>
                <h1 title={book.title}>{book.title}</h1>
                <p>{book.author}</p>
              </div>
            </div>
            <div className='book-notes-header-actions'>
              <button
                ref={exportTrigger}
                type='button'
                className='book-notes-outlined eink-bordered'
                disabled={!loaded}
                onClick={() => {
                  setExportOpen(true);
                  setExportMessage('');
                }}
              >
                <PiDownloadSimple />
                <span>导出</span>
              </button>
              <button
                type='button'
                className='book-notes-outlined eink-bordered'
                disabled={!loaded}
                onClick={() => setAnalysisOpen(true)}
              >
                <PiSparkle />
                <span>AI 分析</span>
              </button>
            </div>
          </div>
          <div className='book-notes-tabbar'>
            <div role='tablist' aria-label='本书记录'>
              <button
                type='button'
                role='tab'
                aria-selected={tab === 'notes'}
                onClick={() => setTab('notes')}
              >
                笔记
              </button>
              <button
                type='button'
                role='tab'
                aria-selected={tab === 'reflections'}
                onClick={() => setTab('reflections')}
              >
                感悟
              </button>
            </div>
            <span>
              {tab === 'notes'
                ? `${noteCount} 条笔记 · ${passageCount} 处原文`
                : `${notes.reflections.length} 篇感悟`}
            </span>
          </div>
          {error && (
            <div role='alert' className='book-notes-load-error'>
              <span>{error}</span>
              <button type='button' onClick={() => void load()}>
                重试
              </button>
              <button type='button' aria-label='关闭错误提示' onClick={() => setError('')}>
                <PiX />
              </button>
            </div>
          )}
          {!loaded ? (
            <div className='book-notes-empty'>
              <ModianMascot mood='reading' size={84} motion='working' />
              <p>{error ? '原有资料仍保留在本机。' : '正在收好这本书的记录…'}</p>
            </div>
          ) : tab === 'notes' ? (
            <>
              <div className='book-notes-filterbar'>
                <label className='book-notes-search eink-bordered'>
                  <PiMagnifyingGlass />
                  <input
                    aria-label='搜索原文或笔记'
                    placeholder='搜索原文或笔记'
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <select
                  aria-label='笔记排序'
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value='chapter'>按章节排序</option>
                  <option value='recent'>最近更新</option>
                </select>
                <button
                  type='button'
                  className='book-notes-icon'
                  title='写一条独立笔记'
                  aria-label='新建独立笔记'
                  onClick={() => {
                    setSource(undefined);
                    setSelected('new-independent');
                  }}
                >
                  <PiPlus />
                </button>
                <select
                  className='book-notes-mobile-chapters'
                  aria-label='选择笔记章节'
                  value={chapter}
                  onChange={(event) => setChapter(event.target.value)}
                >
                  <option value='all'>全部章节</option>
                  {chapterGroups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className='book-notes-cards' aria-label='按章节排列的笔记'>
                {!visible.length && (
                  <div className='book-notes-empty'>
                    <ModianMascot mood={query ? 'question' : 'reading'} size={100} motion='enter' />
                    <h2>{groups.length ? '没有找到这条记录' : '把第一点想法留在这里'}</h2>
                    <p>
                      {groups.length
                        ? '换个词，或看看其他章节。'
                        : '阅读时的划线、笔记和疑问，会自动汇集到这里。'}
                    </p>
                    <button
                      type='button'
                      className='book-notes-outlined eink-bordered'
                      onClick={() => {
                        if (groups.length) {
                          setQuery('');
                          setChapter('all');
                        } else {
                          setSource(undefined);
                          setSelected('new-independent');
                        }
                      }}
                    >
                      {groups.length ? '查看全部笔记' : '写下第一条笔记'}
                      <PiArrowRight />
                    </button>
                  </div>
                )}
                {visible.map((group, index) => {
                  const last = [...group.entries].reverse().find((entry) => entry.text.trim());
                  const section = chapterGroups.find((item) => item.id === group.chapterId);
                  const heading =
                    sort === 'chapter' &&
                    (index === 0 || visible[index - 1]?.chapterId !== group.chapterId);
                  return (
                    <div key={group.id}>
                      {heading && (
                        <div className='book-notes-chapter-heading'>
                          <h2>{section?.label || group.chapter}</h2>
                          <small>
                            {section?.count || 0} 条笔记 · {section?.groups.length || 0} 处记录
                          </small>
                        </div>
                      )}
                      <button
                        type='button'
                        className={`book-notes-card eink-bordered ${activeGroup?.id === group.id ? 'is-selected' : ''}`}
                        aria-pressed={activeGroup?.id === group.id}
                        onClick={() => {
                          setSelected(group.id);
                          setSource(undefined);
                        }}
                      >
                        <small className='book-notes-card-source'>
                          {group.chapterId === 'book' ? '独立笔记' : group.chapter}{' '}
                          {group.excerpt ? '· 原文片段' : ''}
                        </small>
                        <span className='book-notes-card-quote'>
                          {group.excerpt || last?.text || '书签'}
                        </span>
                        {group.excerpt && last && (
                          <span className='book-notes-card-thought'>
                            <span>{last.kind === 'question' ? '我的疑问' : '我的想法'}</span>
                            {last.text}
                          </span>
                        )}
                        <span className='book-notes-card-meta'>
                          {group.noteCount ? `共 ${group.noteCount} 次记录` : '已收藏原文'}
                          {group.updatedAt && (
                            <>
                              <i />
                              {when(group.updatedAt)}
                            </>
                          )}
                        </span>
                        <PiCaretRight className='book-notes-card-chevron' />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className='book-notes-editor-scroll'>
              <div className='book-notes-mobile-reflections'>
                <select
                  aria-label='选择感悟'
                  value={reflection?.id || ''}
                  onChange={(event) => setReflectionId(event.target.value)}
                >
                  {notes.reflections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title || '未命名感悟'}
                    </option>
                  ))}
                </select>
                <button type='button' onClick={() => newReflection()}>
                  <PiPlus />
                  新建
                </button>
              </div>
              {reflection ? (
                <ReflectionEditor
                  key={reflection.id}
                  reflection={reflection}
                  groups={groups}
                  saveStatus={saveStatus}
                  onChange={updateReflection}
                  onOpenGroup={openGroup}
                  onRetry={() => void flush().catch(() => undefined)}
                />
              ) : (
                <div className='book-notes-empty'>
                  <ModianMascot mood='reading' size={106} motion='enter' />
                  <h2>读完以后，留几句话给自己</h2>
                  <p>感受、联想，或还没想明白的问题，都可以写。</p>
                  <button
                    type='button'
                    className='book-notes-solid btn-contrast'
                    onClick={() => newReflection()}
                  >
                    <PiNotePencil /> 写第一篇感悟
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
        {hasDetail && activeGroup && (
          <>
            <PanelDivider
              label='调整笔记详情宽度'
              value={actualSizes.detail}
              min={360}
              max={width - actualSizes.navigation - 316}
              onMove={(delta) => setSizes(resizePanels(width, actualSizes, 'detail', delta, true))}
            />
            <NoteDetail
              key={activeGroup.id}
              group={activeGroup}
              draft={drafts[activeGroup.id] || ''}
              onDraft={(text) => setDrafts((current) => ({ ...current, [activeGroup.id]: text }))}
              onAppend={append}
              onEdit={edit}
              onResolve={resolve}
              onCite={(group) => {
                if (reflection) {
                  updateReflection({
                    ...reflection,
                    references: [
                      ...new Set([
                        ...reflection.references,
                        ...group.entries.map((entry) => entry.id),
                      ]),
                    ],
                    updatedAt: new Date().toISOString(),
                  });
                  setReflectionId(reflection.id);
                  setTab('reflections');
                } else newReflection(group);
              }}
              onOpenSource={(target) => {
                void flush()
                  .then(() => onOpenSource({ ...target, bookHash: target.bookHash || hash }))
                  .catch(() => undefined);
              }}
              onClose={() => {
                setSelected('');
                setSource(undefined);
              }}
            />
          </>
        )}
      </div>
      <Dialog.Root
        open={exportOpen}
        onOpenChange={(value) => {
          if (!exportBusy) setExportOpen(value);
        }}
      >
        <Dialog.Portal container={root.current}>
          <Dialog.Overlay className='book-notes-overlay'>
            <Dialog.Content
              aria-label='导出本书笔记'
              className='book-notes-export eink-bordered'
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                exportTrigger.current?.focus();
              }}
            >
              <header>
                <Dialog.Title asChild>
                  <h2>导出本书笔记</h2>
                </Dialog.Title>
                <button
                  type='button'
                  className='book-notes-icon'
                  aria-label='关闭笔记导出'
                  disabled={exportBusy}
                  onClick={() => setExportOpen(false)}
                >
                  <PiX />
                </button>
              </header>
              <Dialog.Description asChild>
                <p>原文、章节和每次思考，一起带走。</p>
              </Dialog.Description>
              <label>
                导出范围
                <select
                  aria-label='导出范围'
                  value={exportScope}
                  onChange={(event) => setExportScope(event.target.value)}
                >
                  <option value='all'>本书全部笔记</option>
                  <option value='visible'>当前章节与搜索结果</option>
                  <option value='selected' disabled={!activeGroup}>
                    当前原文下的全部记录
                  </option>
                </select>
              </label>
              <label className='book-notes-checkbox'>
                <input
                  type='checkbox'
                  checked={includeReflections}
                  onChange={(event) => setIncludeReflections(event.target.checked)}
                />
                包含整书感悟
              </label>
              <label className='book-notes-checkbox'>
                <input
                  type='checkbox'
                  checked={includeReports}
                  onChange={(event) => setIncludeReports(event.target.checked)}
                />
                包含 AI 分析报告
              </label>
              <div className='book-notes-export-formats'>
                {(['markdown', 'text', 'json'] as const).map((format) => (
                  <button
                    type='button'
                    className='book-notes-outlined eink-bordered'
                    key={format}
                    disabled={exportBusy}
                    onClick={() => void exportData(format)}
                  >
                    {format === 'markdown'
                      ? 'Markdown'
                      : format === 'text'
                        ? '纯文本'
                        : 'JSON 资料包'}
                    <PiDownloadSimple />
                  </button>
                ))}
              </div>
              <details>
                <summary>连接 Codex / Claude Code</summary>
                <p>
                  导出的 Markdown 可以直接交给它们阅读。JSON 资料包保留记录
                  ID、原文关系与多次思考，也可通过本地 MCP 读取。
                </p>
                <code>node scripts/notes-mcp/server.mjs --snapshot /资料路径/本书笔记.json</code>
                <p>
                  桌面书库可使用 <code>--library /书库目录</code> 读取最新资料。完整配置见项目文档{' '}
                  <code>docs/notes-mcp.md</code>。
                </p>
              </details>
              {exportMessage && <p role='status'>{exportMessage}</p>}
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
      {analysisOpen && (
        <AnalysisPanel
          bookTitle={book.title}
          groups={groups}
          reflections={notes.reflections}
          reports={notes.reports}
          currentChapter={chapter === 'all' ? undefined : chapter}
          selectedGroupId={activeGroup?.id}
          onSaveReport={saveReport}
          onSaveReflection={async (value) => {
            updateReflection(value);
            await flush();
          }}
          onOpenGroup={openGroup}
          onOpenReflection={(id) => {
            setReflectionId(id);
            setTab('reflections');
            setAnalysisOpen(false);
          }}
          onClose={() => setAnalysisOpen(false)}
        />
      )}
    </section>
  );
}
