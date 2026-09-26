import { describe, expect, it, vi } from 'vitest';
import { applyReadingLayout } from './layout';
import type { FoliateView } from '@/types/view';

describe('reading layout transaction', () => {
  it('suspends marks, applies a complete layout, and restores the text anchor before resuming', async () => {
    const events: string[] = [];
    const renderer = document.createElement('div');
    Object.assign(renderer, {
      render: vi.fn(async () => {
        events.push('render');
      }),
    });
    const view = document.createElement('div') as unknown as FoliateView;
    Object.assign(view, {
      renderer,
      lastLocation: { cfi: 'epubcfi(/6/4!/4/2:80)' },
      goTo: vi.fn(async (cfi: string) => {
        events.push(cfi);
      }),
    });
    view.addEventListener('reading-layout-start', () => events.push('start'));
    view.addEventListener('reading-layout-end', () => events.push('end'));
    await applyReadingLayout(view, 'none');
    expect(events).toEqual(['start', 'render', 'epubcfi(/6/4!/4/2:80)', 'end']);
    expect(renderer.getAttribute('max-column-count')).toBe('1');
    expect(renderer.getAttribute('flow')).toBe('paginated');
    expect(view.hasAttribute('data-reading-layout')).toBe(false);
  });
});
