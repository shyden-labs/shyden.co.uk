import { describe, expect, it } from 'vitest';
import guards from '../../vitest.guards.config';
import integration from '../../vitest.integration.config';
import unit from '../../vitest.config';

/**
 * Which setup files each suite takes (#632).
 *
 * The unit suite refuses every process and every connection off this machine
 * and checks each test's own CPU; the integration suite exists to start
 * processes and the guards suite reads the whole tree over 1 s, so neither may
 * take those two. All three keep the shared pair. The lists are pinned as
 * literals, read from the three configs' own objects: a list asserted against
 * the constant the config was built from would move with it and pin nothing.
 */
describe('the setup files of each suite', () => {
  it('give the unit suite the refusal and the CPU check, then the shared pair', () => {
    expect(unit.test?.setupFiles).toEqual([
      'tests/unit-refusal-setup.ts',
      'tests/unit-cpu-setup.ts',
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
    ]);
  });

  it('give the guards suite the shared pair and nothing that refuses', () => {
    expect(guards.test?.setupFiles).toEqual([
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
    ]);
  });

  it('give the integration suite the shared pair and nothing that refuses', () => {
    expect(integration.test?.setupFiles).toEqual([
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
    ]);
  });

  it('give the guards suite the unit suite global setup', () => {
    expect(guards.test?.globalSetup).toEqual(unit.test?.globalSetup);
  });

  it('give the integration suite the unit suite global setup', () => {
    expect(integration.test?.globalSetup).toEqual(unit.test?.globalSetup);
  });
});

describe('the CPU limit', () => {
  it('is not asked of the integration suite', () => {
    expect(integration.test?.setupFiles).not.toContain(
      'tests/unit-cpu-setup.ts',
    );
  });
});
