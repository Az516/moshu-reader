import { describe, expect, it } from 'vitest';
import { glyphRectOnLine, sentenceAtPoint } from './sentence';

function passage(html: string, selector: string, offset: number) {
  const paragraph = document.createElement('p');
  paragraph.innerHTML = html;
  const doc = document;
  const node = (selector ? paragraph.querySelector(selector) : paragraph)!.firstChild!;
  Object.assign(doc, {
    caretRangeFromPoint: () => {
      const range = doc.createRange();
      range.setStart(node, offset);
      range.getBoundingClientRect = () => new DOMRect(20, 20, 16, 20);
      return range;
    },
  });
  return { paragraph, hit: sentenceAtPoint(doc, 25, 25) };
}

describe('sentence and magnetic text ranges', () => {
  it('uses only the character rectangle on the pointer line at a soft wrap', () => {
    const previousLine = new DOMRect(620, 20, 18, 24);
    const currentLine = new DOMRect(40, 56, 18, 24);
    const range = {
      getClientRects: () => [previousLine, currentLine],
      getBoundingClientRect: () => new DOMRect(40, 20, 598, 60),
    } as unknown as Range;

    expect(glyphRectOnLine(range, 68)).toBe(currentLine);
  });

  it('rejects collapsed wrap whitespace instead of painting a white stripe', () => {
    const range = {
      getClientRects: () => [new DOMRect(40, 56, 0, 24)],
      getBoundingClientRect: () => new DOMRect(40, 20, 598, 60),
    } as unknown as Range;

    expect(glyphRectOnLine(range, 68)).toBeNull();
  });

  it('finds the whole sentence across inline markup and retains a real DOM anchor', () => {
    const { paragraph, hit } = passage(
      '第一句。阅读需要<strong>主动</strong>思考。下一句。',
      'strong',
      1,
    );
    expect(hit?.range.toString()).toBe('阅读需要主动思考。');
    expect(hit?.element).toBe(paragraph);
    expect(hit?.glyphs.map(({ text }) => text).join('')).toBe('需要主动思考。');
    expect(hit?.glyphs).toHaveLength(7);
  });

  it('keeps short sentences intact and never cuts a surrogate pair', () => {
    const { hit } = passage('甲🖋️乙。', '', 2);
    expect(hit?.range.toString()).toBe('甲🖋️乙。');
    expect(hit?.glyphs.map(({ text }) => text)).toEqual(['甲', '🖋️', '乙', '。']);
  });

  it('keeps one focus phrase stable across nearby characters before stepping forward', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '甲乙丙丁戊己庚辛壬癸。';
    const node = paragraph.firstChild!;
    let offset = 4;
    Object.assign(document, {
      caretRangeFromPoint: () => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.getBoundingClientRect = () => new DOMRect(20, 20, 16, 20);
        return range;
      },
    });

    const first = sentenceAtPoint(document, 25, 25)
      ?.glyphs.map(({ text }) => text)
      .join('');
    offset = 7;
    const nearby = sentenceAtPoint(document, 25, 25)
      ?.glyphs.map(({ text }) => text)
      .join('');
    offset = 8;
    const next = sentenceAtPoint(document, 25, 25)
      ?.glyphs.map(({ text }) => text)
      .join('');

    expect(nearby).toBe(first);
    expect(next).not.toBe(first);
  });

  it('does not snap to body text from a page margin', () => {
    passage('文本。', '', 0);
    expect(sentenceAtPoint(document, 200, 200)).toBeNull();
  });
});
