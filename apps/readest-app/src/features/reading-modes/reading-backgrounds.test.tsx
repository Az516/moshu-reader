import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useThemeStore } from '@/store/themeStore';
import { getThemeCode } from '@/utils/style';
import { themes, themeVariables } from '@/styles/themes';
import { ReadingBackgroundOptions } from './ReadingBackgroundMenu';

const initialTheme = useThemeStore.getState();
const originalPath = window.location.pathname;
const choices = [
  ['纯白', '#ffffff'],
  ['淡米白', '#faf8f3'],
  ['冷白', '#f5f7fa'],
  ['雾灰', '#eff0f1'],
  ['灰绿', '#edf3ed'],
  ['淡青', '#edf5f3'],
  ['雾蓝', '#eef3f8'],
  ['浅紫', '#f3eff8'],
  ['淡粉', '#faf0f2'],
  ['夜间', '#222222'],
] as const;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/reader/synthetic-book');
  useThemeStore.setState(initialTheme, true);
  useThemeStore.getState().setThemeScope('reader');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, '', originalPath);
  useThemeStore.setState(initialTheme, true);
});

describe('reading paper colors', () => {
  it.each(
    choices,
  )('%s uses the same persisted palette for swatch, shell and book content', (label, hex) => {
    render(<ReadingBackgroundOptions onCustom={() => {}} />);
    const option = screen.getByRole('radio', { name: label });
    fireEvent.click(option);
    expect(option.getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
    const { readerThemeColor, readerThemeMode, themeCode } = useThemeStore.getState();
    expect(localStorage.getItem('themeColor')).toBe(readerThemeColor);
    expect(localStorage.getItem('themeMode')).toBe(readerThemeMode);
    const theme = themes.find(({ name }) => name === readerThemeColor)!;
    const scheme = readerThemeMode === 'dark' ? 'dark' : 'light';
    expect(themeVariables(theme.colors[scheme], scheme)['--color-base-100']).toBe(hex);
    expect(themeCode.bg).toBe(hex);
    expect(getThemeCode().bg).toBe(hex);
    const expected = document.createElement('span');
    expected.style.background = hex;
    expect((option.querySelector('.moshu-paper-swatch') as HTMLElement).style.background).toBe(
      expected.style.background,
    );
  });

  it('leaves established Sepia/Grass palettes and custom colors unchanged', () => {
    expect(themes.find(({ name }) => name === 'sepia')?.colors.light['base-100']).toBe('#f1e8d0');
    expect(themes.find(({ name }) => name === 'grass')?.colors.light['base-100']).toBe('#d7dbbd');
    localStorage.setItem(
      'customThemes',
      JSON.stringify([
        {
          name: 'my-paper',
          label: 'My paper',
          colors: {
            light: { bg: '#abcdef', fg: '#111111', primary: '#0066cc' },
            dark: { bg: '#181818', fg: '#ffffff', primary: '#77bbee' },
          },
        },
      ]),
    );
    useThemeStore.getState().setScopedThemeMode('reader', 'light');
    useThemeStore.getState().setScopedThemeColor('reader', 'my-paper');
    expect(getThemeCode().bg).toBe('#abcdef');
  });
});
