'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import tinycolor from 'tinycolor2';
import { useDropdownContext } from '@/context/DropdownContext';
import { useReaderStore } from '@/store/readerStore';
import { sourceFromSelection } from '../active-reading/session';
import type { ReadingSource } from '../reading-method/types';
import type { FollowStyle } from '../reading-modes/state';
import { createDwellController } from './dwell';
import { glyphRectOnLine, sentenceAtPoint } from './sentence';
import LockedLineGuide from './LockedLineGuide';

export interface DwellAnchor {
  x: number;
  y: number;
  lineTop: number;
  lineBottom: number;
}

export interface SentenceGuideProps {
  bookKey: string;
  enabled: boolean;
  remindersEnabled: boolean;
  onDwell: (source: ReadingSource, anchor: DwellAnchor) => void;
  followStyle?: FollowStyle;
  lockLine?: boolean;
  paused?: boolean;
  variant?: 'focus-window' | 'emphasis';
}

// WKWebView can intermittently reject an SVG data URL when it is used as a
// cursor. A tiny RGBA PNG keeps the transparent centre and double outline while
// remaining stable in the packaged macOS app.
const HOLLOW_RING_CURSOR_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA3klEQVR42mNgwAL+//8vBcS+QBwBpaUYiAFAhapAvPD0yRMnG+sqd5UW5uwC0SA+SBwkj0+z2/17d08525mfM9XX+G9prPMAxAbRID6IDZIHqcNqM0jS3FDrpZ2F0dXzZ8+cAIqtAeLJIBrEB4mD5KGGqKIbsBBkA0jRp08f9wH5OmjyOiBxkDxIHUg9SoCB/AhyJtRmHRxe1AHJg9RBw0QKJuELCiiQX0HOJRDIa0DqQOpB+mCCEaDQhjptMgEDJoPUgdSD9FHNBZSFAcWxQJV0QHFKpEpeoEpuJAcAAJKpelDPIRfdAAAAAElFTkSuQmCC';

const READING_CURSOR_CONFIG = {
  'focus-window': {
    mode: 'quick',
    image: HOLLOW_RING_CURSOR_PNG,
    hotspot: '8 8',
    fallback: 'default',
  },
  emphasis: {
    mode: 'analytical',
    image: HOLLOW_RING_CURSOR_PNG,
    hotspot: '8 8',
    fallback: 'default',
  },
} as const;

