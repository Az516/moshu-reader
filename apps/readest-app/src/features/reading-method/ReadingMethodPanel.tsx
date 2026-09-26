'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { emptyDrafts, readDrafts, writeDrafts } from './drafts';
import type { ReadingMethodDrafts } from './drafts';
import type {
  ReadingMethodPanelProps,
  ReadingMethodProfile,
  ReadingMethodRecord,
  ReadingMethodTab,
  ReadingRecordKind,
  ReadingRecordStatus,
  ReadingSource,
} from './types';

const TABS: { id: ReadingMethodTab; label: string }[] = [
  { id: 'prepare', label: '读前' },
  { id: 'questions', label: '疑问' },
  { id: 'reflect', label: '理解' },
  { id: 'review', label: '回顾' },
];

const FOUR_QUESTIONS = [
  { title: '全书讲什么？', hint: '用自己的话概括主题，以及主要部分怎样联系。' },
  { title: '作者具体怎样说？', hint: '留下关键概念、主要观点和作者的理由。' },
  { title: '我认为是否成立？', hint: '哪些赞同、哪些存疑？写下依据，也可以暂不判断。' },
  { title: '这对我有什么意义？', hint: '认知变化、生活经验、未解问题，或想尝试的一件事。' },
];

const GENRES = [
  ['', '暂不分类'],
  ['nonfiction', '一般非虚构'],
  ['philosophy', '哲学'],
  ['history', '历史'],
  ['social-science', '社会科学'],
  ['science', '科学与科普'],
  ['practical', '实用与方法'],
  ['textbook', '教材'],
  ['fiction', '小说与文学'],
];

const KIND_LABELS: Record<ReadingRecordKind, string> = {
  question: '我的疑问',
  understanding: '我的理解',
  judgment: '我的判断',
  review: '我的回忆',
};

const STATUS_LABELS: Record<ReadingRecordStatus, string> = {
  open: '待处理',
  resolved: '已明白',
  kept: '先保留',
  discarded: '不再需要',
};

const fieldClass =
  'textarea textarea-bordered eink-bordered bg-base-100 text-base-content w-full resize-y rounded-lg text-sm leading-6 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary';
const buttonClass =
  'btn btn-sm eink-bordered min-h-9 h-auto rounded-lg px-3 py-2 text-xs font-medium focus-visible:ring-2 focus-visible:ring-base-content/15';
const subtleButtonClass = `${buttonClass} btn-ghost`;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作没有完成，请再试一次。';
}

function sameSource(a?: ReadingSource, b?: ReadingSource): boolean {
  return !!a && !!b && a.bookHash === b.bookHash && a.cfi === b.cfi && a.excerpt === b.excerpt;
}

function SourceBlock({
  source,
  onGoToSource,
  expanded = true,
}: {
  source: ReadingSource;
  onGoToSource: ReadingMethodPanelProps['onGoToSource'];
  expanded?: boolean;
}) {
  const content = (
    <>
      <blockquote className='border-base-content/20 text-base-content mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-s-2 ps-3 text-sm leading-6'>
        {source.excerpt}
      </blockquote>
      {source.cfi ? (
        <button
          type='button'
          className={`${subtleButtonClass} mt-1 -ms-3`}
          onClick={() => onGoToSource(source)}
        >
          回到原文
        </button>
      ) : null}
    </>
  );
  const label = `原文${source.chapter ? ` · ${source.chapter}` : ''}`;
  return expanded ? (
    <div className='min-w-0'>
      <p className='text-base-content break-words text-xs'>{label}</p>
      {content}
    </div>
  ) : (
    <details className='min-w-0'>
      <summary className='text-base-content cursor-pointer rounded text-xs leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'>
        {label}
      </summary>
      {content}
    </details>
  );
}

