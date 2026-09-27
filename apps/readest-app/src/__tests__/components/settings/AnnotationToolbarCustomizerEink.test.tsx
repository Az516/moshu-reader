import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, within, waitFor, act } from '@testing-library/react';
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { DEFAULT_ANNOTATION_TOOLBAR_ITEMS } from '@/utils/annotationToolbar';

/**
 * Regression guard for issue #4839 (display error under e-ink mode).
 *
 * The Customize Toolbar sub-page renders a content-width *preview* of the live
 * selection popup. The preview surface uses `bg-gray-600 text-white` to mirror
 * the real popup — but unlike the real popup (which earns its e-ink treatment
 * from `.popup-container` in globals.css), the preview Zone is a plain div. With
 * no e-ink override, the dark fill survives under `[data-eink='true']` and the
 * whole row paints as an unreadable solid black bar.
 *
 * Invariant: the toolbar preview must carry `eink-bordered`, so e-ink swaps the
 * dark fill for a `base-100` surface with a 1px `base-content` border — matching
 * how the annotation toolbar renders in the reader.
 */

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => undefined }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: { annotationToolbarItems: undefined } },
  }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));

vi.mock('@/utils/share', () => ({
  canShareText: () => true,
}));

vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));

import AnnotationToolbarCustomizer from '@/components/settings/AnnotationToolbarCustomizer';

beforeEach(() => {
  vi.mocked(saveViewSettings).mockReset().mockResolvedValue(undefined);
  vi.mocked(eventDispatcher.dispatch).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('AnnotationToolbarCustomizer e-ink toolbar preview', () => {
  it('marks the toolbar preview eink-bordered so e-ink swaps the dark fill for a bordered base-100 surface', () => {
    const { container } = render(<AnnotationToolbarCustomizer bookKey='test' onBack={() => {}} />);
    const toolbarPreview = container.querySelector('.selection-popup') as HTMLElement;
    expect(toolbarPreview).not.toBeNull();
    expect(toolbarPreview.classList.contains('eink-bordered')).toBe(true);
  });

  /**
   * The preview surface mirrors the real popup's theme-aware fill
   * (`bg-base-300`, `base-100` under dark themes), so it is *light* on light
   * themes. A hardcoded white empty-state hint only worked against the old
   * fixed dark `bg-gray-600` fill and would be unreadable now.
   */
  it('keeps the empty-toolbar hint readable against the theme-aware preview surface', async () => {
    const { getByText } = render(<AnnotationToolbarCustomizer bookKey='test' onBack={() => {}} />);
    fireEvent.click(getByText('Clear all'));
    const hint = getByText('No tools, drag one here');
    expect(hint.className).not.toMatch(/text-white/);
    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledTimes(2));
  });

  it('preserves added utilities in the toolbar and saves their explicit customization', async () => {
    const { container } = render(<AnnotationToolbarCustomizer bookKey='test' onBack={() => {}} />);
    const toolbar = within(container.querySelector('.selection-popup') as HTMLElement);
    const available = within(screen.getByText('Available').parentElement!);

    for (const label of ['Dictionary', 'Translate', 'Speak']) {
      fireEvent.click(available.getByRole('button', { name: label }));
    }

    expect(
      toolbar.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['呼叫小墨', 'Highlight', 'Annotate', '疑问', 'Dictionary', 'Translate', 'Speak']);
    for (const label of ['Dictionary', 'Translate', 'Speak']) {
      expect(available.queryByRole('button', { name: label })).toBeNull();
    }
    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledTimes(6));
    expect(saveViewSettings).toHaveBeenCalledWith(
      {},
      'test',
      'annotationToolbarCustomized',
      true,
      false,
      false,
    );
    expect(saveViewSettings).toHaveBeenLastCalledWith(
      {},
      'test',
      'annotationToolbarItems',
      [...DEFAULT_ANNOTATION_TOOLBAR_ITEMS, 'dictionary', 'translate', 'tts'],
      false,
      true,
    );
  });

  it('serializes rapid edits while the first customization save is pending', async () => {
    let finishFirst!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    vi.mocked(saveViewSettings).mockImplementationOnce(() => firstSave);
    render(<AnnotationToolbarCustomizer bookKey='test' onBack={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    await act(async () => {
      await Promise.resolve();
    });
    const callsBeforeFirstCompleted = vi.mocked(saveViewSettings).mock.calls.length;
    await act(async () => {
      finishFirst();
      await firstSave;
    });
    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledTimes(6));

    expect(callsBeforeFirstCompleted).toBe(1);
    expect(vi.mocked(saveViewSettings).mock.calls.map((call) => call.slice(2, 4))).toEqual([
      ['annotationToolbarCustomized', true],
      ['annotationToolbarItems', [...DEFAULT_ANNOTATION_TOOLBAR_ITEMS, 'dictionary']],
      ['annotationToolbarCustomized', true],
      ['annotationToolbarItems', [...DEFAULT_ANNOTATION_TOOLBAR_ITEMS, 'dictionary', 'translate']],
      ['annotationToolbarCustomized', true],
      [
        'annotationToolbarItems',
        [...DEFAULT_ANNOTATION_TOOLBAR_ITEMS, 'dictionary', 'translate', 'tts'],
      ],
    ]);
  });

  it('shows a save error and continues saving later edits', async () => {
    vi.mocked(saveViewSettings)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    render(<AnnotationToolbarCustomizer bookKey='test' onBack={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledTimes(4));
    expect(eventDispatcher.dispatch).toHaveBeenCalledWith('toast', {
      type: 'error',
      message: '工具栏保存失败，请重试。',
    });
    expect(saveViewSettings).toHaveBeenLastCalledWith(
      {},
      'test',
      'annotationToolbarItems',
      [...DEFAULT_ANNOTATION_TOOLBAR_ITEMS, 'dictionary', 'translate'],
      false,
      true,
    );
  });
});
