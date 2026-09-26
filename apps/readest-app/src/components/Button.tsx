import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { loadShortcuts, type ShortcutAction } from '@/helpers/shortcuts';
import { isMacPlatform } from '@/services/environment';
import { filterPlatformKeys, formatKeyForDisplay } from '@/utils/shortcutKeys';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/primitives/tooltip';

const buttonDescriptions: { label: string; purpose: string; action?: ShortcutAction }[] = [
  { label: 'Toggle Sidebar', purpose: '查看目录、书内搜索与标记', action: 'onToggleSideBar' },
  { label: 'Notebook', purpose: '查看本书的标记和笔记', action: 'onToggleNotebook' },
  {
    label: 'Table of Contents',
    purpose: '选择章节并回到书中位置',
    action: 'onOpenTableOfContents',
  },
  { label: 'Add Bookmark', purpose: '为当前阅读位置添加书签', action: 'onToggleBookmark' },
  { label: 'Remove Bookmark', purpose: '移除当前阅读位置的书签', action: 'onToggleBookmark' },
  { label: 'Previous Page', purpose: '回到前一页', action: 'onGoPrev' },
  { label: 'Next Page', purpose: '继续阅读下一页', action: 'onGoNext' },
  { label: 'Previous Section', purpose: '回到上一章节', action: 'onGoPrevSection' },
  { label: 'Next Section', purpose: '跳到下一章节', action: 'onGoNextSection' },
  { label: 'Go Back', purpose: '返回上次阅读位置', action: 'onGoBack' },
  { label: 'Go Forward', purpose: '前往下一处历史阅读位置', action: 'onGoForward' },
  { label: 'Speak', purpose: '打开朗读控制与声音设置', action: 'onToggleTTS' },
  { label: 'Color', purpose: '调整阅读页面的颜色与亮度' },
  { label: 'Reading Progress', purpose: '查看进度并跳转阅读位置' },
  {
    label: 'Font & Layout',
    purpose: '调整字体、字号与页面布局',
    action: 'onOpenFontLayoutSettings',
  },
  { label: 'Enable Translation', purpose: '在正文中显示翻译' },
  { label: 'Disable Translation', purpose: '收起正文中的翻译' },
  { label: 'Translation Disabled', purpose: '当前书籍或语言暂不支持翻译' },
];

interface ButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

const Button: React.FC<ButtonProps> = ({ icon, onClick, disabled = false, label, className }) => {
  const { appService } = useEnv();
  const _ = useTranslation();
  const description = buttonDescriptions.find(
    (item) => _(item.label) === label || item.label === label,
  );
  const readShortcut = () => {
    const isMac = isMacPlatform();
    const keys = description?.action
      ? filterPlatformKeys(loadShortcuts()[description.action].keys, isMac)
      : [];
    return keys.map((key) => formatKeyForDisplay(key, isMac)).join(' / ') || _('无快捷键');
  };
  const [shortcut, setShortcut] = useState(readShortcut);
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={0}>
      <Tooltip
        onOpenChange={(open) => {
          if (open) setShortcut(readShortcut());
        }}
      >
        <TooltipTrigger asChild>
          <span className='inline-flex' tabIndex={disabled ? 0 : undefined}>
            <button
              type='button'
              className={clsx(
                // 32px of icon is below the 44px mobile touch target (DESIGN.md), and
                // in the reader bars a miss falls through to the book and turns the
                // page (#5401), so every one of these carries the halo.
                'touch-target btn btn-ghost h-8 min-h-8 w-8 p-0',
                appService?.isMobileApp && 'hover:bg-transparent',
                disabled && 'cursor-default bg-transparent! opacity-50',
                className,
              )}
              aria-label={label}
              aria-disabled={disabled || undefined}
              onClick={disabled ? undefined : onClick}
            >
              {icon}
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side='bottom' className='eink-bordered z-[120]'>
          {label} · {_(description?.purpose || '执行此阅读操作')} <kbd>{shortcut}</kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default Button;
