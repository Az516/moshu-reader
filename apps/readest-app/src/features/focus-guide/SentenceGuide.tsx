'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDropdownContext } from '@/context/DropdownContext';
import { useReaderStore } from '@/store/readerStore';
import { sourceFromSelection } from '../active-reading/session';
import type { ReadingSource } from '../reading-method/types';
import { createDwellController } from './dwell';
import { glyphRectOnLine, sentenceAtPoint } from './sentence';

export interface SentenceGuideProps {
  bookKey: string;
  enabled: boolean;
  remindersEnabled: boolean;
  onDwell: (source: ReadingSource) => void;
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
}: SentenceGuideProps) {
  const view = useReaderStore((state) => state.viewStates[bookKey]?.view);
  const vertical = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings?.vertical);
  const isEink = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings?.isEink);
  const menuOpen = Boolean(useDropdownContext()?.openDropdownId);
  const rootRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<SVGRectElement>(null);
  const maskId = useId().replace(/:/g, '');
  const onDwellRef = useRef(onDwell);
  useEffect(() => {
    onDwellRef.current = onDwell;
  }, [onDwell]);
  const session = useMemo(
    () => ({
      bookKey,
      dwell: createDwellController((source) => onDwellRef.current(source)),
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
    if (!root || !veil || !view) return;
    root.style.visibility = 'hidden';
    const { dwell } = session;
    if ((!enabled && !remindersEnabled) || paused || menuOpen || view.isFixedLayout) return;
    let frameId = 0;
    let point: { doc: Document; x: number; y: number } | null = null;
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
      lastSource = null;
      root.style.visibility = 'hidden';
      dwell.cancel();
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
        const frame = iframe.getBoundingClientRect();
        const bounds = view.getBoundingClientRect();
        const left = Math.max(0, bounds.left);
        const top = Math.max(0, bounds.top);
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
        if (!glyphs.length) return hide();
        Object.assign(root.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${Math.max(0, Math.min(window.innerWidth, bounds.right) - left)}px`,
          height: `${Math.max(0, Math.min(window.innerHeight, bounds.bottom) - top)}px`,
          visibility: 'visible',
        });
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
        if (
          event.pointerType === 'touch' ||
          event.buttons !== 0 ||
          (event.target as Element | null)?.closest?.(
            'a,button,input,textarea,select,[role="button"],[contenteditable="true"]',
          )
        )
          return hide();
        point = { doc, x: event.clientX, y: event.clientY };
        if (!frameId) frameId = requestAnimationFrame(paint);
      };
      const exit = (event: PointerEvent) => {
        if (!event.relatedTarget) hide();
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
      const observer = new ResizeObserver(hide);
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
      'pointermove',
      'pointerdown',
      'keydown',
      'focusin',
      'visibilitychange',
      'scroll',
      'wheel',
    ];
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
  ]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={rootRef}
      aria-hidden='true'
      data-sentence-guide={bookKey}
      data-variant={variant}
      className='pointer-events-none fixed z-20 overflow-hidden'
      style={{ visibility: 'hidden', contain: 'strict' }}
    >
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
    </div>,
    document.body,
  );
}
