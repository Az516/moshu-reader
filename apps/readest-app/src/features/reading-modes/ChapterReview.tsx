import { useState } from 'react';
import { PiX } from 'react-icons/pi';
import type { Reconstruction } from './state';
import IconButton from './IconButton';
export const reconstructionFields = [
  ['question', '作者的问题'],
  ['concepts', '核心概念'],
  ['proposition', '核心命题'],
  ['argument', '理由与证据'],
  ['position', '本章在全书中的位置'],
] as const;
export const emptyReconstruction = (): Reconstruction => ({
  question: '',
  concepts: '',
  proposition: '',
  argument: '',
  position: '',
  confirmed: false,
});
export default function ChapterReview({
  chapter,
  value,
  onSave,
  onClose,
}: {
  chapter: string;
  value?: Reconstruction;
  onSave: (value: Reconstruction) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value || emptyReconstruction());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className='moshu-overlay'>
      <form
        className='moshu-sheet'
        aria-label='章末重构'
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onSave(draft);
            onClose();
          } catch {
            setError('保存失败，请重试。');
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <div>
            <small>{chapter}</small>
            <h2>把作者的思路，重新连起来</h2>
          </div>
          <IconButton label='关闭重构' purpose='继续阅读' shortcut='Esc' onClick={onClose}>
            <PiX />
          </IconButton>
        </header>
        {reconstructionFields.map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              required
              aria-label={label}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              placeholder='先用自己的话表达，再回到原文核对'
            />
          </label>
        ))}
        <label className='moshu-check'>
          <input
            type='checkbox'
            checked={draft.confirmed}
            onChange={(e) => setDraft({ ...draft, confirmed: e.target.checked })}
          />
          我已对照原文，确认自己准确理解作者
        </label>
        {error && <p role='alert'>{error}</p>}
        <footer>
          <button className='moshu-primary' disabled={busy} type='submit'>
            保存本章重构
          </button>
        </footer>
      </form>
    </div>
  );
}
