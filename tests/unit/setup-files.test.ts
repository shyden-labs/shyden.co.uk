import { describe, expect, it } from 'vitest';
import guards from '../../vitest.guards.config';
import integration from '../../vitest.integration.config';
import logs from '../../vitest.logs.config';
import simulation from '../../vitest.simulation.config';
import unit from '../../vitest.config';

/**
 * Which setup files each suite takes (#632).
 *
 * The unit suite refuses every process and every connection off this machine;
 * the other suites exist to start processes or read the whole tree, so none
 * may take that refusal. All keep the shared pair. The lists are pinned as
 * literals: a list asserted against the constant the config was built from
 * would move with it and pin nothing.
 */
const SHARED = ['tests/git-env-setup.ts', 'tests/temporary-files-setup.ts'];

describe('the setup files of each suite', () => {
  it('give the unit suite the refusal, then the shared pair', () => {
    expect(unit.test?.setupFiles).toEqual([
      'tests/unit-refusal-setup.ts',
      ...SHARED,
    ]);
  });

  it.each([
    ['guards', guards],
    ['integration', integration],
    ['simulation', simulation],
    ['logs', logs],
  ] as const)(
    'give the %s suite the shared pair and nothing that refuses',
    (_name, config) => {
      expect(config.test?.setupFiles).toEqual(SHARED);
    },
  );

  it.each([
    ['guards', guards],
    ['integration', integration],
    ['simulation', simulation],
    ['logs', logs],
  ] as const)(
    'give the %s suite the unit suite global setup',
    (_name, config) => {
      expect(config.test?.globalSetup).toEqual(unit.test?.globalSetup);
    },
  );
});
