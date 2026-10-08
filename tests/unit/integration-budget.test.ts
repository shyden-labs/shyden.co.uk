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
 * Measurement: TO BE MEASURED (#630 S5). Until then the figure is the 30s the
 * unit suite used to give these same tests.
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

  it('has the repo setup files the unit suite has, so a run is as isolated', () => {
    expect(integration.test?.setupFiles).toEqual(unit.test?.setupFiles);
    expect(integration.test?.globalSetup).toEqual(unit.test?.globalSetup);
  });
});
