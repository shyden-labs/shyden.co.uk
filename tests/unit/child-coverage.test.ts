import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHILD_COVERAGE, measureChildren } from '../child-coverage';

/**
 * Only the processes a test starts write raw V8 coverage (#936). Vitest stops
 * each fork with SIGTERM and kills it 500 ms later, so a fork that inherits
 * `NODE_V8_COVERAGE` can die writing its own file and leave it empty. The run
 * names the directory under `CHILD_COVERAGE`, and each fork copies it into its
 * own environment after it has started, which Node reads only at startup.
 */
describe('the processes a test starts are measured, the fork is not (#936)', () => {
  it('copies the directory into the environment a started process inherits', () => {
    const env: NodeJS.ProcessEnv = { [CHILD_COVERAGE]: '/run/raw' };
    measureChildren(env);
    expect(env).toEqual({
      [CHILD_COVERAGE]: '/run/raw',
      NODE_V8_COVERAGE: '/run/raw',
    });
  });

  it('measures nothing when the run names no directory', () => {
    const env: NodeJS.ProcessEnv = {};
    measureChildren(env);
    expect(env).toEqual({});
  });

  it('names the directory under its own name, never as NODE_V8_COVERAGE', () => {
    expect(CHILD_COVERAGE).toBe('COVERAGE_CHILD_PROCESSES');
  });

  it('runs the integration suite under coverage with the directory named for the children alone', () => {
    const scripts = (
      JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['test:coverage:integration']).toBe(
      'COVERAGE_CHILD_PROCESSES="$PWD/coverage/raw/integration" npm run test:integration -- --coverage',
    );
  });
});
