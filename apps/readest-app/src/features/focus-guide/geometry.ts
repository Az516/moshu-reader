import { buildLineBoxes, type ReadingRulerLineBox } from '@/app/reader/utils/readingRuler';

export interface FocusBand {
  lineTop: number;
  lineHeight: number;
  clearTop: number;
  clearBottom: number;
}

/** Rectangles stay in the iframe's coordinates; viewport offsets are applied at paint time. */
export const getParagraphLines = (element: Element): ReadingRulerLineBox[] => {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return buildLineBoxes(Array.from(range.getClientRects()), false, false, {
    top: 0,
    left: 0,
    right: 0,
  });
};

export const findFocusBand = (
  lines: ReadingRulerLineBox[],
  y: number,
  contextLines: number,
  lineHeight: number,
): FocusBand | null => {
  const index = lines.findIndex((line) => y >= line.start && y <= line.end);
  const line = lines[index];
  if (!line) return null;
  const height = Math.max(line.end - line.start, 1);
  const spacing = Math.max(height, lineHeight);
  const context = Math.max(0, Math.min(4, Math.round(contextLines)));
  const before = lines[Math.max(0, index - context)];
  const after = lines[Math.min(lines.length - 1, index + context)];
  return {
    lineTop: line.start,
    lineHeight: height,
    // At paragraph boundaries preserve approximately the same clear area.
    clearTop: Math.min(before?.start ?? line.start, line.start - spacing * context),
    clearBottom: Math.max(after?.end ?? line.end, line.end + spacing * context),
  };
};

type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

/** Do not snap from images, chapter gaps or page margins to a distant word. */
export const textAtPoint = (doc: Document, x: number, y: number) => {
  const caretDoc = doc as CaretDocument;
  let range = caretDoc.caretRangeFromPoint?.(x, y) ?? null;
  if (!range) {
    const position = caretDoc.caretPositionFromPoint?.(x, y);
    if (position) {
      range = doc.createRange();
      range.setStart(position.offsetNode, position.offset);
    }
  }
  const node = range?.startContainer;
  if (!range || !node || node.nodeType !== 3 || !node.textContent?.trim()) return null;
  const offset = Math.min(range.startOffset, Math.max(0, node.textContent.length - 1));
  range.setStart(node, offset);
  range.setEnd(node, Math.min(node.textContent.length, offset + 1));
  const rect = range.getBoundingClientRect();
  const padding = Math.max(8, rect.width);
  const linePadding = Math.min(8, rect.height * 0.35);
  if (
    rect.height <= 0 ||
    y < rect.top - linePadding ||
    y > rect.bottom + linePadding ||
    x < rect.left - padding ||
    x > rect.right + padding
  ) {
    return null;
  }
  const element =
    node.parentElement?.closest('p,li,blockquote,h1,h2,h3,h4,h5,h6,pre,figcaption') ??
    node.parentElement;
  if (!element) return null;
  return { element, rect };
};
