import type { Book } from '@/types/book';
import type { ReadingSource } from '../reading-method/types';

/** Book has a partial-file hash, but no stored full-file digest. Do not invent one. */
export function readingSourceIdentity(
  book: Pick<Book, 'hash' | 'title' | 'author'>,
): Pick<ReadingSource, 'bookHash' | 'bookVersion' | 'title' | 'author'> {
  return {
    bookHash: book.hash,
    bookVersion: `book-hash:${book.hash}`,
    title: book.title,
    author: book.author,
  };
}
