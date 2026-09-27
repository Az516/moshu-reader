# Reading mode storage

`Books/<bookHash>/reading-modes.json` is a local-only document written through
`localReaderPersistence`. Its schema remains `version: 1`.

`followStyle` is an optional preference with two values: `classic` (the original
focus window) and `soft` (a local reading marker). `lockLine` is an independent
optional boolean that keeps either style on the chosen line. New documents use
`soft` with `lockLine: false`. Missing styles keep `classic` through
`getFollowStyle`; missing `lockLine` means off.

The former `followStyle: 'locked'` format is accepted for compatibility. After
complete validation, `validateModeState` normalizes the in-memory document to
`followStyle: 'soft', lockLine: true`, preserving its existing `follow` value.
Loading alone never rewrites the source file. The next safe save or backup
restore writes the normalized format. Invalid styles or non-boolean lock flags
fail validation before migration or any write.

Switching reading modes preserves `followStyle` and `lockLine`. Switching visual
styles does not change either `lockLine` or `follow`. Explicitly turning on the
lock-line switch also enables `follow`; turning it off preserves `follow`.
The existing reading-mode switch
still turns on when entering quick reading and off when entering other modes.

The version 1 `active-reader-backup.json` manifest lists document paths and
already includes each book's complete `reading-modes.json`; the optional field
does not change the archive format. Restoring into a fresh library preserves
the incoming preference, including a missing legacy field. Merging into an
existing book retains its current reading preferences while merging chapter
thoughts and reconstruction data. Undo restores the previous local bytes.

Coverage: `state.test.ts`, `localReaderMerge.test.ts`, and
`readerBackup.roundtrip.test.ts` (real ZIP imports for both visual styles, both
lock states, and legacy documents), plus `FollowStyleMenu.test.tsx` for the
independent menu controls.
