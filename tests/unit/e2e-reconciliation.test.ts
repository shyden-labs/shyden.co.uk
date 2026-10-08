import { describe, it, expect } from 'vitest';
import {
  parseListTotal,
  isFilteredRun,
  countExecuted,
  reconcile,
  mergeReporters,
  NAV_TIMING_REPORTER,
  enumerationArgs,
} from '../../scripts/test-e2e.mjs';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * A green e2e run must mean the whole suite ran, not that some of it did.
 *
 * This file exists because of a real observation that was misdiagnosed: a run
 * reported roughly 850 passing tests when the suite holds 2094, and the
 * shortfall was attributed to stale browser binaries. That theory was tested
 * and is false — a missing browser revision makes Playwright fail loudly, per
 * test, printing the exact `npx playwright install` remedy. Reproduced by
 * moving `webkit-2359` aside: `browserType.launch: Executable doesn't exist`,
 * 1 failed. It cannot produce a green partial run.
 *
 * So the cause of that particular shortfall is unknown, and that is precisely
 * why the guard here is written to be CAUSE-INDEPENDENT. It does not detect
 * stale browsers, an interrupted worker, an accidental `--project`, or a spec
 * that stopped matching. It detects the only thing that matters and the one
 * thing all of those share: fewer tests ran than the suite contains.
 *
 * The comparison MUST come from outside the run. A Playwright reporter is
 * handed the already-filtered test list, so a reporter comparing what it saw
 * against what it was given compares a number with itself and can only ever
 * agree — a guard that cannot fail. The enumeration therefore comes from a
 * separate, unfiltered `playwright test --list`.
 *
 * A deliberately narrowed run is not a defect. It is ANNOUNCED, never failed,
 * because a guard that cries wolf on `--project=chromium` is a guard people
 * learn to ignore.
 */

describe('reading the suite size from `playwright test --list`', () => {
  it('reads the total off the footer', () => {
    const listing = [
      '  [webkit] › smoke.spec.ts:3:1 › homepage responds with the Shyden title',
      'Total: 2094 tests in 18 files',
    ].join('\n');

    expect(parseListTotal(listing)).toBe(2094);
  });

  it('refuses to guess when the footer is missing', () => {
    // Returning 0 here would make every comparison below trivially satisfied:
    // "executed >= 0" is true of every run, including one that ran nothing.
    expect(
      parseListTotal('Error: no tests found'),
      'a missing footer must be an absent answer, never a zero',
    ).toBeNull();
  });
});

describe('telling a deliberate subset from a full run', () => {
  it('treats an unadorned invocation as the full suite', () => {
    expect(isFilteredRun([])).toBe(false);
  });

  it.each([
    ['--project=chromium'],
    ['--project', 'chromium'],
    ['--grep=@smoke'],
    ['-g', '@smoke'],
    ['--grep-invert=@slow'],
    ['--shard=1/3'],
    ['--last-failed'],
    ['--only-changed'],
  ])('recognises %s as narrowing the run', (...argv) => {
    expect(
      isFilteredRun(argv),
      `${argv.join(' ')} reduces the run and must not be judged against the full total`,
    ).toBe(true);
  });

  it('recognises a positional spec path as narrowing the run', () => {
    expect(isFilteredRun(['tests/e2e/smoke.spec.ts'])).toBe(true);
  });

  it.each([
    ['--workers=2'],
    ['--reporter=line'],
    ['--retries=1'],
    ['--headed'],
  ])('does not mistake %s for a filter', (...argv) => {
    expect(
      isFilteredRun(argv),
      `${argv.join(' ')} changes how the suite runs, not which tests run — ` +
        'treating it as a filter would silently disable the guard',
    ).toBe(false);
  });
});

describe('counting what actually ran', () => {
  it('counts every outcome a test can end in', () => {
    // Skipped tests were still accounted for. Omitting them would make the
    // guard fire on a suite that legitimately skips, and the fix for that
    // false alarm would be to weaken the guard.
    expect(
      countExecuted({ expected: 2080, unexpected: 0, flaky: 0, skipped: 14 }),
    ).toBe(2094);
  });
});

