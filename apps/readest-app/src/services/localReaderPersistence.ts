import type { AppService, BaseDir } from '@/types/system';

export const LOCAL_READER_RECOVERED_EVENT = 'local-reader-recovered';
export interface LocalReaderRecoveryNotice {
  path: string;
  base: BaseDir;
  recoveredAt: string;
  corruptPath?: string;
}
const notices = new WeakMap<AppService, LocalReaderRecoveryNotice[]>();
const fileOperations = new WeakMap<AppService, Map<string, Promise<unknown>>>();
export const getLocalReaderRecoveryNotices = (service: AppService) => [
  ...(notices.get(service) || []),
];
type Validate = (value: unknown) => void;

async function replaceText(
  service: AppService,
  path: string,
  base: BaseDir,
  text: string,
  validate: Validate,
) {
  if (!service.replaceFile) throw new Error('当前存储不支持安全替换，原文件未改动。');
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await service.writeFile(temporary, base, text);
    validate(JSON.parse((await service.readFile(temporary, base, 'text')) as string));
    await service.replaceFile(temporary, path, base);
  } finally {
    if (await service.exists(temporary, base)) await service.deleteFile?.(temporary, base);
  }
}

async function readLocalReaderJSONUnlocked<T>(
  service: AppService,
  path: string,
  base: BaseDir,
  validate: Validate,
  defaultValue: T,
): Promise<T> {
  const backup = `${path}.backup`;
  const exists = await service.exists(path, base);
  if (!exists && !(await service.exists(backup, base))) return defaultValue;
  let primaryText: string | undefined;
  let primaryError: unknown;
  if (exists) {
    try {
      primaryText = (await service.readFile(path, base, 'text')) as string;
      const value: unknown = JSON.parse(primaryText);
      validate(value);
      return value as T;
    } catch (error) {
      primaryError = error;
    }
  }
  if (!(await service.exists(backup, base))) throw primaryError || new Error('本地记录无法读取。');
  let recovered: T;
  let backupText: string;
  try {
    backupText = (await service.readFile(backup, base, 'text')) as string;
    const value: unknown = JSON.parse(backupText);
    validate(value);
    recovered = value as T;
  } catch {
    throw new Error(`本地记录及备份均无法读取，原文件已保留：${path}`);
  }
  // Do not replace a primary we could not read: that may be a permissions or
  // transient I/O failure, and its original bytes have not been preserved.
  if (exists && primaryText === undefined) throw primaryError;
  const corruptPath = exists ? `${path}.corrupt-${Date.now()}-${crypto.randomUUID()}` : undefined;
  if (corruptPath) await service.writeFile(corruptPath, base, primaryText!);
  await replaceText(service, path, base, backupText, validate);
  const notice = { path, base, corruptPath, recoveredAt: new Date().toISOString() };
  notices.set(service, [...(notices.get(service) || []), notice]);
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(LOCAL_READER_RECOVERED_EVENT, { detail: notice }));
  return recovered;
}

/** Recovery reads may replace the primary, so reads and writes share a lock. */
function queueLocalReaderOperation<T>(
  service: AppService,
  path: string,
  base: BaseDir,
  operation: () => Promise<T>,
): Promise<T> {
  let queue = fileOperations.get(service);
  if (!queue) {
    queue = new Map();
    fileOperations.set(service, queue);
  }
  const key = `${base}/${path}`;
  const task = (queue.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  queue.set(key, task);
  void task
    .finally(() => {
      if (queue.get(key) === task) queue.delete(key);
    })
    .catch(() => undefined);
  return task;
}

export function readLocalReaderJSON<T>(
  service: AppService,
  path: string,
  base: BaseDir,
  validate: Validate,
  defaultValue: T,
): Promise<T> {
  return queueLocalReaderOperation(service, path, base, () =>
    readLocalReaderJSONUnlocked(service, path, base, validate, defaultValue),
  );
}

export function writeLocalReaderJSON<T>(
  service: AppService,
  path: string,
  base: BaseDir,
  value: T,
  validate: Validate,
): Promise<void> {
  return queueLocalReaderOperation(service, path, base, async () => {
    validate(value);
    const text = JSON.stringify(value, null, 2);
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) await service.createDir(folder, base, true);
    if (await service.exists(path, base)) {
      const current = await readLocalReaderJSONUnlocked(service, path, base, validate, value);
      await replaceText(service, `${path}.backup`, base, JSON.stringify(current), validate);
    } else if (!(await service.exists(`${path}.backup`, base))) {
      // First write also has a recoverable copy if the primary replace fails.
      await replaceText(service, `${path}.backup`, base, text, validate);
    }
    await replaceText(service, path, base, text, validate);
  });
}
