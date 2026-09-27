import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';

const h = vi.hoisted(() => ({
  windowPosition: vi.fn<() => Promise<{ x: number; y: number }>>(),
  setHoveredBookKey: vi.fn(),
  settingsState: { settings: { hardwarePageTurner: undefined } },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false, isMobileApp: false, isAndroidApp: false } }),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/window', () => ({ tauriGetWindowLogicalPosition: h.windowPosition }));
vi.mock('@/utils/bridge', () => ({ refreshEinkScreen: vi.fn() }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: () => ({ disableClick: false, readingRulerEnabled: false }),
      getViewState: () => ({ inited: true }),
      hoveredBookKey: null,
      setHoveredBookKey: h.setHoveredBookKey,
    }),
    { getState: () => ({ hoveredBookKey: null }) },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({}) }),
}));
vi.mock('@/store/deviceStore', () => ({ useDeviceControlStore: () => ({}) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (select: (state: typeof h.settingsState) => unknown) => select(h.settingsState),
    { getState: () => h.settingsState },
  ),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: { getState: () => ({ sideBarBookKey: 'book' }) },
}));
vi.mock('@/app/reader/hooks/useTouchInterceptor', () => ({ useTouchInterceptor: () => {} }));

import { usePagination } from '@/app/reader/hooks/usePagination';
import { eventDispatcher } from '@/utils/event';

describe('iframe click consumers before native pagination coordinates', () => {
  const consumer = vi.fn<(event: CustomEvent) => boolean>();
  const setup = () => {
    const view = { renderer: { scrolled: false }, next: vi.fn(), prev: vi.fn() };
    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
    const { result } = renderHook(() =>
      usePagination('book', { current: view as unknown as FoliateView }, { current: container }),
    );
    return { result, view };
  };
  const click = (bookKey = 'book') =>
    new MessageEvent('message', {
      data: {
        type: 'iframe-single-click',
        bookKey,
        clientX: 420,
        clientY: 200,
        screenX: 1000,
        screenY: 240,
      },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    consumer.mockReturnValue(false);
    h.windowPosition.mockResolvedValue({ x: 100, y: 40 });
    eventDispatcher.onSync('iframe-single-click', consumer);
  });
  afterEach(() => {
    eventDispatcher.offSync('iframe-single-click', consumer);
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps local text interactions working when the native coordinate API would reject', async () => {
    consumer.mockReturnValue(true);
    h.windowPosition.mockRejectedValue(new Error('native window position unavailable'));
    const { result, view } = setup();
    await act(async () => {
      await expect(result.current.handlePageFlip(click())).resolves.toBeUndefined();
    });
    expect(consumer).toHaveBeenCalledTimes(1);
    expect(consumer.mock.calls[0]?.[0].detail).toMatchObject({
      bookKey: 'book',
      clientX: 420,
      clientY: 200,
    });
    expect(h.windowPosition).not.toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
    expect(h.setHoveredBookKey).not.toHaveBeenCalled();
  });

  it('still resolves native coordinates and turns the page for an unconsumed click', async () => {
    const { result, view } = setup();
    await act(async () => {
      await result.current.handlePageFlip(click());
    });
    expect(consumer).toHaveBeenCalledTimes(1);
    expect(h.windowPosition).toHaveBeenCalledTimes(1);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(view.prev).not.toHaveBeenCalled();
  });

  it('does not offer another book’s click to consumers or native pagination', async () => {
    const { result, view } = setup();
    await act(async () => {
      await result.current.handlePageFlip(click('other-book'));
    });
    expect(consumer).not.toHaveBeenCalled();
    expect(h.windowPosition).not.toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });
});
