import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectVisibleLines, getReadingViewport } from './lockedLines';

interface TextRun {
  start: number;
  end: number;
  rect: DOMRect;
}

describe('visible DOM reading lines', () => {
  const viewport = { left: 0, top: 0, right: 800, bottom: 600 };
  const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  let runs: Map<Text, TextRun[]>;
  let measure: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runs = new Map();
    measure = vi.fn(function (this: Range) {
      const rects: DOMRect[] = [];
      for (const [node, fragments] of runs) {
        if (!this.intersectsNode(node)) continue;
        const start = this.startContainer === node ? this.startOffset : 0;
        const end = this.endContainer === node ? this.endOffset : node.length;
        for (const fragment of fragments) {
          const from = Math.max(start, fragment.start);
          const to = Math.min(end, fragment.end);
          if (from >= to) continue;
          const charWidth = fragment.rect.width / (fragment.end - fragment.start);
          rects.push(
            new DOMRect(
              fragment.rect.left + (from - fragment.start) * charWidth,
              fragment.rect.top,
              (to - from) * charWidth,
              fragment.rect.height,
            ),
          );
        }
      }
      return rects as unknown as DOMRectList;
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: measure,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRects);
    else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  });

  const text = (selector: string, fragments: TextRun[], child = 0) => {
    const node = document.querySelector(selector)!.childNodes[child] as Text;
    runs.set(node, fragments);
    return node;
  };
  const run = (
    start: number,
    end: number,
    left: number,
    top: number,
    width: number,
    height = 20,
  ): TextRun => ({ start, end, rect: new DOMRect(left, top, width, height) });

  it('splits native wrapped rectangles, merges adjacent inline text and preserves exact DOM ranges', () => {
    document.body.innerHTML = '<p>甲乙丙丁<strong>戊己</strong>庚辛</p>';
    text('p', [run(0, 2, 20, 20, 40), run(2, 4, 20, 50, 40)]);
    text('strong', [run(0, 2, 60, 48, 40, 24)]);
    text('p', [run(0, 2, 100, 50, 40)], 2);
    const original = document.body.innerHTML;
    const lines = collectVisibleLines(document, viewport);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.range.toString())).toEqual(['甲乙', '丙丁戊己庚辛']);
    expect(lines[1]).toMatchObject({ doc: document, left: 20, right: 140, top: 48, bottom: 72 });
    expect(document.body.innerHTML).toBe(original);
  });

  it('keeps same-height columns separate and follows DOM reading order, not top-to-bottom sorting', () => {
    document.body.innerHTML = '<p>甲乙丙丁戊己庚辛</p>';
    text('p', [
      run(0, 2, 20, 20, 100),
      run(2, 4, 20, 50, 100),
      run(4, 6, 220, 20, 100),
      run(6, 8, 220, 50, 100),
    ]);
    const lines = collectVisibleLines(document, viewport);
    expect(lines.map((line) => line.range.toString())).toEqual(['甲乙', '丙丁', '戊己', '庚辛']);
    expect(lines.map(({ left, top }) => [left, top])).toEqual([
      [20, 20],
      [20, 50],
      [220, 20],
      [220, 50],
    ]);
  });

  it('does not join distinct blocks or a column gutter at the same y position', () => {
    document.body.innerHTML =
      '<p id="left">左页</p><p id="right">右页</p><p id="flow">同段跨栏</p>';
    text('#left', [run(0, 2, 20, 20, 100)]);
    text('#right', [run(0, 2, 128, 20, 100)]);
    text('#flow', [run(0, 2, 20, 70, 100), run(2, 4, 220, 70, 100)]);
    const lines = collectVisibleLines(document, viewport);
    expect(lines.map((line) => line.range.toString())).toEqual(['左页', '右页', '同段', '跨栏']);
  });

  it('uses fragmented paragraph boxes to distinguish columns even with a narrow gutter', () => {
    document.body.innerHTML = '<p>左栏<strong>右栏</strong></p>';
    text('p', [run(0, 2, 20, 20, 100)]);
    text('strong', [run(0, 2, 122, 20, 100)]);
    vi.spyOn(document.querySelector('p')!, 'getClientRects').mockReturnValue([
      new DOMRect(20, 0, 100, 100),
      new DOMRect(122, 0, 100, 100),
    ] as unknown as DOMRectList);
    const lines = collectVisibleLines(document, viewport);
    expect(lines.map((line) => line.range.toString())).toEqual(['左栏', '右栏']);
  });

  it('clips line geometry to the viewport and excludes lines outside it', () => {
    document.body.innerHTML = '<p>甲乙丙丁戊己庚辛</p>';
    text('p', [
      run(0, 2, 0, 0, 100),
      run(2, 4, 0, 30, 100),
      run(4, 6, 0, 60, 100),
      run(6, 8, 200, 30, 100),
    ]);
    const lines = collectVisibleLines(document, { left: 20, top: 35, right: 90, bottom: 55 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ left: 20, right: 90, top: 35, bottom: 50 });
    expect(lines[0]?.range.toString()).toBe('丙丁');
  });

  it('excludes hidden controls and navigation while retaining ordinary prose links', () => {
    document.body.innerHTML =
      '<p id="text">读<a href="#chapter">原文</a></p><p hidden>隐藏</p><div style="display:none"><p>折叠</p></div><p style="visibility:hidden">不可见</p><p style="opacity:0">透明</p><nav><a href="#next">下一页</a></nav><a href="#menu">菜单</a><form><label>搜索</label></form><button>按钮</button><p>   </p>';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      runs.set(node as Text, [run(0, node.textContent!.length, 40, 20, 40)]);
    }
    text('#text', [run(0, 1, 20, 20, 20)]);
    const lines = collectVisibleLines(document, viewport);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.range.toString()).toBe('读原文');
    expect(document.querySelector('#text a')?.getAttribute('href')).toBe('#chapter');
  });

  it('measures text-node fragments rather than every character of a long chapter', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '甲'.repeat(10000);
    document.body.appendChild(paragraph);
    runs.set(
      paragraph.firstChild as Text,
      Array.from({ length: 100 }, (_, index) =>
        run(index * 100, (index + 1) * 100, 20, index * 30, 500),
      ),
    );
    const lines = collectVisibleLines(document, { left: 0, top: 1490, right: 600, bottom: 1550 });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.range.startOffset).toBe(5000);
    expect(lines[1]?.range.endOffset).toBe(5200);
    expect(measure.mock.calls.length).toBeLessThan(80);
  });
});

