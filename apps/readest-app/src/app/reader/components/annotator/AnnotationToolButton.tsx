import clsx from 'clsx';
import React, { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { loadShortcuts } from '@/helpers/shortcuts';
import { isMacPlatform } from '@/services/environment';
import { filterPlatformKeys, formatKeyForDisplay } from '@/utils/shortcutKeys';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/primitives/tooltip';
import { annotationToolButtons } from './AnnotationTools';
import styles from './AnnotationPopup.module.css';

interface AnnotationToolButtonProps {
  showTooltip: boolean;
  tooltipText: string;
  disabled?: boolean;
  Icon: React.ElementType;
  onClick: () => void;
  label?: string;
  emphasized?: boolean;
}

const AnnotationToolButton: React.FC<AnnotationToolButtonProps> = ({
  showTooltip: _showTooltip,
  tooltipText,
  disabled,
  Icon,
  onClick,
  label,
  emphasized,
}) => {
  const _ = useTranslation();
  const tool = annotationToolButtons.find(
    (item) => _(item.label) === tooltipText || item.Icon === Icon,
  );
  const name = tool ? _(tool.label) : tooltipText;
  const purpose = tool
    ? _(tool.tooltip)
    : tooltipText === _('Delete Highlight')
      ? _('移除所选文字的高亮')
      : _('操作当前选文');
  const readShortcut = () => {
    const isMac = isMacPlatform();
    if (tool?.shortcut) return formatKeyForDisplay(tool.shortcut, isMac);
    const keys = tool?.shortcutAction
      ? filterPlatformKeys(loadShortcuts()[tool.shortcutAction].keys, isMac)
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
          <span
            className='inline-flex shrink-0'
            data-selection-tool
            tabIndex={disabled ? 0 : undefined}
          >
            <button
              type='button'
              onClick={onClick}
              aria-label={tooltipText}
              className={clsx(
                'flex h-9 min-h-9 shrink-0 items-center justify-center gap-1.5 p-0',
                '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
                styles['tool'],
                label ? styles['labeledTool'] : 'w-9',
                emphasized && styles['conversationTool'],
                disabled
                  ? 'cursor-not-allowed opacity-50'
                  : 'not-eink:hover:bg-base-200 eink:hover:border rounded-md',
              )}
              disabled={disabled}
            >
              <Icon className='shrink-0 text-xl' />
              {label && (
                <span data-tool-label className='whitespace-nowrap leading-none'>
                  {label}
                </span>
              )}
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side='bottom' className='eink-bordered z-[120]'>
          {name} · {purpose} <kbd>{shortcut}</kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default AnnotationToolButton;
