import { describe, expect, it } from 'vitest';
import { findFocusBand } from './geometry';

describe('focus guide line geometry', () => {
  const lines = [
    { start: 10, end: 26 },
    { start: 36, end: 52 },
    { start: 62, end: 78 },
    { start: 88, end: 104 },
    { start: 114, end: 130 },
  ];

  it('keeps two neighboring lines clear around the current line', () => {
    expect(findFocusBand(lines, 70, 2, 26)).toEqual({
      lineTop: 62,
      lineHeight: 16,
      clearTop: 10,
      clearBottom: 130,
    });
  });

  it('does not jump across whitespace or into an offscreen line', () => {
    expect(findFocusBand(lines, 31, 2, 26)).toBeNull();
    expect(findFocusBand(lines, 600, 2, 26)).toBeNull();
    expect(findFocusBand([], 70, 2, 26)).toBeNull();
  });

  it('preserves clear context at a paragraph boundary', () => {
    expect(findFocusBand([{ start: 120, end: 140 }], 130, 2, 30)).toEqual({
      lineTop: 120,
      lineHeight: 20,
      clearTop: 60,
      clearBottom: 200,
    });
  });

  it('allows a single-line focus and prevents negative surrounding ranges', () => {
    expect(findFocusBand(lines, 70, -1, 26)).toEqual({
      lineTop: 62,
      lineHeight: 16,
      clearTop: 62,
      clearBottom: 78,
    });
  });
});