describe('actual iframe reading viewport', () => {
  let frame: HTMLIFrameElement;
  let doc: Document;
  const bounds = { left: 0, top: 0, right: 1400, bottom: 800 };
  const box = (
    element: HTMLElement,
    left: number,
    top: number,
    width: number,
    height: number,
    client = { left: 0, top: 0, width, height },
  ) => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(left, top, width, height),
    );
    for (const [key, value] of Object.entries({
      clientLeft: client.left,
      clientTop: client.top,
      clientWidth: client.width,
      clientHeight: client.height,
      offsetWidth: width,
      offsetHeight: height,
    }))
      Object.defineProperty(element, key, { configurable: true, value });
  };

  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1400);
    vi.stubGlobal('innerHeight', 800);
    frame = document.createElement('iframe');
    document.body.appendChild(frame);
    doc = document.implementation.createHTMLDocument('reading viewport test');
    // jsdom does not instantiate iframe browsing contexts inside a shadow root.
    Object.defineProperty(doc, 'defaultView', { value: { frameElement: frame } });
    box(frame, 100, 80, 1300, 600);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('intersects window, reader bounds and the iframe client viewport in local coordinates', () => {
    expect(getReadingViewport(doc, { left: 120, top: 100, right: 1600, bottom: 900 })).toEqual({
      left: 20,
      top: 20,
      right: 1300,
      bottom: 600,
    });
  });

  it('excludes the next column hidden by a paginator-sized clipping ancestor', () => {
    const clip = document.createElement('div');
    clip.style.overflow = 'hidden';
    document.body.appendChild(clip);
    clip.appendChild(frame);
    box(clip, 100, 80, 1200, 600);
    expect(getReadingViewport(doc, { left: 100, top: 80, right: 1344, bottom: 680 })).toEqual({
      left: 0,
      top: 0,
      right: 1200,
      bottom: 600,
    });
  });

  it('walks through shadow hosts and combines each axis of independent overflow clips', () => {
    const host = document.createElement('div');
    host.style.overflowY = 'clip';
    host.style.overflowX = 'visible';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const clip = document.createElement('div');
    clip.style.overflowX = 'clip';
    clip.style.overflowY = 'visible';
    shadow.appendChild(clip);
    clip.appendChild(frame);
    box(host, 500, 120, 100, 350);
    box(clip, 150, 200, 700, 100);
    expect(getReadingViewport(doc, bounds)).toEqual({ left: 50, top: 40, right: 750, bottom: 390 });
  });

  it('uses client boxes so borders and scrollbars do not become visible book area', () => {
    const clip = document.createElement('div');
    clip.style.overflow = 'auto';
    document.body.appendChild(clip);
    clip.appendChild(frame);
    box(clip, 120, 100, 900, 450, { left: 4, top: 6, width: 872, height: 420 });
    expect(getReadingViewport(doc, bounds)).toEqual({ left: 24, top: 26, right: 896, bottom: 446 });
  });

  it('does not clip against the box of an ancestor whose overflow is visible', () => {
    const parent = document.createElement('div');
    parent.style.overflow = 'visible';
    document.body.appendChild(parent);
    parent.appendChild(frame);
    box(parent, 300, 200, 20, 20);
    expect(getReadingViewport(doc, bounds)).toEqual({ left: 0, top: 0, right: 1300, bottom: 600 });
  });

  it('returns null for an empty clip or a detached frame', () => {
    const clip = document.createElement('div');
    clip.style.overflow = 'hidden';
    document.body.appendChild(clip);
    clip.appendChild(frame);
    box(clip, 0, 0, 50, 50);
    expect(getReadingViewport(doc, bounds)).toBeNull();
    frame.remove();
    expect(getReadingViewport(doc, bounds)).toBeNull();
  });
});
