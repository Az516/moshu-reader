import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadingBackgroundOptions } from './ReadingBackgroundMenu';

const mocks = vi.hoisted(() => ({
  setMode: vi.fn(),
  setColor: vi.fn(),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: (selector: (state: unknown) => unknown) =>
    selector({
      readerThemeMode: 'light',
      readerThemeColor: 'paper-ivory',
      setScopedThemeMode: mocks.setMode,
      setScopedThemeColor: mocks.setColor,
    }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReadingBackgroundOptions', () => {
  it('shows clear paper choices and applies them to the reader scope', () => {
    const close = vi.fn();
    render(<ReadingBackgroundOptions onCustom={vi.fn()} setIsDropdownOpen={close} />);
    const labels = [
      '纯白',
      '淡米白',
      '冷白',
      '雾灰',
      '灰绿',
      '淡青',
      '雾蓝',
      '浅紫',
      '淡粉',
      '夜间',
    ];

    for (const label of labels) {
      const option = screen.getByRole('radio', { name: label });
      expect(option.getAttribute('aria-label')).toBe(label);
      expect(option.getAttribute('title')).toBe(label);
      expect(option.getAttribute('aria-checked')).toBe(String(label === '淡米白'));
    }

    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(labels.length);

    fireEvent.click(screen.getByRole('radio', { name: '纯白' }));
    expect(mocks.setMode).toHaveBeenCalledWith('reader', 'light');
    expect(mocks.setColor).toHaveBeenCalledWith('reader', 'default');
    expect(close).toHaveBeenCalledWith(false);
  });

  it('opens the full theme editor for a custom background', () => {
    const onCustom = vi.fn();
    render(<ReadingBackgroundOptions onCustom={onCustom} />);
    fireEvent.click(screen.getByRole('button', { name: '自定义颜色' }));
    expect(onCustom).toHaveBeenCalledOnce();
  });
});
