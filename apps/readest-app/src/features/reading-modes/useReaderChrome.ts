import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { useDropdownContext } from '@/context/DropdownContext';

const DESKTOP_HIDE_DELAY = 1600;
const TOUCH_HIDE_DELAY = 4000;
const REVEAL_CLICK_GUARD_DELAY = 700;

/** Chrome overlays a stable viewport; showing controls never repaginates the book. */
export function useReaderChrome(
  root: RefObject<HTMLDivElement | null>,
  view: FoliateView | null | undefined,
) {
  const menuOpen = Boolean(useDropdownContext()?.openDropdownId);
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true);
  const revealRef = useRef<() => void>(() => setVisible(true));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let revealClickTimer: ReturnType<typeof setTimeout>;
    let consumeRevealClick = false;
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const docs = new Map<Document, EventListener>();
    const reveal = () => {
      clearTimeout(timer);
      visibleRef.current = true;
      setVisible(true);
      timer = setTimeout(
        () => {
          visibleRef.current = false;
          setVisible(false);
        },
        coarsePointer ? TOUCH_HIDE_DELAY : DESKTOP_HIDE_DELAY,
      );
    };
    const prepareTouchReveal = () => {
      clearTimeout(revealClickTimer);
      consumeRevealClick = !visibleRef.current;
      if (consumeRevealClick)
        revealClickTimer = setTimeout(() => {
          consumeRevealClick = false;
        }, REVEAL_CLICK_GUARD_DELAY);
      reveal();
    };
    const consumeIframeRevealClick = () => {
      if (!consumeRevealClick) return false;
      clearTimeout(revealClickTimer);
      consumeRevealClick = false;
      return true;
    };
    revealRef.current = reveal;
    const outerTouch = (event: PointerEvent) => {
      if (!coarsePointer && event.pointerType !== 'touch') return;
      const host = root.current;
      if (host && event.target instanceof Node && host.contains(event.target)) reveal();
    };
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.key !== 'Tab' && e.key !== 'Escape')) return;
      const target = e.target as Element | null;
      if (
        e.key === 'Escape' &&
        target?.nodeType === Node.ELEMENT_NODE &&
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        )
      )
        return;
      reveal();
    };
    const attach = () => {
      for (const { doc } of view?.renderer.getContents() ?? []) {
        if (docs.has(doc)) continue;
        const touchListener: EventListener = (event) => {
          if (coarsePointer || (event as PointerEvent).pointerType === 'touch')
            prepareTouchReveal();
        };
        doc.addEventListener('pointerdown', touchListener, { passive: true });
        doc.addEventListener('keydown', key);
        docs.set(doc, touchListener);
      }
    };
    document.addEventListener('pointerdown', outerTouch, { passive: true });
    document.addEventListener('keydown', key);
    eventDispatcher.onSync('iframe-single-click', consumeIframeRevealClick);
    view?.addEventListener('load', attach);
    attach();
    reveal();
    return () => {
      clearTimeout(timer);
      clearTimeout(revealClickTimer);
      document.removeEventListener('pointerdown', outerTouch);
      document.removeEventListener('keydown', key);
      eventDispatcher.offSync('iframe-single-click', consumeIframeRevealClick);
      view?.removeEventListener('load', attach);
      for (const [doc, touchListener] of docs) {
        doc.removeEventListener('pointerdown', touchListener);
        doc.removeEventListener('keydown', key);
      }
    };
  }, [view, root]);
  const reveal = useCallback(() => revealRef.current(), []);
  // Mouse-opened menus do not reliably receive focus in WebKit.
  return { visible: visible || menuOpen, reveal };
}
