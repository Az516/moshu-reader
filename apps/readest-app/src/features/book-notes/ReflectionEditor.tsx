'use client';

import { useRef, useState } from 'react';
import {
  PiArrowUpRight,
  PiEye,
  PiNotePencil,
  PiQuotes,
  PiTextB,
  PiTextItalic,
  PiX,
} from 'react-icons/pi';
import TextEditor, { type TextEditorRef } from '@/components/TextEditor';
import ModianMascot from '../reading-modes/ModianMascot';
import AnswerMarkdown from '../reading-modes/AnswerMarkdown';
import type { ArchiveGroup, BookReflection } from './types';

export default function ReflectionEditor({
  reflection,
  groups,
  saveStatus,
  onChange,
  onOpenGroup,
  onRetry,
}: {
  reflection: BookReflection;
  groups: ArchiveGroup[];
  saveStatus: 'saved' | 'saving' | 'error';
  onChange: (reflection: BookReflection) => void;
  onOpenGroup: (id: string) => void;
  onRetry: () => void;
}) {
  const editor = useRef<TextEditorRef>(null);
  const [preview, setPreview] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const references = groups.filter((group) =>
    group.entries.some((entry) => reflection.references.includes(entry.id)),
  );
  const update = (patch: Partial<BookReflection>) =>
    onChange({ ...reflection, ...patch, updatedAt: new Date().toISOString() });
  const format = (delimiter: string) => {
    const element = editor.current?.getElement();
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    update({
      text:
        reflection.text.slice(0, start) +
        delimiter +
        reflection.text.slice(start, end) +
        delimiter +
        reflection.text.slice(end),
    });
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + delimiter.length, end + delimiter.length);
    });
  };
  return (
    <article className='book-notes-reflection' aria-label='感悟编辑器'>
      <div className='book-notes-editor-toolbar'>
        <div className='book-notes-format-actions'>
          <button
            type='button'
            className='book-notes-icon'
            disabled={preview}
            aria-label='加粗所选文字'
            title='加粗所选文字（Markdown）'
            onClick={() => format('**')}
          >
            <PiTextB />
          </button>
          <button
            type='button'
            className='book-notes-icon'
            disabled={preview}
            aria-label='斜体所选文字'
            title='斜体所选文字（Markdown）'
            onClick={() => format('*')}
          >
            <PiTextItalic />
          </button>
          <button type='button' onClick={() => setPreview(!preview)}>
            {preview ? <PiNotePencil /> : <PiEye />}
            {preview ? '编辑' : '预览'}
          </button>
        </div>
        <button type='button' onClick={() => setPicking(!picking)}>
          <PiQuotes /> 引用笔记
        </button>
        <span role='status' className='book-notes-save-status'>
          <ModianMascot
            mood={saveStatus === 'error' ? 'question' : 'reading'}
            size={25}
            motion={saveStatus === 'saving' ? 'working' : 'none'}
          />
          {saveStatus === 'saving'
            ? '正在保存…'
            : saveStatus === 'error'
              ? '保存失败'
              : '已自动保存'}
        </span>
        {saveStatus === 'error' && (
          <button type='button' onClick={onRetry}>
            重试
          </button>
        )}
      </div>
      {picking && (
        <section className='book-notes-citation-picker eink-bordered' aria-label='选择引用笔记'>
          <div className='book-notes-picker-heading'>
            <strong>引用笔记</strong>
            <button
              type='button'
              className='book-notes-icon'
              aria-label='关闭引用选择'
              onClick={() => setPicking(false)}
            >
              <PiX />
            </button>
          </div>
          <input
            aria-label='搜索可引用笔记'
            className='book-notes-input eink-bordered'
            placeholder='搜索原文或想法'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className='book-notes-picker-results'>
            {groups
              .filter((group) =>
                `${group.excerpt} ${group.entries.map((entry) => entry.text).join(' ')}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((group) => (
                <button
                  type='button'
                  key={group.id}
                  onClick={() => {
                    update({
                      references: [
                        ...new Set([
                          ...reflection.references,
                          ...group.entries.map((entry) => entry.id),
                        ]),
                      ],
                    });
                    setPicking(false);
                  }}
                >
                  <small>{group.chapter}</small>
                  <span>{group.excerpt || group.entries[0]?.text || '独立笔记'}</span>
                </button>
              ))}
            {!groups.length && <p>还没有可以引用的笔记。</p>}
          </div>
        </section>
      )}
      <input
        className='book-notes-reflection-title'
        aria-label='感悟标题'
        placeholder='给这篇感悟起个名字'
        value={reflection.title}
        onChange={(event) => update({ title: event.target.value })}
      />
      <time className='book-notes-reflection-date'>
        {new Date(reflection.createdAt).toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </time>
      {preview ? (
        <div className='book-notes-reflection-preview'>
          <AnswerMarkdown text={reflection.text || '还没有写下内容。'} />
        </div>
      ) : (
        <TextEditor
          ref={editor}
          value={reflection.text}
          onChange={(text) => update({ text })}
          ariaLabel='感悟正文'
          placeholder='这本书给你留下了什么？从自己的感受开始写。'
          minRows={8}
          fontSize='inherit'
          className='book-notes-reflection-text'
        />
      )}
      {references.length > 0 && (
        <section className='book-notes-reflection-references' aria-label='感悟引用的笔记'>
          {references.map((group) => (
            <blockquote key={group.id}>
              <p>{group.excerpt || group.entries[0]?.text}</p>
              <div>
                <button type='button' onClick={() => onOpenGroup(group.id)}>
                  来自{group.chapter} · 查看笔记 <PiArrowUpRight />
                </button>
                <button
                  type='button'
                  className='book-notes-icon'
                  aria-label='移除此引用'
                  onClick={() =>
                    update({
                      references: reflection.references.filter(
                        (id) => !group.entries.some((entry) => entry.id === id),
                      ),
                    })
                  }
                >
                  <PiX />
                </button>
              </div>
            </blockquote>
          ))}
        </section>
      )}
    </article>
  );
}