describe('the reconciliation itself', () => {
  const full = { enumerated: 2094, filtered: false, playwrightExitCode: 0 };

  it('fails a green run that executed less than the whole suite', () => {
    const result = reconcile({ ...full, executed: 861 });

    expect(
      result.exitCode,
      'this is the entire point: green must never mean "some of it passed"',
    ).toBe(1);
    expect(result.message).toContain('861');
    expect(result.message).toContain('2094');
  });

  it('passes a run that executed the whole suite', () => {
    expect(reconcile({ ...full, executed: 2094 }).exitCode).toBe(0);
  });

  /**
   * ZERO is a broken measurement, not a suite size.
   *
   * Measured by execution, not argued: `reconcile({enumerated: 0, executed: 0,
   * filtered: false, playwrightExitCode: 0})` returned exitCode 0 -- a full run
   * that enumerated nothing, ran nothing and exited clean, reported as a PASS
   * by the guard whose own message calls that "the single outcome this guard
   * exists to reject".
   *
   * The neighbours were all correct, which is what hid it: `{0, 12}` fails on
   * the inequality and `{null, *}` fails on the type check. Only the number
   * zero is both a valid `number` and equal to an executed count of zero.
   *
   * The state is reachable -- a run immediately after `npm ci` printed
   * "PARTIAL RUN — 12 of 0 tests", so the listing really did emit a footer
   * reading zero. The trigger was never reproduced and is not claimed here
   * (#150).
   */
  it.each([
    ['the listing said zero and the run did nothing', 0, 0],
    ['the listing said zero while the run did work', 0, 12],
    ['the listing was believable but nothing ran', 2094, 0],
  ])('refuses to pass when %s', (_what, enumerated, executed) => {
    const result = reconcile({
      enumerated,
      executed,
      filtered: false,
      playwrightExitCode: 0,
    });

    expect(
      result.exitCode,
      'a run of zero tests is the vacuous pass this file exists to stop',
    ).toBe(1);
    // The operator has to be able to tell WHICH input was unbelievable.
    expect(result.message).toMatch(/enumerat|suite size|executed|ran/i);
  });

  it('names the listing’s own failure instead of deriving from its output', () => {
    // `spawnSync` reported the failure all along and nothing read it: a
    // listing that dies while still printing a footer is indistinguishable
    // from a suite that genuinely has that many tests. Same shape as the
    // `gh run list --commit` hazard -- an empty result reads exactly like a
    // real absence, and only one of those is good news.
    const result = reconcile({
      enumerated: 2094,
      executed: 2094,
      filtered: false,
      playwrightExitCode: 0,
      listing: { status: 1, stderr: 'error: cannot find module playwright' },
    });

    expect(result.exitCode, 'a broken enumeration cannot be a pass').toBe(1);
    expect(
      result.message,
      'the listing’s own words are the diagnosis',
    ).toContain('cannot find module playwright');
  });

  it('names the cause when the listing was killed rather than exiting', () => {
    // #438: a listing past spawnSync's buffer is killed, so it has no exit
    // status, an `error` of ENOBUFS and an empty stderr. The message read only
    // status and stderr, and said `exited null` with nothing to go on.
    const result = reconcile({
      ...full,
      executed: 2094,
      listing: {
        status: null,
        signal: 'SIGTERM',
        stderr: '',
        error: Object.assign(new Error('spawnSync npx ENOBUFS'), {
          code: 'ENOBUFS',
        }),
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('ENOBUFS');
    expect(result.message).toContain('SIGTERM');
  });

  it('still passes when the listing succeeded', () => {
    // Liveness for the check above: it must be the FAILURE that reddens it,
    // not the presence of a listing argument.
    expect(
      reconcile({
        ...full,
        executed: 2094,
        listing: { status: 0, stderr: '' },
      }).exitCode,
    ).toBe(0);
  });

  it('leaves a genuinely failing run failing', () => {
    const result = reconcile({
      ...full,
      executed: 2094,
      playwrightExitCode: 1,
    });

    expect(
      result.exitCode,
      'the guard adds a reason to fail and must never remove one',
    ).toBe(1);
  });

  it('announces a deliberately narrowed run instead of failing it', () => {
    const result = reconcile({
      enumerated: 2094,
      executed: 852,
      filtered: true,
      playwrightExitCode: 0,
    });

    expect(result.exitCode).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.message).toContain('852');
    expect(result.message).toContain('2094');
  });

  it('fails when more tests ran than the suite contains', () => {
    // Not a pedantic case: it means the enumeration and the run disagree about
    // what the suite IS, so every other comparison here is unsound. Louder
    // than a shortfall, not quieter.
    expect(reconcile({ ...full, executed: 2095 }).exitCode).toBe(1);
  });

  it('fails when the suite size could not be established', () => {
    expect(
      reconcile({ ...full, enumerated: null, executed: 2094 }).exitCode,
      'an unknown total must block the run, not wave it through',
    ).toBe(1);
  });
});

describe('a flag and its value are one argument, not two', () => {
  it.each([
    ['--workers', '2'],
    ['--reporter', 'line'],
    ['--retries', '1'],
  ])('does not read the value of %s as a spec path', (...argv) => {
    // `--workers 2` splits into two tokens and `2` looks positional. Reading it
    // as a path filter would mark a FULL run as narrowed, which announces the
    // shortfall instead of failing it — the guard would still print, and still
    // never fire. Silently disabling the guard is the failure this prevents.
    expect(isFilteredRun(argv)).toBe(false);
  });

  it('still sees a spec path that follows a valueless flag', () => {
    expect(isFilteredRun(['--headed', 'tests/e2e/smoke.spec.ts'])).toBe(true);
  });
});

describe("keeping this repo's reporters without stealing the console one", () => {
  // Both are added, and both for the same reason: `--reporter` REPLACES
  // rather than appends, so the caller's flag passed through untouched would
  // leave the suite-size guard with no json and #44 with no navigation
  // durations. A guard with no numbers is a guard that cannot fire.
  const ADDED = `json,${NAV_TIMING_REPORTER}`;

  it('adds them alongside the default console reporter', () => {
    expect(mergeReporters([])).toEqual({
      passthrough: [],
      reporter: `list,${ADDED}`,
    });
  });

  it("keeps the caller's chosen reporter and adds them to it", () => {
    expect(mergeReporters(['--reporter=line'])).toEqual({
      passthrough: [],
      reporter: `line,${ADDED}`,
    });
  });

  it('handles the space-separated form and leaves other args alone', () => {
    expect(mergeReporters(['--reporter', 'dot', '--workers=2'])).toEqual({
      passthrough: ['--workers=2'],
      reporter: `dot,${ADDED}`,
    });
  });

  it('adds neither twice when the caller already asked for them', () => {
    expect(
      mergeReporters([`--reporter=line,json,${NAV_TIMING_REPORTER}`]).reporter,
    ).toBe(`line,json,${NAV_TIMING_REPORTER}`);
  });

  it('adds the missing one when the caller asked for only the other', () => {
    // The two are independent: asking for json must not suppress the nav
    // reporter, which is how a merge written as one `if` would behave.
    expect(mergeReporters(['--reporter=line,json']).reporter).toBe(
      `line,json,${NAV_TIMING_REPORTER}`,
    );
    expect(
      mergeReporters([`--reporter=line,${NAV_TIMING_REPORTER}`]).reporter,
    ).toBe(`line,${NAV_TIMING_REPORTER},json`);
  });
});

describe('what the enumeration is allowed to inherit', () => {
  it('forwards the config, because it defines which suite this is', () => {
    // Counting the default suite while the run executes a different config is
    // a guaranteed false alarm on a legitimate command.
    expect(enumerationArgs(['--config=playwright.dev.config.ts'])).toEqual([
      '--config=playwright.dev.config.ts',
    ]);
    expect(enumerationArgs(['-c', 'playwright.dev.config.ts'])).toEqual([
      '-c',
      'playwright.dev.config.ts',
    ]);
  });

  it('never forwards a filter, which would make the guard unfailable', () => {
    // This is the load-bearing assertion of the whole file. Forwarding
    // `--project` shrinks the enumeration to exactly what the run executes, so
    // the two always agree and the guard can never fire again — while still
    // appearing to be present and passing.
    const argv = ['--project=chromium', '--grep=@smoke', '--shard=1/3'];
    expect(
      searched(enumerationArgs(argv), {
        of: argv.filter((arg) => arg.startsWith('-')),
        what: 'flags offered to the enumeration',
      }),
      'the total must describe the whole suite, not the slice being run',
    ).toEqual([]);
    expect(
      floorBreach(
        'e2e-reconciliation/filter-flags',
        argv.filter((arg) => arg.startsWith('-')).length,
      ),
    ).toBeUndefined();
  });

  it('ignores flags that change neither the suite nor its size', () => {
    const argv = ['--workers=2', '--headed', '--retries', '1'];
    expect(
      searched(enumerationArgs(argv), {
        of: argv.filter((arg) => arg.startsWith('-')),
        what: 'flags offered to the enumeration',
      }),
    ).toEqual([]);
    expect(
      floorBreach(
        'e2e-reconciliation/neutral-flags',
        argv.filter((arg) => arg.startsWith('-')).length,
      ),
    ).toBeUndefined();
  });
});

describe('flags that change the count without narrowing it', () => {
  it('does not judge a repeated run against a single-pass total', () => {
    // `--repeat-each=2` runs every test twice: executed legitimately EXCEEDS
    // the enumeration. Enforcing there fails a valid command, and the natural
    // fix for that false alarm would be to weaken the guard.
    expect(isFilteredRun(['--repeat-each=2'])).toBe(true);
  });
});
