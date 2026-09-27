type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

/** Pick one real glyph box on the pointer's visual line, never a multi-line union box. */
export function glyphRectOnLine(range: Range, y: number): DOMRect | null {
  const rects =
    typeof range.getClientRects === 'function'
      ? Array.from(range.getClientRects())
      : [range.getBoundingClientRect()];
  return (
    rects.find(
      (rect) =>
        rect.width > 0.5 &&
        rect.height > 0 &&
        rect.width <= Math.max(64, rect.height * 2.5) &&
        y >= rect.top - 2 &&
        y <= rect.bottom + 2,
    ) ?? null
  );
}

/** Native text ranges preserve EPUB CFIs; the source document is never rewritten. */
export function sentenceAtPoint(doc: Document, x: number, y: number) {
  const caretDoc = doc as CaretDocument;
  let caret = caretDoc.caretRangeFromPoint?.(x, y) ?? null;
  if (!caret) {
    const position = caretDoc.caretPositionFromPoint?.(x, y);
    if (position) {
      caret = doc.createRange();
      caret.setStart(position.offsetNode, position.offset);
    }
  }
  const node = caret?.startContainer;
  if (!caret || node?.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return null;
  const offset = Math.min(caret.startOffset, node.textContent.length - 1);
  caret.setStart(node, offset);
  caret.setEnd(node, offset + 1);
  const rect = caret.getBoundingClientRect();
  if (
    rect.height <= 0 ||
    y < rect.top - 5 ||
    y > rect.bottom + 5 ||
    x < rect.left - 8 ||
    x > rect.right + 8
  )
    return null;
  const element =
    node.parentElement?.closest('p,li,blockquote,h1,h2,h3,h4,h5,h6,pre,figcaption,td') ??
    node.parentElement;
  if (!element) return null;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: { node: Node; start: number; end: number }[] = [];
  let text = '';
  let current: Node | null;
  let position = 0;
  while ((current = walker.nextNode())) {
    if (current === node) position = text.length + offset;
    const start = text.length;
    text += current.textContent ?? '';
    nodes.push({ node: current, start, end: text.length });
  }
  const sentences =
    typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)]
      : [...text.matchAll(/[^。！？.!?\n]+[。！？.!?\n]*|[。！？.!?\n]+/gu)].map((match) => ({
          index: match.index,
          segment: match[0],
        }));
  const sentence = sentences.find(
    ({ index, segment }) => position >= index && position < index + segment.length,
  );
  if (!sentence || !sentence.segment.trim() || sentence.segment.length > 6000) return null;
  const makeRange = (start: number, end: number) => {
    const first = nodes.find((part) => start >= part.start && start < part.end)!;
    const last = nodes.find((part) => end > part.start && end <= part.end)!;
    const range = doc.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  };
  const graphemes =
    typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(sentence.segment)]
      : Array.from(sentence.segment).map((segment, index, all) => ({
          segment,
          index: all.slice(0, index).join('').length,
        }));
  const center = Math.max(
    0,
    graphemes.findIndex(({ index, segment }) => position < sentence.index + index + segment.length),
  );
  // Move the lens in short phrase-sized steps instead of rebuilding it for
  // every character under the pointer. The overlapping groups keep context
  // while removing the rapid one-glyph shimmer that made quick reading flash.
  const maxStart = Math.max(0, graphemes.length - 7);
  const start = Math.min(Math.max(0, Math.floor(center / 4) * 4 - 2), maxStart);
  return {
    element,
    caretRect: rect,
    start: sentence.index,
    end: sentence.index + sentence.segment.length,
    range: makeRange(sentence.index, sentence.index + sentence.segment.length),
    glyphs: graphemes.slice(start, start + 7).map(({ index, segment }) => ({
      text: segment,
      range: makeRange(sentence.index + index, sentence.index + index + segment.length),
    })),
  };
}
