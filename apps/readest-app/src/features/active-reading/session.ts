import { create } from 'zustand';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { findTocItemBS } from '@/services/nav';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import type { TOCItem } from '@/libs/document';
import type { TextSelection } from '@/utils/sel';
import type { ReadingSource, ReadingMethodTab } from '../reading-method/types';
import { readingSourceIdentity } from './source';

export type ReadingAction = 'ask' | 'question' | 'understanding' | 'prepare';
interface ReadingRequest {
  bookKey: string;
  source?: ReadingSource;
  action: ReadingAction;
  nonce: number;
  handled?: boolean;
}
export const useReadingSession = create<{ request: ReadingRequest | null }>(() => ({
  request: null,
}));

const hasTocCfis = (items: TOCItem[]): boolean =>
  items.every((item) => Boolean(item.cfi) && (!item.subitems || hasTocCfis(item.subitems)));

export function sourceFromSelection(bookKey: string, selection: TextSelection): ReadingSource {
  const { book, bookDoc } = useBookDataStore.getState().getBookData(bookKey) ?? {};
  const view = useReaderStore.getState().getView(bookKey);
  if (!book || !view || !selection.text.trim()) throw new Error('请先在正文中选择一段文字。');
  if (selection.text.length > 6000) throw new Error('选文较长，请缩小到 6000 字以内再提问。');
  const cfi =
    selection.cfi || (selection.range ? view.getCFI(selection.index, selection.range) : undefined);
  let chapter = '';
  // Resolve the selection itself: the reading position can already be in a
  // different section. Foliate's synchronous lookup also works before TOC CFIs
  // have been hydrated. A popup range belongs to a separate document, so only
  // its canonical CFI is suitable for chapter lookup.
  if (selection.range && !selection.popup) {
    const selectionView = view as typeof view & {
      getProgressOf?: (index: number, range: Range) => { tocItem?: { label?: string } | null };
    };
    try {
      chapter =
        selectionView.getProgressOf?.(selection.index, selection.range).tocItem?.label?.trim() ||
        '';
    } catch {
      // The selection's document may have been disposed during navigation.
    }
  }
  const toc = bookDoc?.toc ?? [];
  if (!chapter && cfi && hasTocCfis(toc)) {
    try {
      chapter = findTocItemBS(toc, cfi)?.label?.trim() || '';
    } catch {
      // An invalid imported navigation CFI should not prevent saving the passage.
    }
  }
  const node = selection.range?.startContainer;
  const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  const block = element?.closest('p,li,blockquote,h1,h2,h3,h4,td');
  const context = block
    ? [
        block.previousElementSibling?.textContent,
        block.textContent,
        block.nextElementSibling?.textContent,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 3000)
    : '';
  return {
    ...readingSourceIdentity(book),
    excerpt: selection.text.trim(),
    sectionIndex: selection.index,
    cfi,
    chapter: chapter || `第 ${selection.index + 1} 节`,
    context,
  };
}

export function openReadingPanel(
  bookKey: string,
  action: ReadingAction = 'prepare',
  source?: ReadingSource,
) {
  useReadingSession.setState({ request: { bookKey, source, action, nonce: Date.now() } });
  useSidebarStore.getState().setSideBarBookKey(bookKey);
  useNotebookStore.getState().setNotebookActiveTab('reading');
  useNotebookStore.getState().setNotebookVisible(true);
}

export const actionTab = (action: ReadingAction): ReadingMethodTab =>
  action === 'prepare' ? 'prepare' : action === 'understanding' ? 'reflect' : 'questions';
