'use client';

import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

/** Keep the reader's theme while Radix owns keyboard focus and background isolation. */
export default function ThematicDialog({
  label,
  className,
  onClose,
  children,
}: {
  label: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const origin = useRef(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Overlay className='thematic-drawer-backdrop'>
        <Dialog.Content
          className={className}
          aria-describedby={undefined}
          onKeyDownCapture={(event) => {
            // Focused icon tooltips have their own Radix layer. Escape should
            // dismiss this reader dialog even while its tooltip is open.
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const details = origin.current?.closest('details');
            const target =
              details && !details.open ? details.querySelector('summary') : origin.current;
            if (target instanceof HTMLElement && target.isConnected) target.focus();
          }}
        >
          <Dialog.Title className='sr-only'>{label}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Root>
  );
}
