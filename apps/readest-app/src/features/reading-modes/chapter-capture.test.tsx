import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChapterCapture } from './chapter-capture';

describe('chapter capture drafts', () => {
  it('retains in-progress writing through settings, mode updates and chapter round trips', () => {
    const { result, rerender } = renderHook(({ id, saved }) => useChapterCapture(id, saved), {
      initialProps: { id: 'chapter-a', saved: '上次保存的句子' },
    });
    act(() => result.current.setCapture('正在写的新思考'));
    rerender({ id: 'chapter-a', saved: '上次保存的句子' });
    expect(result.current.capture).toBe('正在写的新思考');
    rerender({ id: 'chapter-b', saved: '' });
    expect(result.current.capture).toBe('');
    act(() => result.current.setCapture('第二章还未保存'));
    rerender({ id: 'chapter-a', saved: '上次保存的句子' });
    expect(result.current.capture).toBe('正在写的新思考');
    rerender({ id: 'chapter-b', saved: '' });
    expect(result.current.capture).toBe('第二章还未保存');
  });

  it('keeps deliberately empty drafts and returns to saved data only after explicit completion', () => {
    const { result, rerender } = renderHook(({ saved }) => useChapterCapture('chapter-a', saved), {
      initialProps: { saved: '旧句子' },
    });
    act(() => result.current.setCapture(''));
    rerender({ saved: '外部保存' });
    expect(result.current.capture).toBe('');
    act(() => result.current.clearDraft());
    expect(result.current.capture).toBe('外部保存');
  });

  it('does not clear newer writing when an earlier asynchronous save finishes', () => {
    const { result } = renderHook(() => useChapterCapture('chapter-a', ''));
    act(() => result.current.setCapture('刚提交的句子'));
    act(() => result.current.setCapture('保存期间继续补充的句子'));
    act(() => result.current.clearDraft('刚提交的句子'));
    expect(result.current.capture).toBe('保存期间继续补充的句子');
  });
});
