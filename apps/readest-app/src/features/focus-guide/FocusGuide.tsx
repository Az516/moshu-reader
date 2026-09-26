'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDropdownContext } from '@/context/DropdownContext';
import { useReaderStore } from '@/store/readerStore';
import type { BookFormat } from '@/types/book';
import { findFocusBand, getParagraphLines, textAtPoint } from './geometry';
import { useFocusGuideStore, useHydrateFocusGuide } from './store';

export interface FocusGuideProps {
  bookKey: string;
  bookFormat: BookFormat;
  /** Additional application panels that should suspend the guide. */
  paused?: boolean;
}

/**
 * A passive overlay: no event cancellation, selection changes, reader navigation,
 * tracking, or React updates on pointer movement. Only the hovered paragraph is
 * measured; its line geometry is reused until the document layout changes.
 */
const FocusGuide: React.FC<FocusGuideProps> = ({ bookKey, bookFormat, paused = false }) => {
  useHydrateFocusGuide();
  const enabled = useFocusGuideStore((s) => s.enabled);
  const intensity = useFocusGuideStore((s) => s.intensity);
  const contextLines = useFocusGuideStore((s) => s.contextLines);
  const view = useReaderStore((s) => s.viewStates[bookKey]?.view);
  const vertical = useReaderStore((s) => s.viewStates[bookKey]?.viewSettings?.vertical);
  const isEink = useReaderStore((s) => s.viewStates[bookKey]?.viewSettings?.isEink);
  const dropdown = useDropdownContext();
  const menuOpen = Boolean(dropdown?.openDropdownId);
  const rootRef = useRef<HTMLDivElement>(null);
  const upperRef = useRef<HTMLDivElement>(null);
  const lowerRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const upper = upperRef.current;
    const lower = lowerRef.current;
    const line = lineRef.current;
    if (!root || !upper || !lower || !line) return;
    root.style.visibility = 'hidden';
    if (!enabled || !view || bookFormat !== 'EPUB' || vertical || paused || menuOpen) return;

    let frameId = 0;
    let point: { x: number; y: number } | null = null;
    let cached: {
      element: Element;
      lines: ReturnType<typeof getParagraphLines>;
      lineHeight: number;
    } | null = null;
    const docCleanups = new Map<Document, () => void>();

    const hide = () => {
      point = null;
      root.style.visibility = 'hidden';
    };

    const paint = () => {
      frameId = 0;
      if (!point || view.isFixedLayout || (view.renderer.columnCount ?? 1) > 1) {
        root.style.visibility = 'hidden';
        return;
      }
      const bounds = view.getBoundingClientRect();
      const left = Math.max(0, bounds.left);
      const top = Math.max(0, bounds.top);
      const right = Math.min(window.innerWidth, bounds.right);
      const bottom = Math.min(window.innerHeight, bounds.bottom);
      if (right <= left || bottom <= top) return hide();

      try {
        for (const { doc } of view.renderer.getContents()) {
          const iframe = doc.defaultView?.frameElement;
          const frame = iframe?.getBoundingClientRect();
          if (
            !frame ||
            !iframe?.isConnected ||
            point.x < frame.left ||
            point.x > frame.right ||
            point.y < frame.top ||
            point.y > frame.bottom
          )
            continue;
          if (doc.getSelection()?.isCollapsed === false) return hide();
          const x = point.x - frame.left;
          const y = point.y - frame.top;
          const hit = textAtPoint(doc, x, y);
          if (!hit) break;

          if (cached?.element !== hit.element) {
            const styles = doc.defaultView?.getComputedStyle(hit.element);
            if (styles?.writingMode && styles.writingMode !== 'horizontal-tb') break;
            const fontSize = Number.parseFloat(styles?.fontSize ?? '16') || 16;
            cached = {
              element: hit.element,
              lines: getParagraphLines(hit.element),
              lineHeight: Number.parseFloat(styles?.lineHeight ?? '') || fontSize * 1.5,
            };
          }
          const band = findFocusBand(
            cached.lines,
            (hit.rect.top + hit.rect.bottom) / 2,
            contextLines,
            cached.lineHeight,
          );
          if (!band) break;
          const height = bottom - top;
          const clearTop = Math.max(0, band.clearTop + frame.top - top);
          const clearBottom = Math.min(height, band.clearBottom + frame.top - top);
          const lineTop = band.lineTop + frame.top - top;
          if (lineTop + band.lineHeight <= 0 || lineTop >= height) break;
          const background = view.renderer.pageColors?.background || 'var(--color-base-100)';
          const foreground = view.renderer.pageColors?.foreground || 'var(--color-base-content)';

          // Reads above, writes below: no getClientRects after changing overlay styles.
          Object.assign(root.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${right - left}px`,
            height: `${height}px`,
            visibility: 'visible',
          });
          Object.assign(upper.style, {
            height: `${Math.min(height, clearTop)}px`,
            backgroundColor: background,
            opacity: isEink ? '0' : String(intensity),
          });
          Object.assign(lower.style, {
            top: `${Math.max(0, clearBottom)}px`,
            height: `${Math.max(0, height - clearBottom)}px`,
            backgroundColor: background,
            opacity: isEink ? '0' : String(intensity),
          });
          Object.assign(line.style, {
            transform: `translateY(${lineTop}px)`,
            height: `${band.lineHeight}px`,
            backgroundColor: isEink ? 'transparent' : foreground,
            opacity: isEink ? '1' : '0.07',
            borderBlock: isEink ? `1px solid ${foreground}` : 'none',
          });
          return;
        }
      } catch {
        // An iframe may be disposed between a page turn and this animation frame.
        cached = null;
      }
      root.style.visibility = 'hidden';
    };

    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(paint);
    };
    const invalidate = () => {
      cached = null;
      root.style.visibility = 'hidden';
      schedule();
    };

    const attachDoc = (doc: Document) => {
      if (docCleanups.has(doc)) return;
      const onMove = (event: PointerEvent) => {
        if (event.pointerType === 'touch' || event.buttons !== 0) return hide();
        const target = event.target as Element | null;
        if (
          target?.closest?.(
            'a,button,input,textarea,select,[role="button"],[contenteditable="true"]',
          )
        ) {
          return hide();
        }
        const rect = doc.defaultView?.frameElement?.getBoundingClientRect();
        if (!rect) return hide();
        point = { x: rect.left + event.clientX, y: rect.top + event.clientY };
        schedule();
      };
      const onExit = (event: PointerEvent) => {
        if (!event.relatedTarget) hide();
      };
      const onSelection = () => {
        if (doc.getSelection()?.isCollapsed === false) hide();
      };
      doc.addEventListener('pointermove', onMove, { passive: true });
      doc.addEventListener('pointerdown', hide, { passive: true, capture: true });
      doc.addEventListener('pointerout', onExit, { passive: true });
      doc.addEventListener('contextmenu', hide, { passive: true });
      doc.addEventListener('selectionchange', onSelection);
      doc.addEventListener('scroll', invalidate, { passive: true, capture: true });
      doc.addEventListener('load', invalidate, true);
      doc.fonts?.addEventListener('loadingdone', invalidate);
      const observer = new ResizeObserver(invalidate);
      observer.observe(doc.documentElement);
      docCleanups.set(doc, () => {
        doc.removeEventListener('pointermove', onMove);
        doc.removeEventListener('pointerdown', hide, true);
        doc.removeEventListener('pointerout', onExit);
        doc.removeEventListener('contextmenu', hide);
        doc.removeEventListener('selectionchange', onSelection);
        doc.removeEventListener('scroll', invalidate, true);
        doc.removeEventListener('load', invalidate, true);
        doc.fonts?.removeEventListener('loadingdone', invalidate);
        observer.disconnect();
      });
    };

    const refreshDocs = (event?: Event) => {
      const contents = view.renderer.getContents();
      const liveDocs = new Set(contents.map(({ doc }) => doc));
      const loadedDoc = (event as CustomEvent<{ doc?: Document }> | undefined)?.detail?.doc;
      if (loadedDoc) liveDocs.add(loadedDoc);
      for (const [doc, cleanup] of docCleanups) {
        if (!liveDocs.has(doc)) {
          cleanup();
          docCleanups.delete(doc);
        }
      }
      for (const doc of liveDocs) attachDoc(doc);
      invalidate();
    };

    const observer = new ResizeObserver(invalidate);
    observer.observe(view);
    view.addEventListener('load', refreshDocs);
    view.addEventListener('relocate', refreshDocs);
    view.addEventListener('navigate-start', hide);
    view.renderer.addEventListener('relocate', invalidate);
    view.renderer.addEventListener('scroll', invalidate, { passive: true });
    document.addEventListener('pointermove', hide, { passive: true });
    document.addEventListener('pointerdown', hide, { passive: true, capture: true });
    document.addEventListener('focusin', hide);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', invalidate);
    refreshDocs();
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      for (const cleanup of docCleanups.values()) cleanup();
      view.removeEventListener('load', refreshDocs);
      view.removeEventListener('relocate', refreshDocs);
      view.removeEventListener('navigate-start', hide);
      view.renderer.removeEventListener('relocate', invalidate);
      view.renderer.removeEventListener('scroll', invalidate);
      document.removeEventListener('pointermove', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', hide);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', invalidate);
      root.style.visibility = 'hidden';
    };
  }, [enabled, view, bookFormat, vertical, paused, menuOpen, contextLines, intensity, isEink]);

  if (!enabled || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={rootRef}
      aria-hidden='true'
      data-focus-guide={bookKey}
      className='pointer-events-none fixed z-20 overflow-hidden'
      style={{ visibility: 'hidden', contain: 'strict' }}
    >
      <div ref={upperRef} className='absolute inset-x-0 top-0' />
      <div ref={lowerRef} className='absolute inset-x-0' />
      <div ref={lineRef} className='absolute inset-x-0 top-0' />
    </div>,
    document.body,
  );
};

export default FocusGuide;
