import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import integration from '../../vitest.integration.config';
import unit from '../../vitest.config';

/**
 * The per-test budget of the integration suite (#630).
 *
 * Every test that starts a process lives in `tests/integration/`, not in the
 * unit suite (operator, 2026-10-08: "No processes in unit"). Process start-up
 * is the one cost load stretches without limit, so the suite gets ONE limit,
 * written where the suite is run (`npm run test:integration`, which CI runs
 * as the step after the unit one) and never in a config file or on a test: a
 * test that names its own limit has chosen a number nobody measured.
 *
 * The limit is pinned here as a literal, because a value asserted against the
 * script it was read from would move with it and pin nothing.
 *
 * Measurement (2026-10-08, the 318 tests as moved): the slowest test on the CI
 * runner took 5.2s (run 37747897477, `git-env`: a child vitest over the
 * scratch-repository tests); on a laptop running the whole suite at once the
 * slowest took 16.7s (the same test), the next 6.9s. 30s is 1.8x the laptop's
 * worst and 5.8x the runner's, and it is the limit the unit suite already gave
 * these same tests, so moving them raises nothing: a figure at 3x the laptop
 * (51s) would have been a raise, and the operator rule is that none is ever made.
 */
const script = (): string => {
  const scripts = (
    JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;
  return scripts['test:integration'] ?? '';
};

describe('the integration suite budget', () => {
  it('gives every test one limit, set on the command that runs the suite', () => {
    expect(script()).toBe(
      'vitest run --config vitest.integration.config.ts --reporter=verbose --testTimeout=30000',
    );
  });

  it('sets no limit in its config, where a test run by hand would escape it', () => {
    expect(integration.test?.testTimeout).toBeUndefined();
    expect(integration.test?.hookTimeout).toBeUndefined();
  });

  it('reads tests/integration and nothing else', () => {
    expect(integration.test?.include).toEqual([
      'tests/integration/**/*.test.ts',
    ]);
  });

  it('is not read by the unit suite', () => {
    expect(unit.test?.include).toEqual(['tests/unit/**/*.test.ts']);
  });

  it("has the shared setup files and the unit suite's global setup, so a run is as isolated", () => {
    expect(integration.test?.setupFiles).toEqual([
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
    ]);
    expect(integration.test?.globalSetup).toEqual(unit.test?.globalSetup);
  });
});
