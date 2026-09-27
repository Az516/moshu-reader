export interface LockedLine {
  doc: Document;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Original text on the visual line, including inline elements between its ends. */
  range: Range;
}

interface Viewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Intersect actual ancestor clips before converting into the book's coordinates. */
export function getReadingViewport(doc: Document, bounds: Viewport): Viewport | null {
  const frame = doc.defaultView?.frameElement as HTMLElement | null | undefined;
  const outerWindow = frame?.ownerDocument.defaultView;
  if (!frame?.isConnected || !outerWindow) return null;
  const clientBox = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
    const left = rect.left + element.clientLeft * scaleX;
    const top = rect.top + element.clientTop * scaleY;
    return {
      left,
      top,
      right: left + element.clientWidth * scaleX,
      bottom: top + element.clientHeight * scaleY,
      scaleX,
      scaleY,
    };
  };
  const frameBox = clientBox(frame);
  if (frameBox.scaleX <= 0 || frameBox.scaleY <= 0) return null;
  const visualViewport = outerWindow.visualViewport;
  const windowLeft = visualViewport?.offsetLeft ?? 0;
  const windowTop = visualViewport?.offsetTop ?? 0;
  const visible = {
    left: Math.max(windowLeft, bounds.left, frameBox.left),
    top: Math.max(windowTop, bounds.top, frameBox.top),
    right: Math.min(
      windowLeft + (visualViewport?.width ?? outerWindow.innerWidth),
      bounds.right,
      frameBox.right,
    ),
    bottom: Math.min(
      windowTop + (visualViewport?.height ?? outerWindow.innerHeight),
      bounds.bottom,
      frameBox.bottom,
    ),
  };
  const parentOf = (element: HTMLElement): HTMLElement | null =>
    (element.assignedSlot ??
      element.parentElement ??
      (element.getRootNode() as ShadowRoot).host ??
      null) as HTMLElement | null;
  for (let ancestor = parentOf(frame); ancestor; ancestor = parentOf(ancestor)) {
    const style = outerWindow.getComputedStyle(ancestor);
    // Non-replaced inline/contents elements have no overflow clipping box.
    if (style.display === 'inline' || style.display === 'contents') continue;
    const clips = (overflow: string) => /^(hidden|clip|auto|scroll|overlay)$/.test(overflow);
    const clipX = clips(style.overflowX || style.overflow);
    const clipY = clips(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const box = clientBox(ancestor);
    if (clipX) {
      visible.left = Math.max(visible.left, box.left);
      visible.right = Math.min(visible.right, box.right);
    }
    if (clipY) {
      visible.top = Math.max(visible.top, box.top);
      visible.bottom = Math.min(visible.bottom, box.bottom);
    }
  }
  if (visible.right <= visible.left || visible.bottom <= visible.top) return null;
  return {
    left: (visible.left - frameBox.left) / frameBox.scaleX,
    top: (visible.top - frameBox.top) / frameBox.scaleY,
    right: (visible.right - frameBox.left) / frameBox.scaleX,
    bottom: (visible.bottom - frameBox.top) / frameBox.scaleY,
  };
}

const PROSE = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,pre,figcaption,td,th';
const EXCLUDED =
  'script,style,template,noscript,svg,canvas,button,input,select,textarea,form,nav,[role="navigation"],[role="button"],[hidden],[inert],[aria-hidden="true"],[contenteditable="true"]';

const overlaps = (a: Viewport, b: Viewport) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.1 &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.1;

/** Resolve only a visible fragment's boundaries, using logarithmic range probes. */
function fragmentRange(doc: Document, node: Text, rect: DOMRect, singleRect: boolean): Range {
  const range = doc.createRange();
  range.selectNodeContents(node);
  if (singleRect) return range;
  const probe = doc.createRange();
  const intersectsFragment = (start: number, end: number) => {
    probe.setStart(node, start);
    probe.setEnd(node, end);
    return Array.from(probe.getClientRects()).some((candidate) => overlaps(candidate, rect));
  };
  let low = 0;
  let high = node.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (intersectsFragment(0, middle)) high = middle;
    else low = middle + 1;
  }
  let start = Math.max(0, low - 1);
  low = start;
  high = node.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (intersectsFragment(middle, node.length)) low = middle + 1;
    else high = middle;
  }
  let end = low;
  // Native probes may bisect a surrogate pair, whose halves share one glyph box.
  const isLowSurrogate = (offset: number) => {
    const code = node.data.charCodeAt(offset);
    return code >= 0xdc00 && code <= 0xdfff;
  };
  if (start > 0 && isLowSurrogate(start)) start--;
  if (end < node.length && isLowSurrogate(end)) end++;
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

