'use client';
import { memo, useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './answer.css';

/** All HTML remains escaped; numbered citations are handled inside the app. */
export default memo(function AnswerMarkdown({
  text,
  citationCount = 0,
  onCitation,
}: {
  text: string;
  citationCount?: number;
  onCitation?: (index: number) => void;
}) {
  const content = text.replace(/\[(\d+)\](?!\()/g, (match, number: string) =>
    Number(number) > 0 && Number(number) <= citationCount
      ? `[${number}](#source-${number})`
      : match,
  );
  const citationHandler = useRef(onCitation);
  citationHandler.current = onCitation;
  const hasCitations = Boolean(onCitation);
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        const match = href?.match(/^#source-(\d+)$/);
        if (match && hasCitations)
          return (
            <button
              type='button'
              className='moshu-citation'
              aria-label={`查看引用 ${match[1]}`}
              onClick={(event) => {
                // WebKit pointer clicks do not focus buttons. Let the dialog
                // capture this citation as its keyboard return target.
                event.currentTarget.focus({ preventScroll: true });
                citationHandler.current?.(Number(match[1]) - 1);
              }}
            >
              {children}
            </button>
          );
        return (
          <a href={href} target='_blank' rel='noopener noreferrer'>
            {children}
          </a>
        );
      },
    }),
    [hasCitations],
  );
  return (
    <div className='moshu-answer'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
