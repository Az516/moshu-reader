'use client';

import React, { useId } from 'react';
import clsx from 'clsx';
import { MdCenterFocusWeak, MdTune } from 'react-icons/md';
import Dropdown from '@/components/Dropdown';
import BoxedList from '@/components/settings/primitives/BoxedList';
import SettingsSwitchRow from '@/components/settings/primitives/SettingsSwitchRow';
import { useTranslation } from '@/hooks/useTranslation';
import { useFocusGuideStore, useHydrateFocusGuide } from './store';

export interface FocusGuideControlProps {
  className?: string;
}

const FocusGuideControl: React.FC<FocusGuideControlProps> = ({ className }) => {
  useHydrateFocusGuide();
  const _ = useTranslation();
  const id = useId();
  const enabled = useFocusGuideStore((s) => s.enabled);
  const intensity = useFocusGuideStore((s) => s.intensity);
  const contextLines = useFocusGuideStore((s) => s.contextLines);
  const setEnabled = useFocusGuideStore((s) => s.setEnabled);
  const setIntensity = useFocusGuideStore((s) => s.setIntensity);
  const setContextLines = useFocusGuideStore((s) => s.setContextLines);
  return (
    <div className={clsx('flex items-center gap-0.5', className)}>
      <button
        type='button'
        aria-label={_('Visual follow')}
        aria-pressed={enabled}
        title={_('Visual follow')}
        onClick={() => setEnabled(!enabled)}
        className={clsx(
          'btn btn-ghost btn-circle min-h-10 min-w-10 focus-visible:ring-2 focus-visible:ring-base-content/15',
          enabled && 'bg-base-300 eink-bordered',
        )}
      >
        <MdCenterFocusWeak aria-hidden='true' size={22} />
      </button>
      <Dropdown
        label={_('Visual follow settings')}
        buttonClassName='btn btn-ghost btn-circle min-h-10 min-w-10'
        toggleButton={<MdTune aria-hidden='true' size={18} />}
      >
        <div className='dropdown-content bg-base-100 eink-bordered border-base-300 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border p-4 shadow-lg'>
          <h2 className='text-lg font-semibold tracking-tight'>{_('Visual follow')}</h2>
          <p className='text-base-content/70 mb-3 mt-1 text-sm leading-relaxed'>
            {_('Move the pointer over a line to keep your place. Selecting text pauses the guide.')}
          </p>
          <BoxedList>
            <SettingsSwitchRow
              label={_('Enable visual follow')}
              checked={enabled}
              onChange={() => setEnabled(!enabled)}
            />
            <div className='space-y-2 py-3 pe-4'>
              <label
                htmlFor={`${id}-intensity`}
                className='flex items-center justify-between text-sm'
              >
                <span>{_('Background softening')}</span>
                <output>{Math.round(intensity * 100)}%</output>
              </label>
              <input
                id={`${id}-intensity`}
                type='range'
                min={0}
                max={35}
                step={1}
                value={Math.round(intensity * 100)}
                onChange={(event) => setIntensity(Number(event.target.value) / 100)}
                className='range range-sm w-full'
              />
            </div>
            <div className='space-y-2 py-3 pe-4'>
              <label
                htmlFor={`${id}-context`}
                className='flex items-center justify-between text-sm'
              >
                <span>{_('Clear lines on each side')}</span>
                <output>{contextLines}</output>
              </label>
              <input
                id={`${id}-context`}
                type='range'
                min={0}
                max={4}
                step={1}
                value={contextLines}
                onChange={(event) => setContextLines(Number(event.target.value))}
                className='range range-sm w-full'
              />
            </div>
          </BoxedList>
          <p className='text-base-content/65 mt-3 text-xs leading-relaxed'>
            {_('Available for horizontal, single-column EPUB. Other layouts keep normal reading.')}
          </p>
        </div>
      </Dropdown>
    </div>
  );
};

export default FocusGuideControl;
