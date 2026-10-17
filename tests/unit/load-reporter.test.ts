import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestModule } from 'vitest/node';
import guards from '../../vitest.guards.config';
import integration from '../../vitest.integration.config';
import logs from '../../vitest.logs.config';
import simulation from '../../vitest.simulation.config';
import unit from '../../vitest.config';
import LoadReporter from '../load-reporter';

/**
 * The report of what loading each test file cost (#688, #696): one reporter,
 * named by the suite it reports on, in all four Vitest suites.
 */

type Fake = {
  file: string;
  states: string[];
  cpu?: number;
  wall?: number;
};

/** A test module as the reporter reads it: its tests' states and its meta. */
const fakeModule = ({ file, states, cpu, wall }: Fake): TestModule =>
  ({
    relativeModuleId: file,
    children: {
      allTests: () => states.map((state) => ({ result: () => ({ state }) })),
    },
    meta: () => ({ loadCpuMicroseconds: cpu, loadWallMilliseconds: wall }),
  }) as unknown as TestModule;

/** What one run of the reporter prints, as lines. */
const printed = (suite: string, modules: Fake[]): string[] => {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  new LoadReporter({ suite }).onTestRunEnd(modules.map(fakeModule));
  const text = write.mock.calls.map(([chunk]) => String(chunk)).join('');
  return text.split('\n').filter((line) => line !== '');
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the load report', () => {
  it('names the suite and prints a measured file with its wall time', () => {
    expect(
      printed('guards', [
        {
          file: 'tests/guards/a.test.ts',
          states: ['passed'],
          cpu: 412_600,
          wall: 980.4,
        },
      ]),
    ).toEqual([
      'Own CPU of loading each guards file (#688): 1 measured, 0 unmeasured; over 300 ms: 1; over 200 ms: 1; the heaviest 1:',
      '     413 ms  tests/guards/a.test.ts > loaded in 980 ms of wall',
    ]);
  });

  it('counts a file that ran a test and carries no figure as unmeasured', () => {
    expect(
      printed('integration', [
        { file: 'tests/integration/b.test.ts', states: ['failed'] },
      ]),
    ).toEqual([
      'Own CPU of loading each integration file (#688): 0 measured, 1 unmeasured; over 300 ms: 0; over 200 ms: 0; the heaviest 0:',
    ]);
  });

  it('leaves out a file none of whose tests ran', () => {
    expect(
      printed('simulation', [
        {
          file: 'tests/simulation/c.test.ts',
          states: ['skipped'],
          cpu: 900_000,
          wall: 1,
        },
      ]),
    ).toEqual([
      'Own CPU of loading each simulation file (#688): 0 measured, 0 unmeasured; over 300 ms: 0; over 200 ms: 0; the heaviest 0:',
    ]);
  });

  it('refuses to report without the name of its suite', () => {
    expect(() => new LoadReporter({ suite: '' })).toThrow(
      'The load reporter needs the name of the suite it reports on (#696).',
    );
  });
});

// Each suite's own reporters, pinned as literals read from the configs' own
// objects (#696). The other suites keep the verbose listing they had on their
// command line, which a command-line reporter would replace wholesale.
describe('the reporters of each suite', () => {
  it('give the unit suite the default listing, test CPU, then loading', () => {
    expect(unit.test?.reporters).toEqual([
      'default',
      './tests/unit-cpu-reporter.ts',
      ['./tests/load-reporter.ts', { suite: 'unit' }],
    ]);
  });

  it.each([
    ['guards', guards],
    ['integration', integration],
    ['simulation', simulation],
    ['logs', logs],
  ] as const)(
    'give the %s suite the verbose listing, then its loading (#696)',
    (suite, config) => {
      expect(config.test?.reporters).toEqual([
        'verbose',
        ['./tests/load-reporter.ts', { suite }],
      ]);
    },
  );
});
