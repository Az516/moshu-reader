'use client';

import { PiCheck, PiPalette, PiSlidersHorizontal } from 'react-icons/pi';
import Dropdown from '@/components/Dropdown';
import { useThemeStore } from '@/store/themeStore';
import { readingPaperThemes, themes, type ThemeMode } from '@/styles/themes';

const presets: Array<{
  label: string;
  mode: ThemeMode;
  color: string;
}> = [
  { label: '纯白', mode: 'light', color: 'default' },
  ...readingPaperThemes.map(({ name, label }) => ({ label, mode: 'light' as const, color: name })),
  { label: '夜间', mode: 'dark', color: 'default' },
];

export function ReadingBackgroundOptions({
  onCustom,
  setIsDropdownOpen,
}: {
  onCustom: () => void;
  setIsDropdownOpen?: (open: boolean) => void;
}) {
  const mode = useThemeStore((state) => state.readerThemeMode);
  const color = useThemeStore((state) => state.readerThemeColor);
  const setMode = useThemeStore((state) => state.setScopedThemeMode);
  const setColor = useThemeStore((state) => state.setScopedThemeColor);

  return (
    <div
      className='moshu-paper-menu dropdown-content no-triangle z-30 mt-1.5 eink-bordered'
      role='menu'
      aria-label='阅读背景'
    >
      <strong>阅读背景</strong>
      <div role='radiogroup' aria-label='纸张颜色'>
        {presets.map((preset) => {
          const selected = mode === preset.mode && color === preset.color;
          return (
            <button
              key={preset.label}
              type='button'
              role='radio'
              aria-checked={selected}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => {
                setMode('reader', preset.mode);
                setColor('reader', preset.color);
                setIsDropdownOpen?.(false);
              }}
            >
              <span
                className='moshu-paper-swatch'
                style={{
                  background: themes.find((theme) => theme.name === preset.color)?.colors[
                    preset.mode === 'dark' ? 'dark' : 'light'
                  ]['base-100'],
                }}
              />
              <span>{preset.label}</span>
              {selected && <PiCheck aria-hidden='true' />}
            </button>
          );
        })}
      </div>
      <button
        type='button'
        className='moshu-paper-custom'
        aria-label='自定义颜色'
        onClick={() => {
          setIsDropdownOpen?.(false);
          onCustom();
        }}
      >
        <PiSlidersHorizontal aria-hidden='true' />
        自定义颜色
      </button>
    </div>
  );
}

export default function ReadingBackgroundMenu({ onCustom }: { onCustom: () => void }) {
  return (
    <Dropdown
      label='阅读背景'
      showTooltip
      className='dropdown-end dropdown-bottom'
      buttonClassName='moshu-icon-button'
      toggleButton={<PiPalette />}
    >
      <ReadingBackgroundOptions onCustom={onCustom} />
    </Dropdown>
  );
}
