import { describe, expect, it } from 'vitest';
import { clampPanels, resizePanels, readPanelSizes } from './panels';

describe('book notes resizable columns', () => {
  it('gives the detail more space when its divider moves left, without changing the directory', () => {
    const before = { navigation: 240, detail: 520 };
    expect(resizePanels(1440, before, 'detail', -120, true)).toEqual({
      navigation: 240,
      detail: 640,
    });
    expect(resizePanels(1440, before, 'navigation', 80, true)).toEqual({
      navigation: 320,
      detail: 520,
    });
  });
  it('keeps the list usable and clamps saved widths after the window shrinks', () => {
    const result = clampPanels(1080, { navigation: 400, detail: 800 }, true);
    expect(result.navigation + result.detail + 16 + 300).toBeLessThanOrEqual(1080);
    expect(result.navigation).toBeGreaterThanOrEqual(172);
    expect(result.detail).toBeGreaterThanOrEqual(360);
    expect(resizePanels(1080, result, 'detail', -1000, true).navigation).toBe(result.navigation);
  });
  it('ignores broken preferences and does not keep impossible widths', () => {
    expect(readPanelSizes('not-json')).toEqual({ navigation: 240, detail: 540 });
    expect(readPanelSizes('{"navigation":-1,"detail":"wide"}')).toEqual({
      navigation: 240,
      detail: 540,
    });
    expect(readPanelSizes('{"navigation":280,"detail":640}')).toEqual({
      navigation: 280,
      detail: 640,
    });
  });
});
