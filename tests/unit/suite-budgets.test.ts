import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import guards from '../../vitest.guards.config';
import integration from '../../vitest.integration.config';
import simulation from '../../vitest.simulation.config';
import unit from '../../vitest.config';
import { workflowJobs } from '../workflow-jobs';
import { unitProject } from '../vitest-suite-dirs';

/**
 * The per-test budget of each suite that is not the unit suite: one table, so
 * the rule every suite shares has one home and a suite added later meets all
 * of it (the unit suite's own budget is `unit-budget.test.ts`).
 *
 * Each suite gets ONE limit, written where the suite is run
 * (`npm run test:<suite>`, a CI step of its own) and never in a config file or
 * on a test: a test that names its own limit has chosen a number nobody
 * measured. Each limit is pinned here as a literal, because a value asserted
 * against the script it was read from would move with it and pin nothing.
 *
 * guards (#638). A guard reads or parses the whole tree, so its cost is the
 * tree's size and load stretches it; it cannot meet the unit suite's 0.3 s and
 * is not a unit test (operator, 2026-10-08: "Own 'guards' suite").
 * Measurement (2026-10-08, the 597 tests as moved): the slowest test on the CI
 * runner took 7.2s (run 37798571160, `collection-needs-no-build`: it parses
 * every file under tests/), the next 4.3s. On a laptop running the whole
 * suite the same test took 7.6s, the next 2.5s. 25s is 3.3x the laptop's worst
 * and 3.5x the runner's, below the 30s the unit suite once allowed these same
 * tests, so moving them raises nothing. LOADING a file is outside this limit
 * (a per-test timer starts in a hook): measured on two CI runs (#696, runs
 * 38150963027 and 38153506290), `duplication.test.ts` spends 27.5 to 28.2 s of
 * its own CPU loading, more than the whole 25s, and the next three guard
 * files 3.2 to 4.8 s. The suite reports every file's load (`load-reporter.ts`)
 * and sets no load limit yet: operator, 2026-10-11, "After #700, from new
 * data", since a limit set now would have to sit above the defect #700 cuts.
 * integration and simulation load in at most 370 ms and 14 ms.
 *
 * simulation (#650). A simulation is a real run of the engine over many seeded
 * inputs; the unit suite keeps a stand-in that meets its 1 s and 0.3 s of CPU
 * and the real case lives in `tests/simulation/` (operator, 2026-10-09: "New
 * 'simulation' suite"). Measurement (2026-10-09, laptop, the eight
 * apart-letters cases, in the unit suite with coverage off, three samples
 * each; machine load average 8 to 23): sizes 4 to 20 took 2 to 14 ms; size 25
 * took 110 to 134 ms alone and up to 212 ms of wall (172 ms of its own CPU) in
 * the full unit run; size 30 up to 162 ms of wall. 700 ms is 3.3x the slowest
 * wall seen.
 *
 * integration (#630). Every test that starts a process lives in
 * `tests/integration/`, not in the unit suite (operator, 2026-10-08: "No
 * processes in unit"). Process start-up is the one cost load stretches without
 * limit. Measurement (2026-10-08, the 318 tests as moved): the slowest test on
 * the CI runner took 5.2s (run 37747897477, `git-env`: a child vitest over the
 * scratch-repository tests); on a laptop running the whole suite at once the
 * slowest took 16.7s (the same test), the next 6.9s. 30s is 1.8x the laptop's
 * worst and 5.8x the runner's, and it is the limit the unit suite already gave
 * these same tests, so moving them raises nothing: a figure at 3x the laptop
 * (51s) would have been a raise, and the operator rule is that none is ever
 * made.
 */
const SUITES = [
  {
    suite: 'guards',
    config: guards,
    command: 'vitest run --config vitest.guards.config.ts --testTimeout=25000',
  },
  {
    suite: 'simulation',
    config: simulation,
    command:
      'vitest run --config vitest.simulation.config.ts --testTimeout=700',
  },
  {
    suite: 'integration',
    config: integration,
    command:
      'vitest run --config vitest.integration.config.ts --testTimeout=30000',
  },
] as const;

const scripts = (): Record<string, string> =>
  (
    JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;

describe.each(SUITES)(
  'the $suite suite budget',
  ({ suite, config, command }) => {
    it('gives every test one limit, set on the command that runs the suite', () => {
      expect(scripts()[`test:${suite}`]).toBe(command);
    });

    it('sets no limit in its config, where a test run by hand would escape it', () => {
      expect({
        test: config.test?.testTimeout,
        hook: config.test?.hookTimeout,
      }).toEqual({ test: undefined, hook: undefined });
    });

    it(`reads tests/${suite} and nothing else`, () => {
      expect(config.test?.include).toEqual([`tests/${suite}/**/*.test.ts`]);
    });

    it("has the shared setup files and the unit suite's global setup, so a run is as isolated, then measures loading (#696)", () => {
      expect({
        setup: config.test?.setupFiles,
        global: config.test?.globalSetup,
      }).toEqual({
        setup: [
          'tests/git-env-setup.ts',
          'tests/temporary-files-setup.ts',
          'tests/load-setup.ts',
        ],
        global: unit.test?.globalSetup,
      });
    });
  },
);

describe('the suites beside the unit suite', () => {
  it('are not read by the unit suite', () => {
    expect({
      unit: unitProject('unit').include,
      parser: unitProject('unit-parser').include?.every((file) =>
        file.startsWith('tests/unit/'),
      ),
    }).toEqual({ unit: ['tests/unit/**/*.test.ts'], parser: true });
  });

  // Only unit tests, formatters and type checks run on the laptop; every other
  // suite runs in CI alone (operator, 2026-10-09, a global rule; #653). `npm
  // test` is the laptop's whole check, so it runs exactly those three, in this
  // order.
  it('are not run by npm test, which runs only what the laptop may run', () => {
    expect(scripts()['test']).toBe(
      'npm run format && npm run typecheck && npm run test:unit',
    );
  });

  // Read from the parsed workflow, step by step: a match in the raw text
  // could be satisfied by a comment, by another job, or by a longer script
  // name that merely contains this one.
  it('each run by a step of its own in the checks job, straight after the unit suite', () => {
    const checks = workflowJobs(
      readFileSync('.github/workflows/ci.yml', 'utf8'),
      'ci.yml',
    ).find(({ id }) => id === 'checks');
    const runs = checks?.runs ?? [];
    const unitAt = runs.indexOf('npm run test:unit');
    expect(runs.slice(unitAt, unitAt + 1 + SUITES.length)).toEqual([
      'npm run test:unit',
      'npm run test:guards',
      'npm run test:simulation',
      'npm run test:integration',
    ]);
  });
});
