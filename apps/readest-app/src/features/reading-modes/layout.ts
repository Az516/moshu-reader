import type { FoliateView } from '@/types/view';

/** A layout change preserves a text anchor, never a page number from the old pagination. */
export async function applyReadingLayout(view: FoliateView, spread: 'none' | 'auto') {
  const anchor = view.lastLocation?.cfi;
  view.setAttribute('data-reading-layout', '');
  view.dispatchEvent(new Event('reading-layout-start'));
  try {
    view.renderer.setAttribute('flow', 'paginated');
    view.renderer.setAttribute('spread', spread);
    view.renderer.setAttribute('max-column-count', spread === 'none' ? 1 : 2);
    await view.renderer.render?.();
    if (anchor) await view.goTo(anchor);
  } finally {
    view.removeAttribute('data-reading-layout');
    view.dispatchEvent(new Event('reading-layout-end'));
  }
}
