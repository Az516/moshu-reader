import { useCallback, useState } from 'react';

/** Drafts follow chapter identity, not each refreshed object from persistent storage. */
export function useChapterCapture(chapterKey: string, saved: string) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const setCapture = useCallback(
    (text: string) => {
      setDrafts((current) => ({ ...current, [chapterKey]: text }));
    },
    [chapterKey],
  );
  const clearDraft = useCallback(
    (savedDraft?: string) => {
      setDrafts((current) => {
        if (savedDraft !== undefined && current[chapterKey] !== savedDraft) return current;
        const next = { ...current };
        delete next[chapterKey];
        return next;
      });
    },
    [chapterKey],
  );
  return { capture: drafts[chapterKey] ?? saved, setCapture, clearDraft };
}
