import { readLocalReaderJSON, writeLocalReaderJSON } from '@/services/localReaderPersistence';
import {
  mergeRestoreMap,
  mergeRestoreConflicts,
  type LocalRestoreConflict,
} from '@/services/localReaderMerge';
import type { AppService } from '@/types/system';

export type ReadingMode = 'quick' | 'analytical' | 'thematic';
export type Reconstruction = {
  question: string;
  concepts: string;
  proposition: string;
  argument: string;
  position: string;
  confirmed: boolean;
};
export interface ModeState {
  version: 1;
  bookHash: string;
  mode: ReadingMode | null;
  follow: boolean;
  reminders: boolean;
  quietDate: string;
  stage: number;
  captures: Record<string, string>;
  reconstructions: Record<string, Reconstruction>;
  intensive: string[];
  restoreConflicts?: LocalRestoreConflict[];
}
export const emptyModeState = (bookHash: string): ModeState => ({
  version: 1,
  bookHash,
  mode: null,
  follow: true,
  reminders: true,
  quietDate: '',
  stage: 0,
  captures: {},
  reconstructions: {},
  intensive: [],
});
export const switchMode = (state: ModeState, mode: ReadingMode): ModeState => ({
  ...state,
  mode,
  follow: mode === 'quick',
});
export const pageLayoutSettings = (spreadMode: 'none' | 'auto') => ({
  spreadMode,
  maxColumnCount: spreadMode === 'auto' ? 2 : 1,
});
export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const remindersAllowed = (state: ModeState, date = localDate()) =>
  state.reminders && state.quietDate !== date;
const file = (hash: string) => `${hash}/reading-modes.json`;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isReconstruction = (value: unknown): value is Reconstruction =>
  isObject(value) &&
  ['question', 'concepts', 'proposition', 'argument', 'position'].every(
    (key) => typeof value[key] === 'string',
  ) &&
  typeof value['confirmed'] === 'boolean';
export function validateModeState(value: unknown, hash: string): asserts value is ModeState {
  if (
    !isObject(value) ||
    value['version'] !== 1 ||
    value['bookHash'] !== hash ||
    ![null, 'quick', 'analytical', 'thematic'].includes(value['mode'] as ReadingMode | null) ||
    typeof value['follow'] !== 'boolean' ||
    typeof value['reminders'] !== 'boolean' ||
    typeof value['quietDate'] !== 'string' ||
    !Number.isInteger(value['stage']) ||
    (value['stage'] as number) < 0 ||
    (value['stage'] as number) > 4 ||
    !isObject(value['captures']) ||
    !Object.values(value['captures']).every((capture) => typeof capture === 'string') ||
    !isObject(value['reconstructions']) ||
    !Object.values(value['reconstructions']).every(isReconstruction) ||
    !Array.isArray(value['intensive']) ||
    !value['intensive'].every((target) => typeof target === 'string')
  )
    throw new Error('阅读方式记录无法读取，原文件已保留。');
}

export const chapterStorageKey = (index: number, href?: string) => `section:${index}:${href || ''}`;

/** Old label-only records remain intact; ambiguous repeated labels are never guessed. */
export function readChapterEntry<T>(
  entries: Record<string, T>,
  key: string,
  label: string,
  tocLabels: string[],
): T | undefined {
  if (Object.hasOwn(entries, key)) return entries[key];
  if (
    tocLabels.filter((candidate) => candidate === label).length <= 1 &&
    Object.hasOwn(entries, label)
  )
    return entries[label];
  return undefined;
}

export async function loadModeState(service: AppService, hash: string): Promise<ModeState> {
  return readLocalReaderJSON(
    service,
    file(hash),
    'Books',
    (value) => validateModeState(value, hash),
    emptyModeState(hash),
  );
}
export function mergeModeState(current: ModeState, incoming: ModeState): ModeState {
  validateModeState(current, current.bookHash);
  validateModeState(incoming, current.bookHash);
  const conflicts: LocalRestoreConflict[] = [];
  return {
    ...current,
    captures: mergeRestoreMap(current.captures, incoming.captures, 'captures', conflicts),
    reconstructions: mergeRestoreMap(
      current.reconstructions,
      incoming.reconstructions,
      'reconstructions',
      conflicts,
    ),
    intensive: [...new Set([...current.intensive, ...incoming.intensive])],
    restoreConflicts: mergeRestoreConflicts(
      current.restoreConflicts,
      incoming.restoreConflicts,
      conflicts,
    ),
  };
}
const pending = new Map<string, Promise<ModeState>>();
export function mutateModeState(
  service: AppService,
  hash: string,
  mutate: (state: ModeState) => ModeState,
): Promise<ModeState> {
  const previous = pending.get(hash);
  const task = (async () => {
    await previous?.catch(() => undefined);
    const before = await loadModeState(service, hash);
    const next = mutate(before);
    if (next.bookHash !== hash) throw new Error('无法写入其他书籍。');
    validateModeState(next, hash);
    await writeLocalReaderJSON(service, file(hash), 'Books', next, (value) =>
      validateModeState(value, hash),
    );
    return next;
  })();
  pending.set(hash, task);
  void task
    .finally(() => {
      if (pending.get(hash) === task) pending.delete(hash);
    })
    .catch(() => undefined);
  return task;
}

export function atSectionEnd(
  fraction: number,
  index: number,
  sectionFractions: number[],
  visibleText = '',
) {
  const end = sectionFractions[index + 1];
  return Boolean(visibleText.trim()) && end !== undefined && fraction >= end - 0.00001;
}
