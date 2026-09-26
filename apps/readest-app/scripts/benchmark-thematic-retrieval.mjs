import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const vitest = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const result = spawnSync(process.execPath, [
  vitest, 'run', 'src/features/reading-modes/thematic-performance.test.ts', '--maxWorkers=1',
], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    MOSHU_SYNTHETIC_BENCH: '1',
    NEXT_PUBLIC_APP_PLATFORM: 'web',
    // The parser imports shared app modules. No real service credentials or
    // local model configuration are needed for this entirely offline benchmark.
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'synthetic-offline-only',
  },
});
process.exit(result.status ?? 1);
