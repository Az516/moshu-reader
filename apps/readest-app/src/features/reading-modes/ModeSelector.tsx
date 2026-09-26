'use client';
import {
  PiArrowLeft,
  PiArrowRight,
  PiListDashes,
  PiGraph,
  PiBooks,
  PiBookOpen,
} from 'react-icons/pi';
import type { Book } from '@/types/book';
import type { ReadingMode } from './state';
import ModianMascot from './ModianMascot';
export const modeNames = { quick: '快速阅读', analytical: '分析阅读', thematic: '主题阅读' };
const choices = [
  {
    mode: 'quick' as const,
    Icon: PiListDashes,
    text: '浏览全书，发现重点',
  },
  {
    mode: 'analytical' as const,
    Icon: PiGraph,
    text: '细读原文，记录思考',
  },
  {
    mode: 'thematic' as const,
    Icon: PiBooks,
    text: '围绕问题，连接多本书',
  },
];
export default function ModeSelector({
  book,
  onSelect,
  onCancel,
}: {
  book: Book;
  onSelect: (mode: ReadingMode) => void;
  onCancel?: () => void;
}) {
  return (
    <section className='moshu-selector' aria-label='选择阅读方式'>
      <div className='moshu-selector-content'>
        <div className='moshu-book-intro'>
          {book.coverImageUrl ? (
            <img src={book.coverImageUrl} alt={`${book.title}封面`} />
          ) : (
            <PiBookOpen aria-hidden='true' className='moshu-coverless' />
          )}
          <div>
            <h2 title={book.title}>{book.title}</h2>
            <p title={book.author}>{book.author}</p>
          </div>
        </div>
        <div className='moshu-selector-heading'>
          <ModianMascot className='moshu-selector-mascot' mood='reading' size={88} motion='enter' />
          <h1>选择阅读方式</h1>
        </div>
        <div className='moshu-mode-options'>
          {choices.map(({ mode, Icon, text }) => (
            <button
              type='button'
              className='moshu-mode-option eink-bordered'
              key={mode}
              onClick={() => onSelect(mode)}
            >
              <Icon className='moshu-mode-icon' aria-hidden='true' />
              <div className='moshu-mode-copy'>
                <h2>{modeNames[mode]}</h2>
                <p>{text}</p>
              </div>
              <PiArrowRight className='moshu-mode-arrow' aria-hidden='true' />
            </button>
          ))}
        </div>
        {onCancel && (
          <button className='moshu-selector-back' type='button' onClick={onCancel}>
            <PiArrowLeft aria-hidden='true' /> 返回阅读
          </button>
        )}
      </div>
    </section>
  );
}
