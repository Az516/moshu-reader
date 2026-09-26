import type { ButtonHTMLAttributes, ReactNode } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/primitives/tooltip';
export default function IconButton({
  label,
  purpose,
  shortcut = '无快捷键',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  purpose: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type='button' className='moshu-icon-button' aria-label={label} {...props}>
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side='bottom'>
          {label} · {purpose} <kbd>{shortcut}</kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
