import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModianMascot from './ModianMascot';

const preferences = vi.hoisted(() => ({ eink: false }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({ settings: { globalViewSettings: { isEink: preferences.eink } } }),
}));

afterEach(() => {
  cleanup();
  preferences.eink = false;
});

describe('ModianMascot', () => {
  it('uses the matching Xiao Mo pose and keeps decorative images silent', () => {
    const { rerender } = render(<ModianMascot mood='reading' />);
    expect(screen.getByTestId('modian-mascot').getAttribute('src')).toBe('/modian/reading.webp');
    expect(screen.getByTestId('modian-mascot').getAttribute('alt')).toBe('');

    rerender(<ModianMascot mood='research' motion='working' />);
    expect(screen.getByTestId('modian-mascot').getAttribute('src')).toBe('/modian/research.webp');
    expect(screen.getByTestId('modian-mascot').getAttribute('data-motion')).toBe('working');
  });

  it('only offers animation when motion is allowed and keeps the static fallback', () => {
    const { container, rerender } = render(<ModianMascot mood='research' motion='working' />);
    expect(container.querySelector('source')?.getAttribute('srcset')).toBe(
      '/modian/research-motion.webp',
    );
    expect(container.querySelector('source')?.getAttribute('media')).toBe(
      '(prefers-reduced-motion: no-preference)',
    );
    expect(screen.getByTestId('modian-mascot').getAttribute('src')).toBe('/modian/research.webp');

    preferences.eink = true;
    rerender(<ModianMascot mood='research' motion='working' />);
    expect(container.querySelector('source')).toBeNull();

    preferences.eink = false;
    rerender(<ModianMascot mood='research' motion='none' />);
    expect(container.querySelector('source')).toBeNull();
  });
});
