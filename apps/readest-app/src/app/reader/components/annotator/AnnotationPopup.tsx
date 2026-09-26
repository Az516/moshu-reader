import clsx from 'clsx';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PiDotsThreeBold } from 'react-icons/pi';
import { Position } from '@/utils/sel';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import Popup from '@/components/Popup';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/primitives/dropdown-menu';
import AnnotationToolButton from './AnnotationToolButton';
import AnnotationNoteEditor from './AnnotationNoteEditor';
import AnnotationNotes from './AnnotationNotes';
import HighlightOptions from './HighlightOptions';

export interface AnnotationNoteEditorTarget {
  value: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}

interface AnnotationPopupProps {
  bookKey: string;
  dir: 'ltr' | 'rtl';
  isVertical: boolean;
  buttons: Array<{
    tooltipText: string;
    Icon: React.ElementType;
    onClick: () => void;
    disabled?: boolean;
    visible?: boolean;
    label?: string;
  }>;
  notes: BookNote[];
  /**
   * Set while the Annotate action is collecting a note for the selection. It
   * takes over the popup body: the toolbar's job is done, and the note the
   * user is typing is the only thing they care about (#5987).
   */
  noteEditor?: AnnotationNoteEditorTarget | null;
  /** Opens `noteEditor` on an existing note (the bubble's pencil). */
  onEditNote?: (note: BookNote) => void;
  position: Position;
  trianglePosition: Position;
  highlightOptionsVisible: boolean;
  selectedStyle: HighlightStyle;
  selectedColor: HighlightColor;
  popupWidth: number;
  popupHeight: number;
  globalToggleAvailable?: boolean;
  globalToggleActive?: boolean;
  onToggleGlobal?: () => void;
  onHighlight: (update?: boolean) => void;
  onDismiss: () => void;
}

type ToolbarButton = AnnotationPopupProps['buttons'][number];

const toolName = (button: ToolbarButton) =>
  button.label || button.tooltipText.split(' · ', 1)[0] || button.tooltipText;

export const countToolbarButtonsThatFit = (
  widths: number[],
  available: number,
  overflowWidth: number,
  gap = 4,
) => {
  const allWidth = widths.reduce((sum, width) => sum + width, 0);
  if (allWidth + gap * Math.max(0, widths.length - 1) <= available) return widths.length;

  let used = overflowWidth;
  let count = 0;
  for (const width of widths) {
    const next = used + gap + width;
    if (next > available) break;
    used = next;
    count += 1;
  }
  return count;
};

/**
 * Measures the rendered controls instead of guessing from translated label
 * length. This keeps the toolbar on one row in every locale while preserving
 * every action in the overflow menu.
 */
const useVisibleButtonCount = (
  buttons: ToolbarButton[],
  isVertical: boolean,
  popupWidth: number,
) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(buttons.length);

  const measure = useCallback(() => {
    if (isVertical) {
      setVisibleCount(buttons.length);
      return;
    }
    const toolbar = toolbarRef.current;
    const measureBox = measureRef.current;
    if (!toolbar || !measureBox) return;

    const items = Array.from(measureBox.querySelectorAll<HTMLElement>('[data-measure-tool]'));
    const more = measureBox.querySelector<HTMLElement>('[data-measure-more]');
    if (items.length !== buttons.length || !more) return;

    const toolbarStyle = getComputedStyle(toolbar);
    const available =
      toolbar.clientWidth -
      Number.parseFloat(toolbarStyle.paddingInlineStart || '0') -
      Number.parseFloat(toolbarStyle.paddingInlineEnd || '0');
    setVisibleCount(
      countToolbarButtonsThatFit(
        items.map((item) => item.getBoundingClientRect().width),
        available,
        more.getBoundingClientRect().width,
      ),
    );
  }, [buttons, isVertical]);

  useLayoutEffect(() => {
    measure();
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [measure, popupWidth]);

  return { toolbarRef, measureRef, visibleCount };
};