/**
 * Read visual lines without inserting wrappers into EPUB text. Coordinates are
 * local to doc's viewport; partial lines have clipped geometry but full anchors.
 * Native text rectangles and the text walker retain DOM order across columns.
 */
export function collectVisibleLines(doc: Document, viewport: Viewport): LockedLine[] {
  const root = doc.body ?? doc.documentElement;
  if (!root || viewport.right <= viewport.left || viewport.bottom <= viewport.top) return [];
  const styles = new Map<Element, CSSStyleDeclaration | undefined>();
  const styleFor = (element: Element) => {
    if (!styles.has(element)) styles.set(element, doc.defaultView?.getComputedStyle(element));
    return styles.get(element);
  };
  const hidden = (element: Element) => {
    if (element.closest(EXCLUDED)) return true;
    const visibility = styleFor(element)?.visibility;
    if (visibility === 'hidden' || visibility === 'collapse') return true;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = styleFor(ancestor);
      if (
        style?.display === 'none' ||
        style?.opacity === '0' ||
        style?.contentVisibility === 'hidden'
      )
        return true;
    }
    return false;
  };
  const blockFor = (element: Element) => {
    const prose = element.closest(PROSE);
    if (prose) return prose;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (
        /^(block|flow-root|list-item|table-cell|flex|grid)$/.test(styleFor(ancestor)?.display ?? '')
      )
        return ancestor;
    }
    return root;
  };
  const lines: LockedLine[] = [];
  const blockRects = new Map<Element, DOMRect[]>();
  let lastBlock: Element | null = null;
  let lastFragment = -1;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text;
    const parent = node.parentElement;
    if (!node.data.trim() || !parent || hidden(parent)) continue;
    // Navigation anchors are not prose. Inline links inside a paragraph remain
    // part of its geometry; this helper never installs handlers on those links.
    if (parent.closest('a') && !parent.closest(PROSE)) continue;
    const block = blockFor(parent);
    const fullRange = doc.createRange();
    fullRange.selectNodeContents(node);
    const rects = Array.from(fullRange.getClientRects()).filter(
      (rect) => rect.width > 0.1 && rect.height > 0.1,
    );
    for (const rect of rects) {
      if (!overlaps(rect, viewport)) continue;
      if (!blockRects.has(block)) blockRects.set(block, Array.from(block.getClientRects()));
      const centerX = (rect.left + rect.right) / 2;
      const fragment = blockRects
        .get(block)!
        .findIndex((box) => centerX >= box.left && centerX <= box.right && overlaps(box, rect));
      const range = fragmentRange(doc, node, rect, rects.length === 1);
      const previous = lines.at(-1);
      const lineHeight = previous ? Math.min(previous.bottom - previous.top, rect.height) : 0;
      const verticalOverlap = previous
        ? Math.min(previous.bottom, rect.bottom) - Math.max(previous.top, rect.top)
        : 0;
      const horizontalGap = previous
        ? Math.max(rect.left - previous.right, previous.left - rect.right, 0)
        : Infinity;
      if (
        previous &&
        lastBlock === block &&
        lastFragment === fragment &&
        verticalOverlap >= lineHeight * 0.55 &&
        horizontalGap <= Math.max(4, lineHeight * 0.5)
      ) {
        previous.left = Math.min(previous.left, rect.left);
        previous.right = Math.max(previous.right, rect.right);
        previous.top = Math.min(previous.top, rect.top);
        previous.bottom = Math.max(previous.bottom, rect.bottom);
        previous.range.setEnd(range.endContainer, range.endOffset);
      } else {
        lines.push({
          doc,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          range,
        });
      }
      lastBlock = block;
      lastFragment = fragment;
    }
  }
  return lines.map((line) => ({
    ...line,
    left: Math.max(line.left, viewport.left),
    right: Math.min(line.right, viewport.right),
    top: Math.max(line.top, viewport.top),
    bottom: Math.min(line.bottom, viewport.bottom),
  }));
}
