import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useThemeStore } from '@/store/themeStore';
import ThematicAppearance from './ThematicAppearance';

const initialTheme = useThemeStore.getState();

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState(initialTheme, true);
  useThemeStore.getState().setThemeScope('reader');
  useThemeStore.getState().setScopedThemeMode('reader', 'auto');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  useThemeStore.setState(initialTheme, true);
});

describe('ThematicAppearance', () => {
  it('persists all three reader choices without changing an explicit library preference', () => {
    useThemeStore.getState().setScopedThemeMode('library', 'dark');
    useThemeStore.getState().setThemeScope('library');
    render(<ThematicAppearance />);

    expect(screen.getByRole('radiogroup', { name: '主题外观' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe(
      'true',
    );

    for (const [label, mode] of [
      ['亮色', 'light'],
      ['暗色', 'dark'],
      ['跟随系统', 'auto'],
    ]) {
      const option = screen.getByRole('radio', { name: label });
      expect(option.textContent).toBe(label);
      fireEvent.click(option);
      expect(useThemeStore.getState().readerThemeMode).toBe(mode);
      expect(localStorage.getItem('themeMode')).toBe(mode);
      expect(useThemeStore.getState().libraryThemeMode).toBe('dark');
      expect(localStorage.getItem('libraryThemeMode')).toBe('dark');
      expect(option.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('supports one Tab stop, wrapping arrow keys, Home and End', () => {
    render(<ThematicAppearance />);
    const light = screen.getByRole('radio', { name: '亮色' });
    const dark = screen.getByRole('radio', { name: '暗色' });
    const auto = screen.getByRole('radio', { name: '跟随系统' });
    expect([light.tabIndex, dark.tabIndex, auto.tabIndex]).toEqual([-1, -1, 0]);
    auto.focus();
    fireEvent.keyDown(auto, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(light);
    expect(localStorage.getItem('themeMode')).toBe('light');
    expect([light.tabIndex, dark.tabIndex, auto.tabIndex]).toEqual([0, -1, -1]);
    fireEvent.keyDown(light, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(auto);
    fireEvent.keyDown(auto, { key: 'Home' });
    expect(document.activeElement).toBe(light);
    fireEvent.keyDown(light, { key: 'End' });
    expect(document.activeElement).toBe(auto);
    expect(localStorage.getItem('themeMode')).toBe('auto');
  });

  it('keeps automatic preference selected while the existing system theme handler changes appearance', () => {
    render(<ThematicAppearance />);
    act(() => useThemeStore.getState().handleSystemThemeChange(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('default-dark');
    expect(screen.getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(localStorage.getItem('themeMode')).toBe('auto');
    act(() => useThemeStore.getState().handleSystemThemeChange(false));
    expect(document.documentElement.getAttribute('data-theme')).toBe('default-light');
  });
});
