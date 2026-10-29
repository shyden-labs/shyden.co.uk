import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keepFromChildren } from '../main-coverage';
import { nonEmpty } from '../source-files';

/**
 * Vitest's main process is measured (#912): it loads the configs and the
 * reporters, which run nowhere else. Its forks and the processes they start
 * must not inherit its directory (#936).
 */
describe('keepFromChildren: the main process alone writes (#912)', () => {
  it('takes the directory out of the environment children inherit', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_V8_COVERAGE: '/repo/coverage/raw/vitest-main',
      PATH: '/usr/bin',
    };
    keepFromChildren(env);
    expect(env).toEqual({ PATH: '/usr/bin' });
  });

  it('leaves an environment without one as it was', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    keepFromChildren(env);
    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});

/** Every Vitest config at the root, read from the filesystem, never listed. */
const CONFIGS = nonEmpty(
  readdirSync('.').filter((name) =>
    /^vitest(\.[\w-]+)?\.config\.ts$/.test(name),
  ),
  'Vitest configs at the repository root',
).sort();

describe('every Vitest config clears it before anything else runs (#912)', () => {
  it.each(CONFIGS)('%s imports main-coverage first', (config) => {
    const first = readFileSync(config, 'utf8')
      .split('\n')
      .find((line) => line.startsWith('import '));
    expect(first).toBe("import './tests/main-coverage.ts';");
  });
});
