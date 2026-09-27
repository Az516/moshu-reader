export interface PanelSizes {
  navigation: number;
  detail: number;
}

export const defaultPanelSizes: PanelSizes = { navigation: 240, detail: 540 };
export const COMPACT_WIDTH = 1000;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function readPanelSizes(stored: string | null): PanelSizes {
  try {
    const value: unknown = JSON.parse(stored || 'null');
    if (
      value &&
      typeof value === 'object' &&
      'navigation' in value &&
      'detail' in value &&
      typeof value.navigation === 'number' &&
      Number.isFinite(value.navigation) &&
      value.navigation >= 172 &&
      typeof value.detail === 'number' &&
      Number.isFinite(value.detail) &&
      value.detail >= 360
    )
      return { navigation: Math.min(420, value.navigation), detail: Math.min(1200, value.detail) };
  } catch {
    /* Invalid preferences do not affect the notes themselves. */
  }
  return { ...defaultPanelSizes };
}

export function clampPanels(width: number, sizes: PanelSizes, hasDetail: boolean): PanelSizes {
  const fullDetail = hasDetail && width >= COMPACT_WIDTH;
  const navigation = clamp(
    sizes.navigation,
    172,
    Math.min(420, width - (fullDetail ? 360 : 0) - 300 - 16),
  );
  const detail = fullDetail
    ? clamp(sizes.detail, 360, width - navigation - 300 - 16)
    : sizes.detail;
  return { navigation, detail };
}

export function resizePanels(
  width: number,
  sizes: PanelSizes,
  edge: keyof PanelSizes,
  delta: number,
  hasDetail: boolean,
): PanelSizes {
  const current = clampPanels(width, sizes, hasDetail);
  if (edge === 'navigation') {
    const maximum = width - (hasDetail && width >= COMPACT_WIDTH ? current.detail : 0) - 300 - 16;
    return {
      ...current,
      navigation: clamp(current.navigation + delta, 172, Math.min(420, maximum)),
    };
  }
  return {
    ...current,
    detail: clamp(current.detail - delta, 360, width - current.navigation - 300 - 16),
  };
}
