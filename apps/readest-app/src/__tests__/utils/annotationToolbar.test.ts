import { describe, test, expect } from 'vitest';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  ALL_ANNOTATION_TOOL_TYPES,
  DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
  getToolbarToolTypes,
  getAvailableToolTypes,
  addToolToToolbar,
  removeToolFromToolbar,
  reorderToolbar,
  shouldShowHighlightOptions,
  supportsProofread,
} from '@/utils/annotationToolbar';

describe('annotationToolbar helpers', () => {
  test('names the reading assistant action 呼叫小墨', () => {
    expect(annotationToolButtons.find((button) => button.type === 'ask-reading')?.label).toBe(
      '呼叫小墨',
    );
  });

  test('ALL_ANNOTATION_TOOL_TYPES matches the button registry order', () => {
    expect(ALL_ANNOTATION_TOOL_TYPES).toEqual(annotationToolButtons.map((b) => b.type));
  });

  test('default toolbar offers dialogue, marking, notes and questions', () => {
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).toEqual([
      'ask-reading',
      'highlight',
      'annotate',
      'save-question',
    ]);
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).not.toContain('copy');
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).not.toContain('share');
  });

  test('existing default layouts also adopt the four reading actions', () => {
    expect(
      getToolbarToolTypes(
        [
          'ask-reading',
          'save-question',
          'write-understanding',
          'copy',
          'highlight',
          'annotate',
          'search',
          'dictionary',
          'translate',
          'tts',
          'proofread',
        ],
        true,
      ),
    ).toEqual(DEFAULT_ANNOTATION_TOOLBAR_ITEMS);
    expect(
      getToolbarToolTypes(
        [
          'ask-reading',
          'highlight',
          'annotate',
          'search',
          'dictionary',
          'translate',
          'tts',
          'proofread',
        ],
        true,
      ),
    ).toEqual(DEFAULT_ANNOTATION_TOOLBAR_ITEMS);
    expect(
      getToolbarToolTypes(
        ['ask-reading', 'annotate', 'highlight', 'dictionary', 'translate', 'tts'],
        true,
      ),
    ).toEqual(DEFAULT_ANNOTATION_TOOLBAR_ITEMS);
    expect(
      getAvailableToolTypes(
        ['ask-reading', 'annotate', 'highlight', 'dictionary', 'translate', 'tts'],
        true,
      ),
    ).toContain('dictionary');
    expect(getToolbarToolTypes(['annotate'], true)).toEqual(['annotate']);
  });

  test('copylink is opt-in: off the default toolbar, offered in the available tray', () => {
    expect(ALL_ANNOTATION_TOOL_TYPES).toContain('copylink');
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).not.toContain('copylink');
    expect(getToolbarToolTypes(undefined, true)).not.toContain('copylink');
    expect(getAvailableToolTypes(DEFAULT_ANNOTATION_TOOLBAR_ITEMS, true)).toContain('copylink');
    expect(getToolbarToolTypes([...DEFAULT_ANNOTATION_TOOLBAR_ITEMS, 'copylink'], true)).toContain(
      'copylink',
    );
  });

  test('explicit customization survives even when it resembles a previous default', () => {
    const customized = [
      ...DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
      'dictionary',
      'translate',
      'tts',
    ] as const;
    expect(getToolbarToolTypes([...customized], true, true)).toEqual(customized);
    expect(getAvailableToolTypes([...customized], true, true)).not.toContain('dictionary');
    const reordered = [
      'tts',
      'translate',
      'dictionary',
      'highlight',
      'annotate',
      'ask-reading',
    ] as const;
    expect(getToolbarToolTypes([...reordered], true, true)).toEqual(reordered);
  });

  test('getToolbarToolTypes preserves order and falls back to default when undefined', () => {
    expect(getToolbarToolTypes(undefined, true)).toEqual(DEFAULT_ANNOTATION_TOOLBAR_ITEMS);
    expect(getToolbarToolTypes(['search', 'copy'], true)).toEqual(['search']);
  });

  test('getToolbarToolTypes drops share when !canShare, keeps it when canShare', () => {
    expect(getToolbarToolTypes(['search', 'share'], false)).toEqual(['search']);
    expect(getToolbarToolTypes(['search', 'share'], true)).toEqual(['search', 'share']);
  });

  test('getToolbarToolTypes drops unknown/duplicate entries', () => {
    expect(getToolbarToolTypes(['search', 'search', 'bogus' as never], true)).toEqual(['search']);
  });

  test('getAvailableToolTypes returns canonical-order complement', () => {
    expect(getAvailableToolTypes(['copy'], true)).toEqual([
      'ask-reading',
      'save-question',
      'write-understanding',
      'copylink',
      'highlight',
      'annotate',
      'search',
      'dictionary',
      'translate',
      'tts',
      'proofread',
      'share',
    ]);
    expect(ALL_ANNOTATION_TOOL_TYPES).not.toContain('copy');
  });

  test('getAvailableToolTypes hides share when !canShare', () => {
    expect(getAvailableToolTypes(['copy'], false)).not.toContain('share');
  });

  test('addToolToToolbar appends by default and is a no-op when present', () => {
    expect(addToolToToolbar(['copy'], 'share')).toEqual(['copy', 'share']);
    expect(addToolToToolbar(['copy', 'share'], 'share')).toEqual(['copy', 'share']);
  });

  test('addToolToToolbar inserts at the given index', () => {
    expect(addToolToToolbar(['copy', 'search'], 'share', 1)).toEqual(['copy', 'share', 'search']);
  });

  test('removeToolFromToolbar removes the tool', () => {
    expect(removeToolFromToolbar(['copy', 'share'], 'share')).toEqual(['copy']);
    expect(removeToolFromToolbar(['copy'], 'share')).toEqual(['copy']);
  });

  test('reorderToolbar moves a tool to another tool position', () => {
    expect(reorderToolbar(['copy', 'highlight', 'search'], 'search', 'copy')).toEqual([
      'search',
      'copy',
      'highlight',
    ]);
    expect(reorderToolbar(['copy', 'search'], 'copy', 'copy')).toEqual(['copy', 'search']);
  });
});

