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
 * Measurement: INTERIM, to be replaced by the measured figure before the
 * story merges.
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
      'vitest run --config vitest.guards.config.ts --reporter=verbose --testTimeout=30000',
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

  it('has the repo setup files the unit suite has, so a run is as isolated', () => {
    expect({
      setup: guards.test?.setupFiles,
      global: guards.test?.globalSetup,
    }).toEqual({
      setup: unit.test?.setupFiles,
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
