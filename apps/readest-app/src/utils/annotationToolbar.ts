import type { AnnotationToolType } from '@/types/annotator';
import { BookFormat, FIXED_LAYOUT_FORMATS } from '@/types/book';

// Proofread rewrites the rendered text through the content transformers, which
// every reflowable format runs (Markdown wires the same pipeline in utils/md.ts
// without an EPUB conversion). Only the fixed-layout formats are out: they
// render pages, not text. The toolbar button used to require EPUB, the sole
// format the feature shipped for (#2725).
export const supportsProofread = (format: BookFormat | undefined): boolean =>
  !!format && !FIXED_LAYOUT_FORMATS.has(format);

// Canonical order of every annotation tool. Kept in sync with
// `annotationToolButtons` in AnnotationTools.tsx (asserted by a unit test).
export const ALL_ANNOTATION_TOOL_TYPES: AnnotationToolType[] = [
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
];

// Keep immediate dialogue separate from the three ways to leave a record.
export const DEFAULT_ANNOTATION_TOOLBAR_ITEMS: AnnotationToolType[] = [
  'ask-reading',
  'highlight',
  'annotate',
  'save-question',
];

// Existing books can retain earlier shipped defaults. Recognize those sets
// without overwriting smaller or otherwise customized toolbars.
const LEGACY_TOOLBAR_DEFAULTS: AnnotationToolType[][] = [
  ['ask-reading', 'annotate', 'highlight', 'dictionary', 'translate', 'tts'],
  ['ask-reading', 'highlight', 'annotate', 'search', 'dictionary', 'translate', 'tts', 'proofread'],
  ['highlight', 'annotate', 'search', 'dictionary', 'translate', 'tts', 'proofread'],
];

// Drop unknown/duplicate entries; fall back to the default when unset (a
// pre-existing per-book config may not carry the field yet).
const sanitize = (
  items: AnnotationToolType[] | undefined,
  customized = false,
): AnnotationToolType[] => {
  // These actions were shipped in configs but suppressed by the old UI.
  const legacyItems: AnnotationToolType[] | undefined = items?.filter(
    (type) => type !== 'save-question' && type !== 'write-understanding' && type !== 'copy',
  );
  const legacyDefault =
    !customized &&
    legacyItems &&
    LEGACY_TOOLBAR_DEFAULTS.some(
      (legacy) =>
        legacy.length === legacyItems.length && legacy.every((type) => legacyItems.includes(type)),
    );
  const source = !items || legacyDefault ? DEFAULT_ANNOTATION_TOOLBAR_ITEMS : items;
  const seen = new Set<AnnotationToolType>();
  const out: AnnotationToolType[] = [];
  for (const type of source) {
    if (ALL_ANNOTATION_TOOL_TYPES.includes(type) && !seen.has(type)) {
      seen.add(type);
      out.push(type);
    }
  }
  return out;
};

// Visible tools to render in the live selection toolbar, in order.
export const getToolbarToolTypes = (
  items: AnnotationToolType[] | undefined,
  canShare: boolean,
  customized = false,
): AnnotationToolType[] =>
  sanitize(items, customized).filter((type) => canShare || type !== 'share');

// A fresh selection stays compact. Marking once reveals color/style controls;
// tapping an existing mark also exposes its editing controls.
export const shouldShowHighlightOptions = (
  _toolTypes: AnnotationToolType[],
  selection: { annotated?: boolean; popup?: boolean; cfi?: string } | null,
): boolean => {
  return !!selection?.annotated && !(selection.popup && !selection.cfi);
};

// Hidden tools (the "Available" tray), in canonical order.
export const getAvailableToolTypes = (
  items: AnnotationToolType[] | undefined,
  canShare: boolean,
  customized = false,
): AnnotationToolType[] => {
  const visible = new Set(sanitize(items, customized));
  return ALL_ANNOTATION_TOOL_TYPES.filter(
    (type) => !visible.has(type) && (canShare || type !== 'share'),
  );
};

// Add `type` to the visible list at `atIndex` (default: end). No-op if present.
export const addToolToToolbar = (
  visible: AnnotationToolType[],
  type: AnnotationToolType,
  atIndex?: number,
): AnnotationToolType[] => {
  if (visible.includes(type)) return visible;
  const next = [...visible];
  next.splice(atIndex ?? next.length, 0, type);
  return next;
};

// Remove `type` from the visible list. No-op if absent.
export const removeToolFromToolbar = (
  visible: AnnotationToolType[],
  type: AnnotationToolType,
): AnnotationToolType[] => visible.filter((type_) => type_ !== type);

// Move `fromType` to where `toType` currently sits within the visible list.
export const reorderToolbar = (
  visible: AnnotationToolType[],
  fromType: AnnotationToolType,
  toType: AnnotationToolType,
): AnnotationToolType[] => {
  const from = visible.indexOf(fromType);
  const to = visible.indexOf(toType);
  if (from < 0 || to < 0 || from === to) return visible;
  const next = [...visible];
  const spliced = next.splice(from, 1);
  next.splice(to, 0, spliced[0]!);
  return next;
};
