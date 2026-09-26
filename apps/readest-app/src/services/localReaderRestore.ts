import type { AppService, BaseDir } from '@/types/system';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import {
  mergeReadingData,
  validateReadingData,
  type ReadingData,
} from '@/features/active-reading/data';
import { mergeModeState, validateModeState, type ModeState } from '@/features/reading-modes/state';
import {
  mergeResearchFiles,
  validateResearchFile,
  type ResearchFile,
} from '@/features/reading-modes/thematic';
import {
  mergeDialogueFiles,
  validateDialogueFile,
  type DialogueFile,
} from '@/features/reading-modes/dialogue-history';
import { readLocalReaderJSON, writeLocalReaderJSON } from './localReaderPersistence';
import { stableJSON } from './localReaderMerge';

export const READER_BACKUP_MANIFEST = 'active-reader-backup.json';
export const READER_THEME_ENTRY = 'active-reader/thematic-research.json';
export const READER_THEME_PATH = 'thematic-research.json';
export const isReaderBookFile = (path: string) =>
  /^[^/]+\/reading-(method|modes|dialogues)\.json$/.test(path);
export const isReaderBackupFile = (path: string) =>
  /\/reading-(method|modes|dialogues)\.json\.(backup|tmp-|corrupt-)/.test(path);
export const validArchivePath = (path: string) =>
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !path.split('/').some((part) => part === '..' || part === '.' || !part) &&
  !path.includes(':');
export interface RestoreTarget {
  path: string;
  base: 'Books' | 'Data';
}
export interface RestoreDifference extends RestoreTarget {
  current: unknown;
  incoming: unknown;
}
export interface LocalRestoreSnapshot {
  version: 1;
  id: string;
  createdAt: string;
  state: 'ready' | 'restored' | 'undone';
  books: Book[];
  settings?: SystemSettings;
  files: (RestoreTarget & { savedPath: string | null })[];
  differences: RestoreDifference[];
}
const LATEST = 'restore-snapshots/latest.json';
const snapshotPath = (id: string) => `restore-snapshots/${id}/manifest.json`;
const validSnapshot = (value: unknown): asserts value is LocalRestoreSnapshot => {
  const snapshot = value as LocalRestoreSnapshot | null;
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    typeof snapshot.id !== 'string' ||
    !/^[a-zA-Z0-9-]+$/.test(snapshot.id) ||
    !Array.isArray(snapshot.books) ||
    !Array.isArray(snapshot.files) ||
    !Array.isArray(snapshot.differences) ||
    !['ready', 'restored', 'undone'].includes(snapshot.state) ||
    snapshot.files.some(
      (file) =>
        !['Books', 'Data'].includes(file.base) ||
        !validArchivePath(file.path) ||
        (file.savedPath !== null &&
          !file.savedPath.startsWith(`restore-snapshots/${snapshot.id}/files/`)),
    )
  )
    throw new Error('恢复快照无法读取，原文件已保留。');
};
export function readerDocumentAdapter(path: string, base: BaseDir) {
  const hash = path.split('/')[0]!;
  if (base === 'Data' && path === READER_THEME_PATH)
    return {
      validate: (value: unknown) => validateResearchFile(value),
      merge: (a: unknown, b: unknown) => mergeResearchFiles(a as ResearchFile, b as ResearchFile),
    };
  if (base !== 'Books' || !isReaderBookFile(path)) return null;
  if (path.endsWith('/reading-method.json'))
    return {
      validate: (value: unknown) => validateReadingData(value, hash),
      merge: (a: unknown, b: unknown) => mergeReadingData(a as ReadingData, b as ReadingData),
    };
  if (path.endsWith('/reading-modes.json'))
    return {
      validate: (value: unknown) => validateModeState(value, hash),
      merge: (a: unknown, b: unknown) => mergeModeState(a as ModeState, b as ModeState),
    };
  return {
    validate: (value: unknown) => validateDialogueFile(value, hash),
    merge: (a: unknown, b: unknown) => mergeDialogueFiles(a as DialogueFile, b as DialogueFile),
  };
}
export async function restoreReaderDocument(
  service: AppService,
  target: RestoreTarget,
  incoming: unknown,
): Promise<RestoreDifference | undefined> {
  const adapter = readerDocumentAdapter(target.path, target.base);
  if (!adapter) throw new Error('不支持的阅读记录文件。');
  adapter.validate(incoming);
  const current = await readLocalReaderJSON<unknown>(
    service,
    target.path,
    target.base,
    adapter.validate,
    undefined,
  );
  const next = current === undefined ? incoming : adapter.merge(current, incoming);
  await writeLocalReaderJSON(service, target.path, target.base, next, adapter.validate);
  return current !== undefined && stableJSON(current) !== stableJSON(incoming)
    ? { ...target, current, incoming }
    : undefined;
}