/** Reveal original glyphs through a passive mask; never redraw or resize book text. */
export default function SentenceGuide({
  bookKey,
  enabled,
  remindersEnabled,
  onDwell,
  paused = false,
  variant = 'emphasis',
  followStyle = 'classic',
  lockLine = false,
}: SentenceGuideProps) {
  const view = useReaderStore((state) => state.viewStates[bookKey]?.view);
  const vertical = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings?.vertical);
  const isEink = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings?.isEink);
  const menuOpen = Boolean(useDropdownContext()?.openDropdownId);
  const rootRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<SVGRectElement>(null);
  const softRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<DwellAnchor | null>(null);
  const maskId = useId().replace(/:/g, '');
  const onDwellRef = useRef(onDwell);
  useEffect(() => {
    onDwellRef.current = onDwell;
  }, [onDwell]);
  const session = useMemo(
    () => ({
      bookKey,
      dwell: createDwellController((source) => {
        if (anchorRef.current) onDwellRef.current(source, anchorRef.current);
      }),
    }),
    [bookKey],
  );

  // Quick and analytical reading intentionally have separate profiles so a
  // later tuning of one mode cannot silently change the other. They currently
  // share the same unobtrusive ring artwork.
  useEffect(() => {
    if (!view || !enabled || view.isFixedLayout) return;
    type CursorDeclaration = { value: string; priority: string };
    type CursorSnapshot = {
      root: CursorDeclaration;
      body: CursorDeclaration | null;
      frame: HTMLElement | null;
      frameCursor: CursorDeclaration | null;
      rule: HTMLStyleElement;
    };
    const readCursor = (element: HTMLElement): CursorDeclaration => ({
      value: element.style.getPropertyValue('cursor'),
      priority: element.style.getPropertyPriority('cursor'),
    });
    const restoreCursor = (element: HTMLElement, declaration: CursorDeclaration) => {
      if (declaration.value) {
        element.style.setProperty('cursor', declaration.value, declaration.priority);
      } else {
        element.style.removeProperty('cursor');
      }
    };
    const previous = new Map<Document, CursorSnapshot>();
    const profile = READING_CURSOR_CONFIG[variant];
    const cursor = `url("${profile.image}") ${profile.hotspot}, ${profile.fallback}`;
    const applyToDocument = (doc: Document) => {
      if (previous.has(doc)) return;
      const root = doc.documentElement;
      const body = doc.body;
      const frame = doc.defaultView?.frameElement as HTMLElement | null;
      const rule = doc.createElement('style');
      rule.setAttribute('data-moshu-reader-cursor', variant);
      rule.setAttribute('data-moshu-reader-cursor-mode', profile.mode);
      rule.textContent = `
        html, body, body *, body *::before, body *::after {
          cursor: ${cursor} !important;
        }
        body :is(a, button, summary, select, label[for], [role='button'],
          input[type='button'], input[type='submit'], input[type='reset'],
          input[type='checkbox'], input[type='radio']),
        body :is(a, button, summary, select, label[for], [role='button'],
          input[type='button'], input[type='submit'], input[type='reset'],
          input[type='checkbox'], input[type='radio']) * {
          cursor: pointer !important;
        }
        body :is(textarea, [contenteditable='true'],
          input:not([type='button'], [type='submit'], [type='reset'], [type='checkbox'], [type='radio'])) {
          cursor: text !important;
        }
      `;
      previous.set(doc, {
        root: readCursor(root),
        body: body ? readCursor(body) : null,
        frame,
        frameCursor: frame ? readCursor(frame) : null,
        rule,
      });
      (doc.head || root).appendChild(rule);
      root.style.setProperty('cursor', cursor, 'important');
      body?.style.setProperty('cursor', cursor, 'important');
      frame?.style.setProperty('cursor', cursor, 'important');
    };
    const apply = (event?: Event) => {
      const loaded = (event as CustomEvent<{ doc?: Document }> | undefined)?.detail?.doc;
      if (loaded) applyToDocument(loaded);
      for (const { doc } of view.renderer.getContents()) applyToDocument(doc);
    };
    const restore = () => {
      for (const [doc, snapshot] of previous) {
        snapshot.rule.remove();
        restoreCursor(doc.documentElement, snapshot.root);
        if (doc.body && snapshot.body) restoreCursor(doc.body, snapshot.body);
        if (snapshot.frame && snapshot.frameCursor)
          restoreCursor(snapshot.frame, snapshot.frameCursor);
      }
      previous.clear();
    };
    const refresh = () => {
      restore();
      apply();
    };
    view.addEventListener('load', apply);
    view.addEventListener('relocate', refresh);
    apply();
    return () => {
      view.removeEventListener('load', apply);
      view.removeEventListener('relocate', refresh);
      restore();
    };
  }, [enabled, variant, view]);

  useEffect(() => {
    const root = rootRef.current;
    const veil = veilRef.current;
    const soft = softRef.current;
    if (!root || !view) return;
    root.style.visibility = 'hidden';
    root.style.mixBlendMode = 'normal';
    const { dwell } = session;
    if ((!enabled && !remindersEnabled) || paused || menuOpen || view.isFixedLayout) return;
    let frameId = 0;
    let point: { doc: Document; x: number; y: number } | null = null;
    let restingPoint: { doc: Document; x: number; y: number } | null = null;
    let lastSource: { key: string; source: ReadingSource } | null = null;
    let nextElementId = 0;
    const highlights = new Map<
      Document,
      { registry: Map<string, unknown>; style: HTMLStyleElement }
    >();
    const clearHighlights = () => {
      for (const { registry } of highlights.values()) registry.delete('moshu-focus');
    };
    const elementIds = new WeakMap<Element, number>();
    const docCleanups = new Map<Document, () => void>();

    const hide = () => {
      clearHighlights();
      point = null;
      restingPoint = null;
      anchorRef.current = null;
      lastSource = null;
      root.style.visibility = 'hidden';
      dwell.cancel();
    };
    // Crossing iframe edges, page gutters and passive controls is not a request
    // to toggle the entire page's contrast. Keep the classic focus until an
    // explicit interaction; soft mode can retire its tiny marker independently.
    const leaveText = () => {
      dwell.cancel();
      point = null;
      lastSource = null;
      anchorRef.current = null;
      restingPoint = null;
      if (followStyle === 'soft') root.style.visibility = 'hidden';
    };
    const paint = () => {
      frameId = 0;
      if (!point) return;
      const { doc, x, y } = point;
      const iframe = doc.defaultView?.frameElement;
      if (!iframe?.isConnected || doc.getSelection()?.isCollapsed === false || document.hidden)
        return hide();
      try {
        const hit = sentenceAtPoint(doc, x, y);
        if (!hit) {
          // Keep the last clear phrase while crossing spaces or moving to the next line.
          // Clearing the entire veil here makes the whole page flash on every line break.
          dwell.cancel();
          lastSource = null;
          return;
        }
        const frame = iframe.getBoundingClientRect();
        anchorRef.current = {
          x: frame.left + x,
          y: frame.top + y,
          lineTop: frame.top + hit.caretRect.top,
          lineBottom: frame.top + hit.caretRect.bottom,
        };
        const contents = view.renderer.getContents().find((content) => content.doc === doc);
        if (!contents) return hide();
        const index = contents.index ?? view.renderer.primaryIndex;
        if (!elementIds.has(hit.element)) elementIds.set(hit.element, nextElementId++);
        const key = `${index}:${elementIds.get(hit.element)}:${hit.start}:${hit.end}`;
        if (remindersEnabled) {
          if (lastSource?.key !== key) {
            const source = sourceFromSelection(bookKey, {
              key,
              text: hit.range.toString(),
              range: hit.range,
              index,
              page: view.renderer.page,
            });
            lastSource = { key, source };
          }
          if (lastSource.source.cfi)
            dwell.hover({
              key,
              chapter: lastSource.source.chapter ?? `${index}`,
              source: lastSource.source,
            });
        }
        const styles = doc.defaultView?.getComputedStyle(hit.element);
        if (
          !enabled ||
          vertical ||
          (styles?.writingMode && styles.writingMode !== 'horizontal-tb')
        ) {
          root.style.visibility = 'hidden';
          return;
        }
        const bounds = view.getBoundingClientRect();
        const left = Math.max(0, bounds.left);
        const top = Math.max(0, bounds.top);
        Object.assign(root.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${Math.max(0, Math.min(window.innerWidth, bounds.right) - left)}px`,
          height: `${Math.max(0, Math.min(window.innerHeight, bounds.bottom) - top)}px`,
          visibility: 'visible',
        });
        if (followStyle === 'soft' && soft) {
          const fontSize = Number.parseFloat(styles?.fontSize || '20') || 20;
          const width = Math.min(fontSize * 4.5, bounds.width);
          const dark = tinycolor(view.renderer.pageColors?.background || '#ffffff').isDark();
          root.style.mixBlendMode = isEink ? 'normal' : dark ? 'screen' : 'multiply';
          Object.assign(soft.style, {
            left: `${Math.max(0, Math.min(bounds.right - left - width, frame.left + x - left - width * 0.65))}px`,
            top: `${frame.top + hit.caretRect.top - top - 1}px`,
            width: `${width}px`,
            height: `${hit.caretRect.height + 2}px`,
            background: isEink ? 'transparent' : dark ? '#48402a' : '#fff0ba',
            borderBottom: isEink ? '2px solid currentColor' : 'none',
            color: styles?.color || 'currentColor',
          });
          return;
        }
        if (!veil) return;
        const glyphs = hit.glyphs.flatMap(({ text, range }) => {
          if (!text.trim()) return [];
          const rect = glyphRectOnLine(range, y);
          if (!rect) return [];
          return [
            {
              text,
              rect,
              style: doc.defaultView!.getComputedStyle(range.startContainer.parentElement!),
            },
          ];
        });
        if (!glyphs.length) return;
        veil.setAttribute('fill', view.renderer.pageColors?.background || 'var(--color-base-100)');
        veil.style.opacity = isEink ? '0' : variant === 'focus-window' ? '0.52' : '0.25';
        const cutouts = root.querySelectorAll<SVGRectElement>('[data-focus-cutout]');
        for (let index = 0; index < cutouts.length; index++) {
          const cutout = cutouts[index]!;
          const glyph = glyphs[index];
          cutout.style.display = glyph ? '' : 'none';
          if (!glyph) continue;
          const { rect } = glyph;
          cutout.setAttribute('x', `${frame.left + rect.left - left - 1}`);
          cutout.setAttribute('y', `${frame.top + rect.top - top - 1}`);
          cutout.setAttribute('width', `${rect.width + 2}`);
          cutout.setAttribute('height', `${rect.height + 2}`);
        }
        // Native highlights add weight optically without changing layout or copying text.
        const runtime = doc.defaultView as unknown as {
          Highlight?: new (...ranges: Range[]) => unknown;
          CSS?: { highlights?: Map<string, unknown> };
        };
        if (runtime.Highlight && runtime.CSS?.highlights) {
          if (!highlights.has(doc)) {
            const style = doc.createElement('style');
            style.dataset['moshuFocus'] = '';
            style.textContent = `::highlight(moshu-focus) { text-shadow: .45px 0 currentColor, -.45px 0 currentColor; }`;
            doc.head.appendChild(style);
            highlights.set(doc, { registry: runtime.CSS.highlights, style });
          }
          clearHighlights();
          runtime.CSS.highlights.set(
            'moshu-focus',
            new runtime.Highlight(...hit.glyphs.map((g) => g.range)),
          );
        }
      } catch {
        // A page turn can dispose a range between pointer movement and paint.
        hide();
      }
    };
    const attach = (doc: Document) => {
      if (docCleanups.has(doc)) return;
      const move = (event: PointerEvent) => {
        if (event.pointerType === 'touch' || event.buttons !== 0) return hide();
        if (
          (event.target as Element | null)?.closest?.(
            'a,button,input,textarea,select,[role="button"],[contenteditable="true"]',
          )
        )
          return leaveText();
        if (
          !restingPoint ||
          restingPoint.doc !== doc ||
          Math.hypot(event.clientX - restingPoint.x, event.clientY - restingPoint.y) > 3
        ) {
          dwell.cancel();
          restingPoint = { doc, x: event.clientX, y: event.clientY };
        }
        point = { doc, x: event.clientX, y: event.clientY };
        if (!frameId) frameId = requestAnimationFrame(paint);
      };
      const exit = (event: PointerEvent) => {
        if (!event.relatedTarget) leaveText();
      };
      doc.addEventListener('pointermove', move, { passive: true });
      doc.addEventListener('pointerout', exit, { passive: true });
      const cancelEvents = [
        'pointerdown',
        'contextmenu',
        'keydown',
        'selectionchange',
        'scroll',
        'wheel',
        'focusin',
      ];
      for (const type of cancelEvents)
        doc.addEventListener(type, hide, { passive: true, capture: true });
      doc.fonts?.addEventListener('loadingdone', hide);
      let resizeObserved = false;
      const observer = new ResizeObserver(() => {
        // observe() reports the initial size after paint; it is not a layout change.
        if (resizeObserved) hide();
        resizeObserved = true;
      });
      observer.observe(doc.documentElement);
      docCleanups.set(doc, () => {
        doc.removeEventListener('pointermove', move);
        doc.removeEventListener('pointerout', exit);
        for (const type of cancelEvents) doc.removeEventListener(type, hide, true);
        doc.fonts?.removeEventListener('loadingdone', hide);
        observer.disconnect();
      });
    };
    const refresh = (event?: Event) => {
      hide();
      const docs = new Set(view.renderer.getContents().map(({ doc }) => doc));
      const loaded = (event as CustomEvent<{ doc?: Document }> | undefined)?.detail?.doc;
      if (loaded) docs.add(loaded);
      for (const [doc, cleanup] of docCleanups)
        if (!docs.has(doc)) {
          cleanup();
          docCleanups.delete(doc);
        }
      for (const doc of docs) attach(doc);
    };
    view.addEventListener('load', refresh);
    view.addEventListener('relocate', refresh);
    view.addEventListener('navigate-start', hide);
    view.addEventListener('reading-layout-start', hide);
    view.renderer.addEventListener('relocate', hide);
    view.renderer.addEventListener('scroll', hide, { passive: true });
    const outerEvents = [
      'pointerdown',
      'keydown',
      'focusin',
      'visibilitychange',
      'scroll',
      'wheel',
    ];
    document.addEventListener('pointermove', leaveText, { passive: true, capture: true });
    for (const type of outerEvents)
      document.addEventListener(type, hide, { passive: true, capture: true });
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    refresh();
    return () => {
      hide();
      cancelAnimationFrame(frameId);
      for (const cleanup of docCleanups.values()) cleanup();
      view.removeEventListener('load', refresh);
      view.removeEventListener('relocate', refresh);
      view.removeEventListener('navigate-start', hide);
      view.removeEventListener('reading-layout-start', hide);
      for (const { style } of highlights.values()) style.remove();
      view.renderer.removeEventListener('relocate', hide);
      view.renderer.removeEventListener('scroll', hide);
      for (const type of outerEvents) document.removeEventListener(type, hide, true);
      document.removeEventListener('pointermove', leaveText, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, [
    bookKey,
    enabled,
    remindersEnabled,
    paused,
    menuOpen,
    view,
    vertical,
    isEink,
    session,
    variant,
    followStyle,
    lockLine,
  ]);

  if (typeof document === 'undefined') return null;
  if (lockLine && enabled && view)
    return (
      <LockedLineGuide
        bookKey={bookKey}
        view={view}
        enabled={enabled}
        remindersEnabled={remindersEnabled}
        paused={paused || menuOpen}
        onDwell={onDwell}
        vertical={vertical}
        isEink={isEink}
        followStyle={followStyle}
        variant={variant}
      />
    );
  return createPortal(
    <div
      ref={rootRef}
      aria-hidden='true'
      data-sentence-guide={bookKey}
      data-variant={variant}
      data-follow-style={followStyle}
      className='pointer-events-none fixed z-20 overflow-hidden'
      style={{ visibility: 'hidden', contain: followStyle === 'classic' ? 'strict' : undefined }}
    >
      {followStyle === 'soft' ? (
        <div ref={softRef} data-focus-soft='' style={{ position: 'absolute', borderRadius: 4 }} />
      ) : (
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
