import { describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import {
  emptyModeState,
  switchMode,
  mutateModeState,
  loadModeState,
  remindersAllowed,
  chapterStorageKey,
  pageLayoutSettings,
  readChapterEntry,
} from './state';

describe('reading mode continuity', () => {
  it('maps the visible double-page choice to two renderer columns', () => {
    expect(pageLayoutSettings('none')).toEqual({ spreadMode: 'none', maxColumnCount: 1 });
    expect(pageLayoutSettings('auto')).toEqual({ spreadMode: 'auto', maxColumnCount: 2 });
  });

  it('switches purpose without losing chapter captures, reconstruction or chosen scope', () => {
    const before = {
      ...emptyModeState('book'),
      captures: { chapter: '作者的问题' },
      intensive: ['chapter'],
    };
    const quick = switchMode(before, 'quick');
    expect(quick.follow).toBe(true);
    const analytical = switchMode(quick, 'analytical');
    expect(analytical.follow).toBe(false);
    expect(analytical.captures).toEqual(before.captures);
    expect(analytical.intensive).toEqual(['chapter']);
    expect(switchMode(analytical, 'thematic').captures).toEqual(before.captures);
  });
  it('serializes concurrent writes and keeps each book isolated', async () => {
    const files = new Map<string, string>();
    const service = {
      exists: vi.fn(async (path: string) => files.has(path)),
      replaceFile: async (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      deleteFile: async (path: string) => {
        files.delete(path);
      },
      readFile: vi.fn(async (path: string) => files.get(path)),
      createDir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, _base: string, data: string) => {
        files.set(path, data);
      }),
    } as unknown as AppService;
    await Promise.all([
      mutateModeState(service, 'a', (s) => ({ ...s, captures: { first: '一句话' } })),
      mutateModeState(service, 'a', (s) => switchMode(s, 'analytical')),
    ]);
    expect(await loadModeState(service, 'a')).toMatchObject({
      mode: 'analytical',
      captures: { first: '一句话' },
    });
    expect((await loadModeState(service, 'b')).captures).toEqual({});
  });
  it('keeps quiet today or permanently without disabling tomorrow by accident', () => {
    const state = emptyModeState('book');
    expect(remindersAllowed(state, '2026-09-20')).toBe(true);
    expect(remindersAllowed({ ...state, quietDate: '2026-09-20' }, '2026-09-20')).toBe(false);
    expect(remindersAllowed({ ...state, quietDate: '2026-09-20' }, '2026-09-21')).toBe(true);
    expect(remindersAllowed({ ...state, reminders: false }, '2026-09-21')).toBe(false);
  });

  it.each([
    { captures: 'broken' },
    { captures: { chapter: 4 } },
    { reconstructions: [] },
    { reconstructions: { chapter: { question: 'incomplete' } } },
    { stage: 9 },
    { stage: '2' },
    { mode: 'invalid' },
    { reminders: 'false' },
    { follow: null },
    { quietDate: 9 },
    { intensive: [7] },
  ])('rejects malformed persisted values without overwriting the file: %j', async (patch) => {
    const raw = JSON.stringify({ ...emptyModeState('book'), ...patch });
    const writeFile = vi.fn();
    const service = {
      exists: async () => true,
      readFile: async () => raw,
      writeFile,
      createDir: vi.fn(),
    } as unknown as AppService;
    await expect(loadModeState(service, 'book')).rejects.toThrow('原文件已保留');
    await expect(
      mutateModeState(service, 'book', (s) => ({ ...s, reminders: false })),
    ).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects invalid mutations before writing a backup or primary file', async () => {
    const writeFile = vi.fn();
    const service = {
      exists: async () => true,
      readFile: async () => JSON.stringify(emptyModeState('book')),
      writeFile,
      createDir: vi.fn(),
    } as unknown as AppService;
    await expect(mutateModeState(service, 'book', (s) => ({ ...s, stage: 5 }))).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('keeps identically named chapters separate and reads unambiguous legacy keys', () => {
    const first = chapterStorageKey(0, 'first.xhtml#summary');
    const second = chapterStorageKey(1, 'second.xhtml#summary');
    const entries = { [first]: '第一章思考', [second]: '第二章思考', 总结: '历史记录' };
    expect(first).not.toBe(second);
    expect(readChapterEntry(entries, first, '总结', ['总结', '总结'])).toBe('第一章思考');
    expect(readChapterEntry(entries, second, '总结', ['总结', '总结'])).toBe('第二章思考');
    expect(readChapterEntry({ 总结: '历史记录' }, first, '总结', ['总结'])).toBe('历史记录');
    expect(readChapterEntry({ 总结: '历史记录' }, first, '总结', ['总结', '总结'])).toBeUndefined();
    expect(entries['总结']).toBe('历史记录');
  });
});

import { atSectionEnd } from './state';
describe('chapter end detection', () => {
  it('uses the end of the current page, rather than mistaking the section index for a page count', () => {
    expect(atSectionEnd(0.45, 1, [0, 0.2, 0.5, 1], '当前原文')).toBe(false);
    expect(atSectionEnd(0.5, 1, [0, 0.2, 0.5, 1], '当前原文')).toBe(true);
    expect(atSectionEnd(0.6, 2, [0, 0.2, 0.5, 1], '当前原文')).toBe(false);
  });
  it('does not ask for a chapter capture on image-only covers or blank pages', () => {
    expect(atSectionEnd(0.2, 0, [0, 0.2, 1], '')).toBe(false);
    expect(atSectionEnd(0.2, 0, [0, 0.2, 1], '   \n')).toBe(false);
  });
});
