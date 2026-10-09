import { describe, it, expect } from 'vitest';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import {
  collectNavigations,
  NAVIGATION_STEP_CATEGORY,
  NAVIGATION_STEP_TITLE,
  type NavigationStepLike,
} from '../reporters/nav-timing-reporter';
import {
  navTimings,
  formatNavTimings,
  navTimingVerdict,
  excusedFromNavigating,
  resultsByProject,
} from '../../scripts/test-e2e.mjs';

/**
 * Per-NAVIGATION timings, as opposed to the per-test timings in
 * `e2e-timings.test.ts`.
 *
 * #44's open question is stated in `playwright.config.ts`: the whole-test
 * numbers "bound the problem, they do not separate a slow navigation from a
 * slow test around one". `page.goto: Test timeout of 30000ms exceeded` names
 * the TEST budget, so a navigation that ran 900ms inside a test that ran 29s
 * and one that ran 29s on its own produce the same line. Only the first is a
 * navigation problem, and the two call for opposite fixes.
 *
 * THREE FACTS BELOW WERE MEASURED, NOT ASSUMED (Playwright 1.63.0, probe run
 * 2026-09-10), and each one would have produced a silently empty distribution
 * if guessed:
 *
 * 1. The step is titled `Navigate`, NOT `page.goto`. Matching the API name —
 *    the obvious guess — collects nothing and reports a healthy-looking empty
 *    table.
 * 2. A `goto` inside a plain helper is a TOP-LEVEL step, but one inside
 *    `test.step()` is a CHILD, and one in `beforeEach` is a child of
 *    `Before Hooks`. A shallow scan silently drops both.
 * 3. The built-in `json` reporter — the artefact `scripts/test-e2e.mjs`
 *    already produces — STRIPS every `pw:api` step and keeps only the user's
 *    `test.step` entries, with no `category` field at all. The durations exist
 *    only in the in-memory tree a reporter is handed, which is why this is a
 *    reporter and not another read of that file.
 *
 * The liveness verdict at the bottom is the control for all three. Every one
 * of those mistakes fails the same way — zero records, green run — which is
 * the defect class #79/#84/#87 exist to close, in a fourth medium.
 */

/** A minimal `TestStep`, structurally compatible with Playwright's. */
function step(
  title: string,
  category: string,
  duration: number,
  options: { error?: boolean; steps?: NavigationStepLike[] } = {},
): NavigationStepLike {
  return {
    title,
    category,
    duration,
    error: options.error ? { message: 'timed out' } : undefined,
    steps: options.steps ?? [],
  };
}

const nav = (duration: number, error = false) =>
  step(NAVIGATION_STEP_TITLE, NAVIGATION_STEP_CATEGORY, duration, { error });

describe('collecting navigation steps out of a result tree', () => {
  it('records a top-level navigation', () => {
    expect(collectNavigations([nav(420)])).toEqual([
      { durationMs: 420, errored: false },
    ]);
  });

  it('records a navigation nested inside a test.step', () => {
    const tree = [
      step('a named step', 'test.step', 430, { steps: [nav(425)] }),
    ];
    expect(collectNavigations(tree)).toEqual([
      { durationMs: 425, errored: false },
    ]);
  });

  it('records a navigation made in beforeEach, under Before Hooks', () => {
    const tree = [
      step('Before Hooks', 'hook', 900, {
        steps: [step('Fixture "page"', 'fixture', 800, { steps: [nav(760)] })],
      }),
    ];
    expect(collectNavigations(tree)).toEqual([
      { durationMs: 760, errored: false },
    ]);
  });

  it('ignores a test.step a human happened to title Navigate', () => {
    const tree = [step(NAVIGATION_STEP_TITLE, 'test.step', 99)];
    expect(
      searched(collectNavigations(tree), {
        of: tree,
        what: 'steps in the result tree',
      }),
    ).toEqual([]);
    expect(
      floorBreach('nav-timings/human-titled-navigate-steps', tree.length),
    ).toBeUndefined();
  });

  it('ignores the other pw:api steps that surround every navigation', () => {
    const tree = [
      step('Launch browser', NAVIGATION_STEP_CATEGORY, 595),
      step('Create context', NAVIGATION_STEP_CATEGORY, 5),
      step('Create page', NAVIGATION_STEP_CATEGORY, 183),
    ];
    expect(
      searched(collectNavigations(tree), {
        of: tree,
        what: 'steps in the result tree',
      }),
    ).toEqual([]);
    expect(
      floorBreach('nav-timings/surrounding-pw-api-steps', tree.length),
    ).toBeUndefined();
  });

  it('flags a navigation that errored — the #44 shape', () => {
    expect(collectNavigations([nav(8802, true)])).toEqual([
      { durationMs: 8802, errored: true },
    ]);
  });

  it('finds every navigation in a test that made several', () => {
    const tree = [
      nav(100),
      step('reload and check', 'test.step', 300, { steps: [nav(250)] }),
      nav(120),
    ];
    expect(collectNavigations(tree).map((n) => n.durationMs)).toEqual([
      100, 250, 120,
    ]);
  });
});

