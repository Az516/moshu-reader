import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  capture: vi.fn(),
  optIn: vi.fn(),
  checkUpdate: vi.fn(),
  fetchUpdate: vi.fn(),
  getAppService: vi.fn(),
}));

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      refreshSession: mocks.refreshSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
  },
}));
vi.mock('posthog-js', () => ({
  default: { capture: mocks.capture, opt_in_capturing: mocks.optIn },
}));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.checkUpdate }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetchUpdate }));
vi.mock('@/components/UpdaterWindow', () => ({ setUpdaterWindowVisible: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/access', () => ({ isCloudSyncAllowed: () => false }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: mocks.getAppService } }),
}));

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useDemoBooks } from '@/app/library/hooks/useDemoBooks';
import { mountAdditionalFonts } from '@/styles/fonts';
import { checkAppReleaseNotes, checkForAppUpdates } from '@/helpers/updater';
import { isReadestCloudEnabled } from '@/services/sync/cloudSyncProvider';
import { captureEvent, optInTelemetry, TELEMETRY_OPT_OUT_KEY } from '@/utils/telemetry';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('local edition isolation', () => {
  it('starts an empty library without fetching demo books or relying on a previous-launch flag', () => {
    const { result } = renderHook(useDemoBooks);
    expect(result.current).toEqual([]);
    expect(mocks.getAppService).not.toHaveBeenCalled();
    expect(localStorage.getItem('demoBooksFetched')).toBeNull();
  });

  it('ignores an existing upstream session without refreshing or subscribing to auth', () => {
    localStorage.setItem('token', 'existing-upstream-token');
    localStorage.setItem('user', JSON.stringify({ id: 'existing-upstream-user' }));
    const { result } = renderHook(useAuth, { wrapper: AuthProvider });

    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(mocks.onAuthStateChange).not.toHaveBeenCalled();
  });

  it('does not send telemetry even when an old setting opted in', () => {
    localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'false');
    optInTelemetry();
    captureEvent('reader_open', { book: 'private-book' });

    expect(mocks.optIn).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('keeps upstream cloud sync off even if a restored configuration enabled it', () => {
    expect(isReadestCloudEnabled(undefined)).toBe(false);
    expect(
      isReadestCloudEnabled({ readestCloud: { enabled: true } } as Parameters<
        typeof isReadestCloudEnabled
      >[0]),
    ).toBe(false);
  });

  it('does not inject remote font stylesheets when opening a book', async () => {
    const bookDocument = document.implementation.createHTMLDocument('Book');
    await mountAdditionalFonts(bookDocument, true);
    expect(bookDocument.querySelectorAll('link, style')).toHaveLength(0);
  });

  it('does not contact the updater or release-note endpoint for automatic or manual checks', async () => {
    const translate = ((key: string) => key) as Parameters<typeof checkForAppUpdates>[0];
    expect(await checkForAppUpdates(translate, true)).toBe(false);
    expect(await checkForAppUpdates(translate, false)).toBe(false);
    expect(await checkAppReleaseNotes(false)).toBe(false);
    expect(mocks.checkUpdate).not.toHaveBeenCalled();
    expect(mocks.fetchUpdate).not.toHaveBeenCalled();
    expect(localStorage.getItem('lastAppUpdateCheck')).toBeNull();
  });
});
