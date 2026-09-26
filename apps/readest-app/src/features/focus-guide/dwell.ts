import type { ReadingSource } from '../reading-method/types';

interface DwellCandidate {
  key: string;
  chapter: string;
  source: ReadingSource;
}

/** Cancel only the pending dwell; chapter limits and cooldown survive UI pauses. */
export function createDwellController(onDwell: (source: ReadingSource) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let candidate: DwellCandidate | undefined;
  let cooldownUntil = 0;
  const chapterCounts = new Map<string, number>();
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    candidate = undefined;
  };
  return {
    cancel,
    hover(next: DwellCandidate) {
      if (candidate?.key === next.key) return;
      cancel();
      if (Date.now() < cooldownUntil || (chapterCounts.get(next.chapter) ?? 0) >= 3) return;
      candidate = next;
      timer = setTimeout(() => {
        timer = undefined;
        candidate = undefined;
        cooldownUntil = Date.now() + 60_000;
        chapterCounts.set(next.chapter, (chapterCounts.get(next.chapter) ?? 0) + 1);
        onDwell(next.source);
      }, 5000);
    },
  };
}
