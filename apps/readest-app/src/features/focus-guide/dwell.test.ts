import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDwellController } from './dwell';

describe('sentence dwell reminders', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const candidate = (key = 'sentence', chapter = 'chapter') => ({
    key,
    chapter,
    source: { excerpt: key, chapter },
  });

  it('waits five seconds in the same sentence even while the pointer moves within it', () => {
    const onDwell = vi.fn();
    const dwell = createDwellController(onDwell);
    dwell.hover(candidate());
    vi.advanceTimersByTime(4000);
    dwell.hover(candidate());
    vi.advanceTimersByTime(999);
    expect(onDwell).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDwell).toHaveBeenCalledExactlyOnceWith(candidate().source);
    dwell.cancel();
  });

  it('restarts when the sentence changes and cancels on reader interaction', () => {
    const onDwell = vi.fn();
    const dwell = createDwellController(onDwell);
    dwell.hover(candidate('first'));
    vi.advanceTimersByTime(4000);
    dwell.hover(candidate('second'));
    vi.advanceTimersByTime(4000);
    expect(onDwell).not.toHaveBeenCalled();
    dwell.cancel();
    vi.advanceTimersByTime(5000);
    expect(onDwell).not.toHaveBeenCalled();
    dwell.hover(candidate('second'));
    vi.advanceTimersByTime(5000);
    expect(onDwell).toHaveBeenCalledExactlyOnceWith(candidate('second').source);
  });

  it('applies a sixty-second cooldown immediately after showing a reminder across chapters', () => {
    const onDwell = vi.fn();
    const dwell = createDwellController(onDwell);
    dwell.hover(candidate());
    vi.advanceTimersByTime(5000);
    dwell.cancel();
    dwell.hover(candidate('next', 'next chapter'));
    vi.advanceTimersByTime(59999);
    expect(onDwell).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    dwell.hover(candidate('next', 'next chapter'));
    vi.advanceTimersByTime(5000);
    expect(onDwell).toHaveBeenCalledTimes(2);
  });

  it('shows at most three reminders in each chapter, including when revisiting it', () => {
    const onDwell = vi.fn();
    const dwell = createDwellController(onDwell);
    for (let index = 0; index < 4; index++) {
      dwell.hover(candidate(`sentence ${index}`));
      vi.advanceTimersByTime(65000);
    }
    expect(onDwell).toHaveBeenCalledTimes(3);
    dwell.hover(candidate('other', 'other chapter'));
    vi.advanceTimersByTime(65000);
    expect(onDwell).toHaveBeenCalledTimes(4);
    dwell.hover(candidate('revisited'));
    vi.advanceTimersByTime(65000);
    expect(onDwell).toHaveBeenCalledTimes(4);
  });
});
