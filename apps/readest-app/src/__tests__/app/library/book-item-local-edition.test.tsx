import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookItem from '@/app/library/components/BookItem';

const edition = vi.hoisted(() => ({ local: true }));
vi.mock('@/services/localEdition', () => ({
  get LOCAL_EDITION() {
    return edition.local;
  },
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'old-user' } }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/components/BookCover', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  edition.local = true;
});

const renderBook = (uploaded: boolean) => {
  const book: Book = {
    hash: 'local-book',
    title: 'Local Book',
    author: 'Author',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
    downloadedAt: uploaded ? undefined : 1,
    uploadedAt: uploaded ? 1 : undefined,
  };
  const props = {
    book,
    mode: 'grid' as const,
    coverFit: 'crop' as const,
    isSelectMode: false,
    bookSelected: false,
    transferProgress: null,
    handleBookUpload: vi.fn(),
    handleBookDownload: vi.fn(),
    showBookDetailsModal: vi.fn(),
    showTimeRemaining: false,
  };
  return { ...render(<BookItem {...props} />), props };
};

describe('BookItem local cloud controls', () => {
  it.each([false, true])('hides the cloud button for local edition (uploaded: %s)', (uploaded) => {
    const { queryByRole, getByRole, props } = renderBook(uploaded);
    expect(queryByRole('button', { name: 'Upload Book' })).toBeNull();
    expect(queryByRole('button', { name: 'Download Book' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Show Book Details' }));
    expect(props.showBookDetailsModal).toHaveBeenCalledWith(props.book);
  });

  it.each([false, true])('keeps the upstream cloud action (uploaded: %s)', (uploaded) => {
    edition.local = false;
    const { getByRole, props } = renderBook(uploaded);
    fireEvent.click(getByRole('button', { name: uploaded ? 'Download Book' : 'Upload Book' }));
    if (uploaded) {
      expect(props.handleBookDownload).toHaveBeenCalledWith(props.book, { queued: true });
    } else {
      expect(props.handleBookUpload).toHaveBeenCalledWith(props.book);
    }
  });
});
