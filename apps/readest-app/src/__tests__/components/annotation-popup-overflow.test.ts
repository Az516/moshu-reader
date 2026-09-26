import { describe, expect, it } from 'vitest';
import { countToolbarButtonsThatFit } from '@/app/reader/components/annotator/AnnotationPopup';

describe('annotation toolbar overflow', () => {
  it('shows every action when the translated controls fit', () => {
    expect(countToolbarButtonsThatFit([96, 68, 68, 36], 280, 36)).toBe(4);
  });

  it('reserves a More button and keeps the remaining actions reachable there', () => {
    // 96 + 68 + 68 + 36 plus gaps cannot fit. Reserving a 36px More button
    // leaves room for the two leading actions without wrapping either label.
    expect(countToolbarButtonsThatFit([96, 68, 68, 36], 220, 36)).toBe(2);
  });

  it('falls back to More alone in an extremely narrow split-view cell', () => {
    expect(countToolbarButtonsThatFit([110, 70], 44, 36)).toBe(0);
  });
});