function TextField({
  label,
  value,
  hint,
  rows = 3,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
  rows?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className='space-y-2'>
      <label htmlFor={id} className='block text-sm font-medium'>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        disabled={disabled}
        className={fieldClass}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p id={`${id}-hint`} className='text-base-content text-xs leading-5'>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Keyed internally: changing books never carries over an in-memory source or draft. */
export default function ReadingMethodPanel(props: ReadingMethodPanelProps) {
  const bookIdentity = props.bookId || `${props.bookTitle}\u0000${props.bookAuthor || ''}`;
  return <PanelSession key={bookIdentity} {...props} bookIdentity={bookIdentity} />;
}

function PanelSession({
  bookIdentity,
  bookId,
  bookTitle,
  bookAuthor,
  profile,
  source,
  records,
  onProfileChange,
  onCreateRecord,
  onUpdateRecord,
  onGoToSource,
  onAskAI,
  onExport,
  onOpenContents,
  initialTab = 'prepare',
  focusRequest,
  className = '',
}: ReadingMethodPanelProps & { bookIdentity: string }) {
  const panelId = useId();
  const storageKey = `readest:reading-method-drafts:v1:${encodeURIComponent(bookIdentity)}`;
  const [tab, setTab] = useState<ReadingMethodTab>(initialTab);
  const [reflectKind, setReflectKind] = useState<'understanding' | 'judgment'>('understanding');
  const [drafts, setDrafts] = useState<ReadingMethodDrafts>(emptyDrafts);
  const draftsRef = useRef(drafts);
  const [ready, setReady] = useState(false);
  const [cacheFailed, setCacheFailed] = useState(false);
  const [showReviewSource, setShowReviewSource] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const restored = readDrafts(storageKey);
    draftsRef.current = restored;
    setDrafts(restored);
    setReady(true);
    return () => {
      mountedRef.current = false;
    };
  }, [storageKey]);

  const changeDrafts = useCallback(
    (update: (previous: ReadingMethodDrafts) => ReadingMethodDrafts) => {
      if (!mountedRef.current) return;
      const next = update(draftsRef.current);
      draftsRef.current = next;
      // Persist at the edit event, including before a sidebar unmount or book switch.
      const cached = writeDrafts(storageKey, next);
      if (mountedRef.current) {
        setDrafts(next);
        setCacheFailed(!cached);
      }
    },
    [storageKey],
  );

  useEffect(() => {
    if (!focusRequest) return;
    setTab(focusRequest.tab);
    if (focusRequest.kind === 'understanding' || focusRequest.kind === 'judgment') {
      setReflectKind(focusRequest.kind);
    }
    if (focusRequest.tab === 'review') setShowReviewSource(false);
  }, [focusRequest?.tab, focusRequest?.kind, focusRequest?.nonce]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    if (tab === 'review') setShowReviewSource(false);
    if (focusRequest?.tab === tab && tab !== 'prepare') composerRef.current?.focus();
  }, [tab, focusRequest?.nonce]);

  const runAction = async (key: string, action: () => Promise<void>, success?: string) => {
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    setErrors((previous) => ({ ...previous, [key]: '' }));
    setNotice('');
    try {
      await action();
      if (mountedRef.current && success) setNotice(success);
    } catch (error) {
      if (mountedRef.current)
        setErrors((previous) => ({ ...previous, [key]: errorMessage(error) }));
    } finally {
      pendingRef.current.delete(key);
      if (mountedRef.current) setPending(new Set(pendingRef.current));
    }
  };

  const belongsToBook = (value?: ReadingSource) =>
    value && (!bookId || !value.bookHash || value.bookHash === bookId);
  const currentSource = belongsToBook(source) ? source : undefined;
  const draftProfile = drafts.profile || profile;
  const profileDirty = JSON.stringify(draftProfile) !== JSON.stringify(profile);
  const kind: ReadingRecordKind =
    tab === 'questions' ? 'question' : tab === 'review' ? 'review' : reflectKind;
  const composer = drafts.composers[kind];
  // Once writing begins, use its captured source rather than the latest selection.
  const composerSource = belongsToBook(composer.source)
    ? composer.source
    : composer.userText === ''
      ? currentSource
      : undefined;

  useEffect(() => {
    setShowReviewSource(false);
  }, [composerSource?.bookHash, composerSource?.cfi, composerSource?.excerpt]);

  const updateProfile = (patch: Partial<ReadingMethodProfile>) => {
    changeDrafts((previous) => ({
      ...previous,
      profile: { ...(previous.profile || profile), ...patch },
    }));
  };

  const updateQuestion = (index: number, value: string) => {
    changeDrafts((previous) => {
      const base = previous.profile || profile;
      const fourQuestions: ReadingMethodProfile['fourQuestions'] = [...base.fourQuestions];
      fourQuestions[index] = value;
      return { ...previous, profile: { ...base, fourQuestions } };
    });
  };

  const saveProfile = () =>
    runAction(
      'profile',
      async () => {
        const snapshot = {
          ...draftProfile,
          fourQuestions: [...draftProfile.fourQuestions] as ReadingMethodProfile['fourQuestions'],
        };
        await onProfileChange(snapshot);
        changeDrafts((previous) =>
          JSON.stringify(previous.profile || profile) === JSON.stringify(snapshot)
            ? { ...previous, profile: undefined }
            : previous,
        );
      },
      '阅读卡已保存',
    );

  const saveComposer = () =>
    runAction(
      `create:${kind}`,
      async () => {
        if (!composer.userText.trim()) return;
        const snapshot = composer.userText;
        await onCreateRecord({
          kind,
          userText: snapshot.trim(),
          source: composerSource ? { ...composerSource } : undefined,
          status: 'open',
          createdAt: new Date().toISOString(),
        });
        changeDrafts((previous) =>
          previous.composers[kind].userText === snapshot
            ? { ...previous, composers: { ...previous.composers, [kind]: { userText: '' } } }
            : previous,
        );
        if (kind === 'review' && mountedRef.current) setShowReviewSource(false);
      },
      '已保存；需要时可在下方请小墨对照原文',
    );

  const askAI = (record: ReadingMethodRecord) =>
    runAction(`ai:${record.id}`, async () => {
      if (!belongsToBook(record.source) || !record.source?.excerpt.trim()) {
        throw new Error('先选中书中一段文字并关联到这条记录，再请小墨核对。');
      }
      await onAskAI(record);
    });

  const updateStatus = (record: ReadingMethodRecord, status: ReadingRecordStatus) =>
    runAction(
      `record:${record.id}`,
      async () => {
        await onUpdateRecord(record.id, { status, updatedAt: new Date().toISOString() });
      },
      '疑问状态已更新',
    );

  const saveRecordEdit = (record: ReadingMethodRecord) =>
    runAction(
      `record:${record.id}`,
      async () => {
        const text = draftsRef.current.recordEdits[record.id];
        if (text === undefined || !text.trim()) return;
        await onUpdateRecord(record.id, {
          userText: text.trim(),
          updatedAt: new Date().toISOString(),
        });
        changeDrafts((previous) => {
          if (previous.recordEdits[record.id] !== text) return previous;
          const recordEdits = { ...previous.recordEdits };
          delete recordEdits[record.id];
          return { ...previous, recordEdits };
        });
      },
      '个人内容已保存',
    );

  const visibleRecords = records
    .filter((record) => {
      if (tab === 'questions') {
        return (
          record.kind === 'question' &&
          (showAllQuestions || record.status === 'open' || record.status === 'kept')
        );
      }
      if (tab === 'review') return record.kind === 'review';
      return record.kind === 'understanding' || record.kind === 'judgment';
    })
    .slice()
    .reverse();

  const sourceRecords = records.filter(
    (record) => belongsToBook(record.source) && record.source?.excerpt,
  );
  const fieldBusy = pending.has(`create:${kind}`);
  const isCustomGenre = !GENRES.some(([value]) => value === draftProfile.genre);

  const renderError = (key: string) =>
    errors[key] ? (
      <p className='text-error mt-2 break-words text-xs leading-5' role='alert'>
        {errors[key]}
      </p>
    ) : null;

  const profileSaveButton = (
    <div className='pt-1'>
      <button
        type='button'
        className={`${buttonClass} btn-contrast`}
        disabled={!profileDirty || pending.has('profile')}
        onClick={() => void saveProfile()}
      >
        {pending.has('profile') ? '正在保存…' : '保存阅读卡'}
      </button>
      <span className='text-base-content ms-3 text-xs'>
        {profileDirty ? '有未保存的修改' : '阅读卡已保存'}
      </span>
      {renderError('profile')}
    </div>
  );

  return (
    <section
      className={`bg-base-100 text-base-content flex h-full min-h-0 min-w-0 flex-col ${className}`}
      aria-label='阅读方法助手'
    >
      <header className='border-base-content/10 shrink-0 border-b px-4 pb-3 pt-4'>
        <p className='text-base-content mb-1 text-xs'>阅读助手</p>
        <h2 className='truncate text-lg font-semibold tracking-tight' title={bookTitle}>
          {bookTitle}
        </h2>
        {bookAuthor ? (
          <p className='text-base-content mt-1 truncate text-xs'>{bookAuthor}</p>
        ) : null}
        <div
          className='eink-bordered bg-base-200 mt-4 grid grid-cols-4 gap-1 rounded-lg p-1'
          role='tablist'
          aria-label='阅读助手功能'
        >
          {TABS.map((item, index) => (
            <button
              key={item.id}
              type='button'
              role='tab'
              id={`${panelId}-${item.id}`}
              aria-controls={`${panelId}-panel`}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              className={`min-h-9 rounded-md px-1 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${tab === item.id ? 'bg-base-100 border-base-content border-b-2' : 'text-base-content border-transparent border-b-2 hover:bg-base-200'}`}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => {
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % TABS.length
                    : event.key === 'ArrowLeft'
                      ? (index + TABS.length - 1) % TABS.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? TABS.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                const nextTab = TABS[next];
                if (nextTab) {
                  setTab(nextTab.id);
                  document.getElementById(`${panelId}-${nextTab.id}`)?.focus();
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div
        ref={bodyRef}
        id={`${panelId}-panel`}
        role='tabpanel'
        aria-labelledby={`${panelId}-${tab}`}
        aria-busy={!ready}
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5'
      >
        {!ready ? (
          <p className='text-base-content text-sm'>正在恢复阅读记录…</p>
        ) : tab === 'prepare' ? (
          <div className='space-y-6'>
            <div>
              <h3 className='text-sm font-semibold'>认识这本书</h3>
              <p className='text-base-content mt-2 text-xs leading-6'>
                先看看目录、序言和感兴趣的章节，写下一个初步判断。也可以直接开始读。
              </p>
              {onOpenContents ? (
                <button
                  type='button'
                  className={`${subtleButtonClass} mt-2 -ms-3`}
                  onClick={onOpenContents}
                >
                  打开目录，浏览全书
                </button>
              ) : null}
            </div>
            <div className='space-y-2'>
              <label className='block text-sm font-medium' htmlFor={`${panelId}-genre`}>
                这是什么类型的书？
              </label>
              <select
                id={`${panelId}-genre`}
                className='select select-bordered eink-bordered bg-base-100 w-full rounded-lg text-sm'
                value={draftProfile.genre}
                disabled={pending.has('profile')}
                onChange={(event) => updateProfile({ genre: event.target.value })}
              >
                {isCustomGenre ? (
                  <option value={draftProfile.genre}>{draftProfile.genre}</option>
                ) : null}
                {GENRES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              label='我为什么想读？'
              value={draftProfile.goal}
              rows={2}
              hint='想弄懂一个问题、了解一个领域，或只是享受阅读。'
              disabled={pending.has('profile')}
              onChange={(goal) => updateProfile({ goal })}
            />
            <TextField
              label='现在看来，这本书主要讲什么？'
              value={draftProfile.initialThought}
              hint='一句话就够了。之后可以改变想法。'
              disabled={pending.has('profile')}
              onChange={(initialThought) => updateProfile({ initialThought })}
            />
            {profileSaveButton}
          </div>
        ) : (
          <div className='space-y-6'>
            {tab === 'reflect' ? (
              <details className='border-base-content/10 border-b pb-5'>
                <summary className='cursor-pointer rounded text-sm font-semibold leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'>
                  全书四问{' '}
                  <span className='text-base-content ms-1 text-xs font-normal'>随读随补</span>
                </summary>
                <div className='space-y-5 pt-4'>
                  {FOUR_QUESTIONS.map((question, index) => (
                    <TextField
                      key={question.title}
                      label={question.title}
                      hint={question.hint}
                      value={draftProfile.fourQuestions[index] || ''}
                      disabled={pending.has('profile')}
                      onChange={(value) => updateQuestion(index, value)}
                    />
                  ))}
                  {profileSaveButton}
                </div>
              </details>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveComposer();
              }}
              className='space-y-3'
            >
              <div>
                <h3 className='text-sm font-semibold'>
                  {tab === 'questions'
                    ? '先把问题留下'
                    : tab === 'review'
                      ? '回想刚才读到的内容'
                      : '用自己的话想一想'}
                </h3>
                <p className='text-base-content mt-2 text-xs leading-6'>
                  {tab === 'questions'
                    ? '可以现在问，也可以继续读，看看后文是否会回答。'
                    : tab === 'review'
                      ? '先试着回忆，再展开原文对照。随时可以看原文，不用完成整套步骤。'
                      : '先理解作者，再留下自己的判断。AI 的建议会单独保留。'}
                </p>
              </div>

              {tab === 'reflect' ? (
                <div className='flex flex-wrap gap-1' aria-label='记录类型'>
                  {(['understanding', 'judgment'] as const).map((item) => (
                    <button
                      key={item}
                      type='button'
                      aria-pressed={reflectKind === item}
                      className={`${subtleButtonClass} ${reflectKind === item ? 'bg-base-200' : ''}`}
                      onClick={() => setReflectKind(item)}
                    >
                      {KIND_LABELS[item]}
                    </button>
                  ))}
                </div>
              ) : null}

              {tab === 'review' && sourceRecords.length > 0 ? (
                <div className='space-y-2'>
                  <label htmlFor={`${panelId}-review-source`} className='text-xs font-medium'>
                    也可以回顾之前留下的内容
                  </label>
                  <select
                    id={`${panelId}-review-source`}
                    className='select select-bordered eink-bordered bg-base-100 w-full rounded-lg text-xs'
                    defaultValue=''
                    disabled={fieldBusy}
                    onChange={(event) => {
                      const record = sourceRecords.find((item) => item.id === event.target.value);
                      if (!record?.source) return;
                      changeDrafts((previous) => ({
                        ...previous,
                        composers: {
                          ...previous.composers,
                          review: { ...previous.composers.review, source: { ...record.source! } },
                        },
                      }));
                      setShowReviewSource(false);
                      event.target.value = '';
                    }}
                  >
                    <option value=''>选择一条带原文的记录</option>
                    {sourceRecords
                      .slice()
                      .reverse()
                      .map((record, index) => (
                        <option key={record.id} value={record.id}>
                          {record.source?.chapter || KIND_LABELS[record.kind]} · 记录 {index + 1}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}

              {composerSource ? (
                <div className='eink-bordered bg-base-200/60 rounded-lg p-3'>
                  {tab === 'review' && !showReviewSource ? (
                    <div className='flex items-center justify-between gap-2'>
                      <p className='text-base-content text-xs'>
                        原文已收起{composerSource.chapter ? ` · ${composerSource.chapter}` : ''}
                      </p>
                      <button
                        type='button'
                        className={`${subtleButtonClass} shrink-0`}
                        onClick={() => setShowReviewSource(true)}
                      >
                        展开原文
                      </button>
                    </div>
                  ) : (
                    <SourceBlock source={composerSource} onGoToSource={onGoToSource} />
                  )}
                </div>
              ) : (
                <p className='text-base-content text-xs leading-5'>
                  可以直接记下想法。需要小墨对照时，先在正文选一段文字。
                </p>
              )}

              {currentSource && !sameSource(currentSource, composerSource) ? (
                <button
                  type='button'
                  className={subtleButtonClass}
                  disabled={fieldBusy}
                  onClick={() => {
                    changeDrafts((previous) => ({
                      ...previous,
                      composers: {
                        ...previous.composers,
                        [kind]: { ...previous.composers[kind], source: { ...currentSource } },
                      },
                    }));
                    if (kind === 'review') setShowReviewSource(false);
                  }}
                >
                  {composerSource ? '改为关联当前选文' : '关联当前选文'}
                </button>
              ) : null}

              <div className='space-y-2'>
                <label htmlFor={`${panelId}-composer`} className='block text-sm font-medium'>
                  {KIND_LABELS[kind]}
                </label>
                <textarea
                  ref={composerRef}
                  id={`${panelId}-composer`}
                  rows={4}
                  className={fieldClass}
                  value={composer.userText}
                  disabled={fieldBusy}
                  placeholder={
                    kind === 'question'
                      ? '这里不明白的是……'
                      : kind === 'judgment'
                        ? '我赞同 / 存疑的地方，以及理由……'
                        : kind === 'review'
                          ? '不看原文，我记得……'
                          : '作者的意思，我理解为……'
                  }
                  onChange={(event) => {
                    const userText = event.target.value;
                    changeDrafts((previous) => ({
                      ...previous,
                      composers: {
                        ...previous.composers,
                        [kind]: {
                          userText,
                          source:
                            previous.composers[kind].userText === ''
                              ? composerSource
                              : previous.composers[kind].source,
                        },
                      },
                    }));
                  }}
                />
              </div>
              <button
                type='submit'
                className={`${buttonClass} btn-contrast`}
                disabled={!composer.userText.trim() || fieldBusy}
              >
                {fieldBusy
                  ? '正在保存…'
                  : kind === 'question'
                    ? '暂存疑问'
                    : kind === 'review'
                      ? '保存这次回忆'
                      : '保存我的想法'}
              </button>
              {renderError(`create:${kind}`)}
            </form>

            <div className='border-base-content/10 border-t pt-5'>
              <div className='mb-4 flex items-center justify-between gap-3'>
                <h3 className='text-sm font-semibold'>
                  {tab === 'questions'
                    ? '这本书的疑问'
                    : tab === 'review'
                      ? '过去的回顾'
                      : '留下的理解与判断'}
                </h3>
                {tab === 'questions' ? (
                  <button
                    type='button'
                    className={subtleButtonClass}
                    aria-pressed={showAllQuestions}
                    onClick={() => setShowAllQuestions((previous) => !previous)}
                  >
                    {showAllQuestions ? '只看待处理' : '显示全部'}
                  </button>
                ) : null}
              </div>
              {visibleRecords.length === 0 ? (
                <p className='text-base-content py-3 text-xs leading-6'>
                  {tab === 'questions'
                    ? '这里还没有需要处理的疑问。遇到不明白的地方时再留下。'
                    : tab === 'review'
                      ? '保存一次回忆后，会在这里留下记录。'
                      : '写下一句理解，就能在以后接上自己的思路。'}
                </p>
              ) : (
                <div className='divide-base-content/10 divide-y'>
                  {visibleRecords.map((record) => {
                    const editingText = drafts.recordEdits[record.id];
                    const isEditing = editingText !== undefined;
                    const saving = pending.has(`record:${record.id}`);
                    const asking = pending.has(`ai:${record.id}`);
                    const recordSource = belongsToBook(record.source) ? record.source : undefined;
                    return (
                      <article key={record.id} className='min-w-0 space-y-3 py-5 first:pt-0'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                          <p className='text-xs font-semibold'>{KIND_LABELS[record.kind]}</p>
                          {record.kind === 'question' ? (
                            <span className='text-base-content text-xs'>
                              {STATUS_LABELS[record.status]}
                            </span>
                          ) : null}
                        </div>
                        {isEditing ? (
                          <div className='space-y-2'>
                            <TextField
                              label={`编辑${KIND_LABELS[record.kind]}`}
                              value={editingText}
                              disabled={saving}
                              onChange={(text) =>
                                changeDrafts((previous) => ({
                                  ...previous,
                                  recordEdits: { ...previous.recordEdits, [record.id]: text },
                                }))
                              }
                            />
                            <div className='flex gap-2'>
                              <button
                                type='button'
                                className={`${buttonClass} btn-contrast`}
                                disabled={saving || !editingText.trim()}
                                onClick={() => void saveRecordEdit(record)}
                              >
                                {saving ? '正在保存…' : '保存修改'}
                              </button>
                              <button
                                type='button'
                                className={subtleButtonClass}
                                disabled={saving}
                                onClick={() =>
                                  changeDrafts((previous) => {
                                    const recordEdits = { ...previous.recordEdits };
                                    delete recordEdits[record.id];
                                    return { ...previous, recordEdits };
                                  })
                                }
                              >
                                取消修改
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className='whitespace-pre-wrap break-words text-sm leading-6'>
                            {record.userText}
                          </p>
                        )}

                        {recordSource ? (
                          <SourceBlock
                            source={recordSource}
                            onGoToSource={onGoToSource}
                            expanded={false}
                          />
                        ) : null}

                        {record.aiText ? (
                          <div className='eink-bordered border-base-content/15 bg-base-200/40 rounded-lg border p-3'>
                            <p className='text-base-content mb-2 text-xs font-medium'>
                              小墨对照与建议
                            </p>
                            {record.aiInputText && record.aiInputText !== record.userText ? (
                              <p className='mb-3 whitespace-pre-wrap break-words text-xs leading-5'>
                                这条建议对应此前表述：{record.aiInputText}
                              </p>
                            ) : null}
                            <p className='whitespace-pre-wrap break-words text-sm leading-6'>
                              {record.aiText}
                            </p>
                          </div>
                        ) : null}

                        <div className='-ms-3 flex flex-wrap gap-1'>
                          {!isEditing ? (
                            <button
                              type='button'
                              className={subtleButtonClass}
                              disabled={saving || asking}
                              onClick={() =>
                                changeDrafts((previous) => ({
                                  ...previous,
                                  recordEdits: {
                                    ...previous.recordEdits,
                                    [record.id]: record.userText,
                                  },
                                }))
                              }
                            >
                              编辑我的话
                            </button>
                          ) : null}
                          <button
                            type='button'
                            className={subtleButtonClass}
                            disabled={
                              asking || saving || isEditing || !recordSource?.excerpt.trim()
                            }
                            onClick={() => void askAI(record)}
                          >
                            {asking
                              ? '正在对照原文…'
                              : record.aiText
                                ? '再次请小墨核对'
                                : record.kind === 'question'
                                  ? '请小墨解答'
                                  : '请小墨核对'}
                          </button>
                        </div>
                        {!recordSource ? (
                          <p className='text-base-content text-xs leading-5'>
                            这条记录还没有关联原文，选中一段文字后可以补上。
                          </p>
                        ) : null}
                        {!recordSource && currentSource && !isEditing ? (
                          <button
                            type='button'
                            className={subtleButtonClass}
                            disabled={saving || asking}
                            onClick={() =>
                              void runAction(
                                `record:${record.id}`,
                                async () => {
                                  await onUpdateRecord(record.id, {
                                    source: { ...currentSource },
                                    updatedAt: new Date().toISOString(),
                                  });
                                },
                                '已关联当前选文',
                              )
                            }
                          >
                            关联当前选文后再核对
                          </button>
                        ) : null}

                        {record.kind === 'question' ? (
                          <div className='flex flex-wrap gap-1' aria-label='处理疑问'>
                            {(['resolved', 'kept', 'discarded'] as const).map((status) => (
                              <button
                                key={status}
                                type='button'
                                className={`${subtleButtonClass} ${record.status === status ? 'bg-base-200' : ''}`}
                                aria-pressed={record.status === status}
                                disabled={saving || asking || record.status === status}
                                onClick={() => void updateStatus(record, status)}
                              >
                                {STATUS_LABELS[status]}
                              </button>
                            ))}
                            {record.status === 'resolved' || record.status === 'discarded' ? (
                              <button
                                type='button'
                                className={subtleButtonClass}
                                disabled={saving || asking}
                                onClick={() => void updateStatus(record, 'open')}
                              >
                                重新打开
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {renderError(`record:${record.id}`)}
                        {renderError(`ai:${record.id}`)}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <footer className='border-base-content/10 shrink-0 border-t px-4 py-3'>
        {cacheFailed ? (
          <p role='status' className='text-warning mb-2 text-xs leading-5'>
            草稿暂时无法保存在本机，请保存记录后再关闭侧栏。
          </p>
        ) : null}
        {notice ? (
          <p role='status' className='text-base-content mb-2 text-xs leading-5'>
            {notice}
          </p>
        ) : null}
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <p className='text-base-content text-xs'>原文 · 我的话 · 小墨建议</p>
          <button
            type='button'
            className={subtleButtonClass}
            disabled={pending.has('export')}
            onClick={() =>
              void runAction('export', async () => {
                await onExport();
              })
            }
          >
            {pending.has('export') ? '正在导出…' : '导出 Markdown'}
          </button>
        </div>
        {renderError('export')}
      </footer>
    </section>
  );
}
