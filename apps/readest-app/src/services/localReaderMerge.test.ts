import { describe, expect, it } from 'vitest';
import {
  emptyReadingData,
  mergeReadingData,
  type ReadingRecord,
} from '@/features/active-reading/data';
import { emptyModeState, getFollowStyle, mergeModeState } from '@/features/reading-modes/state';
import { createResearch, mergeResearchFiles } from '@/features/reading-modes/thematic';
const record = (id: string, text: string): ReadingRecord => ({
  id,
  kind: 'understanding',
  status: 'kept',
  userText: text,
  originalText: text,
  revisions: [],
});
describe('local-only restore merge', () => {
  it('retains new records and both text revisions of a divergent ID without duplicating a repeated restore', () => {
    const current = {
      ...emptyReadingData('book'),
      records: [record('a', 'newer'), record('b', 'added')],
    };
    const backup = { ...emptyReadingData('book'), records: [record('a', 'older')] };
    const result = mergeReadingData(current, backup);
    expect(result.records.map((r) => r.userText).sort()).toEqual(['added', 'newer', 'older']);
    expect(mergeReadingData(result, backup).records).toEqual(result.records);
  });
  it('keeps both chapter thoughts on conflict and merges new chapters', () => {
    const current = { ...emptyModeState('book'), captures: { a: 'new' } };
    const backup = { ...emptyModeState('book'), captures: { a: 'old', b: 'another' } };
    const result = mergeModeState(current, backup);
    expect(result.captures).toEqual({ a: 'new', b: 'another' });
    expect(result.restoreConflicts).toContainEqual(
      expect.objectContaining({ path: 'captures.a', incoming: 'old' }),
    );
  });
  it.each([
    ['classic', false],
    ['classic', true],
    ['soft', false],
    ['soft', true],
    [undefined, undefined],
  ] as const)('retains current follow style %s and lockLine %s when restoring a different preference', (followStyle, lockLine) => {
    const current = { ...emptyModeState('book'), followStyle, lockLine };
    if (followStyle === undefined) delete current.followStyle;
    if (lockLine === undefined) delete current.lockLine;
    const backup = {
      ...emptyModeState('book'),
      followStyle: followStyle === 'soft' ? ('classic' as const) : ('soft' as const),
      lockLine: !lockLine,
      captures: { restored: 'Imported thought' },
    };
    const result = mergeModeState(current, backup);
    expect(result.followStyle).toBe(followStyle);
    expect(getFollowStyle(result)).toBe(followStyle ?? 'classic');
    expect(result.lockLine).toBe(lockLine);
    expect(result.captures).toEqual({ restored: 'Imported thought' });
  });
  it('keeps divergent thematic conversations as separate recoverable history', () => {
    const current = {
      version: 1 as const,
      studies: { a: { ...createResearch('a'), question: 'Current question' } },
    };
    const backup = {
      version: 1 as const,
      studies: { a: { ...createResearch('a'), question: 'Old question' }, b: createResearch('b') },
    };
    const result = mergeResearchFiles(current, backup);
    expect(Object.values(result.studies).map((s) => s.question)).toContain('Current question');
    expect(Object.values(result.studies).map((s) => s.question)).toContain('Old question');
    expect(Object.keys(result.studies)).toHaveLength(3);
    expect(Object.keys(mergeResearchFiles(result, backup).studies)).toHaveLength(3);
  });
});
