import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import guards from '../../vitest.guards.config';
import unit from '../../vitest.config';

/**
 * The per-test budget of the guards suite (#638).
 *
 * A guard reads or parses the whole tree, so its cost is the tree's size and
 * load stretches it; it cannot meet the unit suite's 0.3 s and is not a unit
 * test (operator, 2026-10-08: "Own 'guards' suite"). The suite gets ONE limit,
 * written where the suite is run (`npm run test:guards`, which CI runs as the
 * step after the unit one) and never in a config file or on a test.
 *
 * The limit is pinned here as a literal, because a value asserted against the
 * script it was read from would move with it and pin nothing.
 *
 * Measurement (2026-10-08, the 597 tests as moved): the slowest test on the CI
 * runner took 7.2s (run 37798571160, `collection-needs-no-build`: it parses
 * every file under tests/), the next 4.3s. On a laptop running the whole
 * suite the same test took 7.6s, the next 2.5s. 25s is 3.3x the laptop's worst
 * and 3.5x the runner's, below the 30s the unit suite once allowed these same
 * tests, so moving them raises nothing.
 */
const scripts = (): Record<string, string> =>
  (
    JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;

describe('the guards suite budget', () => {
  it('gives every test one limit, set on the command that runs the suite', () => {
    expect(scripts()['test:guards']).toBe(
      'vitest run --config vitest.guards.config.ts --reporter=verbose --testTimeout=25000',
    );
  });

  it('sets no limit in its config, where a test run by hand would escape it', () => {
    expect(guards.test?.testTimeout).toBeUndefined();
    expect(guards.test?.hookTimeout).toBeUndefined();
  });

  it('reads tests/guards and nothing else', () => {
    expect(guards.test?.include).toEqual(['tests/guards/**/*.test.ts']);
  });

  it('is not read by the unit suite', () => {
    expect(unit.test?.include).toEqual(['tests/unit/**/*.test.ts']);
  });

  it("has the shared setup files and the unit suite's global setup, so a run is as isolated", () => {
    expect({
      setup: guards.test?.setupFiles,
      global: guards.test?.globalSetup,
    }).toEqual({
      setup: ['tests/git-env-setup.ts', 'tests/temporary-files-setup.ts'],
      global: unit.test?.globalSetup,
    });
  });

  it('is run by npm test, after the unit suite', () => {
    expect(scripts()['test']).toBe(
      'npm run test:unit && npm run test:guards && npm run test:integration && npm run test:e2e',
    );
  });

  it('is run by the pre-push hook, right after the unit suite', () => {
    const hook = readFileSync('.githooks/pre-push', 'utf8');
    const unitAt = hook.indexOf('npm run test:unit ||');
    const guardsAt = hook.indexOf('npm run test:guards ||');
    expect(unitAt).toBeGreaterThan(-1);
    expect(guardsAt).toBeGreaterThan(unitAt);
  });
});
