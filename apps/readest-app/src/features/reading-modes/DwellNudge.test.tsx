import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import DwellNudge from './DwellNudge';

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({ settings: { globalViewSettings: { isEink: false } } }),
}));

describe('anchored Xiao Mo dwell reminder', () => {
  const anchor = { x: 400, y: 300, lineTop: 288, lineBottom: 316 };
  let view: FoliateView;
  let frame: HTMLIFrameElement;
  let onDismiss: ReturnType<typeof vi.fn<() => void>>;
  let onOpen: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onDismiss = vi.fn();
    onOpen = vi.fn();
    view = document.createElement('div') as unknown as FoliateView;
    frame = document.createElement('iframe');
    view.appendChild(frame);
    document.body.appendChild(view);
    const renderer = document.createElement('div') as unknown as FoliateView['renderer'];
    Object.assign(renderer, { getContents: () => [{ doc: frame.contentDocument!, index: 0 }] });
    Object.assign(view, { renderer });
    vi.spyOn(view, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 800, 600));
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 120, 760, 560));
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLButtonElement,
    ) {
      return new DOMRect(
        Number.parseFloat(this.style.left) || 0,
        Number.parseFloat(this.style.top) || 0,
        176,
        44,
      );
    });
  });

  afterEach(() => {
    cleanup();
    view.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mount = (overrides: Partial<Parameters<typeof DwellNudge>[0]> = {}) =>
    render(
      <DwellNudge
        anchor={anchor}
        view={view}
        sequence={0}
        onDismiss={onDismiss}
        onOpen={onOpen}
        {...overrides}
      />,
    );

  it('shows the static mascot beside the stopped line and rotates copy only per appearance', () => {
    vi.useFakeTimers();
    const { rerender } = mount();
    const button = screen.getByRole('button', { name: '小墨停留提醒' });
    expect(button.textContent).toBe('走神了？');
    expect(screen.getByTestId('modian-mascot').getAttribute('src')).toBe('/modian/question.webp');
    expect(screen.getByTestId('modian-mascot').getAttribute('data-motion')).toBe('none');
    expect(button.querySelector('source')).toBeNull();
    expect(Number.parseFloat(button.style.top)).toBeGreaterThan(anchor.lineBottom);
    expect(Number.parseFloat(button.style.left)).toBeGreaterThan(anchor.x);
    act(() => vi.advanceTimersByTime(20000));
    expect(button.textContent).toBe('走神了？');
    rerender(
      <DwellNudge anchor={anchor} view={view} sequence={1} onDismiss={onDismiss} onOpen={onOpen} />,
    );
    expect(button.textContent).toBe('在想什么呢？');
    rerender(
      <DwellNudge anchor={anchor} view={view} sequence={5} onDismiss={onDismiss} onOpen={onOpen} />,
    );
    expect(button.textContent).toBe('走神了？');
  });

  it('flips above the line and stays inside the reader when near the lower right edge', () => {
    mount({ anchor: { x: 886, y: 679, lineTop: 664, lineBottom: 692 } });
    const button = screen.getByRole('button', { name: '小墨停留提醒' });
    const box = button.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(888);
    expect(box.bottom).toBeLessThan(664);
    expect(box.left).toBeGreaterThanOrEqual(112);
  });

  it('dismisses on movement to other text, even on the same line', () => {
    mount();
    fireEvent.mouseMove(document, { clientX: 422, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 440, clientY: 300 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps the short direct path into the reminder clickable, then dismisses when leaving it', () => {
    mount();
    const button = screen.getByRole('button', { name: '小墨停留提醒' });
    const box = button.getBoundingClientRect();
    fireEvent.mouseMove(document, {
      clientX: (anchor.x + box.left + 18) / 2,
      clientY: (anchor.y + box.top + 18) / 2,
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseMove(button, { clientX: box.left + 24, clientY: box.top + 20 });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseMove(document, { clientX: anchor.x, clientY: anchor.y });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['middle of the text', 0.5],
    ['far end of the text', 0.94],
  ])('keeps a stepwise path to the %s clickable', (_name, targetFraction) => {
    mount();
    const button = screen.getByRole('button', { name: '小墨停留提醒' });
    const box = button.getBoundingClientRect();
    const targetX = box.left + box.width * Number(targetFraction);
    const targetY = box.top + box.height / 2;
    for (let step = 1; step <= 10; step++) {
      const clientX = anchor.x + ((targetX - anchor.x) * step) / 10;
      const clientY = anchor.y + ((targetY - anchor.y) * step) / 10;
      fireEvent.mouseMove(clientY >= box.top ? button : document, { clientX, clientY });
      expect(onDismiss, `step ${step}`).not.toHaveBeenCalled();
    }
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('dismisses when the pointer reverses from the corridor back toward the book', () => {
    mount();
    fireEvent.mouseMove(document, { clientX: 420.4, clientY: 309.2 });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseMove(document, { clientX: anchor.x, clientY: anchor.y });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps a fractional pointer path when compatibility mouse events round the same positions', () => {
    mount();
    const button = screen.getByRole('button', { name: '小墨停留提醒' });
    const box = button.getBoundingClientRect();
    const targetX = box.left + box.width / 2;
    const targetY = box.top + box.height / 2;
    for (let step = 1; step <= 8; step++) {
      const clientX = anchor.x + ((targetX - anchor.x) * step) / 8;
      const clientY = anchor.y + ((targetY - anchor.y) * step) / 8;
      const target = clientY >= box.top ? button : document;
      const pointer = new Event('pointermove', { bubbles: true });
      Object.assign(pointer, { clientX, clientY });
      fireEvent(target, pointer);
      fireEvent.mouseMove(target, {
        clientX: Math.floor(clientX),
        clientY: Math.floor(clientY),
      });
      expect(onDismiss, `step ${step}`).not.toHaveBeenCalled();
    }
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('converts iframe pointer positions before deciding whether reading has resumed', () => {
    mount();
    fireEvent.mouseMove(frame.contentDocument!, { clientX: 280, clientY: 180 });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseMove(frame.contentDocument!, { clientX: 308, clientY: 180 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it.each([
    'wheel',
    'scroll',
    'relocate',
    'navigate-start',
  ])('dismisses on %s without needing pointer movement', (eventName) => {
    mount();
    fireEvent(
      eventName === 'wheel' || eventName === 'scroll' ? frame.contentDocument! : view,
      new Event(eventName),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape and detaches listeners when unmounted', () => {
    const { unmount } = mount();
    fireEvent.keyDown(frame.contentDocument!, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    unmount();
    onDismiss.mockClear();
    fireEvent.mouseMove(document, { clientX: 800, clientY: 100 });
    fireEvent(frame.contentDocument!, new Event('wheel'));
    fireEvent(view, new Event('relocate'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('attaches dismissal to newly loaded renderer documents and handles window blur', () => {
    mount();
    const secondFrame = document.createElement('iframe');
    view.appendChild(secondFrame);
    fireEvent(view, new CustomEvent('load', { detail: { doc: secondFrame.contentDocument! } }));
    fireEvent(secondFrame.contentDocument!, new Event('wheel'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
    onDismiss.mockClear();
    mount();
    fireEvent(window, new Event('blur'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
