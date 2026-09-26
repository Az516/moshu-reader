import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';

const DESKTOP_HIDE_DELAY = 1600;
const TOUCH_HIDE_DELAY = 4000;
const REVEAL_CLICK_GUARD_DELAY = 700;

/** Chrome overlays a stable viewport; showing controls never repaginates the book. */
export function useReaderChrome(
  root: RefObject<HTMLDivElement | null>,
  view: FoliateView | null | undefined,
) {
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true);
  const revealRef = useRef<() => void>(() => setVisible(true));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let revealClickTimer: ReturnType<typeof setTimeout>;
    let consumeRevealClick = false;
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const docs = new Map<Document, { move: EventListener; touch: EventListener }>();
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
    const move = (y: number) => {
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      if (y < bounds.top + 68 || y > bounds.bottom - 82) reveal();
    };
    const outer = (e: PointerEvent) => move(e.clientY);
    const outerTouch = (event: PointerEvent) => {
      if (!coarsePointer && event.pointerType !== 'touch') return;
      const host = root.current;
      if (host && event.target instanceof Node && host.contains(event.target)) reveal();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Escape') reveal();
    };
    const attach = () => {
      for (const { doc } of view?.renderer.getContents() ?? []) {
        if (docs.has(doc)) continue;
        const moveListener: EventListener = (event) => {
          const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
          if (frame) move(frame.top + (event as PointerEvent).clientY);
        };
        const touchListener: EventListener = (event) => {
          if (coarsePointer || (event as PointerEvent).pointerType === 'touch')
            prepareTouchReveal();
        };
        doc.addEventListener('pointermove', moveListener, { passive: true });
        doc.addEventListener('pointerdown', touchListener, { passive: true });
        docs.set(doc, { move: moveListener, touch: touchListener });
      }
    };
    document.addEventListener('pointermove', outer, { passive: true });
    document.addEventListener('pointerdown', outerTouch, { passive: true });
    document.addEventListener('keydown', key);
    eventDispatcher.onSync('iframe-single-click', consumeIframeRevealClick);
    view?.addEventListener('load', attach);
    attach();
    reveal();
    return () => {
      clearTimeout(timer);
      clearTimeout(revealClickTimer);
      document.removeEventListener('pointermove', outer);
      document.removeEventListener('pointerdown', outerTouch);
      document.removeEventListener('keydown', key);
      eventDispatcher.offSync('iframe-single-click', consumeIframeRevealClick);
      view?.removeEventListener('load', attach);
      for (const [doc, listeners] of docs) {
        doc.removeEventListener('pointermove', listeners.move);
        doc.removeEventListener('pointerdown', listeners.touch);
      }
    };
  }, [view, root]);
  const reveal = useCallback(() => revealRef.current(), []);
  return { visible, reveal };
}