describe('summarising navigations per project', () => {
  const records = [
    {
      project: 'mobile-safari',
      file: 'a.spec.ts',
      test: 'one',
      durationMs: 100,
      errored: false,
    },
    {
      project: 'mobile-safari',
      file: 'a.spec.ts',
      test: 'two',
      durationMs: 900,
      errored: false,
    },
    {
      project: 'mobile-safari',
      file: 'a.spec.ts',
      test: 'three',
      durationMs: 500,
      errored: false,
    },
    {
      project: 'chromium',
      file: 'a.spec.ts',
      test: 'one',
      durationMs: 40,
      errored: false,
    },
  ];

  it('groups by project and counts what it saw', () => {
    const rows = navTimings(records);
    expect(rows.map((r) => [r.project, r.count])).toEqual([
      ['mobile-safari', 3],
      ['chromium', 1],
    ]);
  });

  it('reports the tail, because a mean hides the one navigation that stalled', () => {
    const [heaviest] = navTimings(records);
    expect(heaviest.maxMs).toBe(900);
    expect(heaviest.p95Ms).toBe(900);
  });

  it('never invents a duration that no navigation actually took', () => {
    // Nearest-rank, not interpolation. With two samples an interpolated
    // median would report 300ms — a number no navigation spent — and #44 is
    // an argument about specific observed navigations.
    const [only] = navTimings([
      { project: 'p', file: 'f', test: 't', durationMs: 100, errored: false },
      { project: 'p', file: 'f', test: 't', durationMs: 500, errored: false },
    ]);
    expect(only.medianMs).toBe(100);
  });

  it('orders projects by their slowest navigation, worst first', () => {
    expect(navTimings(records).map((r) => r.project)).toEqual([
      'mobile-safari',
      'chromium',
    ]);
  });

  it('names the errored navigations, so a timeout is identifiable', () => {
    const rows = navTimings([
      ...records,
      {
        project: 'mobile-safari',
        file: 'p.spec.ts',
        test: 'reload',
        durationMs: 30000,
        errored: true,
      },
    ]);
    const [heaviest] = rows;
    expect(heaviest.erroredCount).toBe(1);
    expect(heaviest.slowest[0]).toMatchObject({
      test: 'reload',
      durationMs: 30000,
    });
  });

  it('survives a run that recorded nothing rather than dividing by zero', () => {
    expect(navTimings([])).toEqual([]);
  });
});

type Outcome = 'expected' | 'unexpected' | 'flaky' | 'skipped';

/**
 * A json report in the shape Playwright writes it: `stats` counts tests by
 * outcome, each test names its project, a `describe` block nests as `suites`,
 * and each project's `metadata` is copied into `config.projects`. Declared
 * here rather than imported, so it can disagree with the code it tests.
 *
 * Every test sits one `describe` deep, so a walk that reads only top-level
 * specs finds none of them.
 */
const jsonReport = ({
  tests,
  excused = [],
  stats,
}: {
  tests: { project: string; status: Outcome }[];
  excused?: string[];
  stats?: Partial<Record<Outcome, number>>;
}) => {
  const outcomes = (status: Outcome) =>
    tests.filter((t) => t.status === status).length;
  const names = [...new Set([...tests.map((t) => t.project), ...excused])];
  return {
    config: {
      projects: names.map((name) => ({
        name,
        metadata: excused.includes(name) ? { requiresNavigation: false } : {},
      })),
    },
    stats: stats ?? {
      expected: outcomes('expected'),
      unexpected: outcomes('unexpected'),
      flaky: outcomes('flaky'),
      skipped: outcomes('skipped'),
    },
    suites: [
      {
        title: 'a.spec.ts',
        specs: [],
        suites: [
          {
            title: 'a describe block',
            specs: tests.map(({ project, status }, i) => ({
              title: `test ${i}`,
              tests: [{ projectName: project, status }],
            })),
          },
        ],
      },
    ],
  };
};

/**
 * The refusal's message, after asserting the verdict refused, which also
 * narrows its type for the assertions that read the message.
 */
const refusal = (verdict: ReturnType<typeof navTimingVerdict>): string => {
  if (verdict.ok) throw new Error('expected the verdict to refuse; it passed');
  return verdict.message;
};

const ran = (project: string, count: number, status: Outcome = 'expected') =>
  Array.from({ length: count }, () => ({ project, status }));