export async function createLocalRestoreSnapshot(
  service: AppService,
  targets: RestoreTarget[],
  books: Book[],
  includeSettings: boolean,
): Promise<LocalRestoreSnapshot> {
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const snapshot: LocalRestoreSnapshot = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    state: 'ready',
    books: structuredClone(books),
    files: [],
    differences: [],
  };
  if (includeSettings) snapshot.settings = await service.loadSettings();
  const expanded = targets.flatMap((target) =>
    readerDocumentAdapter(target.path, target.base)
      ? [target, { ...target, path: `${target.path}.backup` }]
      : [target],
  );
  const unique = [
    ...new Map(expanded.map((target) => [`${target.base}/${target.path}`, target])).values(),
  ];
  await service.createDir(`restore-snapshots/${id}/files`, 'Data', true);
  for (const target of unique) {
    if (!validArchivePath(target.path)) throw new Error('备份路径无效。');
    const exists = await service.exists(target.path, target.base);
    const savedPath = exists ? `restore-snapshots/${id}/files/${snapshot.files.length}` : null;
    if (savedPath) await service.copyFile(target.path, target.base, savedPath, 'Data');
    snapshot.files.push({ ...target, savedPath });
  }
  await writeLocalReaderJSON(service, snapshotPath(id), 'Data', snapshot, validSnapshot);
  await writeLocalReaderJSON(service, LATEST, 'Data', { id }, validateLatest);
  return snapshot;
}
function validateLatest(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !/^[a-zA-Z0-9-]+$/.test(value.id)
  )
    throw new Error('恢复快照索引无法读取。');
}
export async function getLastLocalRestore(
  service: AppService,
): Promise<LocalRestoreSnapshot | null> {
  const latest = await readLocalReaderJSON<{ id: string } | null>(
    service,
    LATEST,
    'Data',
    validateLatest,
    null,
  );
  if (!latest) return null;
  const snapshot = await readLocalReaderJSON<LocalRestoreSnapshot | null>(
    service,
    snapshotPath(latest.id),
    'Data',
    validSnapshot,
    null,
  );
  return snapshot?.state === 'undone' ? null : snapshot;
}
export async function finishLocalRestore(service: AppService, snapshot: LocalRestoreSnapshot) {
  snapshot.state = 'restored';
  await writeLocalReaderJSON(service, snapshotPath(snapshot.id), 'Data', snapshot, validSnapshot);
}
export async function undoLastLocalRestore(service: AppService): Promise<void> {
  if (!service.replaceFile) throw new Error('当前存储不支持安全替换，尚未撤销。');
  const snapshot = await getLastLocalRestore(service);
  if (!snapshot) throw new Error('没有可撤销的恢复。');
  // Check every retained copy before changing anything. A failed undo keeps the
  // snapshot and pointer, so the operation can be retried after storage recovers.
  for (const file of snapshot.files)
    if (file.savedPath && !(await service.exists(file.savedPath, 'Data')))
      throw new Error('恢复快照不完整，尚未撤销。');
  for (const file of snapshot.files) {
    if (file.savedPath) {
      const temporary = `${file.path}.undo-${crypto.randomUUID()}`;
      await service.copyFile(file.savedPath, 'Data', temporary, file.base);
      try {
        await service.replaceFile(temporary, file.path, file.base);
      } finally {
        if (await service.exists(temporary, file.base))
          await service.deleteFile(temporary, file.base);
      }
    } else if (await service.exists(file.path, file.base))
      await service.deleteFile(file.path, file.base);
  }
  await service.saveLibraryBooks(snapshot.books, { replace: true });
  if (snapshot.settings) await service.saveSettings(snapshot.settings);
  snapshot.state = 'undone';
  await writeLocalReaderJSON(service, snapshotPath(snapshot.id), 'Data', snapshot, validSnapshot);
}
