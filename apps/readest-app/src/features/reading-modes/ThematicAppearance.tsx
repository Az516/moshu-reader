'use client';

import { useRef, type KeyboardEvent } from 'react';
import { FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { useThemeStore } from '@/store/themeStore';

const options = [
  { mode: 'light', label: '亮色', Icon: FiSun },
  { mode: 'dark', label: '暗色', Icon: FiMoon },
  { mode: 'auto', label: '跟随系统', Icon: FiMonitor },
] as const;

export default function ThematicAppearance() {
  const mode = useThemeStore((state) => state.readerThemeMode);
  const setMode = useThemeStore((state) => state.setScopedThemeMode);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.mode === mode);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + options.length) % options.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = options.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const option = options[nextIndex];
    if (!option) return;
    setMode('reader', option.mode);
    buttons.current[nextIndex]?.focus();
  };

  return (
    <div className='thematic-appearance' role='radiogroup' aria-label='主题外观'>
      {options.map(({ mode: optionMode, label, Icon }, index) => (
        <button
          key={optionMode}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type='button'
          role='radio'
          aria-checked={mode === optionMode}
          tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
          onClick={() => setMode('reader', optionMode)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <Icon aria-hidden='true' />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
