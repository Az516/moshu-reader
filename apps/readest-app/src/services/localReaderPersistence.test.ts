import { describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import {
  getLocalReaderRecoveryNotices,
  readLocalReaderJSON,
  writeLocalReaderJSON,
} from './localReaderPersistence';

const validate = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('value' in value) || typeof value.value !== 'string')
    throw new Error('invalid data');
};
function storage() {
  const files = new Map<string, string>();
  const service = {
    exists: async (path: string) => files.has(path),
    readFile: async (path: string) => {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path)!;
    },
    writeFile: vi.fn(async (path: string, _base: string, text: string) => {
      files.set(path, text);
    }),
    replaceFile: vi.fn(async (from: string, to: string) => {
      if (!files.has(from)) throw new Error('missing');
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    deleteFile: async (path: string) => {
      files.delete(path);
    },
    createDir: async () => {},
  };
  return { files, operations: service, service: service as unknown as AppService };
}
describe('local reader durable JSON', () => {
  it('writes and validates a temporary file before replacing the primary and keeps the previous revision', async () => {
    const { files, operations, service } = storage();
    await writeLocalReaderJSON(service, 'book/data.json', 'Books', { value: 'first' }, validate);
    await writeLocalReaderJSON(service, 'book/data.json', 'Books', { value: 'second' }, validate);
    expect(JSON.parse(files.get('book/data.json')!)).toEqual({ value: 'second' });
    expect(JSON.parse(files.get('book/data.json.backup')!)).toEqual({ value: 'first' });
    expect(operations.writeFile.mock.calls.every(([path]) => path !== 'book/data.json')).toBe(true);
    expect(operations.replaceFile).toHaveBeenCalled();
  });
  it('preserves corrupt bytes and recovers a validated backup with a readable notice', async () => {
    const { files, service } = storage();
    files.set('data.json', '{truncated');
    files.set('data.json.backup', JSON.stringify({ value: 'safe' }));
    expect(
      await readLocalReaderJSON(service, 'data.json', 'Data', validate, { value: 'empty' }),
    ).toEqual({ value: 'safe' });
    expect(
      [...files.entries()].some(
        ([path, text]) => path.includes('.corrupt-') && text === '{truncated',
      ),
    ).toBe(true);
    expect(JSON.parse(files.get('data.json')!)).toEqual({ value: 'safe' });
    expect(getLocalReaderRecoveryNotices(service)[0]?.path).toBe('data.json');
  });
  it('does not turn unreadable primary and backup into an empty file', async () => {
    const { files, service } = storage();
    files.set('data.json', '{}');
    files.set('data.json.backup', '{bad');
    await expect(
      readLocalReaderJSON(service, 'data.json', 'Data', validate, { value: 'empty' }),
    ).rejects.toThrow();
    expect(files.get('data.json')).toBe('{}');
  });
  it('serializes a delayed backup recovery before a newer write instead of overwriting that write', async () => {
    const { files, operations, service } = storage();
    files.set('data.json', '{truncated');
    files.set('data.json.backup', JSON.stringify({ value: 'older backup' }));
    let releaseRecovery!: () => void;
    let backupReadStarted!: () => void;
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const enteredBackup = new Promise<void>((resolve) => {
      backupReadStarted = resolve;
    });
    const originalRead = operations.readFile;
    let firstBackupRead = true;
    vi.spyOn(operations, 'readFile').mockImplementation(async (path) => {
      const bytes = await originalRead(path);
      if (path === 'data.json.backup' && firstBackupRead) {
        firstBackupRead = false;
        backupReadStarted();
        await recoveryGate;
      }
      return bytes;
    });
    const recovering = readLocalReaderJSON(service, 'data.json', 'Data', validate, {
      value: 'empty',
    });
    await enteredBackup;
    let writeFinished = false;
    const writing = writeLocalReaderJSON(
      service,
      'data.json',
      'Data',
      { value: 'newest' },
      validate,
    ).then(() => {
      writeFinished = true;
    });
    // Every storage operation is immediate except recoveryGate. One event-loop
    // turn lets an incorrectly unqueued writer finish deterministically.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const finishedBeforeRecovery = writeFinished;
    releaseRecovery();
    await Promise.all([recovering, writing]);
    expect(JSON.parse(files.get('data.json')!)).toEqual({ value: 'newest' });
    expect(finishedBeforeRecovery).toBe(false);
    expect(getLocalReaderRecoveryNotices(service)).toHaveLength(1);
  });

  it('leaves the old primary usable if the final replace fails', async () => {
    const { files, operations, service } = storage();
    files.set('data.json', JSON.stringify({ value: 'old' }));
    operations.replaceFile.mockImplementation(async (from, to) => {
      if (to === 'data.json') throw new Error('disk failure');
      files.set(to, files.get(from)!);
      files.delete(from);
    });
    await expect(
      writeLocalReaderJSON(service, 'data.json', 'Data', { value: 'new' }, validate),
    ).rejects.toThrow('disk failure');
    expect(JSON.parse(files.get('data.json')!).value).toBe('old');
    expect([...files.keys()].some((path) => path.includes('.tmp-'))).toBe(false);
  });
});