describe('supportsProofread', () => {
  // Proofread rewrites the rendered text through the content transformers, so
  // it works on every reflowable format -- not just EPUB, which is all the
  // original feature (#2725) shipped with and all the toolbar button allowed.
  test('enables every reflowable format', () => {
    for (const format of ['EPUB', 'MD', 'MOBI', 'AZW', 'AZW3', 'FB2', 'FBZ', 'TXT'] as const) {
      expect(supportsProofread(format)).toBe(true);
    }
  });

  test('excludes the fixed-layout formats, which have no text to transform', () => {
    expect(supportsProofread('PDF')).toBe(false);
    expect(supportsProofread('CBZ')).toBe(false);
  });

  test('excludes a book whose format is not known yet', () => {
    expect(supportsProofread(undefined)).toBe(false);
  });
});

describe('shouldShowHighlightOptions', () => {
  const toolbarWithHighlight = DEFAULT_ANNOTATION_TOOLBAR_ITEMS;
  const toolbarWithoutHighlight = removeToolFromToolbar(
    DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
    'highlight',
  );

  test('fresh selections keep the style and color controls collapsed', () => {
    expect(shouldShowHighlightOptions(toolbarWithHighlight, {})).toBe(false);
  });

  test('hidden for a fresh selection when the highlight tool is off the toolbar', () => {
    expect(shouldShowHighlightOptions(toolbarWithoutHighlight, {})).toBe(false);
  });

  test('always shown for an already-annotated selection', () => {
    expect(shouldShowHighlightOptions(toolbarWithoutHighlight, { annotated: true })).toBe(true);
  });

  test('hidden for a popup-window selection without a CFI, which cannot anchor a highlight', () => {
    expect(shouldShowHighlightOptions(toolbarWithHighlight, { popup: true })).toBe(false);
  });

  test('popup-window selections also wait until a mark is added', () => {
    expect(
      shouldShowHighlightOptions(toolbarWithHighlight, { popup: true, cfi: 'epubcfi(/6/4!/4/2)' }),
    ).toBe(false);
  });

  test('hidden with no selection', () => {
    expect(shouldShowHighlightOptions(toolbarWithHighlight, null)).toBe(false);
  });
});
