/**
 * AboutWindow — the version label doubles as a copy-to-clipboard control.
 *
 * On mobile there is no way to select the version string to paste it into a
 * bug report (issue #5285), so tapping the label copies it. The label must
 * keep its plain-text look: no button chrome, same classes as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { mockWriteTextToClipboard, mockDispatch } = vi.hoisted(() => ({
  mockWriteTextToClipboard: vi.fn(async () => true),
  mockDispatch: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, params?: Record<string, unknown>) =>
    params ? s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(params[k] ?? '')) : s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasUpdater: true } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { updateChannel: 'stable' } }),
}));

vi.mock('@/helpers/updater', () => ({
  checkForAppUpdates: vi.fn(),
  checkAppReleaseNotes: vi.fn(),
}));

vi.mock('@/utils/ua', () => ({
  parseWebViewInfo: () => 'Chrome 148',
}));

vi.mock('@/utils/version', () => ({
  getAppVersion: () => '0.11.20',
}));

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: mockWriteTextToClipboard,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: mockDispatch, on: vi.fn(), off: vi.fn() },
}));

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

vi.mock('@/features/reading-modes/ModianMascot', () => ({
  default: () => <span data-testid='modian-mascot' />,
}));

vi.mock('@/components/SupportLinks', () => ({ default: () => null }));
vi.mock('@/components/LegalLinks', () => ({ default: () => null }));
vi.mock('@/components/Link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ children, boxClassName }: { children: ReactNode; boxClassName?: string }) => (
    <div data-box-class={boxClassName}>{children}</div>
  ),
}));

import { AboutWindow, setAboutDialogVisible } from '@/components/AboutWindow';

const openDialog = async () => {
  render(
    <>
      <div id='about_window' />
      <AboutWindow />
    </>,
  );
  setAboutDialogVisible(true);
  return screen.findByText(/Version 0\.11\.20/);
};

describe('AboutWindow version label', () => {
  beforeEach(() => {
    mockWriteTextToClipboard.mockClear();
    mockDispatch.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('copies the version and webview info when clicked', async () => {
    const label = await openDialog();

    fireEvent.click(label);

    await waitFor(() => expect(mockWriteTextToClipboard).toHaveBeenCalledTimes(1));
    expect(mockWriteTextToClipboard).toHaveBeenCalledWith('Version 0.11.20 (Chrome 148)');
  });

  it('shows a toast confirming the copy', async () => {
    const label = await openDialog();

    fireEvent.click(label);

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ message: 'Copied to clipboard' }),
      ),
    );
  });

  it('keeps the plain-text look of the label', async () => {
    const label = await openDialog();

    // Same typography classes as the non-clickable label it replaces, and no
    // daisyUI button chrome that would change how it renders.
    expect(label.className).toContain('text-neutral-content');
    expect(label.className).toContain('text-center');
    expect(label.className).toContain('text-sm');
    expect(label.className).not.toContain('btn');
  });

  it('exposes the label as an accessible control', async () => {
    const label = await openDialog();

    expect(label.tagName).toBe('BUTTON');
    expect(label.getAttribute('title')).toBe('Copy');
  });
});

describe('AboutWindow local edition story', () => {
  afterEach(() => {
    cleanup();
  });

  it('introduces 墨书 with the 小墨 IP and its own reading proposition', async () => {
    await openDialog();

    expect(screen.getByTestId('modian-mascot')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '读进去，也想明白' })).toBeTruthy();
    expect(screen.getByText(/把原文、笔记、疑问与小墨放在同一条阅读路径里/)).toBeTruthy();
    expect(screen.getByText('三种阅读方式')).toBeTruthy();
    expect(screen.getByText('回答可回到原文')).toBeTruthy();
    expect(screen.getByText('书籍与思考留在本机')).toBeTruthy();
  });

  it('keeps Readest attribution, original copyright, and AGPL links in a secondary disclosure', async () => {
    await openDialog();

    const disclosure = screen.getByText('开源许可').closest('details');
    expect(disclosure).toBeTruthy();
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(screen.getByText(/Bilingify LLC\. All rights reserved\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Readest 源代码' }).getAttribute('href')).toBe(
      'https://github.com/readest/readest',
    );
    expect(screen.getByRole('link', { name: 'GNU AGPL v3' }).getAttribute('href')).toBe(
      'https://www.gnu.org/licenses/agpl-3.0.html',
    );
  });

  it('uses a compact responsive dialog width instead of a fixed tall composition', async () => {
    await openDialog();

    const container = screen.getByTestId('modian-mascot').closest('[data-box-class]');
    expect(container?.getAttribute('data-box-class')).toContain('sm:max-w-[620px]');
    expect(container?.getAttribute('data-box-class')).toContain('sm:max-h-[min(760px,90vh)]');
  });
});
