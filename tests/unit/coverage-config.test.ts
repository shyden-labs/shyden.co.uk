import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import coverage from '../../vitest.coverage.config';
import guards from '../../vitest.guards.config';
import integration from '../../vitest.integration.config';
import simulation from '../../vitest.simulation.config';
import unit from '../../vitest.config';
import { unitProject } from '../vitest-suite-dirs';

/**
 * The coverage run (#896): the unit suite under V8 coverage, minus exactly the
 * two unit judges, own CPU and file load. They judge the 1 s step, which runs
 * without coverage; under coverage a test's CPU is the instrumentation's too.
 * Nothing else may differ: no limit is raised, no refusal dropped. Pinned as
 * literals read from the configs' own objects, never from the constants they
 * were built from.
 */
describe('the coverage run is the unit suite minus its two judges (#896)', () => {
  it('keeps the refusal and the shared pair, without the CPU judge', () => {
    expect(coverage.test?.setupFiles).toEqual([
      'tests/unit-refusal-setup.ts',
      'tests/git-env-setup.ts',
      'tests/temporary-files-setup.ts',
    ]);
  });

  it('keeps the unit suite with its CPU judge', () => {
    expect(unit.test?.setupFiles).toContain('tests/unit-cpu-setup.ts');
  });

  it.each([
    ['unit', ['tests/load-setup.ts']],
    [
      'unit-parser',
      ['tests/typescript-preload-setup.ts', 'tests/load-setup.ts'],
    ],
  ] as const)(
    'gives the %s project its setup without the load judge',
    (name, setup) => {
      expect(
        unitProject(name, coverage, 'vitest.coverage.config.ts').setupFiles,
      ).toEqual(setup);
    },
  );

  it.each(['unit', 'unit-parser'] as const)(
    'keeps the load judge in the unit suite’s %s project',
    (name) => {
      expect(unitProject(name).setupFiles).toContain(
        'tests/unit-load-limit-setup.ts',
      );
    },
  );

  it.each(['unit', 'unit-parser'] as const)(
    'runs the same files as the unit suite’s %s project',
    (name) => {
      const ours = unitProject(name, coverage, 'vitest.coverage.config.ts');
      const theirs = unitProject(name);
      expect([ours.include, ours.exclude, ours.isolate]).toEqual([
        theirs.include,
        theirs.exclude,
        theirs.isolate,
      ]);
    },
  );

  it.each(['testTimeout', 'hookTimeout'] as const)(
    'raises no limit: %s stays at 1 s',
    (limit) => {
      expect(coverage.test?.[limit]).toBe(1_000);
    },
  );

  it('reports load without the CPU reporter, which reads the judge’s figures', () => {
    expect(coverage.test?.reporters).toEqual([
      'default',
      ['./tests/load-reporter.ts', { suite: 'unit' }],
    ]);
  });

  it('leaves the 1 s step without coverage', () => {
    const scripts = (
      JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect([scripts['test:unit'], unit.test?.coverage]).toEqual([
      'vitest run',
      undefined,
    ]);
  });
});

/** What every suite measures, and where each writes it (#896). */
describe('every Vitest suite measures the same code with V8', () => {
  const MEASURED = {
    provider: 'v8',
    reporter: ['json', 'lcovonly'],
    include: [
      'src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
      'scripts/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
      'functions/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
      'tests/*.{ts,tsx,mts,cts,js,mjs,cjs}',
    ],
    exclude: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'],
    reportOnFailure: false,
  };

  it.each([
    ['unit', coverage],
    ['guards', guards],
    ['simulation', simulation],
    ['integration', integration],
  ] as const)('the %s suite writes to its own directory', (suite, config) => {
    expect(config.test?.coverage).toEqual({
      ...MEASURED,
      reportsDirectory: `coverage/${suite}`,
    });
  });
});
