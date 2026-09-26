import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import LocalReaderRecoveryNotice from './LocalReaderRecoveryNotice';

const notices = vi.hoisted(() => ({
  values: [] as { path: string; base: 'Books'; recoveredAt: string; corruptPath?: string }[],
}));
vi.mock('@/services/localReaderPersistence', () => ({
  LOCAL_READER_RECOVERED_EVENT: 'local-reader-recovered',
  getLocalReaderRecoveryNotices: () => notices.values,
}));
afterEach(() => {
  cleanup();
  notices.values = [];
});

describe('local reading recovery notice', () => {
  it('shows earlier recoveries and can dismiss the notice without removing preserved-file information', () => {
    notices.values = [
      {
        path: 'book/reading-method.json',
        base: 'Books',
        recoveredAt: '2026-09-24',
        corruptPath: 'book/reading-method.json.corrupt-1',
      },
    ];
    render(<LocalReaderRecoveryNotice service={{} as AppService} />);
    expect(screen.getByRole('status').textContent).toContain('已从本机备份恢复');
    expect(screen.getByText('book/reading-method.json.corrupt-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(notices.values).toHaveLength(1);
  });

  it('shows a recovery that happens after mounting', () => {
    render(<LocalReaderRecoveryNotice service={{} as AppService} />);
    expect(screen.queryByRole('status')).toBeNull();
    notices.values = [
      { path: 'book/reading-modes.json', base: 'Books', recoveredAt: '2026-09-24' },
    ];
    fireEvent(window, new CustomEvent('local-reader-recovered', { detail: notices.values[0] }));
    expect(screen.getByRole('status').textContent).toContain('已从本机备份恢复');
  });
});
