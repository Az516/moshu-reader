'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { FoliateView } from '@/types/view';
import ModianMascot from './ModianMascot';
import './dwell-nudge.css';

export interface DwellAnchor {
  x: number;
  y: number;
  lineTop: number;
  lineBottom: number;
}

interface DwellNudgeProps {
  anchor: DwellAnchor;
  view: FoliateView | null | undefined;
  sequence: number;
  onOpen: () => void;
  onDismiss: () => void;
}

const phrases = [
  '走神了？',
  '在想什么呢？',
  '这句想聊聊吗？',
  '要不要留个疑问？',
  '慢慢来，我在。',
];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A small stationary invitation: moving on with the book makes it disappear. */
export default function DwellNudge({ anchor, view, sequence, onOpen, onDismiss }: DwellNudgeProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<DOMRect | null>(null);
  const dismissRef = useRef(onDismiss);
  const { x, y, lineTop, lineBottom } = anchor;
  const phrase = phrases[((sequence % phrases.length) + phrases.length) % phrases.length];

  useLayoutEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const position = () => {
      const viewport = window.visualViewport;
      const visibleLeft = viewport?.offsetLeft ?? 0;
      const visibleTop = viewport?.offsetTop ?? 0;
      const visibleRight = visibleLeft + (viewport?.width ?? window.innerWidth);
      const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
      const reader = view?.getBoundingClientRect();
      const useReader = reader && reader.width > 120 && reader.height > 80;
      const left = Math.max(visibleLeft, useReader ? reader.left : visibleLeft) + 12;
      const right = Math.min(visibleRight, useReader ? reader.right : visibleRight) - 12;
      const top = Math.max(visibleTop, useReader ? reader.top : visibleTop) + 12;
      const bottom = Math.min(visibleBottom, useReader ? reader.bottom : visibleBottom) - 12;
      button.style.maxWidth = `${Math.max(1, right - left)}px`;
      const { width, height } = button.getBoundingClientRect();
      const below = Math.max(lineBottom, y) + 8;
      const above = Math.min(lineTop, y) - height - 8;
      const nextTop = below + height <= bottom ? below : above;
      const nextLeft = clamp(x + 14, left, right - width);
      const safeTop = clamp(nextTop, top, bottom - height);
      button.style.left = `${nextLeft}px`;
      button.style.top = `${safeTop}px`;
      button.style.visibility = 'visible';
      boxRef.current = new DOMRect(nextLeft, safeTop, width, height);
    };
    position();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : null;
    observer?.observe(button);
    return () => observer?.disconnect();
  }, [x, y, lineTop, lineBottom, view, sequence]);

  useEffect(() => {
    let dismissed = false;
    let reachedButton = false;
    let transitProgress = 0;
    const cleanups = new Map<Document, () => void>();
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      dismissRef.current();
    };
    const isButtonEvent = (event: Event) => {
      const button = buttonRef.current;
      return button !== null && event.composedPath().includes(button);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    const pointerdown = (event: Event) => {
      if (!isButtonEvent(event)) dismiss();
    };
    const listen = (doc: Document) => {
      if (cleanups.has(doc)) return;
      const move = (event: MouseEvent) => {
        if (dismissed) return;
        if (isButtonEvent(event)) {
          reachedButton = true;
          return;
        }
        const frame = doc === document ? null : doc.defaultView?.frameElement;
        const offset = frame?.getBoundingClientRect();
        const pointX = event.clientX + (offset?.left ?? 0);
        const pointY = event.clientY + (offset?.top ?? 0);
        const dx = pointX - x;
        const dy = pointY - y;
        if (!reachedButton && transitProgress === 0 && Math.hypot(dx, dy) <= 2) return;
        const box = boxRef.current;
        if (!reachedButton && box) {
          // Fan out only through the gap to the button's facing edge. This
          // admits a direct trip to either the mascot or any part of its text,
          // while a sideways reading motion immediately leaves the corridor.
          const edgeY = y < box.top ? box.top : box.bottom;
          const progress = edgeY === y ? 1 : dy / (edgeY - y);
          const corridorLeft = x + (box.left - x) * progress - 3;
          const corridorRight = x + (box.right - x) * progress + 3;
          // Compatibility mouse events round the same pointer coordinates.
          // Use a pixel tolerance so a short gap cannot magnify that rounding
          // into a false reversal; actual movement back toward the book exits.
          const progressTolerance = 2 / Math.max(1, Math.abs(edgeY - y));
          if (
            progress >= transitProgress - progressTolerance &&
            progress <= 1 &&
            pointX >= corridorLeft &&
            pointX <= corridorRight
          ) {
            transitProgress = Math.max(transitProgress, progress);
            return;
          }
        }
        dismiss();
      };
      doc.addEventListener('pointermove', move, { passive: true, capture: true });
      doc.addEventListener('mousemove', move, { passive: true, capture: true });
      doc.addEventListener('pointerdown', pointerdown, true);
      doc.addEventListener('wheel', dismiss, { passive: true, capture: true });
      doc.addEventListener('scroll', dismiss, { passive: true, capture: true });
      doc.addEventListener('keydown', keydown, true);
      cleanups.set(doc, () => {
        doc.removeEventListener('pointermove', move, true);
        doc.removeEventListener('mousemove', move, true);
        doc.removeEventListener('pointerdown', pointerdown, true);
        doc.removeEventListener('wheel', dismiss, true);
        doc.removeEventListener('scroll', dismiss, true);
        doc.removeEventListener('keydown', keydown, true);
      });
    };
    const refresh = (event?: Event) => {
      const loaded = (event as CustomEvent<{ doc?: Document }> | undefined)?.detail?.doc;
      if (loaded) listen(loaded);
      for (const { doc } of view?.renderer.getContents() ?? []) listen(doc);
    };
    const visibility = () => {
      if (document.hidden) dismiss();
    };
    listen(document);
    refresh();
    view?.addEventListener('load', refresh);
    view?.addEventListener('relocate', dismiss);
    view?.addEventListener('navigate-start', dismiss);
    view?.addEventListener('reading-layout-start', dismiss);
    view?.renderer.addEventListener('scroll', dismiss);
    view?.renderer.addEventListener('relocate', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      for (const cleanup of cleanups.values()) cleanup();
      view?.removeEventListener('load', refresh);
      view?.removeEventListener('relocate', dismiss);
      view?.removeEventListener('navigate-start', dismiss);
      view?.removeEventListener('reading-layout-start', dismiss);
      view?.renderer.removeEventListener('scroll', dismiss);
      view?.renderer.removeEventListener('relocate', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [x, y, view, sequence]);

  return (
    <button
      ref={buttonRef}
      type='button'
      className='moshu-dwell-anchor eink-bordered'
      data-moshu-dwell-nudge
      aria-label='小墨停留提醒'
      title='和小墨聊聊，或留个疑问'
      onClick={onOpen}
    >
      <ModianMascot mood='question' motion='none' size={30} />
      <span>{phrase}</span>
    </button>
  );
}
