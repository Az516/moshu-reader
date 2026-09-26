import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Button from '@/components/Button';
import AnnotationToolButton from '@/app/reader/components/annotator/AnnotationToolButton';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobileApp: false } }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
vi.mock('@/utils/misc', () => ({ stubTranslation: (value: string) => value }));
vi.mock('@/services/environment', () => ({ isMacPlatform: () => true }));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function hoverFor(button: HTMLElement, milliseconds: number) {
  fireEvent.pointerMove(button, { pointerType: 'mouse' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe('reader icon tooltips', () => {
  it('shows a name, purpose and no-shortcut note after 400ms while preserving the accessible label', async () => {
    render(<Button icon={<span />} label='Color' onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Color' });
    await hoverFor(button, 399);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('Color');
    expect(tooltip.textContent).toContain('调整阅读页面的颜色与亮度');
    expect(tooltip.textContent).toContain('无快捷键');
    expect(button.getAttribute('title')).toBeNull();
  });

  it('keeps selection-tool explanations available when highlight options are visible and after clicking', async () => {
    const note = annotationToolButtons.find((button) => button.type === 'annotate')!;
    const onClick = vi.fn();
    render(
      <AnnotationToolButton
        showTooltip={false}
        tooltipText='Annotate'
        Icon={note.Icon}
        onClick={onClick}
      />,
    );
    const button = screen.getByRole('button', { name: 'Annotate' });
    await hoverFor(button, 400);
    expect(screen.getByRole('tooltip').textContent).toContain('Annotate text after selection');
    expect(screen.getByRole('tooltip').textContent).toContain('⌘N');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.pointerLeave(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await hoverFor(button, 400);
    expect(screen.getByRole('tooltip').textContent).toContain('Annotate text after selection');
  });

  it('displays the configured shortcut when the reader changed a key binding', async () => {
    localStorage.setItem('customShortcuts', JSON.stringify({ onToggleSideBar: ['cmd+shift+s'] }));
    render(<Button icon={<span />} label='Toggle Sidebar' onClick={vi.fn()} />);
    await hoverFor(screen.getByRole('button', { name: 'Toggle Sidebar' }), 400);
    expect(screen.getByRole('tooltip').textContent).toContain('⌘⇧S');
  });
});
