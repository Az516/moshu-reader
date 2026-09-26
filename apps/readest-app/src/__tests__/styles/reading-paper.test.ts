import { afterEach, describe, expect, it } from 'vitest';
import { getThemeCode } from '@/utils/style';

afterEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('阅读页默认纸色', () => {
  it('默认阅读画布与墨书外框均为纯白', () => {
    window.history.replaceState({}, '', '/reader/book');
    localStorage.setItem('themeMode', 'light');
    expect(getThemeCode()).toMatchObject({ bg: '#ffffff', fg: '#171717' });
  });

  it('保留明确选择的配色、夜间模式和书库配色', () => {
    window.history.replaceState({}, '', '/reader/book');
    localStorage.setItem('themeColor', 'sepia');
    expect(getThemeCode().bg).toBe('#f1e8d0');
    localStorage.setItem('themeColor', 'default');
    localStorage.setItem('themeMode', 'dark');
    expect(getThemeCode().bg).toBe('#222222');
    localStorage.setItem('themeMode', 'light');
    window.history.replaceState({}, '', '/library');
    expect(getThemeCode().bg).toBe('#ffffff');
  });
});
