'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PiCheckBold } from 'react-icons/pi';
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

/** Portaled marks must obey the same clipping ancestors as the book iframe. */
const getClippedBounds = (
  iframe: Element,
  view: Element,
  bounds: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
) => {
  const clipped = { ...bounds };
  let element: Element | null = iframe;
  while (element && element !== view) {
    const root = element.getRootNode();
    element = element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    if (!element || element === view) break;
    const style = getComputedStyle(element);
    const clipsX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX || style.overflow);
    const clipsY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY || style.overflow);
    if (!clipsX && !clipsY) continue;
    const rect = element.getBoundingClientRect();
    if (clipsX) {
      clipped.left = Math.max(clipped.left, rect.left);
      clipped.right = Math.min(clipped.right, rect.right);
    }
    if (clipsY) {
      clipped.top = Math.max(clipped.top, rect.top);
      clipped.bottom = Math.min(clipped.bottom, rect.bottom);
    }
  }
  return clipped;
};

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
          const visible = getClippedBounds(iframe, view, {
            left: leftEdge,
            right: rightEdge,
            top: topEdge,
            bottom: bottomEdge,
          });
          if (visible.right <= visible.left || visible.bottom <= visible.top) continue;
          const range = anchor(content.doc);
          const visibleRects = getTextClientRects(range).filter(
            (rect) =>
              rect.width > 0 &&
              rect.height > 0 &&
              rect.right + frame.left > visible.left &&
              rect.left + frame.left < visible.right &&
              rect.bottom + frame.top > visible.top &&
              rect.top + frame.top < visible.bottom,
          );
          const rect = visibleRects[0];
          if (!rect) continue;
          const style = record.markerStyle || 'underline';
          for (const [rectIndex, markRect] of visibleRects.entries()) {
            const markLeft = Math.max(visible.left, frame.left + markRect.left);
            const markRight = Math.min(visible.right, frame.left + markRect.right);
            const baseTop = frame.top + markRect.top;
            const isHighlight = style === 'highlight';
            const decorationTop = isHighlight
              ? baseTop + markRect.height * 0.2
              : baseTop + markRect.height - 3;
            const decorationHeight = isHighlight
              ? Math.max(8, markRect.height * 0.68)
              : style === 'underline'
                ? 2
                : 3;
            const markTop = Math.max(visible.top, decorationTop);
            const markBottom = Math.min(visible.bottom, decorationTop + decorationHeight);
            if (markBottom <= markTop) continue;
            nextPassageMarks.push({
              key: `${record.id}:${rectIndex}`,
              style,
              resolved: record.status === 'resolved',
              left: markLeft,
              top: markTop,
              width: markRight - markLeft,
              height: markBottom - markTop,
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
          const size = 44;
          const preferredLeft = frame.left + paragraphRight + 12;
          const maxLeft = rightEdge - size - 4;
          let left = Math.max(leftEdge, Math.min(maxLeft, preferredLeft));
          let top = Math.max(
            topEdge,
            Math.min(bottomEdge - size, frame.top + rect.top + (rect.height - size) / 2),
          );
          let avoidsText: ((candidateTop: number) => boolean) | undefined;
          if (left < frame.left + paragraphRight) {
            if (!paragraph) continue;
            const paragraphRange = content.doc.createRange();
            paragraphRange.selectNodeContents(paragraph);
            const lines: Array<{ left: number; right: number; top: number; bottom: number }> = [];
            for (const glyph of getTextClientRects(paragraphRange)) {
              const box = {
                left: frame.left + glyph.left,
                right: frame.left + glyph.right,
                top: frame.top + glyph.top,
                bottom: frame.top + glyph.bottom,
              };
              if (
                glyph.width <= 0 ||
                glyph.height <= 0 ||
                box.right <= visible.left ||
                box.left >= visible.right ||
                box.bottom <= visible.top ||
                box.top >= visible.bottom
              )
                continue;
              const line = lines.find((row) => box.top < row.bottom && box.bottom > row.top);
              if (line) {
                line.left = Math.min(line.left, box.left);
                line.right = Math.max(line.right, box.right);
                line.top = Math.min(line.top, box.top);
                line.bottom = Math.max(line.bottom, box.bottom);
              } else lines.push(box);
            }
            const visibleLines = lines
              .filter(
                (line) =>
                  line.left >= visible.left &&
                  line.right <= visible.right &&
                  line.top >= visible.top &&
                  line.bottom <= visible.bottom,
              )
              .sort(
                (a, b) =>
                  Math.abs(a.top - frame.top - rect.top) - Math.abs(b.top - frame.top - rect.top),
              );
            if (!visibleLines.length) continue;
            const textRects = [
              paragraph.previousElementSibling,
              paragraph,
              paragraph.nextElementSibling,
            ].flatMap((neighbor) => {
              if (!neighbor) return [];
              const neighborRange = content.doc.createRange();
              neighborRange.selectNodeContents(neighbor);
              return getTextClientRects(neighborRange);
            });
            const isBlank = (candidateLeft: number, candidateTop: number) =>
              candidateLeft >= leftEdge &&
              candidateLeft + size <= rightEdge &&
              candidateTop >= topEdge &&
              candidateTop + size <= bottomEdge &&
              textRects.every(
                (glyph) =>
                  glyph.width <= 0 ||
                  glyph.height <= 0 ||
                  frame.left + glyph.right <= candidateLeft ||
                  frame.left + glyph.left >= candidateLeft + size ||
                  frame.top + glyph.bottom <= candidateTop ||
                  frame.top + glyph.top >= candidateTop + size,
              );
            const spaces = [maxLeft, leftEdge].flatMap((candidateLeft, side) =>
              visibleLines.flatMap((line) => {
                if (
                  side === 0 ? line.right + 6 > candidateLeft : candidateLeft + size + 6 > line.left
                )
                  return [];
                const edgeTops = textRects
                  .filter(
                    (glyph) =>
                      frame.left + glyph.right > candidateLeft &&
                      frame.left + glyph.left < candidateLeft + size &&
                      frame.top + glyph.bottom > line.top - size &&
                      frame.top + glyph.top < line.bottom + size,
                  )
                  .flatMap((glyph) => [
                    frame.top + glyph.bottom + 2,
                    frame.top + glyph.top - size - 2,
                  ]);
                return [
                  (line.top + line.bottom - size) / 2,
                  line.top,
                  line.bottom - size,
                  ...edgeTops,
                ]
                  .filter(
                    (candidateTop) => candidateTop < line.bottom && candidateTop + size > line.top,
                  )
                  .map((candidateTop) => ({ left: candidateLeft, top: candidateTop }));
              }),
            );
            spaces.push(
              { left: maxLeft, top: Math.max(...visibleLines.map((line) => line.bottom)) + 6 },
              { left: maxLeft, top: Math.min(...visibleLines.map((line) => line.top)) - size - 6 },
            );
            const space = spaces.find((candidate) => isBlank(candidate.left, candidate.top));
            if (!space) continue;
            left = space.left;
            top = space.top;
            avoidsText = (candidateTop) => isBlank(left, candidateTop);
          }
          // Leave room above as well as below when adjacent touch targets reach a page edge.
          const spacing = size + 4;
          const nearby = next.filter((previous) => Math.abs(previous.left - left) < spacing);
          const candidates = [
            top,
            ...nearby.flatMap((previous) => [previous.top + spacing, previous.top - spacing]),
          ];
          top =
            candidates.find(
              (candidate) =>
                candidate >= topEdge &&
                candidate <= bottomEdge - size &&
                (!avoidsText || avoidsText(candidate)) &&
                nearby.every((previous) => Math.abs(previous.top - candidate) >= spacing),
            ) ?? top;
          if (avoidsText && nearby.some((previous) => Math.abs(previous.top - top) < spacing))
            continue;
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
    <div
      data-question-markers={bookKey}
      data-eink={isEink || undefined}
      className='pointer-events-none'
    >
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
            {mark.style === 'squiggly' && (
              <svg width='100%' height='3' aria-hidden='true' className='block'>
                <path
                  d={`M0 1.5 ${'q1.5 -2 3 0 t3 0 '.repeat(Math.ceil(mark.width / 6))}`}
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.25'
                />
              </svg>
            )}
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
            data-visual={resolved ? 'resolved-check' : 'question-mascot'}
            className='moshu-question-marker pointer-events-auto fixed z-20 flex items-center justify-center'
            style={{
              left,
              top,
            }}
            onClick={() => onOpen(record)}
          >
            {resolved ? (
              <span className='moshu-question-resolved eink-bordered' aria-hidden='true'>
                <PiCheckBold size={15} />
              </span>
            ) : (
              <img
                src='/modian/question-marker.webp'
                alt=''
                aria-hidden='true'
                width={44}
                height={44}
                draggable={false}
              />
            )}
          </IconButton>
        );
      })}
    </div>,
    document.body,
  );
}
