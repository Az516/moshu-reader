'use client';

import { useRef, useState, type PointerEvent } from 'react';

export default function PanelDivider({
  label,
  value,
  min,
  max,
  onMove,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onMove: (delta: number) => void;
}) {
  const position = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    position.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div
      className='book-notes-divider'
      data-dragging={dragging}
      role='separator'
      aria-orientation='vertical'
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, Math.round(max))}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title='拖动调整宽度，也可使用左右方向键'
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        position.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (position.current === null) return;
        const delta = event.clientX - position.current;
        position.current = event.clientX;
        const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
        onMove(delta * direction);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={() => {
        position.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
        onMove((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 50 : 10) * direction);
      }}
    />
  );
}
