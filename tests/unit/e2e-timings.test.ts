import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  projectTimings,
  formatTimings,
  TEST_BUDGET_MS,
} from '../../scripts/test-e2e.mjs';
import { withoutTsComments } from './source-text';
import { commentsIn, parseSource } from './ast';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * Where the e2e suite's time actually goes, per project.
 *
 * #44: `build-and-test` failed on a single mobile-safari test that exceeded
 * the 30s budget inside `page.goto`, and passed on a re-run. The issue's first
 * acceptance criterion is explicit that no timeout may be raised before the
 * real numbers are known — a timeout change with no measurement behind it is a
 * guess with a number in it.
 *
 * The numbers were already being thrown away. `scripts/test-e2e.mjs` runs the
 * suite with a json reporter beside the caller's (#36's suite-size guard needs
 * one), reads `stats` out of it and deletes the file. Every duration in every
 * CI run so far has gone into a temp directory and straight in the bin.
 *
 * So this is not new instrumentation, it is keeping what the run already
 * produced. Nothing is added to CI: no artifact upload, no new action to
 * SHA-pin, no third-party reporter. That matters more here than convenience —
 * the supply chain of this pipeline is the thing #39 and #23 exist to keep
 * small.
 *
 * ONE CORRECTION TO THE ISSUE, worth recording because it changes the
 * diagnosis. `playwright.config.ts` sets NO `timeout` and no
 * `navigationTimeout`, so "Test timeout of 30000ms exceeded" is the WHOLE
 * TEST's budget, not a stalled navigation — `page.goto` is merely where the
 * clock ran out. That test takes 775ms locally on mobile-safari. A ~39x gap is
 * not the shape of a tight budget under load, which is what these numbers are
 * collected to settle.
 */

/** A report in the shape Playwright's json reporter actually emits, verified
 *  against a real run rather than assumed from the docs. */
const report = (
  tests: { project: string; title: string; durations: number[] }[],
) => ({
  config: {},
  errors: [],
  stats: { expected: tests.length, unexpected: 0, duration: 1 },
  suites: [
    {
      title: 'a.spec.ts',
      file: 'a.spec.ts',
      specs: tests.map(({ project, title, durations }) => ({
        title,
        tests: [
          {
            projectName: project,
            status: 'expected',
            results: durations.map((duration) => ({
              duration,
              status: 'passed',
            })),
          },
        ],
      })),
    },
  ],
});

describe('per-project e2e timings', () => {
  it('groups by project and counts what ran', () => {
    const rows = projectTimings(
      report([
        { project: 'chromium', title: 'a', durations: [10] },
        { project: 'chromium', title: 'b', durations: [20] },
        { project: 'webkit', title: 'c', durations: [30] },
      ]),
    );
    expect(rows.map((r) => [r.project, r.count])).toEqual([
      ['chromium', 2],
      ['webkit', 1],
    ]);
  });

  it('reports the tail, not the mean — a mean hides the one test that timed out', () => {
    const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 29000];
    const [row] = projectTimings(
      report(
        durations.map((d, i) => ({
          project: 'mobile-safari',
          title: `t${i}`,
          durations: [d],
        })),
      ),
    );
    // Nearest-rank: p50 is the 5th of ten, p90 the 9th.
    expect(row.p50).toBe(500);
    expect(row.p90).toBe(900);
    expect(row.max).toBe(29000);
  });

  it('takes the SLOWEST attempt of a retried test, not the last', () => {
    // A test that times out at 30s and passes at 800ms on retry is the exact
    // case #44 is about. Reporting 800ms would erase the finding.
    const [row] = projectTimings(
      report([{ project: 'webkit', title: 'flaky', durations: [30000, 800] }]),
    );
    expect(row.max).toBe(30000);
  });

  it('names the slowest tests, so a near-timeout is identifiable', () => {
    const rows = projectTimings(
      report([
        { project: 'webkit', title: 'quick', durations: [5] },
        { project: 'webkit', title: 'the slow one', durations: [9000] },
      ]),
    );
    expect(rows[0].slowest[0]).toEqual({ title: 'the slow one', ms: 9000 });
  });

  it('survives a report with no tests rather than dividing by zero', () => {
    // No test is the point, so the units the reader walked are the report's
    // suites: one file, holding no spec.
    const empty = report([]);
    expect(
      searched(projectTimings(empty), {
        of: empty.suites,
        what: 'suites of the empty report',
      }),
    ).toEqual([]);
    expect(
      floorBreach('e2e-timings/empty-report-suites', empty.suites.length),
    ).toBeUndefined();
  });

  it('formats a table naming the budget each project is measured against', () => {
    const table = formatTimings(
      projectTimings(
        report([{ project: 'webkit', title: 'x', durations: [1234] }]),
      ),
    );
    expect(table).toContain('webkit');
    expect(table).toContain('1234');
    // The 30000ms default is the thing these numbers are read against; a table
    // without it makes the reader look it up and guess.
    expect(table).toContain('30000');
  });
});

describe('the budget every table is measured against is the real one', () => {
  /**
   * `TEST_BUDGET_MS` is a hard-coded 30000, and the whole of #44 is read
   * against it: "a max approaching it is #44 rather than a merely slow page".
   * What makes that true is Playwright's default per-test timeout, which holds
   * only while `playwright.config.ts` overrides neither `timeout` nor
   * `navigationTimeout`. That was documented in three comments and asserted
   * nowhere — so an override would leave both tables measuring against a
   * number the run no longer uses, and every conclusion drawn from them wrong
   * with nothing going red.
   *
   * COMMENTS ARE STRIPPED FIRST, and the last case proves that is not a
   * formality here: measured, the config is 6111 bytes raw and 1465 stripped,
   * and the word `timeout` survives ONLY in prose. An absence check run over
   * the raw file would be reading mostly documentation — including the
   * documentation explaining why it exists.
   */
  const config = () =>
    withoutTsComments(readFileSync('playwright.config.ts', 'utf8'));

  it('overrides no timeout of any kind, so the defaults are what run', () => {
    // Deliberately every `*timeout:` setting, not just `timeout` and
    // `navigationTimeout`: `actionTimeout` and an `expect` timeout would move
    // these numbers just as silently, and the claim being protected is that
    // NOTHING in this config overrides a default the tables assume.
    expect(config()).not.toMatch(/[a-z]*timeout\s*:/i);
  });

  it("measures against Playwright's documented default", () => {
    expect(TEST_BUDGET_MS).toBe(30000);
  });

  it('reads the config, not the prose about the config', () => {
    // The control on the check above, and the direction that makes an absence
    // assertion vacuous: if the stripper stopped stripping, the guard would go
    // on passing while reading something other than what it claims to. The
    // config discusses `timeout` at length and configures none, so the word
    // must be present in the PROSE and gone once stripped.
    //
    // Sliced out of the comments rather than read off the raw file (#183): an
    // unanchored `/\btimeout\b/i` over raw text is satisfied by a `timeout:`
    // setting exactly as readily as by the prose, so this control would stay
    // green in the one world the assertion above exists to catch. Asked of
    // the parser, the `stranded-docblocks.test.ts` idiom, because only the
    // grammar knows a `//` inside a string or a regex is not a comment (#65).
    const raw = readFileSync('playwright.config.ts', 'utf8');
    const prose = commentsIn(parseSource(raw, 'playwright.config.ts'))
      .map((comment) => raw.slice(comment.pos, comment.end))
      .join('\n');
    expect(prose).toMatch(/\btimeout\b/i);
    expect(withoutTsComments(raw)).not.toMatch(/\btimeout\b/i);
  });
});
