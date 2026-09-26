import { beforeEach, describe, expect, it } from 'vitest';
import { useThemeSourceReturn } from './source-return';

describe('thematic source return state', () => {
  beforeEach(() => {
    useThemeSourceReturn.setState({ origin: null, target: null });
  });

  it('keeps the exact cited passage until the destination book can reveal it', () => {
    const target = {
      bookHash: 'source-book',
      chapter: '第三章',
      excerpt: '这是主题回答引用的原文。',
      cfi: 'epubcfi(/6/8!/4/2:12,/4/2:26)',
    };
    useThemeSourceReturn.getState().setTarget(target);
    expect(useThemeSourceReturn.getState().target).toEqual(target);
    useThemeSourceReturn.getState().setTarget(null);
    expect(useThemeSourceReturn.getState().target).toBeNull();
  });
});
