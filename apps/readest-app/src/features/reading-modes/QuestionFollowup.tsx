'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import type { ReadingSource } from '../reading-method/types';
import { emptyReadingData, mutateReadingData, type ReadingRecord } from '../active-reading/data';
import { readingSourceIdentity } from '../active-reading/source';
import {
  findQuestionFollowup,
  resolveQuestionFollowup,
  type QuestionClue,
} from './question-followup';
import ModianMascot from './ModianMascot';
import './question-followup.css';

export interface QuestionFollowupProps {
  bookKey: string;
  records: ReadingRecord[];
  enabled: boolean;
  onResolved: () => void | Promise<void>;
  onOpenSource: (source: ReadingSource) => void;
}

/** Reuse in saved question details so both anchors remain reachable after reopening. */
export function QuestionAnswerLink({
  record,
  onOpenSource,
}: Pick<QuestionFollowupProps, 'onOpenSource'> & { record: ReadingRecord }) {
  if (!record.resolutionSource?.cfi || !record.resolutionSource.bookHash) return null;
  return (
    <button type='button' onClick={() => onOpenSource(record.resolutionSource!)}>
      回到解答原文
    </button>
  );
}

export default function QuestionFollowup({
  bookKey,
  records,
  enabled,
  onResolved,
  onOpenSource,
}: QuestionFollowupProps) {
  const { appService } = useEnv();
  const hash = bookKey.split('-')[0]!;
  const book = useBookDataStore((state) => state.booksData[hash]?.book);
  const progress = useBookProgress(bookKey);
  const view = useReaderStore((state) => state.viewStates[bookKey]?.view);
  const seen = useRef(new Set<string>());
  const [clue, setClue] = useState<QuestionClue | null>(null);
  const [confirmed, setConfirmed] = useState<ReadingRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const passages = useMemo(() => {
    if (!progress?.range || !view || !book) return [];
    const visible = progress.range;
    const doc = visible.startContainer.ownerDocument;
    if (!doc) return [];
    const result: ReadingSource[] = [];
    try {
      // The renderer's visible range bounds the read: hidden paragraphs and
      // preloaded chapters cannot offer leads before the reader reaches them.
      for (const paragraph of doc.querySelectorAll('p,li,blockquote')) {
        if (paragraph.querySelector('p,li,blockquote') || !visible.intersectsNode(paragraph))
          continue;
        const range = doc.createRange();
        range.selectNodeContents(paragraph);
        if (range.compareBoundaryPoints(Range.START_TO_START, visible) < 0)
          range.setStart(visible.startContainer, visible.startOffset);
        if (range.compareBoundaryPoints(Range.END_TO_END, visible) > 0)
          range.setEnd(visible.endContainer, visible.endOffset);
        const excerpt = range.toString().trim();
        if (excerpt.length < 20 || excerpt.length > 6000) continue;
        result.push({
          ...readingSourceIdentity(book),
          excerpt,
          cfi: view.getCFI(progress.index, range),
          sectionIndex: progress.index,
          chapter: progress.sectionLabel,
        });
      }
    } catch {
      // Page turns may dispose the range between relocation and rendering.
    }
    return result;
  }, [book, progress, view]);

  useEffect(() => {
    seen.current = new Set();
    setClue(null);
    setConfirmed(null);
    setError('');
  }, [bookKey]);

  useEffect(() => {
    if (!enabled || confirmed) return;
    if (
      clue &&
      records.some((record) => record.id === clue.question.id && record.status === 'open') &&
      passages.some((passage) => passage.cfi === clue.passage.cfi)
    )
      return;
    setClue(null);
    const timer = setTimeout(() => {
      for (const passage of passages) {
        const next = findQuestionFollowup(records, passage, seen.current);
        if (!next) continue;
        // One offer per question per book opening, including revisits to a
        // later paragraph on the same page. Dismissal never writes a status.
        seen.current.add(next.question.id);
        setClue(next);
        setError('');
        break;
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [enabled, records, passages, clue, confirmed]);

  const dismiss = () => {
    setClue(null);
    setConfirmed(null);
    setError('');
  };
  const confirm = async () => {
    if (!clue || busy) return;
    if (!appService) {
      setError('书库尚未就绪，疑问仍保持未解决。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await mutateReadingData(appService, emptyReadingData(hash), (current) =>
        resolveQuestionFollowup(current, clue.question.id, clue.passage),
      );
      const saved = data.records.find((record) => record.id === clue.question.id);
      if (saved?.status !== 'resolved' || saved.resolutionSource?.cfi !== clue.passage.cfi)
        throw new Error('疑问记录已发生变化，请回看后再确认。');
      setConfirmed(saved);
      setClue(null);
      await onResolved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，疑问仍保持未解决。');
    } finally {
      setBusy(false);
    }
  };

  if (!enabled || (!clue && !confirmed)) return null;
  const question = confirmed || clue!.question;
  const open = (source: ReadingSource) => {
    dismiss();
    onOpenSource(source);
  };
  return (
    <aside
      className='modian-question-followup eink-bordered'
      aria-label='疑问相关线索'
      data-question-followup
    >
      <div className='modian-question-followup-heading'>
        <ModianMascot
          mood={confirmed ? 'reading' : 'question'}
          size={30}
          motion={confirmed ? 'success' : 'enter'}
        />
        <span aria-live='polite'>
          {confirmed ? '已按你的确认标为解决' : '这段可能与先前疑问有关'}
        </span>
      </div>
      <p className='modian-question-followup-question'>{question.userText}</p>
      {!confirmed && (
        <small>
          小墨只比对了当前原文的关键词：{clue!.keywords.join('、')}。是否解答，由你确认。
        </small>
      )}
      {error && (
        <p role='alert' className='modian-question-followup-error'>
          {error}
        </p>
      )}
      <div className='modian-question-followup-actions'>
        {question.source?.cfi && (
          <button type='button' disabled={busy} onClick={() => open(question.source!)}>
            回看疑问原文
          </button>
        )}
        {confirmed ? (
          <QuestionAnswerLink record={confirmed} onOpenSource={open} />
        ) : (
          <button
            type='button'
            className='modian-question-followup-confirm'
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? '正在保存…' : '我确认已解答'}
          </button>
        )}
        <button type='button' disabled={busy} onClick={dismiss}>
          {confirmed ? '收起' : '暂不处理'}
        </button>
      </div>
    </aside>
  );
}
