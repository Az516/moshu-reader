import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DropdownProvider } from '@/context/DropdownContext';
import FollowStyleMenu from './FollowStyleMenu';

afterEach(cleanup);

it('keeps the two visual styles separate from the lock-line switch', () => {
  const onChange = vi.fn();
  const onLockLineChange = vi.fn();
  render(
    <DropdownProvider>
      <FollowStyleMenu
        value='classic'
        lockLine
        onChange={onChange}
        onLockLineChange={onLockLineChange}
      />
    </DropdownProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '跟随样式' }));
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.getByRole('radio', { name: '经典聚焦' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('switch', { name: '锁行' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('移入文字即可开始，点击文字可重新定位')).toBeTruthy();

  fireEvent.click(screen.getByRole('switch', { name: '锁行' }));
  expect(onLockLineChange).toHaveBeenCalledExactlyOnceWith(false);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole('switch', { name: '锁行' })).toBeNull();
  expect(screen.getByRole('button', { name: '跟随样式' }).getAttribute('aria-expanded')).toBe(
    'false',
  );

  fireEvent.click(screen.getByRole('button', { name: '跟随样式' }));
  expect(screen.getAllByRole('radio')).toHaveLength(2);

  fireEvent.click(screen.getByRole('radio', { name: '轻柔底纹' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('soft');
  expect(onLockLineChange).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('switch', { name: '锁行' })).toBeNull();
});
