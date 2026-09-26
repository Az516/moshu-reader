import type { ComponentProps, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const edition = vi.hoisted(() => ({ local: true }));
const openExternalUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/localEdition', () => ({
  get LOCAL_EDITION() {
    return edition.local;
  },
}));
vi.mock('@/utils/open', () => ({ openExternalUrl: openExternalUrlMock }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false, hasWindowBar: false } }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: () => ({ currentBookshelf: [] }) }));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/app/library/components/SettingsMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ImportMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/LibrarySearchOptionsMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({
  default: ({
    label,
    children,
    toggleButton,
  }: {
    label: string;
    children: ReactNode;
    toggleButton: ReactNode;
  }) => (
    <div>
      <button type='button' aria-label={label}>
        {toggleButton}
      </button>
      {children}
    </div>
  ),
}));

import LibraryHeader from '@/app/library/components/LibraryHeader';

const renderHeader = () => {
  const props: ComponentProps<typeof LibraryHeader> = {
    isSelectMode: false,
    isSelectAll: false,
    onPullLibrary: vi.fn(),
    onImportBooksFromFiles: vi.fn(),
    onOpenCatalogManager: vi.fn(),
    onOpenFeeds: vi.fn(),
    onToggleSelectMode: vi.fn(),
    onSelectAll: vi.fn(),
    onDeselectAll: vi.fn(),
    searchQuery: '',
    searchTarget: 'books',
    searchConfig: {
      scope: 'book',
      mode: 'contains',
      matchCase: false,
      matchDiacritics: false,
      matchWholeWords: false,
    },
    onSearchConfigChange: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onSearchTargetChange: vi.fn(),
  };
  return render(<LibraryHeader {...props} />);
};

afterEach(() => {
  cleanup();
  edition.local = true;
  openExternalUrlMock.mockReset();
});

describe('LibraryHeader free library link', () => {
  it('opens the free library externally from a responsive, keyboard-focusable control', () => {
    renderHeader();

    const button = screen.getByRole('button', { name: 'Free Library' });
    expect(button.getAttribute('title')).toBe('Free Library');
    expect(button.tabIndex).toBe(0);
    expect(button.className).toContain('shrink-0');
    const label = screen.getByText('Free Library');
    expect(label.classList.contains('hidden')).toBe(true);
    expect(label.classList.contains('xl:inline')).toBe(true);

    fireEvent.click(button);

    expect(openExternalUrlMock).toHaveBeenCalledWith('https://z-lib.gd/');
  });

  it('is absent from the upstream edition', () => {
    edition.local = false;

    renderHeader();

    expect(screen.queryByRole('button', { name: 'Free Library' })).toBeNull();
  });
});
