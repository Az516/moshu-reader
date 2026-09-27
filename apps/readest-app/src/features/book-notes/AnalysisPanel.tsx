'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, Check, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AIConnection } from '../active-reading/ReadingWorkspace';
import ModianMascot from '../reading-modes/ModianMascot';
import { runNotesAnalysis, type AnalysisProgress } from './analysis';
import type { ArchiveGroup, BookAnalysisReport, BookReflection } from './types';
import '../reading-modes/answer.css';
import './analysis.css';

export interface AnalysisPanelProps {
  bookTitle: string;
  groups: ArchiveGroup[];
  reflections: BookReflection[];
  reports: BookAnalysisReport[];
  /** Chapter identity, not its potentially duplicated label. */
  currentChapter?: string;
  selectedGroupId?: string;
  onSaveReport: (report: BookAnalysisReport) => Promise<void>;
  onSaveReflection: (reflection: BookReflection) => Promise<void>;
  onOpenGroup: (id: string) => void;
  onOpenReflection?: (id: string) => void;
  onClose: () => void;
}

const tasks = [
  '整理我的收获与仍未解决的问题',
  '比较我对同一原文的理解变化',
  '找出笔记之间的联系与分歧',
];

export default function AnalysisPanel({
  bookTitle,
  groups,
  reflections,
  reports,
  currentChapter,
  selectedGroupId,
  onSaveReport,
  onSaveReflection,
  onOpenGroup,
  onOpenReflection,
  onClose,
}: AnalysisPanelProps) {
  const [scope, setScope] = useState<'book' | 'chapter' | 'group'>('book');
  const [includeReflections, setIncludeReflections] = useState(true);
  const [task, setTask] = useState(tasks[0]!);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [liveText, setLiveText] = useState('');
  const [report, setReport] = useState<BookAnalysisReport | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const selectedGroups = useMemo(
    () =>
      groups.filter(
        (group) =>
          scope === 'book' ||
          (scope === 'chapter' ? group.chapterId === currentChapter : group.id === selectedGroupId),
      ),
    [groups, scope, currentChapter, selectedGroupId],
  );
  const selectedReflections = includeReflections ? reflections : [];
  const noteCount = selectedGroups.reduce((count, group) => count + group.entries.length, 0);
  const currentChapterLabel = groups.find((group) => group.chapterId === currentChapter)?.chapter;
  const scopeLabel = `${scope === 'book' ? '本书全部笔记' : scope === 'chapter' ? `章节：${currentChapterLabel || '当前章节'}` : '当前原文下的笔记'}${includeReflections ? ' · 含整书感悟' : ''}`;
  const sourceGroups = report
    ? groups.filter((group) => group.entries.some((entry) => report.entryIds.includes(entry.id)))
    : [];
  const sourceReflections = report
    ? reflections.filter((reflection) => report.reflectionIds.includes(reflection.id))
    : [];

  const close = () => {
    controller.current?.abort();
    onClose();
  };
  const openGroup = (id: string) => {
    onOpenGroup(id);
    close();
  };
  const openReflection = (id: string) => {
    onOpenReflection?.(id);
    close();
  };

  async function saveReport(value: BookAnalysisReport) {
    setSaving(true);
    try {
      await onSaveReport(value);
      if (mounted.current) {
        setSaved(true);
        setError('');
      }
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? `分析已完成，但保存失败：${reason.message}`
            : '分析已完成，但保存失败。请重试保存。',
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  async function start() {
    if (busy || saving) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    setReport(null);
    setProgress(null);
    setLiveText('');
    setSaved(false);
    setReflectionSaved(false);
    try {
      const value = await runNotesAnalysis({
        bookTitle,
        groups: selectedGroups,
        reflections: selectedReflections,
        task,
        scope: scopeLabel,
        signal: request.signal,
        onProgress: (value) => {
          if (mounted.current) setProgress(value);
        },
        onText: (value) => {
          if (mounted.current) setLiveText(value);
        },
      });
      request.signal.throwIfAborted();
      if (!mounted.current) return;
      setReport(value);
      await saveReport(value);
    } catch (reason) {
      if (mounted.current)
        setError(
          request.signal.aborted
            ? '已停止。这次尚未完成的分析没有保存。'
            : reason instanceof Error
              ? reason.message
              : '分析失败，请检查模型连接后重试。',
        );
    } finally {
      if (mounted.current) setBusy(false);
      if (controller.current === request) controller.current = null;
    }
  }

  async function saveAsReflection() {
    if (!report || saving || reflectionSaved) return;
    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    try {
      await onSaveReflection({
        id: crypto.randomUUID(),
        title: `${report.title} · AI 草稿`,
        text: report.text,
        references: report.entryIds,
        createdAt: now,
        updatedAt: now,
      });
      if (mounted.current) setReflectionSaved(true);
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : '感悟草稿保存失败，请重试。');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className='notes-analysis-overlay' />
        <Dialog.Content
          className='notes-analysis-panel eink-bordered'
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById('notes-analysis-task')?.focus();
          }}
        >
          <header className='notes-analysis-header'>
            <ModianMascot
              mood='research'
              size={46}
              motion={busy ? 'working' : report ? 'success' : 'none'}
            />
            <div>
              <Dialog.Title>和小墨一起整理</Dialog.Title>
              <Dialog.Description>从你的笔记出发，梳理这本书留下的思考。</Dialog.Description>
            </div>
            <Dialog.Close className='notes-analysis-icon' aria-label='关闭 AI 分析'>
              <X size={19} />
            </Dialog.Close>
          </header>
          <div className='notes-analysis-scroll'>
            <fieldset disabled={busy || saving} className='notes-analysis-connection'>
              <AIConnection contextDescription='开始分析时，会发送所选范围的完整笔记、原文片段及勾选的感悟。' />
            </fieldset>
            <form
              className='notes-analysis-form'
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <div className='notes-analysis-scope'>
                <label htmlFor='notes-analysis-scope'>分析范围</label>
                <select
                  id='notes-analysis-scope'
                  disabled={busy || saving}
                  value={scope}
                  onChange={(event) => {
                    const value = event.target.value as typeof scope;
                    setScope(value);
                    setIncludeReflections(value === 'book');
                  }}
                >
                  <option value='book'>本书全部笔记</option>
                  <option value='chapter' disabled={!currentChapter}>
                    当前章节{currentChapterLabel ? ` · ${currentChapterLabel}` : ''}
                  </option>
                  <option value='group' disabled={!selectedGroupId}>
                    当前原文下的笔记
                  </option>
                </select>
              </div>
              <label className='notes-analysis-check'>
                <input
                  type='checkbox'
                  checked={includeReflections}
                  disabled={busy || saving || !reflections.length}
                  onChange={(event) => setIncludeReflections(event.target.checked)}
                />
                同时分析整书感悟 <span>{reflections.length} 篇</span>
              </label>
              <p className='notes-analysis-caption'>
                将发送 {noteCount} 条记录、{selectedGroups.length} 处原文片段
                {includeReflections ? `和 ${reflections.length} 篇感悟` : ''}，按章节完整分析。
              </p>
              <label className='notes-analysis-task-label' htmlFor='notes-analysis-task'>
                想让小墨帮你梳理什么？
              </label>
              <textarea
                id='notes-analysis-task'
                rows={3}
                maxLength={4000}
                value={task}
                disabled={busy || saving}
                onChange={(event) => setTask(event.target.value)}
                placeholder='例如：对比我前后几次阅读时，对同一段话的不同理解。'
              />
              <div className='notes-analysis-presets'>
                {tasks.map((value) => (
                  <button
                    type='button'
                    key={value}
                    disabled={busy || saving}
                    onClick={() => setTask(value)}
                  >
                    {value === tasks[0]
                      ? '收获与疑问'
                      : value === tasks[1]
                        ? '理解的变化'
                        : '联系与分歧'}
                  </button>
                ))}
              </div>
              <div className='notes-analysis-actions'>
                {busy ? (
                  <button
                    type='button'
                    className='notes-analysis-button'
                    onClick={() => controller.current?.abort()}
                  >
                    <Square size={13} />
                    停止分析
                  </button>
                ) : (
                  <button
                    type='submit'
                    className='notes-analysis-button notes-analysis-primary'
                    disabled={
                      saving ||
                      !task.trim() ||
                      (!selectedGroups.length && !selectedReflections.length)
                    }
                  >
                    开始分析
                  </button>
                )}
                <span className='notes-analysis-caption'>
                  {saving ? '正在保存…' : '分析单独保存，可随时回看'}
                </span>
              </div>
            </form>
            {progress && (
              <div className='notes-analysis-progress' role='status' aria-live='polite'>
                <span>
                  {busy
                    ? progress.phase === 'synthesis'
                      ? '正在汇总全部资料…'
                      : `正在阅读 · ${progress.chapter || '笔记'}`
                    : report
                      ? '分析完成'
                      : '分析已停止'}
                </span>
                <span>
                  已读取 {progress.entries}/{progress.totalEntries} 条记录
                  {progress.totalReflections > 0
                    ? ` · ${progress.reflections}/${progress.totalReflections} 篇感悟`
                    : ''}
                </span>
                {busy && (
                  <progress
                    max={progress.totalBatches + 1}
                    value={progress.completedBatches + (progress.phase === 'complete' ? 1 : 0)}
                    aria-label='分析覆盖进度'
                  />
                )}
              </div>
            )}
            {error && (
              <p className='notes-analysis-error' role='alert'>
                {error}
              </p>
            )}
            {(report || liveText) && (
              <section className='notes-analysis-result' aria-label='分析结果'>
                <div className='notes-analysis-result-title'>
                  <h3>{report?.title || '小墨正在整理'}</h3>
                  {saved && (
                    <span>
                      <Check size={14} />
                      已保存
                    </span>
                  )}
                </div>
                {report && (
                  <p className='notes-analysis-caption'>
                    {report.scope} · {report.model} ·{' '}
                    {new Date(report.createdAt).toLocaleString('zh-CN')}
                  </p>
                )}
                <div className='moshu-answer'>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => {
                        const match = href?.match(/^#(note|group|reflection)-(.+)$/);
                        if (!match) return <span>{children}</span>;
                        let id = '';
                        try {
                          id = decodeURIComponent(match[2]!);
                        } catch {
                          return <span>{children}</span>;
                        }
                        const target =
                          match[1] === 'group'
                            ? groups.find((group) => group.id === id)
                            : match[1] === 'note'
                              ? groups.find((group) =>
                                  group.entries.some((entry) => entry.id === id),
                                )
                              : undefined;
                        if (target)
                          return (
                            <button
                              type='button'
                              className='notes-analysis-citation'
                              disabled={busy}
                              onClick={() => openGroup(target.id)}
                            >
                              {children}
                              <ArrowUpRight size={12} />
                            </button>
                          );
                        if (
                          match[1] === 'reflection' &&
                          onOpenReflection &&
                          reflections.some((reflection) => reflection.id === id)
                        )
                          return (
                            <button
                              type='button'
                              className='notes-analysis-citation'
                              disabled={busy}
                              onClick={() => openReflection(id)}
                            >
                              {children}
                              <ArrowUpRight size={12} />
                            </button>
                          );
                        return <span>{children}</span>;
                      },
                    }}
                  >
                    {report?.text || liveText}
                  </ReactMarkdown>
                </div>
                {report && (
                  <>
                    <details className='notes-analysis-sources'>
                      <summary>
                        查看本次资料 · {report.coverage.entries} 条记录 ·{' '}
                        {report.coverage.reflections} 篇感悟
                      </summary>
                      {sourceGroups.map((group) => (
                        <button type='button' key={group.id} onClick={() => openGroup(group.id)}>
                          <span>{group.chapter}</span>
                          <span>{group.excerpt || group.entries[0]?.text || '独立笔记'}</span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                      {sourceReflections.map((reflection) => (
                        <button
                          type='button'
                          key={reflection.id}
                          disabled={!onOpenReflection}
                          onClick={() => openReflection(reflection.id)}
                        >
                          <span>感悟</span>
                          <span>{reflection.title || '未命名感悟'}</span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </details>
                    <div className='notes-analysis-actions'>
                      {!saved && (
                        <button
                          type='button'
                          className='notes-analysis-button notes-analysis-primary'
                          disabled={saving}
                          onClick={() => void saveReport(report)}
                        >
                          保存分析
                        </button>
                      )}
                      <button
                        type='button'
                        className='notes-analysis-button'
                        disabled={saving || reflectionSaved}
                        onClick={() => void saveAsReflection()}
                      >
                        {reflectionSaved ? '已存为感悟草稿' : '存为感悟草稿'}
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}
            {reports.length > 0 && (
              <details className='notes-analysis-history'>
                <summary>
                  以往分析 <span>{reports.length}</span>
                </summary>
                {[...reports]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((value) => (
                    <button
                      type='button'
                      key={value.id}
                      disabled={busy || saving}
                      onClick={() => {
                        setReport(value);
                        setLiveText('');
                        setProgress(null);
                        setSaved(true);
                        setReflectionSaved(false);
                        setError('');
                      }}
                    >
                      <span>{value.title}</span>
                      <small>
                        {new Date(value.createdAt).toLocaleDateString('zh-CN')} ·{' '}
                        {value.coverage.entries} 条记录
                      </small>
                    </button>
                  ))}
              </details>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
