'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PiCheckBold, PiQuestionMarkBold } from 'react-icons/pi';
import { useReaderStore } from '@/store/readerStore';
import type { HighlightStyle } from '@/types/book';
import type { ReadingRecord } from '../active-reading/data';
import IconButton from './IconButton';

interface QuestionMarkersProps {
  bookKey: string;
  records: ReadingRecord[];
  onOpen: (record: ReadingRecord) => void;
}
interface Marker {
  record: ReadingRecord;
  left: number;
  top: number;
}
interface PassageMark {
  key: string;
  style: HighlightStyle;
  resolved: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Measure glyph boxes instead of a block range's full line box. */
const getTextClientRects = (range: Range): DOMRect[] => {
  const doc = range.startContainer.ownerDocument ?? document;
  const root = range.commonAncestorContainer;
  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text);
  else {
    const walker = doc.createTreeWalker(root, doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  }
  const rects: DOMRect[] = [];
  for (const node of nodes) {
    try {
      if (!range.intersectsNode(node) || !node.length) continue;
      const segment = doc.createRange();
      segment.setStart(node, node === range.startContainer ? range.startOffset : 0);
      segment.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
      rects.push(...Array.from(segment.getClientRects()));
    } catch {
      // A document may replace a text node while pagination is settling.
    }
  }
  return rects.length ? rects : Array.from(range.getClientRects());
};

/** Resolve saved anchors without inserting nodes into the book's source document. */
export default function QuestionMarkers({ bookKey, records, onOpen }: QuestionMarkersProps) {
  const view = useReaderStore((state) => state.viewStates[bookKey]?.view);
  const isEink = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings?.isEink);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [passageMarks, setPassageMarks] = useState<PassageMark[]>([]);

