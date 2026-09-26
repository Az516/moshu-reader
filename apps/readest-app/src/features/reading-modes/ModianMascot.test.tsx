import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ModianMascot from './ModianMascot';

afterEach(cleanup);

describe('ModianMascot', () => {
  it('uses the matching Xiao Mo pose and keeps decorative images silent', () => {
    const { rerender } = render(<ModianMascot mood='reading' />);
    expect(screen.getByTestId('modian-mascot').getAttribute('src')).toBe('/modian/reading.webp');
    expect(screen.getByTestId('modian-mascot').getAttribute('alt')).toBe('');

    rerender(<ModianMascot mood='research' motion='working' />);
    expect(screen.getByTestId('modian-mascot').getAttribute('src')).toBe('/modian/research.webp');
    expect(screen.getByTestId('modian-mascot').getAttribute('data-motion')).toBe('working');
  });
});
