import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TOCItem } from '@/libs/document';
import type { TextSelection } from '@/utils/sel';
import { sourceFromSelection } from './session';

const mocks = vi.hoisted(() => ({
  getBookData: vi.fn(),
  getView: vi.fn(),
  getBookProgress: vi.fn(),
  getCFI: vi.fn(),
  getProgressOf: vi.fn(),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: { getState: () => ({ getBookData: mocks.getBookData }) },
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ getView: mocks.getView }) },
}));
vi.mock('@/store/readerProgressStore', () => ({ getBookProgress: mocks.getBookProgress }));
vi.mock('@/store/sidebarStore', () => ({ useSidebarStore: { getState: () => ({}) } }));
vi.mock('@/store/notebookStore', () => ({ useNotebookStore: { getState: () => ({}) } }));
vi.mock('@/libs/document', async () => ({ CFI: await import('foliate-js/epubcfi.js') }));
vi.mock('@/services/nav', async () => ({
  findTocItemBS: (await import('@/services/nav/lookup')).findTocItemBS,
}));

describe('sourceFromSelection', () => {
  const exactCfi = 'epubcfi(/6/2!/4/4,/1:0,/1:12)';
  const toc: TOCItem[] = [
    { id: 0, label: 'Chapter One', href: 'one.xhtml', index: 0, cfi: 'epubcfi(/6/2!/4/2)' },
    { id: 1, label: 'Chapter Two', href: 'two.xhtml', index: 1, cfi: 'epubcfi(/6/4!/4/2)' },
  ];
  let selection: TextSelection;
  let block: HTMLParagraphElement;

  beforeEach(() => {
    vi.clearAllMocks();
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML =
      '<p>far before</p><p>near before</p><p>Alice thinks.</p><p>near after</p><p>far after</p>';
    block = doc.querySelectorAll('p')[2]!;
    const range = doc.createRange();
    range.selectNodeContents(block);
    selection = {
      key: 'selection',
      index: 0,
      page: 1,
      range,
      text: ' Alice thinks. ',
      cfi: exactCfi,
    };
    mocks.getBookData.mockReturnValue({ book: { hash: 'alice' }, bookDoc: { toc } });
    mocks.getView.mockReturnValue({ getCFI: mocks.getCFI, getProgressOf: mocks.getProgressOf });
    mocks.getCFI.mockReturnValue(exactCfi);
    // The current reading position has already advanced to another chapter.
    mocks.getBookProgress.mockReturnValue({ sectionLabel: 'Chapter Two' });
    mocks.getProgressOf.mockReturnValue({ tocItem: { label: 'Chapter One' } });
  });

  it('labels the selected range using its own progress, even while the current page is elsewhere', () => {
    const source = sourceFromSelection('book', selection);
    expect(source.chapter).toBe('Chapter One');
    expect(source.cfi).toBe(exactCfi);
    expect(mocks.getProgressOf).toHaveBeenCalledWith(0, selection.range);
    expect(mocks.getBookProgress).not.toHaveBeenCalled();
  });

  it('snapshots title, author, and the actual library file identity without inventing a full digest', () => {
    mocks.getBookData.mockReturnValue({
      book: {
        hash: 'alice-file-identity',
        title: 'Alice in Wonderland',
        author: 'Lewis Carroll',
        metaHash: 'shared-metadata',
      },
      bookDoc: { toc },
    });
    expect(sourceFromSelection('book', selection)).toMatchObject({
      bookHash: 'alice-file-identity',
      bookVersion: 'book-hash:alice-file-identity',
      title: 'Alice in Wonderland',
      author: 'Lewis Carroll',
    });
  });

  it('falls back to the exact generated CFI and hydrated TOC when range progress is unavailable', () => {
    mocks.getView.mockReturnValue({ getCFI: mocks.getCFI });
    const source = sourceFromSelection('book', { ...selection, cfi: undefined });
    expect(source.chapter).toBe('Chapter One');
    expect(source.cfi).toBe(exactCfi);
    expect(mocks.getCFI).toHaveBeenCalledWith(0, selection.range);
  });

  it('uses the canonical CFI for a popup whose DOM range is not in the book document', () => {
    mocks.getProgressOf.mockReturnValue({ tocItem: { label: 'Chapter Two' } });
    const source = sourceFromSelection('book', { ...selection, popup: true });
    expect(source.chapter).toBe('Chapter One');
    expect(source.cfi).toBe(exactCfi);
    expect(mocks.getProgressOf).not.toHaveBeenCalled();
  });

  it('uses an explicit section number when neither chapter lookup is available', () => {
    mocks.getProgressOf.mockReturnValue({});
    mocks.getBookData.mockReturnValue({ book: { hash: 'alice' }, bookDoc: { toc: [] } });
    expect(sourceFromSelection('book', { ...selection, index: 4 }).chapter).toBe('第 5 节');
    expect(mocks.getBookProgress).not.toHaveBeenCalled();
  });

  it('does not treat a TOC with missing CFIs as a match for its last chapter', () => {
    mocks.getProgressOf.mockReturnValue({});
    mocks.getBookData.mockReturnValue({
      book: { hash: 'alice' },
      bookDoc: { toc: toc.map(({ cfi: _cfi, ...item }) => item) },
    });
    expect(sourceFromSelection('book', selection).chapter).toBe('第 1 节');
  });

  it('keeps only adjacent blocks and bounds context without changing the selected excerpt', () => {
    expect(sourceFromSelection('book', selection)).toMatchObject({
      bookHash: 'alice',
      sectionIndex: 0,
      excerpt: 'Alice thinks.',
      context: 'near before\nAlice thinks.\nnear after',
    });
    block.nextElementSibling!.textContent = 'x'.repeat(5000);
    const source = sourceFromSelection('book', selection);
    expect(source.context).toHaveLength(3000);
    expect(source.context).not.toContain('far before');
    expect(source.context).not.toContain('far after');
    expect(source.excerpt).toBe('Alice thinks.');
  });
});
