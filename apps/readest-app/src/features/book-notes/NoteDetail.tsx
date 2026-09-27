'use client';

import { useState } from 'react';
import { PiArrowUpRight, PiCheck, PiQuotes, PiX } from 'react-icons/pi';
import TextEditor from '@/components/TextEditor';
import ModianMascot from '../reading-modes/ModianMascot';
import type { ReadingSource } from '../reading-method/types';
import type { ArchiveEntry, ArchiveGroup } from './types';

const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '较早的记录' : date.toLocaleDateString('zh-CN');
};

export default function NoteDetail({
  group,
  draft,
  onDraft,
  onAppend,
  onEdit,
  onResolve,
  onCite,
  onOpenSource,
  onClose,
}: {
  group: ArchiveGroup;
  draft: string;
  onDraft: (text: string) => void;
  onAppend: (text: string, question: boolean) => Promise<void>;
  onEdit: (entry: ArchiveEntry, text: string) => Promise<void>;
  onResolve: (entry: ArchiveEntry) => Promise<void>;
  onCite: (group: ArchiveGroup) => void;
  onOpenSource: (source: ReadingSource) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [question, setQuestion] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await work();
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '未能保存，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className='book-notes-detail' aria-label='笔记详情'>
      <header className='book-notes-detail-header'>
        <h2>笔记详情</h2>
        <button
          type='button'
          className='book-notes-icon'
          aria-label='关闭笔记详情'
          onClick={onClose}
        >
          <PiX />
        </button>
      </header>
      <div className='book-notes-detail-scroll'>
        <div className='book-notes-source-label'>
          <span>{group.chapter}</span>
          {group.source?.cfi && (
            <button type='button' onClick={() => onOpenSource(group.source!)}>
              回到原文 <PiArrowUpRight />
            </button>
          )}
        </div>
        {group.excerpt && (
          <blockquote className='book-notes-full-quote'>{group.excerpt}</blockquote>
        )}
        <div className='book-notes-thought-heading'>
          <h3>
            我的思考 <small>{group.noteCount} 次记录</small>
          </h3>
          <button type='button' title='将这处原文和笔记引用到感悟' onClick={() => onCite(group)}>
            <PiQuotes /> 引用到感悟
          </button>
        </div>
        <ol className='book-notes-timeline'>
          {group.entries.map((entry) => (
            <li key={entry.id}>
              <div className='book-notes-entry-meta'>
                <span>
                  {dateLabel(entry.createdAt)} ·{' '}
                  {entry.kind === 'question'
                    ? entry.status === 'resolved'
                      ? '疑问已解'
                      : '待解疑问'
                    : entry.kind === 'highlight'
                      ? '划线摘录'
                      : entry.kind === 'chapter'
                        ? '章节思考'
                        : '我的记录'}
                </span>
                {(entry.origin === 'native' || entry.origin === 'reading') && (
                  <button
                    type='button'
                    disabled={busy}
                    aria-label={`编辑记录 ${dateLabel(entry.createdAt)}`}
                    onClick={() => {
                      setEditing(entry.id);
                      setEditText(entry.text);
                    }}
                  >
                    编辑
                  </button>
                )}
              </div>
              {editing === entry.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      await onEdit(entry, editText);
                      setEditing(null);
                    });
                  }}
                >
                  <TextEditor
                    value={editText}
                    onChange={setEditText}
                    disabled={busy}
                    ariaLabel='编辑这条笔记'
                    minRows={3}
                    className='book-notes-input eink-bordered'
                    fontSize='inherit'
                  />
                  <div className='book-notes-actions'>
                    <button type='button' disabled={busy} onClick={() => setEditing(null)}>
                      取消
                    </button>
                    <button
                      type='submit'
                      className='book-notes-solid btn-contrast'
                      disabled={busy || !editText.trim()}
                    >
                      保存修改
                    </button>
                  </div>
                </form>
              ) : entry.text ? (
                <p className='book-notes-entry-text'>{entry.text}</p>
              ) : (
                <p className='book-notes-muted'>已收藏这段原文，可以在下方留下想法。</p>
              )}
              {entry.kind === 'question' && entry.origin === 'reading' && (
                <button
                  className='book-notes-resolve'
                  type='button'
                  disabled={busy}
                  onClick={() => void perform(() => onResolve(entry))}
                >
                  {entry.status === 'resolved' ? '重新思考' : '标为已解决'}
                </button>
              )}
            </li>
          ))}
        </ol>
        <form
          className='book-notes-compose'
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim())
              void perform(async () => {
                await onAppend(draft, question);
                setQuestion(false);
              });
          }}
        >
          <label htmlFor='book-notes-new-thought'>追加想法</label>
          <TextEditor
            value={draft}
            onChange={(value) => {
              onDraft(value);
              setSaved(false);
            }}
            ariaLabel='追加想法'
            placeholder='写下这一次的新想法…'
            minRows={3}
            className='book-notes-input eink-bordered'
            fontSize='inherit'
          />
          <div className='book-notes-compose-footer'>
            <label className='book-notes-checkbox'>
              <input
                type='checkbox'
                checked={question}
                onChange={(event) => setQuestion(event.target.checked)}
              />{' '}
              这是一个疑问
            </label>
            <button
              type='submit'
              className='book-notes-solid btn-contrast'
              disabled={busy || !draft.trim()}
            >
              {busy ? '正在保存…' : '保存新想法'}
            </button>
          </div>
          {saved && (
            <p role='status' className='book-notes-saved'>
              <ModianMascot mood='reading' size={28} motion='success' />
              <PiCheck /> 已记下，之前的思考也在。
            </p>
          )}
          {error && (
            <p role='alert' className='book-notes-error'>
              {error}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
