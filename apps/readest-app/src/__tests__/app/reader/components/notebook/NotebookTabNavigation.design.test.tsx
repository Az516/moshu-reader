import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookTabNavigation from '@/app/reader/components/notebook/NotebookTabNavigation';

const h = vi.hoisted(() => ({ aiEnabled: false }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { aiSettings: { enabled: h.aiEnabled } } }),
}));

beforeEach(() => {
  h.aiEnabled = false;
});

afterEach(cleanup);

describe('NotebookTabNavigation design regression', () => {
  it('keeps reading and notes available when the upstream AI panel is disabled', () => {
    render(<NotebookTabNavigation activeTab='notes' onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '阅读助手' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'AI' })).toBeNull();
  });

  it('shows the Notes and AI tabs when AI is enabled', () => {
    h.aiEnabled = true;
    render(<NotebookTabNavigation activeTab='notes' onTabChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '阅读助手' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AI' })).toBeTruthy();
  });
});
