import { describe, expect, it } from 'vitest';
import guards from '../../vitest.guards.config';
import integration from '../../vitest.integration.config';
import logs from '../../vitest.logs.config';
import simulation from '../../vitest.simulation.config';
import unit from '../../vitest.config';
import { unitProject } from '../vitest-suite-dirs';

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

  // A project's setup files run after the root's (#688), so the load
  // measurement is last but for its judge in both, and the parser loads
  // before its clock starts.
  it.each([
    ['unit', ['tests/load-setup.ts', 'tests/unit-load-limit-setup.ts']],
    [
      'unit-parser',
      [
        'tests/typescript-preload-setup.ts',
        'tests/load-setup.ts',
        'tests/unit-load-limit-setup.ts',
      ],
    ],
  ] as const)(
    'give the %s project its own setup after the shared lists (#688)',
    (name, setup) => {
      expect(unitProject(name).setupFiles).toEqual(setup);
    },
  );

  it('give the guards suite the shared pair, then the load measurement, and nothing that refuses (#696)', () => {
    expect(guards.test?.setupFiles).toEqual([
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
      'tests/load-setup.ts',
    ]);
  });

  it('give the integration suite the shared pair, then the load measurement, and nothing that refuses (#696)', () => {
    expect(integration.test?.setupFiles).toEqual([
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
      'tests/load-setup.ts',
    ]);
  });

  it('give the simulation suite the shared pair, then the load measurement, and nothing that refuses (#696)', () => {
    expect(simulation.test?.setupFiles).toEqual([
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
      'tests/load-setup.ts',
    ]);
  });

  it('give the simulation suite the unit suite global setup (#650)', () => {
    expect(simulation.test?.globalSetup).toEqual(unit.test?.globalSetup);
  });

  it('give the logs suite the shared pair, then the load measurement, and nothing that refuses (#822)', () => {
    expect(logs.test?.setupFiles).toEqual([
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
      'tests/load-setup.ts',
    ]);
  });

  it('give the logs suite the unit suite global setup (#822)', () => {
    expect(logs.test?.globalSetup).toEqual(unit.test?.globalSetup);
  });

  it('give the guards suite the unit suite global setup', () => {
    expect(guards.test?.globalSetup).toEqual(unit.test?.globalSetup);
  });

  it('give the integration suite the unit suite global setup', () => {
    expect(integration.test?.globalSetup).toEqual(unit.test?.globalSetup);
  });
});

describe('the CPU limit', () => {
  it('is not asked of the simulation suite (#650)', () => {
    expect(simulation.test?.setupFiles).not.toContain(
      'tests/unit-cpu-setup.ts',
    );
  });

  it('is not asked of the integration suite', () => {
    expect(integration.test?.setupFiles).not.toContain(
      'tests/unit-cpu-setup.ts',
    );
  });

  it('is not asked of the logs suite (#822)', () => {
    expect(logs.test?.setupFiles).not.toContain('tests/unit-cpu-setup.ts');
  });
});

// The unit load limit (#688) is the unit suite's alone: the other suites
// measure their loading (#696) and are judged by their one measured limit at
// their CI step, and a limit for their loading is the operator's to set.
describe('the load limit', () => {
  it.each([
    ['guards', guards],
    ['integration', integration],
    ['simulation', simulation],
    ['logs', logs],
  ] as const)('is not asked of the %s suite (#696)', (_name, config) => {
    expect(config.test?.setupFiles).not.toContain(
      'tests/unit-load-limit-setup.ts',
    );
  });
});
