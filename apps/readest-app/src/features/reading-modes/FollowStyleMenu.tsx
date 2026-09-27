'use client';

import { PiCaretDown, PiCheck } from 'react-icons/pi';
import Dropdown from '@/components/Dropdown';
import type { FollowStyle } from './state';

const choices = [
  { value: 'classic', label: '经典聚焦', description: '保留原来的字句清晰窗' },
  { value: 'soft', label: '轻柔底纹', description: '浅底纹指读，全文保持清晰' },
] as const;

function FollowStyleOptions({
  value,
  lockLine,
  onChange,
  onLockLineChange,
  setIsDropdownOpen,
}: {
  value: FollowStyle;
  lockLine: boolean;
  onChange: (value: FollowStyle) => void;
  onLockLineChange: (checked: boolean) => void;
  setIsDropdownOpen?: (open: boolean) => void;
}) {
  return (
    <div className='moshu-follow-menu dropdown-content no-triangle eink-bordered'>
      <strong>跟随样式</strong>
      <div role='radiogroup' aria-label='跟随样式'>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type='button'
            role='radio'
            aria-label={choice.label}
            aria-checked={value === choice.value}
            onClick={() => {
              onChange(choice.value);
              setIsDropdownOpen?.(false);
            }}
          >
            <span>
              <span>{choice.label}</span>
              <small>{choice.description}</small>
            </span>
            {value === choice.value && <PiCheck aria-hidden='true' />}
          </button>
        ))}
      </div>
      <div className='moshu-follow-lock'>
        <button
          type='button'
          role='switch'
          aria-label='锁行'
          aria-checked={lockLine}
          onClick={() => {
            onLockLineChange(!lockLine);
            setIsDropdownOpen?.(false);
          }}
        >
          <span>
            <span>锁行</span>
            <small>上下移动不换行，行尾自动接下一行</small>
          </span>
          <span className='moshu-follow-switch' aria-hidden='true'>
            <span />
          </span>
        </button>
        {lockLine && <p>移入文字即可开始，点击文字可重新定位</p>}
      </div>
    </div>
  );
}

export default function FollowStyleMenu({
  value,
  lockLine,
  onChange,
  onLockLineChange,
}: {
  value: FollowStyle;
  lockLine: boolean;
  onChange: (value: FollowStyle) => void;
  onLockLineChange: (checked: boolean) => void;
}) {
  return (
    <Dropdown
      label='跟随样式'
      className='dropdown-end dropdown-bottom'
      buttonClassName='moshu-follow-style-button'
      toggleButton={<PiCaretDown />}
    >
      <FollowStyleOptions
        value={value}
        lockLine={lockLine}
        onChange={onChange}
        onLockLineChange={onLockLineChange}
      />
    </Dropdown>
  );
}