  useEffect(() => {
    if (!view) {
      setMarkers([]);
      setPassageMarks([]);
      return;
    }
    let frameId = 0;
    const docCleanups = new Map<Document, () => void>();
    const paint = () => {
      frameId = 0;
      if (view.hasAttribute('data-reading-layout')) return;
      const bounds = view.getBoundingClientRect();
      const contents = view.renderer.getContents();
      const next: Marker[] = [];
      const nextPassageMarks: PassageMark[] = [];
      for (const record of records) {
        if (record.kind !== 'question' || record.status === 'discarded' || !record.source?.cfi)
          continue;
        try {
          const { index, anchor } = view.resolveCFI(record.source.cfi);
          const content = contents.find(
            (item) => (item.index ?? view.renderer.primaryIndex) === index,
          );
          const iframe = content?.doc.defaultView?.frameElement;
          if (!content || !iframe?.isConnected) continue;
          const frame = iframe.getBoundingClientRect();
          const leftEdge = Math.max(0, bounds.left, frame.left);
          const rightEdge = Math.min(window.innerWidth, bounds.right, frame.right);
          const topEdge = Math.max(0, bounds.top, frame.top);
          const bottomEdge = Math.min(window.innerHeight, bounds.bottom, frame.bottom);
          const range = anchor(content.doc);
          const visibleRects = getTextClientRects(range).filter(
            (rect) =>
              rect.width > 0 &&
              rect.height > 0 &&
              rect.right + frame.left > leftEdge &&
              rect.left + frame.left < rightEdge &&
              rect.bottom + frame.top > topEdge &&
              rect.top + frame.top < bottomEdge,
          );
          const rect = visibleRects[0];
          if (!rect) continue;
          const style = record.markerStyle || 'underline';
          for (const [rectIndex, markRect] of visibleRects.entries()) {
            const markLeft = Math.max(leftEdge, frame.left + markRect.left);
            const markRight = Math.min(rightEdge, frame.left + markRect.right);
            const baseTop = Math.max(topEdge, frame.top + markRect.top);
            const isHighlight = style === 'highlight';
            nextPassageMarks.push({
              key: `${record.id}:${rectIndex}`,
              style,
              resolved: record.status === 'resolved',
              left: markLeft,
              top: isHighlight ? baseTop + markRect.height * 0.2 : baseTop + markRect.height - 3,
              width: markRight - markLeft,
              height: isHighlight ? Math.max(8, markRect.height * 0.68) : 3,
            });
          }
          const node = range.startContainer;
          const element =
            node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
          const paragraph = element?.closest('p,li,blockquote,h1,h2,h3,h4,td');
          const paragraphRects = Array.from(paragraph?.getClientRects() ?? []);
          const column = paragraphRects.find(
            (box) =>
              box.left <= rect.left && box.right >= rect.right && box.width < rightEdge - leftEdge,
          );
          const paragraphRight = column?.right ?? rect.right;
          const size = 28;
          const left = Math.max(
            leftEdge,
            Math.min(rightEdge - size - 4, frame.left + paragraphRight + 12),
          );
          let top = Math.max(
            topEdge,
            Math.min(bottomEdge - size, frame.top + rect.top + (rect.height - size) / 2),
          );
          // Keep nearby saved questions individually reachable without covering the text.
          for (const previous of next)
            if (Math.abs(previous.left - left) < 36 && Math.abs(previous.top - top) < 36) {
              top = Math.min(bottomEdge - size, previous.top + 38);
            }
          next.push({ record, left, top });
        } catch {
          // A stale imported CFI or a document disposed during a turn has no visible marker.
        }
      }
      setMarkers(next);
      setPassageMarks(nextPassageMarks);
    };
    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(paint);
    };
    const refresh = () => {
      const docs = new Set(view.renderer.getContents().map(({ doc }) => doc));
      for (const [doc, cleanup] of docCleanups)
        if (!docs.has(doc)) {
          cleanup();
          docCleanups.delete(doc);
        }
      for (const doc of docs)
        if (!docCleanups.has(doc)) {
          doc.addEventListener('scroll', schedule, { passive: true, capture: true });
          doc.fonts?.addEventListener('loadingdone', schedule);
          const observer = new ResizeObserver(schedule);
          observer.observe(doc.documentElement);
          docCleanups.set(doc, () => {
            doc.removeEventListener('scroll', schedule, true);
            doc.fonts?.removeEventListener('loadingdone', schedule);
            observer.disconnect();
          });
        }
      schedule();
    };
    const hide = () => {
      cancelAnimationFrame(frameId);
      frameId = 0;
      setMarkers([]);
      setPassageMarks([]);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(view);
    view.addEventListener('load', refresh);
    view.addEventListener('relocate', refresh);
    view.addEventListener('navigate-start', hide);
    view.addEventListener('reading-layout-start', hide);
    view.addEventListener('reading-layout-end', refresh);
    view.renderer.addEventListener('scroll', schedule, { passive: true });
    view.renderer.addEventListener('relocate', schedule);
    window.addEventListener('resize', schedule);
    refresh();
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      for (const cleanup of docCleanups.values()) cleanup();
      view.removeEventListener('load', refresh);
      view.removeEventListener('relocate', refresh);
      view.removeEventListener('navigate-start', hide);
      view.removeEventListener('reading-layout-start', hide);
      view.removeEventListener('reading-layout-end', refresh);
      view.renderer.removeEventListener('scroll', schedule);
      view.renderer.removeEventListener('relocate', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [view, records]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div data-question-markers={bookKey} className='pointer-events-none'>
      {passageMarks.map((mark) => {
        const color = isEink ? 'var(--color-base-content)' : '#d49a36';
        return (
          <span
            key={mark.key}
            aria-hidden='true'
            data-question-highlight={mark.style}
            data-resolved={mark.resolved}
            className={`moshu-question-passage is-${mark.style} pointer-events-none fixed z-[19]`}
            style={{
              left: mark.left,
              top: mark.top,
              width: mark.width,
              height: mark.height,
              color,
            }}
          >
            {mark.style === 'squiggly'
              ? '\u00a0'.repeat(Math.max(2, Math.ceil(mark.width / 4)))
              : null}
          </span>
        );
      })}
      {markers.map(({ record, left, top }) => {
        const resolved = record.status === 'resolved';
        return (
          <IconButton
            key={record.id}
            label={`${resolved ? '已解决' : '疑问'}：${record.userText}`}
            purpose={resolved ? '回看这个位置已解决的疑问' : '查看这个位置保存的疑问'}
            data-status={record.status}
            data-visual='question-dot'
            className='moshu-question-marker eink-bordered pointer-events-auto fixed z-20 flex items-center justify-center outline-offset-4 focus-visible:outline-2'
            style={{
              left,
              top,
            }}
            onClick={() => onOpen(record)}
          >
            {resolved ? (
              <PiCheckBold aria-hidden size={14} />
            ) : (
              <PiQuestionMarkBold aria-hidden size={15} />
            )}
          </IconButton>
        );
      })}
    </div>,
    document.body,
  );
}
