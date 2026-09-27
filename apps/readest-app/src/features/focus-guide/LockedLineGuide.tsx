'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import tinycolor from 'tinycolor2';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { sourceFromSelection } from '../active-reading/session';
import { createDwellController } from './dwell';
import { collectVisibleLines, getReadingViewport, type LockedLine } from './lockedLines';
import { glyphRectOnLine, sentenceAtPoint } from './sentence';
import type { DwellAnchor, SentenceGuideProps } from './SentenceGuide';

interface Props
  extends Pick<
    SentenceGuideProps,
    'bookKey' | 'enabled' | 'remindersEnabled' | 'paused' | 'onDwell' | 'followStyle' | 'variant'
  > {
  view: FoliateView;
  isEink?: boolean;
  vertical?: boolean;
}
const INTERACTIVE =
  'a,sup,img,table,audio,video,button,input,textarea,select,summary,ruby.wl-gloss,[role="button"],[contenteditable="true"],.js_readerFooterNote,.zhangyue-footnote,.duokan-footnote,.qqreader-footnote';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Lock movement to a visual line without changing the chosen guide appearance. */
export default function LockedLineGuide({
  bookKey,
  view,
  enabled,
  remindersEnabled,
  paused,
  onDwell,
  isEink,
  vertical,
  followStyle = 'soft',
  variant = 'focus-window',
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<SVGRectElement>(null);
  const maskId = useId().replace(/:/g, '');
  const callback = useRef(onDwell);
  const anchor = useRef<DwellAnchor | null>(null);
  useEffect(() => {
    callback.current = onDwell;
  }, [onDwell]);
  const dwell = useMemo(
    () =>
      createDwellController((source) => {
        if (anchor.current) callback.current(source, anchor.current);
      }),
    [bookKey],
  );

  useEffect(() => {
    const root = rootRef.current;
    const marker = markerRef.current;
    if (!root || !marker || !enabled || paused || vertical || view.isFixedLayout) return;
    let lines: LockedLine[] = [];
    let current = -1;
    let position = 0;
    let pointer = { x: 0, y: 0 };
    let restingPointer: typeof pointer | null = null;
    let returning = false;
    let returnDistance = 0;
    let returnForward = 0;
    let sourceCache: { line: LockedLine; source: ReturnType<typeof sourceFromSelection> } | null =
      null;
    let turning = false;
    let lockedCfi: string | undefined;
    let generation = 0;
    let disposed = false;
    let frame = 0;
    let candidate: { doc: Document; x: number; y: number; time: number } | null = null;
    const documents = new Map<Document, () => void>();
    const highlights = new Map<
      Document,
      { registry: Map<string, unknown>; style: HTMLStyleElement }
    >();
    const clearHighlights = () => {
      for (const { registry } of highlights.values()) registry.delete('moshu-focus');
    };
    const cancel = () => {
      generation++;
      turning = false;
      current = -1;
      lines = [];
      lockedCfi = undefined;
      candidate = null;
      anchor.current = null;
      restingPointer = null;
      sourceCache = null;
      root.style.visibility = 'hidden';
      clearHighlights();
      dwell.cancel();
    };
    const measure = () => {
      const bounds = view.getBoundingClientRect();
      return view.renderer.getContents().flatMap(({ doc }) => {
        const viewport = getReadingViewport(doc, bounds);
        return viewport ? collectVisibleLines(doc, viewport) : [];
      });
    };
    const paint = () => {
      frame = 0;
      const line = lines[current];
      if (!line || disposed || turning) return;
      const rect = line.doc.defaultView?.frameElement?.getBoundingClientRect();
      const bounds = view.getBoundingClientRect();
      if (!rect) return cancel();
      const styles = line.doc.defaultView?.getComputedStyle(
        line.range.startContainer.parentElement!,
      );
      if (styles?.writingMode && styles.writingMode !== 'horizontal-tb') return cancel();
      const fontSize = Number.parseFloat(styles?.fontSize || '20') || 20;
      const width = Math.min(fontSize * 4.5, line.right - line.left);
      const dark = tinycolor(view.renderer.pageColors?.background || '#fff').isDark();
      Object.assign(root.style, {
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        visibility: 'visible',
        mixBlendMode: followStyle === 'classic' || isEink ? 'normal' : dark ? 'screen' : 'multiply',
      });
      root.dataset['phase'] = returning ? 'returning' : 'reading';
      Object.assign(marker.style, {
        left: `${rect.left - bounds.left + clamp(position, line.left, line.right - width)}px`,
        top: `${rect.top - bounds.top + line.top - 1}px`,
        width: `${width}px`,
        height: `${line.bottom - line.top + 2}px`,
        background:
          followStyle === 'classic' || isEink ? 'transparent' : dark ? '#48402a' : '#fff0ba',
        borderBottom: isEink && followStyle === 'soft' ? '2px solid currentColor' : 'none',
        color: styles?.color || 'currentColor',
      });
      if (followStyle !== 'classic' || !veilRef.current) return;
      const y = (line.top + line.bottom) / 2;
      const hit = sentenceAtPoint(line.doc, clamp(position, line.left + 0.5, line.right - 0.5), y);
      const glyphs =
        hit?.glyphs.flatMap(({ text, range }) => {
          const rect = text.trim() ? glyphRectOnLine(range, y) : null;
          return rect ? [{ range, rect }] : [];
        }) ?? [];
      const veil = veilRef.current;
      veil.setAttribute('fill', view.renderer.pageColors?.background || 'var(--color-base-100)');
      veil.style.opacity = isEink ? '0' : variant === 'focus-window' ? '0.52' : '0.25';
      const cutouts = root.querySelectorAll<SVGRectElement>('[data-focus-cutout]');
      for (let index = 0; index < cutouts.length; index++) {
        const cutout = cutouts[index]!;
        const glyph = glyphs[index];
        // A long unpunctuated paragraph can lack a sentence hit, but still has
        // a real line. Keep a local clear window instead of veiling every word.
        const fallback = !glyphs.length && index === 0;
        cutout.style.display = glyph || fallback ? '' : 'none';
        if (!glyph && !fallback) continue;
        const box =
          glyph?.rect ??
          new DOMRect(
            clamp(position, line.left, line.right - width),
            line.top,
            width,
            line.bottom - line.top,
          );
        cutout.setAttribute('x', `${rect.left - bounds.left + box.left - 1}`);
        cutout.setAttribute('y', `${rect.top - bounds.top + box.top - 1}`);
        cutout.setAttribute('width', `${box.width + 2}`);
        cutout.setAttribute('height', `${box.height + 2}`);
      }
      const runtime = line.doc.defaultView as unknown as {
        Highlight?: new (...ranges: Range[]) => unknown;
        CSS?: { highlights?: Map<string, unknown> };
      };
      clearHighlights();
      if (glyphs.length && runtime.Highlight && runtime.CSS?.highlights) {
        if (!highlights.has(line.doc)) {
          const style = line.doc.createElement('style');
          style.dataset['moshuFocus'] = '';
          style.textContent =
            '::highlight(moshu-focus) { text-shadow: .45px 0 currentColor, -.45px 0 currentColor; }';
          line.doc.head.appendChild(style);
          highlights.set(line.doc, { registry: runtime.CSS.highlights, style });
        }
        runtime.CSS.highlights.set(
          'moshu-focus',
          new runtime.Highlight(...glyphs.map(({ range }) => range)),
        );
      }
    };
    const schedulePaint = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const remind = () => {
      const line = lines[current];
      if (!remindersEnabled || !line || turning || returning) return;
      const contents = view.renderer.getContents().find((item) => item.doc === line.doc);
      if (!contents) return;
      if (sourceCache?.line !== line)
        sourceCache = {
          line,
          source: sourceFromSelection(bookKey, {
            key: `locked:${current}`,
            text: line.range.toString(),
            range: line.range,
            index: contents.index ?? view.renderer.primaryIndex,
            page: view.renderer.page,
          }),
        };
      const { source } = sourceCache;
      if (!source.cfi) return;
      // The reading line stays locked; the invitation still belongs beside the actual pointer.
      anchor.current = {
        x: pointer.x,
        y: pointer.y,
        lineTop: pointer.y - 10,
        lineBottom: pointer.y + 10,
      };
      dwell.hover({
        key: `${current}:${source.cfi}`,
        chapter: source.chapter || `${contents.index}`,
        source,
      });
    };
    const nextLine = async () => {
      returning = true;
      returnDistance = 0;
      returnForward = 0;
      dwell.cancel();
      if (current + 1 < lines.length) {
        current++;
        position = lines[current]!.left;
        return schedulePaint();
      }
      if (view.renderer.atEnd) {
        returning = false;
        return schedulePaint();
      }
      turning = true;
      root.style.visibility = 'hidden';
      const ticket = ++generation;
      try {
        await view.next();
        // Foliate settles iframe geometry after the relocation event.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (disposed || ticket !== generation) return;
        lines = measure();
        lockedCfi = view.lastLocation?.cfi;
        turning = false;
        if (!lines.length) return cancel();
        current = 0;
        position = lines[0]!.left;
        schedulePaint();
      } catch {
        if (!disposed && ticket === generation) cancel();
      }
    };
    const begin = (doc: Document, x: number, y: number, remeasure = false) => {
      if (doc.getSelection()?.isCollapsed === false) return false;
      if (remeasure || !lines.length) lines = measure();
      const index = lines.findIndex(
        (line) =>
          line.doc === doc &&
          y >= line.top - 2 &&
          y <= line.bottom + 2 &&
          x >= line.left - 3 &&
          x <= line.right + 3,
      );
      if (index < 0) return false;
      current = index;
      generation++;
      turning = false;
      returning = false;
      returnDistance = 0;
      returnForward = 0;
      position = clamp(x, lines[current]!.left, lines[current]!.right);
      lockedCfi = view.lastLocation?.cfi;
      const rect = doc.defaultView?.frameElement?.getBoundingClientRect();
      pointer = { x: x + (rect?.left ?? 0), y: y + (rect?.top ?? 0) };
      restingPointer = pointer;
      schedulePaint();
      remind();
      return true;
    };
    const move = (doc: Document, event: PointerEvent) => {
      const rect = doc === document ? null : doc.defaultView?.frameElement?.getBoundingClientRect();
      const x = event.clientX + (rect?.left ?? 0);
      const y = event.clientY + (rect?.top ?? 0);
      const dx = x - pointer.x;
      pointer = { x, y };
      if (event.buttons || event.pointerType === 'touch') return cancel();
      if (!restingPointer || Math.hypot(x - restingPointer.x, y - restingPointer.y) > 2) {
        dwell.cancel();
        restingPointer = pointer;
      }
      if (doc === document) return;
      if (doc.getSelection()?.isCollapsed === false) return cancel();
      if ((event.target as Element | null)?.closest?.(INTERACTIVE)) return;
      if (current < 0) {
        begin(doc, event.clientX, event.clientY);
        return;
      }
      let advance = dx;
      if (returning) {
        if (dx < 0) {
          returnDistance -= dx;
          returnForward = 0;
        }
        if (turning || dx <= 0 || returnDistance < 6) return;
        returnForward += dx;
        if (returnForward < 2) return;
        returning = false;
        advance = returnForward;
      }
      if (turning) return;
      const line = lines[current]!;
      position = clamp(position + advance, line.left, line.right);
      if (dx > 0 && position >= line.right - 1) {
        void nextLine();
        return;
      }
      schedulePaint();
      remind();
    };
    const consumeClick = (event: CustomEvent) => {
      const detail = event.detail as
        | { bookKey?: string; clientX?: number; clientY?: number }
        | undefined;
      const picked = candidate;
      if (
        !picked ||
        detail?.bookKey !== bookKey ||
        Date.now() - picked.time > 1200 ||
        Math.abs((detail.clientX ?? Infinity) - picked.x) > 2 ||
        Math.abs((detail.clientY ?? Infinity) - picked.y) > 2
      )
        return false;
      candidate = null;
      return begin(picked.doc, picked.x, picked.y, true);
    };
    const attach = (doc: Document) => {
      if (documents.has(doc)) return;
      const motion = (event: PointerEvent) => move(doc, event);
      const click = (event: MouseEvent) => {
        candidate = null;
        if (
          event.button ||
          event.detail !== 1 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          (event.target as Element | null)?.closest?.(INTERACTIVE) ||
          doc.getSelection()?.isCollapsed === false
        )
          return;
        candidate = { doc, x: event.clientX, y: event.clientY, time: Date.now() };
      };
      const selection = () => {
        if (doc.getSelection()?.isCollapsed === false) cancel();
      };
      const scroll = () => {
        if (!turning) cancel();
      };
      const down = () => {
        candidate = null;
        dwell.cancel();
      };
      doc.addEventListener('pointermove', motion, { passive: true });
      doc.addEventListener('click', click, true);
      doc.addEventListener('pointerdown', down, true);
      doc.addEventListener('selectionchange', selection);
      doc.addEventListener('scroll', scroll, true);
      for (const name of ['wheel', 'keydown', 'contextmenu'])
        doc.addEventListener(name, cancel, true);
      doc.fonts?.addEventListener('loadingdone', cancel);
      let observed = false;
      const observer = new ResizeObserver(() => {
        if (observed && !turning) cancel();
        observed = true;
      });
      observer.observe(doc.documentElement);
      documents.set(doc, () => {
        doc.removeEventListener('pointermove', motion);
        doc.removeEventListener('click', click, true);
        doc.removeEventListener('pointerdown', down, true);
        doc.removeEventListener('selectionchange', selection);
        doc.removeEventListener('scroll', scroll, true);
        for (const name of ['wheel', 'keydown', 'contextmenu'])
          doc.removeEventListener(name, cancel, true);
        doc.fonts?.removeEventListener('loadingdone', cancel);
        observer.disconnect();
      });
    };
    const refresh = (event?: Event) => {
      // The paginator reports its settled location again after a debounced
      // scroll event. That duplicate must not undo the line we just continued.
      if (
        !turning &&
        event?.type === 'relocate' &&
        (!lockedCfi || view.lastLocation?.cfi !== lockedCfi)
      )
        cancel();
      const docs = new Set(view.renderer.getContents().map((item) => item.doc));
      if (current < 0) lines = [];
      const activeLine = lines[current];
      if (!turning && activeLine && !docs.has(activeLine.doc)) cancel();
      for (const [doc, cleanup] of documents)
        if (!docs.has(doc)) {
          cleanup();
          documents.delete(doc);
        }
      for (const doc of docs) attach(doc);
    };
    const outerMove = (event: PointerEvent) => move(document, event);
    const outerDown = () => cancel();
    eventDispatcher.onSync('iframe-single-click', consumeClick);
    document.addEventListener('pointermove', outerMove, { passive: true });
    document.addEventListener('pointerdown', outerDown, true);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    view.addEventListener('load', refresh);
    view.addEventListener('relocate', refresh);
    view.addEventListener('navigate-start', cancel);
    view.addEventListener('reading-layout-start', cancel);
    refresh();
    return () => {
      disposed = true;
      cancel();
      cancelAnimationFrame(frame);
      for (const cleanup of documents.values()) cleanup();
      for (const { style } of highlights.values()) style.remove();
      eventDispatcher.offSync('iframe-single-click', consumeClick);
      document.removeEventListener('pointermove', outerMove);
      document.removeEventListener('pointerdown', outerDown, true);
      document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      view.removeEventListener('load', refresh);
      view.removeEventListener('relocate', refresh);
      view.removeEventListener('navigate-start', cancel);
      view.removeEventListener('reading-layout-start', cancel);
    };
  }, [
    bookKey,
    view,
    enabled,
    remindersEnabled,
    paused,
    vertical,
    isEink,
    dwell,
    followStyle,
    variant,
  ]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={rootRef}
      aria-hidden='true'
      data-locked-line-guide
      data-sentence-guide={bookKey}
      data-follow-style={followStyle}
      data-lock-line='true'
      className='pointer-events-none fixed z-20 overflow-hidden'
      style={{ visibility: 'hidden' }}
    >
      <div ref={markerRef} data-locked-marker style={{ position: 'absolute', borderRadius: 4 }} />
      {followStyle === 'classic' && (
        <svg className='absolute inset-0 h-full w-full' aria-hidden='true'>
          <defs>
            <mask id={maskId} maskUnits='userSpaceOnUse'>
              <rect width='100%' height='100%' fill='white' />
              {Array.from({ length: 7 }, (_, index) => (
                <rect key={index} data-focus-cutout='' fill='black' />
              ))}
            </mask>
          </defs>
          <rect
            ref={veilRef}
            className='moshu-focus-veil'
            width='100%'
            height='100%'
            mask={`url(#${maskId})`}
          />
        </svg>
      )}
    </div>,
    document.body,
  );
}
