'use client';

import { useSettingsStore } from '@/store/settingsStore';
import './mascot.css';

export type ModianMascotMood = 'reading' | 'research' | 'question';
export type ModianMascotMotion = 'none' | 'idle' | 'enter' | 'working' | 'success';

const assets: Record<ModianMascotMood, string> = {
  reading: '/modian/reading.webp',
  research: '/modian/research.webp',
  question: '/modian/question.webp',
};

export default function ModianMascot({
  mood,
  size = 40,
  motion = 'enter',
  className = '',
}: {
  mood: ModianMascotMood;
  size?: number;
  motion?: ModianMascotMotion;
  className?: string;
}) {
  const isEink = useSettingsStore((state) => state.settings.globalViewSettings?.isEink);
  return (
    <picture className='modian-mascot-picture'>
      {!isEink && motion !== 'none' && (
        <source
          srcSet={`/modian/${mood}-motion.webp`}
          type='image/webp'
          media='(prefers-reduced-motion: no-preference)'
        />
      )}
      <img
        className={`modian-mascot ${className}`.trim()}
        src={assets[mood]}
        alt=''
        aria-hidden='true'
        width={size}
        height={size}
        data-testid='modian-mascot'
        data-mood={mood}
        data-motion={motion}
      />
    </picture>
  );
}
