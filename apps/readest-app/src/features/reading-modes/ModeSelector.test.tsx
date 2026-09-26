import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModeSelector from './ModeSelector';
import type { Book } from '@/types/book';
afterEach(cleanup);
describe('purpose-first reading entry', () => {
  it('opens each reading purpose directly and does not invent a basic-reading mode', () => {
    const onSelect = vi.fn();
    render(
      <ModeSelector
        book={{ hash: 'book', title: '阅读练习', author: '测试作者' } as Book}
        onSelect={onSelect}
      />,
    );
    for (const [name, value] of [
      ['快速阅读', 'quick'],
      ['分析阅读', 'analytical'],
      ['主题阅读', 'thematic'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name!) }));
      expect(onSelect).toHaveBeenLastCalledWith(value);
    }
    expect(screen.queryByText('基础阅读')).toBeNull();
    expect(screen.queryByText('方式可以随时切换，标记与思考会一直保留。')).toBeNull();
    expect(screen.queryByText('建议先从这里开始')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '选择阅读方式' })).toBeTruthy();
  });

  it('allows returning to the book without selecting a different mode', () => {
    const onCancel = vi.fn();
    const onSelect = vi.fn();
    render(
      <ModeSelector
        book={{ hash: 'book', title: '阅读练习', author: '测试作者' } as Book}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /返回阅读/ }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the Modian mascot visible without adding more explanatory text', () => {
    const { container } = render(
      <ModeSelector
        book={{ hash: 'book', title: '阅读练习', author: '测试作者' } as Book}
        onSelect={vi.fn()}
      />,
    );
    const mascot = container.querySelector<HTMLImageElement>('.moshu-selector-mascot');
    expect(mascot?.getAttribute('src')).toBe('/modian/reading.webp');
    expect(mascot?.getAttribute('alt')).toBe('');
    expect(screen.queryByText('我会按你选择的方式')).toBeNull();
  });
});