describe('which projects must navigate — read back out of the report', () => {
  it('excuses exactly the projects the config marks', () => {
    const report = jsonReport({
      tests: [...ran('chromium', 1), ...ran('content', 1)],
      excused: ['content'],
    });
    expect([...excusedFromNavigating(report)]).toEqual(['content']);
  });

  it('excuses nothing when the report carries no project config', () => {
    // Fail closed: a report without the mark counts every project, which is
    // the behaviour before #355 rather than a silent pass.
    const projects = [{ name: 'chromium' }, { name: 'content' }];
    expect(
      searched([...excusedFromNavigating({ config: { projects } })], {
        of: projects,
        what: 'projects in the report',
      }),
    ).toEqual([]);
    expect(
      floorBreach('nav-timings/unmarked-report-projects', projects.length),
    ).toBeUndefined();
    expect(excusedFromNavigating({})).toEqual(new Set());
  });

  it('counts each project’s results, however deep the describe blocks, and never a skip', () => {
    const report = jsonReport({
      tests: [
        ...ran('chromium', 1, 'expected'),
        ...ran('chromium', 1, 'unexpected'),
        ...ran('chromium', 1, 'flaky'),
        ...ran('chromium', 2, 'skipped'),
        ...ran('content', 1),
      ],
    });
    expect(Object.fromEntries(resultsByProject(report))).toEqual({
      chromium: 3,
      content: 1,
    });
  });
});

describe('the liveness verdict — the control on all of the above', () => {
  it('passes a run made only of projects the config excuses (#355)', () => {
    // `copy-reaches-a-page.spec.ts` reads built files and opens no page, so a
    // filtered run of it records no navigation with the collector healthy.
    const verdict = navTimingVerdict({
      navigations: 0,
      report: jsonReport({ tests: ran('content', 11), excused: ['content'] }),
    });
    expect(verdict).toEqual({ ok: true });
  });

  it('passes a mixed run that recorded navigations', () => {
    const verdict = navTimingVerdict({
      navigations: 4,
      report: jsonReport({
        tests: [...ran('chromium', 3), ...ran('content', 2)],
        excused: ['content'],
      }),
    });
    expect(verdict).toEqual({ ok: true });
  });

  it('fails a mixed run whose rendering tests recorded no navigation, and names what it counted', () => {
    const verdict = navTimingVerdict({
      navigations: 0,
      report: jsonReport({
        tests: [
          ...ran('chromium', 2),
          ...ran('webkit', 1),
          ...ran('content', 5),
        ],
        excused: ['content'],
      }),
    });
    const message = refusal(verdict);
    expect(message).toMatch(/3 test\(s\) ran in projects that must navigate/);
    expect(message).toMatch(/chromium 2, webkit 1/);
    expect(message).toMatch(/Not counted: 5 result\(s\) from content/);
    expect(message).toMatch(/Navigate/);
    // The claim #355 found false: most tests navigate, not every test.
    expect(message).not.toMatch(/every test/i);
  });

  it('fails a rendering-only run that recorded no navigation', () => {
    const verdict = navTimingVerdict({
      navigations: 0,
      report: jsonReport({ tests: ran('firefox', 120), excused: ['content'] }),
    });
    const message = refusal(verdict);
    expect(message).toMatch(
      /120 test\(s\) ran in projects that must navigate \(firefox 120\)/,
    );
    expect(message).not.toMatch(/Not counted/);
  });

  it('passes a run where no test produced a result at all', () => {
    // `--grep` that matches nothing, or a suite-level failure before any test
    // ran: there is no collector to prove alive, so there is nothing to fail.
    const verdict = navTimingVerdict({
      navigations: 0,
      report: jsonReport({ tests: ran('chromium', 3, 'skipped') }),
    });
    expect(verdict).toEqual({ ok: true });
  });

  it('fails when its own walk of the report disagrees with the report’s stats', () => {
    // The per-project count is this script's walk. A walk that finds nothing
    // would count zero rendering tests and wave a dead collector through, so
    // it is checked against the count Playwright keeps itself.
    const verdict = navTimingVerdict({
      navigations: 0,
      report: jsonReport({
        tests: ran('chromium', 2),
        stats: { expected: 7 },
      }),
    });
    const message = refusal(verdict);
    expect(message).toMatch(/stats count 7 .* found 2/);
  });
});

describe('the printed table', () => {
  it('prints a row per project with its tail', () => {
    const table = formatNavTimings(
      navTimings([
        {
          project: 'mobile-safari',
          file: 'a.spec.ts',
          test: 'one',
          durationMs: 900,
          errored: false,
        },
      ]),
    );
    expect(table).toMatch(/mobile-safari/);
    expect(table).toMatch(/900/);
  });

  it('says so plainly when a run recorded no navigations', () => {
    expect(formatNavTimings([])).toMatch(/no navigations/i);
  });
});