const AnnotationPopup: React.FC<AnnotationPopupProps> = ({
  bookKey,
  dir,
  isVertical,
  buttons,
  notes,
  noteEditor,
  onEditNote,
  position,
  trianglePosition,
  highlightOptionsVisible,
  selectedStyle,
  selectedColor,
  popupWidth,
  popupHeight,
  globalToggleAvailable,
  globalToggleActive,
  onToggleGlobal,
  onHighlight,
  onDismiss,
}) => {
  // Tall enough for a few lines plus the Cancel/Save row, so the editor opens
  // at a usable size instead of the 44px toolbar height it replaces.
  const noteEditorSize = useResponsiveSize(180);
  // The popup's own box, with the vertical-writing swap already applied — the
  // same values AnnotationNotes and HighlightOptions are handed.
  const boxWidth = isVertical ? popupHeight : popupWidth;
  const boxHeight = isVertical ? popupWidth : popupHeight;
  const visibleButtons = buttons.filter((button) => button.visible !== false);
  const { toolbarRef, measureRef, visibleCount } = useVisibleButtonCount(
    visibleButtons,
    isVertical,
    popupWidth,
  );
  const directButtons = isVertical ? visibleButtons : visibleButtons.slice(0, visibleCount);
  const overflowButtons = isVertical ? [] : visibleButtons.slice(visibleCount);
  return (
    // The toolbar opens against the selection, which is where the range
    // editors' handles hang: the two overlap by design, and whichever layer
    // wins owns those pixels. The handles are grab targets, so they take it —
    // under the toolbar their covered part stops dragging and fires whichever
    // tool button it landed on instead. Hence z-[43], below the handle layer
    // (z-[44]) but still above the paragraph/TTS chrome (z-40). Every other
    // popup surface stays at z-50 and above the handles, so the wrapper is
    // only here to put this one at 43.
    //
    // `absolute`, never `fixed`: `position` is in the book cell's coordinate
    // space (Annotator subtracts `#gridcell-<bookKey>`'s rect), and the cell
    // is the popup's `relative` ancestor. A fixed wrapper re-anchors the popup
    // to the viewport, which drops it `cell.left` px to the left of the
    // selection the moment the cell leaves the viewport origin — sidebar open,
    // or any book past the first in a split view. Inset to the cell, this
    // still makes the stacking context without moving anything.
    // `pointer-events-none` keeps the cell-covering wrapper from swallowing
    // the taps outside the popup that dismiss it.
    <div dir={dir} className='pointer-events-none absolute inset-0 z-[43]'>
      <Popup
        width={boxWidth}
        height={boxHeight}
        minHeight={boxHeight}
        position={position}
        trianglePosition={trianglePosition}
        className={clsx(
          'selection-popup pointer-events-auto',
          (notes.length > 0 || noteEditor) && 'bg-transparent',
        )}
        onDismiss={onDismiss}
      >
        <div className={clsx('flex h-full gap-4', isVertical ? 'flex-row' : 'flex-col')}>
          <div
            ref={toolbarRef}
            className={clsx(
              'selection-buttons relative flex h-full w-full min-w-0 items-center justify-start gap-1 p-1.5',
              isVertical ? 'flex-col overflow-y-auto' : 'flex-row overflow-hidden',
              (notes.length > 0 || noteEditor) && 'hidden',
            )}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {directButtons.map((button, index) => (
              <AnnotationToolButton
                key={`${button.tooltipText}-${index}`}
                showTooltip={!highlightOptionsVisible}
                tooltipText={button.tooltipText}
                Icon={button.Icon}
                onClick={button.onClick}
                disabled={button.disabled}
                label={isVertical ? undefined : button.label}
              />
            ))}
            {overflowButtons.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    aria-label='更多工具'
                    className={clsx(
                      'flex h-9 min-h-9 w-9 shrink-0 items-center justify-center rounded-md',
                      'not-eink:hover:bg-base-200 eink:hover:border',
                      '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:w-11',
                    )}
                  >
                    <PiDotsThreeBold className='text-xl' />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  // The highlight style/color strip occupies the selection-
                  // facing side, so open More on the other side of the bar.
                  side={trianglePosition.dir === 'down' ? 'top' : 'bottom'}
                  sideOffset={8}
                  collisionPadding={10}
                  className='eink-bordered z-[120] min-w-40'
                >
                  {overflowButtons.map((button, index) => {
                    const Icon = button.Icon;
                    return (
                      <DropdownMenuItem
                        key={`${button.tooltipText}-${index}`}
                        disabled={button.disabled}
                        aria-label={toolName(button)}
                        className='min-h-9 whitespace-nowrap [@media(pointer:coarse)]:min-h-11'
                        onSelect={button.onClick}
                      >
                        <Icon />
                        <span>{toolName(button)}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div
              ref={measureRef}
              aria-hidden='true'
              inert
              className='pointer-events-none invisible fixed top-0 -left-[10000px] flex items-center gap-1'
            >
              {visibleButtons.map((button, index) => {
                const Icon = button.Icon;
                return (
                  <span
                    key={`${button.tooltipText}-${index}`}
                    data-measure-tool
                    className={clsx(
                      'flex h-9 shrink-0 items-center justify-center gap-1.5',
                      '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11',
                      button.label ? 'min-w-max px-3 text-[13px] font-medium leading-none' : 'w-9',
                    )}
                  >
                    <Icon className='shrink-0 text-lg' />
                    {button.label && <span className='whitespace-nowrap'>{button.label}</span>}
                  </span>
                );
              })}
              <span
                data-measure-more
                className='h-9 w-9 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11'
              />
            </div>
          </div>
          {noteEditor ? (
            <AnnotationNoteEditor
              value={noteEditor.value}
              isVertical={isVertical}
              // Same chrome recipe as Popup's own container, so the editor
              // reads as a panel over the page rather than a shadowless block
              // in the page's own colour.
              className={clsx(
                'annotation-note-editor popup-container text-base-content absolute rounded-lg border',
                'not-eink:border-base-content/20 not-eink:shadow-2xl',
                'bg-base-300 theme-dark:bg-base-100',
              )}
              // Anchored to the popup's triangle edge and grown away from it,
              // exactly like AnnotationNotes, so the editor covers the toolbar
              // instead of drifting off the selection.
              style={
                isVertical
                  ? {
                      right: trianglePosition.dir === 'left' ? 0 : undefined,
                      left: trianglePosition.dir === 'right' ? 0 : undefined,
                      height: `${boxHeight}px`,
                      width: `${noteEditorSize}px`,
                    }
                  : {
                      top: trianglePosition.dir === 'down' ? 0 : undefined,
                      bottom: trianglePosition.dir === 'up' ? 0 : undefined,
                      width: `${boxWidth}px`,
                      height: `${noteEditorSize}px`,
                    }
              }
              onSave={noteEditor.onSave}
              onCancel={noteEditor.onCancel}
            />
          ) : notes.length > 0 ? (
            <AnnotationNotes
              bookKey={bookKey}
              isVertical={isVertical}
              notes={notes}
              onEditNote={onEditNote}
              toolsVisible={false}
              triangleDir={trianglePosition.dir!}
              popupWidth={boxWidth}
              popupHeight={boxHeight}
              onDismiss={onDismiss}
            />
          ) : (
            highlightOptionsVisible && (
              <HighlightOptions
                isVertical={isVertical}
                triangleDir={trianglePosition.dir!}
                popupWidth={boxWidth}
                popupHeight={boxHeight}
                selectedStyle={selectedStyle}
                selectedColor={selectedColor}
                globalToggleAvailable={globalToggleAvailable}
                globalToggleActive={globalToggleActive}
                onToggleGlobal={onToggleGlobal}
                onHandleHighlight={onHighlight}
              />
            )
          )}
        </div>
      </Popup>
    </div>
  );
};

export default AnnotationPopup;
