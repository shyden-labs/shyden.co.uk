#!/usr/bin/env node
/**
 * `npm run test:e2e` — Playwright, plus proof that Playwright ran all of it.
 *
 * A green e2e summary is how this repo decides a change is safe to deploy. That
 * decision is only as good as the assumption underneath it: that "passed" means
 * the whole suite passed, not that some of it did.
 *
 * The prompting observation (#36) was a run reporting ~850 passing tests when
 * the suite holds 2094. That was originally attributed to stale browser
 * binaries left behind by a Playwright version bump. The theory was tested and
 * is FALSE: moving `webkit-2359` aside and running a webkit spec produces
 * `browserType.launch: Executable doesn't exist`, one failed test, and
 * Playwright's own banner naming the exact fix. A stale browser is loud.
 *
 * So the true cause of that shortfall is unknown — and that is the whole design
 * argument for what follows. This guard does not detect stale browsers, an
 * interrupted worker, a stray `--project`, or a spec that quietly stopped
 * matching. It detects the single thing every one of those has in common, and
 * the only thing that actually matters: fewer tests ran than the suite holds.
 *
 * WHY THE COUNT COMES FROM OUTSIDE THE RUN
 *
 * A Playwright reporter is handed the already-filtered test list. A reporter
 * that compared what it saw against what it was given would compare a number
 * with itself and agree every time — a guard that cannot fail. The enumeration
 * therefore comes from a separate, unfiltered `playwright test --list`.
 *
 * WHY A NARROWED RUN IS ANNOUNCED AND NOT FAILED
 *
 * `npm run test:e2e -- --project=chromium` is a legitimate thing to do. Failing
 * it would train everyone to ignore the guard, which is worse than not having
 * one. A deliberate subset is stated loudly instead; only an unqualified run is
 * held to the full total.
 */
import { spawnSync } from 'node:child_process';
import { messageOf } from './errors.mjs';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVIDENCE_REPORT } from './evidence-files.mjs';
import { shardAccount, shardNotice, shardOf } from './e2e-shards.mjs';

/** `playwright test --list` closes with e.g. `Total: 2094 tests in 18 files`. */
const LIST_FOOTER = /^Total:\s+(\d+)\s+tests?\b/m;

/**
 * The suite size as `--list` reports it, or null when it cannot be read.
 *
 * Null rather than 0: every comparison below is satisfied by "executed >= 0",
 * so a zero here would wave through the exact runs this file exists to stop.
 *
 *  @param {string} text
 */
export function parseListTotal(text) {
  const match = LIST_FOOTER.exec(text ?? '');
  return match ? Number(match[1]) : null;
}

/** Flags that change WHICH tests run, as opposed to how they run. */
const FILTER_FLAGS = new Set([
  '--project',
  '--grep',
  '-g',
  '--grep-invert',
  '--shard',
  '--last-failed',
  '--only-changed',
  // Not a filter — a multiplier. `--repeat-each=2` runs every test twice, so
  // the run legitimately exceeds the enumeration and is not comparable to it.
  '--repeat-each',
]);

/**
 * Flags whose value arrives as a separate token.
 *
 * Without this, `--workers 2` splits into two arguments and `2` reads as a
 * positional spec path — marking a FULL run as narrowed, which announces the
 * shortfall instead of failing it. The guard would still print and still never
 * fire, which is the most dangerous shape a guard can take.
 */
const VALUE_FLAGS = new Set([
  ...FILTER_FLAGS,
  '--workers',
  '-j',
  '--reporter',
  '--retries',
  '--timeout',
  '--global-timeout',
  '--repeat-each',
  '--max-failures',
  '--output',
  '--config',
  '-c',
  '--trace',
]);

/**
 * Args that select WHICH suite this is, as opposed to which of its tests run.
 *
 * These MUST reach the enumeration: counting the default suite while the run
 * executes `--config=playwright.dev.config.ts` compares two different things
 * and fails a perfectly good command.
 */
const SUITE_FLAGS = new Set(['--config', '-c']);

/**
 * The subset of the caller's args that `--list` should also receive.
 *
 * Filters are deliberately excluded, and that exclusion is the load-bearing
 * part: forwarding `--project` would shrink the enumeration to exactly what the
 * run executes, so the two would always agree and this guard could never fire
 * again — while still being present, still passing, and asserting nothing.
 *
 *  @param {readonly string[]} argv
 */
export function enumerationArgs(argv = []) {
  const forwarded = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-')) continue;
    const name = arg.split('=')[0];

    if (SUITE_FLAGS.has(name)) {
      forwarded.push(arg);
      if (!arg.includes('=')) {
        forwarded.push(argv[i + 1]);
        i += 1;
      }
      continue;
    }

    if (!arg.includes('=') && VALUE_FLAGS.has(name)) i += 1;
  }

  return forwarded;
}

/**
 * `--list` prints a line per test, about 150 bytes each, so its output grows
 * with the suite. At 7039 tests it passed spawnSync's 1 MiB default, and Node
 * killed the child: no exit status, ENOBUFS, an empty stderr, and every shard
 * of a green run failed (#438). The figure release-inventory.mjs and
 * build-release-content.mjs read git with.
 */
export const LIST_MAX_BUFFER = 256 * 1024 * 1024;

/**
 * @typedef {(
 *   command: string,
 *   args: readonly string[],
 *   options: import('node:child_process').SpawnSyncOptionsWithStringEncoding,
 * ) => import('node:child_process').SpawnSyncReturns<string>} Spawn
 */

/**
 * The unfiltered `playwright test --list` this run is reconciled against.
 *
 * @param {readonly string[]} argv
 * @param {Spawn} spawn
 */
export function listSuite(argv = [], spawn = spawnSync) {
  return spawn(
    'npx',
    ['playwright', 'test', '--list', ...enumerationArgs(argv)],
    { encoding: 'utf8', maxBuffer: LIST_MAX_BUFFER },
  );
}

/**
 *  Did the caller ask for a subset of the suite?
 *
 *  @param {readonly string[]} argv
 */
export function isFilteredRun(argv = []) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-')) return true; // a spec path
    const name = arg.split('=')[0];
    if (FILTER_FLAGS.has(name)) return true;
    if (!arg.includes('=') && VALUE_FLAGS.has(name)) i += 1; // skip its value
  }
  return false;
}

/**
 * The value each attempt flag must keep in an evidence run.
 *
 * @type {Readonly<Record<string, string>>}
 */
const ONE_ATTEMPT = { '--retries': '0', '--repeat-each': '1' };

/**
 * An evidence run captures exactly one attempt of each test, so it refuses a
 * flag that would make a second.
 *
 * `shoot` (tests/e2e/evidence.ts) numbers a test's captures per worker, and
 * Playwright runs a retry in a fresh worker, so a second attempt writes its
 * `01-…`, `02-…` over the first's files while the manifest keeps both
 * attempts' rows: the sign-off page shows one picture twice, under a test it
 * may not describe. A repeat collides the same way. An ordinary run captures
 * nothing, so it keeps every flag.
 *
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {'one attempt' | 'not an evidence run'}
 */
export function oneAttemptEach(argv, env) {
  if (!env.EVIDENCE_DIR) return 'not an evidence run';
  for (let i = 0; i < argv.length; i += 1) {
    const [name, inline] = argv[i].split('=');
    if (!Object.hasOwn(ONE_ATTEMPT, name)) continue;
    const value = inline ?? argv[i + 1];
    if (value === undefined) throw new Error(`${name} was given no value`);
    if (value !== ONE_ATTEMPT[name])
      throw new Error(
        `an evidence run takes one attempt of each test: ${name}=${value} ` +
          'would write a second attempt’s captures over the first’s, and keep ' +
          'both in the manifest',
      );
  }
  return 'one attempt';
}

/**
 * The reporter that keeps #44's per-navigation durations. A path rather than a
 * built-in name: Playwright resolves an unknown CLI reporter id against the
 * cwd, which is the repo root under `npm run test:e2e`.
 */
export const NAV_TIMING_REPORTER = './tests/reporters/nav-timing-reporter.ts';

/**
 * `--reporter` REPLACES rather than appends, so the caller's own choice would
 * leave no json for this guard to read — and a guard with no numbers is a guard
 * that cannot fire. Their reporter is kept; json is added beside it.
 *
 * The nav-timing reporter is added the same way and for a sharper version of
 * the same reason: #44's per-navigation numbers cannot be read out of the json
 * report AT ALL. Measured on Playwright 1.63.0 — the json reporter strips every
 * `pw:api` step and keeps only the user's `test.step` entries, so a probe test
 * that made two navigations produced a report containing neither.
 *
 *  @param {readonly string[]} argv
 */
export function mergeReporters(argv = []) {
  const passthrough = [];
  let chosen = 'list';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--reporter=')) {
      chosen = arg.slice('--reporter='.length);
    } else if (arg === '--reporter') {
      chosen = argv[i + 1] ?? 'list';
      i += 1;
    } else {
      passthrough.push(arg);
    }
  }

  const reporters = chosen.split(',').filter(Boolean);
  if (!reporters.includes('json')) reporters.push('json');
  if (!reporters.includes(NAV_TIMING_REPORTER))
    reporters.push(NAV_TIMING_REPORTER);
  return { passthrough, reporter: reporters.join(',') };
}

/**
 * Every outcome a test can end in, skips included.
 *
 * Skipped tests were accounted for by the run. Leaving them out would make the
 * guard fire on a suite that legitimately skips, and the natural fix for that
 * false alarm would be to weaken the guard.
 *
 * @param {{ expected?: number, unexpected?: number, flaky?: number, skipped?: number }} stats
 *   Spelled out, because a default of `{}` is read as the TYPE `{}` -- the
 *   narrowest type that value inhabits -- so every property read off it was
 *   an error (#157).
 */
export function countExecuted(stats = {}) {
  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = stats;
  return expected + unexpected + flaky + skipped;
}

const RULE = '='.repeat(72);

/**
 * The verdict, and the exit code the process should carry.
 *
 * Typed explicitly because this is a `.mjs` file: a destructured parameter is
 * inferred from its own shape, so `listing` was first inferred REQUIRED
 * (breaking all seven existing call sites) and then, once defaulted, inferred
 * as `null | undefined` (rejecting the only values it is meant to take).
 * Neither showed up in the suite -- esbuild strips types without checking them.
 *
 * @param {{
 *   enumerated: number | null,
 *   executed: number | null,
 *   filtered: boolean,
 *   playwrightExitCode: number,
 *   listing?: {
 *     status: number | null,
 *     stderr?: string,
 *     signal?: string | null,
 *     error?: Error & { code?: string },
 *   } | null,
 * }} verdict
 */
export function reconcile({
  enumerated,
  executed,
  filtered,
  playwrightExitCode,
  // Defaulted, not merely optional-by-convention: a destructured parameter
  // without a default is inferred as REQUIRED, so adding this key made every
  // existing call site a type error while the suite stayed green -- esbuild
  // strips types without checking them (#115).
  listing = null,
}) {
  // THE LISTING'S OWN FAILURE, before anything derived from it is trusted.
  // `spawnSync` reported it all along and nothing read it, so a listing that
  // died while still printing a footer was indistinguishable from a suite that
  // genuinely had that many tests. Fatal even on a narrowed run: a number that
  // cannot be believed is worse than no number, because it prints like one.
  if (listing && listing.status !== 0) {
    // No status means the child never exited on its own: Node killed it, and
    // said why in `error` and `signal`, never in stderr (#438).
    const ended =
      listing.status === null
        ? `was stopped before it exited (${
            [listing.error?.code ?? listing.error?.message, listing.signal]
              .filter(Boolean)
              .join(', ') || 'no error or signal reported'
          })`
        : `exited ${listing.status}`;
    return {
      exitCode: 1,
      partial: false,
      message:
        `\n${RULE}\n  E2E RECONCILIATION FAILED — the suite could not be enumerated\n\n` +
        `  \`playwright test --list\` ${ended}. Whatever it printed\n` +
        '  cannot be held against this run.\n\n' +
        `${(listing.stderr ?? '').trim() || '  (it printed nothing on stderr)'}\n${RULE}\n`,
    };
  }

  if (filtered) {
    return {
      exitCode: playwrightExitCode,
      partial: true,
      message:
        `\nPARTIAL RUN — ${executed} of ${enumerated ?? 'an unknown number of'} tests.\n` +
        'Arguments narrowed this run, so it was NOT judged against the full ' +
        'suite.\nRun `npm run test:e2e` with no arguments to cover everything.\n',
    };
  }

  if (typeof enumerated !== 'number') {
    return {
      exitCode: 1,
      partial: false,
      message:
        `\n${RULE}\n  E2E RECONCILIATION FAILED — the size of the suite could not be read\n\n` +
        '  `playwright test --list` did not report a total, so there is nothing\n' +
        '  to hold this run against. An unknown total blocks the run rather than\n' +
        `  waving it through.\n${RULE}\n`,
    };
  }

  // `executed` is `number | null` and only `enumerated`'s null was checked:
  // the comment below said "`null` was already fatal above" and it was half
  // true, which is how a comment differs from a guard. A null `executed` fell
  // to the inequality, where it coerces to 0 -- so the run still failed, but
  // it reported "measured less than" with a NEGATIVE difference, describing a
  // count that was never read as a count that came out short. Found by
  // turning `checkJs` on over `scripts/` (#228).
  if (typeof executed !== 'number') {
    return {
      exitCode: 1,
      partial: false,
      message:
        `\n${RULE}\n  E2E RECONCILIATION FAILED — this run accounted for no tests\n\n` +
        '  The reporter produced no executed count at all, so there is nothing\n' +
        `  to hold against the ${enumerated} tests enumerated. That is a broken\n` +
        `  measurement, not a small run.\n${RULE}\n`,
    };
  }

  // ZERO IS A BROKEN MEASUREMENT, NOT A SUITE SIZE. Both nulls are fatal
  // above; the number zero is both a valid `number` and equal to an executed
  // count of zero, so `{0, 0}` fell through the inequality below and returned
  // Playwright's own exit code -- a full run that enumerated nothing, ran
  // nothing and exited clean, reported as a PASS by the guard whose message
  // calls that the single outcome it exists to reject (#150, measured).
  //
  // This repo has 24 spec files. If an empty suite ever becomes legitimate it
  // needs a flag saying so out loud, not a silent zero.
  if (enumerated === 0 || executed === 0) {
    return {
      exitCode: 1,
      partial: false,
      message:
        `\n${RULE}\n  E2E RECONCILIATION FAILED — a run of ZERO tests is not a pass\n\n` +
        `    tests enumerated by \`playwright test --list\` : ${enumerated}\n` +
        `    tests accounted for by this run              : ${executed}\n\n` +
        '  One of those is zero, so there is nothing here to have passed.\n' +
        `  Playwright exited ${playwrightExitCode}, which says nothing about a suite\n` +
        `  that never ran.\n${RULE}\n`,
    };
  }

  if (executed !== enumerated) {
    const verb =
      executed < enumerated ? 'measured less than' : 'disagrees with';
    return {
      exitCode: 1,
      partial: false,
      message:
        `\n${RULE}\n  E2E RECONCILIATION FAILED — this run ${verb} the suite\n\n` +
        `    tests enumerated by \`playwright test --list\` : ${enumerated}\n` +
        `    tests accounted for by this run              : ${executed}\n` +
        `    difference                                   : ${executed - enumerated}\n\n` +
        `  Playwright exited ${playwrightExitCode}. That is not a pass. A green summary\n` +
        '  over a partial run is the single outcome this guard exists to reject.\n\n' +
        '  Worth checking: were workers killed mid-run (memory pressure ends a\n' +
        '  run without failing it)? Did a spec stop matching its project? Was a\n' +
        `  filter set in config rather than on the command line?\n${RULE}\n`,
    };
  }

  return { exitCode: playwrightExitCode, partial: false, message: null };
}

/**
 * Where this run's json report goes, and whether it survives the run.
 *
 * The report has always been written to a throwaway directory and deleted in a
 * `finally`: it exists for the reconciliation below and nothing else reads it.
 * An EVIDENCE run does read it -- `scripts/build-evidence-page.mjs` builds the
 * operator's sign-off page from the report plus the capture manifest -- and
 * `playwright.config.ts` states that such a run "needs no second flag anybody
 * could forget". It could not be built without one, because the report landed
 * in a temp directory and was deleted. So the single switch that turns on
 * captures and video now also decides where the report lands.
 *
 * PURE, so `tests/guards/evidence-page.test.ts` can assert the seam without
 * running Playwright: the caller creates the directory.
 */
export function reportLocation(env = process.env) {
  const evidence = env.EVIDENCE_DIR;
  const dir = evidence || join(tmpdir(), `e2e-reconcile-${process.pid}`);
  return { dir, path: join(dir, EVIDENCE_REPORT), ephemeral: !evidence };
}

function main() {
  const argv = process.argv.slice(2);
  // Refuses a shard it could not account for BEFORE spending a run on it:
  // the account written below needs to say which shard this was (#163).
  shardOf(argv);
  oneAttemptEach(argv, process.env);
  const filtered = isFilteredRun(argv);
  const { passthrough, reporter } = mergeReporters(argv);

  // Same suite, no filters: this is the number the run has to answer to.
  const listing = listSuite(argv);
  const enumerated = parseListTotal(listing.stdout);

  const {
    dir: reportDir,
    path: reportPath,
    ephemeral,
  } = reportLocation(process.env);
  const navPath = join(reportDir, 'nav-timings.json');
  mkdirSync(reportDir, { recursive: true });
  // A report left by an earlier run reads exactly like one this run produced,
  // and reconciling against it is a green verdict about somebody else's tests.
  // Removed first so "the reporter never wrote" stays distinguishable from
  // "the reporter wrote this", which the parse below already treats as fatal.
  rmSync(reportPath, { force: true });

  try {
    const run = spawnSync(
      'npx',
      ['playwright', 'test', `--reporter=${reporter}`, ...passthrough],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
          NAV_TIMING_FILE: navPath,
        },
      },
    );

    let executed = null;
    let parsed = null;
    /** @type {unknown} */
    let unreadable = null;
    try {
      parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
      executed = countExecuted(parsed.stats);
    } catch (cause) {
      unreadable = cause;
    }

    // A CI shard writes down what it ran BEFORE anything below can end the
    // process, so build-and-test names a shard that measured nothing rather
    // than one that never reported. Its sum across shards is held there
    // against the suite (`scripts/e2e-shards.mjs`, #163).
    const recorded = shardAccount({
      argv,
      enumerated,
      executed,
      playwrightExitCode: run.status ?? 1,
      listingStatus: listing.status,
    });
    const accountDir = process.env.E2E_ACCOUNT_DIR;
    if (recorded && accountDir) {
      mkdirSync(accountDir, { recursive: true });
      writeFileSync(
        join(accountDir, recorded.file),
        `${JSON.stringify(recorded.account, null, 2)}\n`,
      );
    }

    if (unreadable !== null) {
      console.error(
        `\n${RULE}\n  E2E RECONCILIATION FAILED — the run produced no readable report\n\n` +
          `  ${messageOf(unreadable)}\n\n` +
          '  Without it there is no count to check, so this cannot be treated as\n' +
          `  a pass.\n${RULE}\n`,
      );
      process.exitCode = 1;
      return;
    }

    // #44 wants the distribution before anyone changes a timeout. Emitted
    // whether the run passed or failed — a failed run is when the numbers
    // matter most — and appended to the GitHub job summary when there is one,
    // so a few runs accumulate evidence with no artifact upload and no new
    // action to SHA-pin.
    const table = formatTimings(projectTimings(parsed));
    if (table) {
      console.error(
        `\n${RULE}\n  E2E DURATIONS BY PROJECT\n${RULE}\n${table}\n`,
      );
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `\n### e2e durations by project\n\n${table}\n`,
        );
    }

    // The question the table above cannot answer: whether the clock ran out
    // INSIDE a navigation or around one. Same emission rules — every run, and
    // into the job summary when there is one.
    let navigations = [];
    try {
      navigations = JSON.parse(readFileSync(navPath, 'utf8')).navigations ?? [];
    } catch {
      // Deliberately not fatal HERE. `navTimingVerdict` below decides, and it
      // is handed the json report's own count of tests that ran — an
      // independent observer — so a reporter that never wrote a file cannot
      // pass by reporting nothing about itself.
    }
    const navTable = formatNavTimings(navTimings(navigations));
    console.error(
      `\n${RULE}\n  NAVIGATION DURATIONS BY PROJECT\n${RULE}\n${navTable}\n`,
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### navigation durations by project\n\n${navTable}\n`,
      );

    const liveness = navTimingVerdict({
      navigations: navigations.length,
      report: parsed,
    });

    const verdict = reconcile({
      enumerated,
      executed,
      filtered,
      playwrightExitCode: run.status ?? 1,
      listing,
    });
    // A shard is narrowed on purpose and judged elsewhere, so it says that
    // instead of reconcile()'s PARTIAL notice, which says nothing judges it.
    const message =
      recorded && verdict.partial
        ? shardNotice(recorded.account)
        : verdict.message;
    if (message) console.error(message);
    if (!liveness.ok)
      console.error(
        `\n${RULE}\n  NAVIGATION TIMINGS: THE COLLECTOR RECORDED NOTHING\n${RULE}\n` +
          `  ${liveness.message}\n${RULE}\n`,
      );
    // Neither verdict masks the other: reconcile keeps its exit code, and a
    // dead collector turns an otherwise-clean run red on its own.
    process.exitCode = verdict.exitCode || (liveness.ok ? 0 : 1);
  } finally {
    // Reached because the verdicts above set `process.exitCode` and return:
    // `process.exit()` ends the process without running any `finally`, and
    // every run left this directory behind while this said otherwise (#390).
    // An evidence directory is the operator's, not ours: it holds the captures
    // and the video the sign-off page is built from.
    if (ephemeral) rmSync(reportDir, { recursive: true, force: true });
  }
}

/**
 * Playwright's default per-test budget, which this repo does not override.
 *
 * `playwright.config.ts` sets no `timeout` and no `navigationTimeout`, so the
 * "Test timeout of 30000ms exceeded" in #44 was the WHOLE TEST's budget rather
 * than a stalled navigation — `page.goto` was simply where the clock ran out.
 * Every number below is read against this.
 */
export const TEST_BUDGET_MS = 30000;

/**
 *  Nearest-rank percentile over an ASCENDING array.
 *
 * @param {number[]} ascending
 * @param {number} quantile
 */
const rank = (ascending, quantile) =>
  ascending[Math.ceil(quantile * ascending.length) - 1];

/**
 * Every test in a Playwright json report, with the spec it belongs to.
 *
 * A `describe` block nests as `suites` inside its file's suite, so a walk that
 * reads only a file's own `specs` misses every test written inside one.
 *
 * @param {Record<string, any>} report
 * @returns {Generator<{ spec: Record<string, any>, test: Record<string, any> }>}
 */
function* reportTests(report) {
  /** @param {any[]} suites @returns {Generator<{ spec: any, test: any }>} */
  function* visit(suites) {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests ?? []) yield { spec, test };
      yield* visit(suite.suites);
    }
  }
  yield* visit(report?.suites);
}

/**
 * Per-project duration distribution from a Playwright json report.
 *
 * The suite already produces this and throws it away: the json reporter exists
 * for #36's suite-size guard, `stats` is read out of it, and the temp file is
 * deleted. #44 asks for the real numbers before any timeout is changed, and
 * they have been in every CI run all along.
 *
 * THE TAIL, NOT THE MEAN. A mean over ~2200 tests cannot move enough for one
 * 30-second test to show up in it. p90 and max are where a flake lives.
 *
 *  @param {Record<string, any>} report
 */
export function projectTimings(report) {
  const byProject = new Map();

  for (const { spec, test } of reportTests(report)) {
    // The SLOWEST attempt, not the last. A test that times out at 30s and
    // passes at 800ms on retry is exactly the case this exists to surface,
    // and reporting the retry erases the finding.
    const ms = Math.max(
      0,
      ...(test.results ?? []).map(
        (/** @type {{ duration?: number }} */ r) => r.duration ?? 0,
      ),
    );
    const rows = byProject.get(test.projectName) ?? [];
    rows.push({ title: spec.title, ms });
    byProject.set(test.projectName, rows);
  }

  return [...byProject].map(([project, tests]) => {
    const ascending = tests
      .map((/** @type {{ ms: number }} */ t) => t.ms)
      .sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    return {
      project,
      count: tests.length,
      p50: rank(ascending, 0.5),
      p90: rank(ascending, 0.9),
      max: ascending[ascending.length - 1],
      slowest: [...tests].sort((a, b) => b.ms - a.ms).slice(0, 3),
    };
  });
}

/**
 *  The distribution as a markdown table, for a terminal or a job summary.
 *
 *  @param {any[]} rows
 */
export function formatTimings(rows) {
  if (!rows.length) return '';
  return [
    '| project | tests | p50 | p90 | max | slowest |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${r.project} | ${r.count} | ${r.p50} | ${r.p90} | ${r.max} | ` +
        `${r.slowest.map((/** @type {{ title: string, ms: number }} */ t) => `${t.title} (${t.ms}ms)`).join('; ')} |`,
    ),
    '',
    `Durations in ms. Playwright's default per-test budget is ${TEST_BUDGET_MS}ms ` +
      'and this repo sets no override, so a max approaching it is #44 rather ' +
      'than a merely slow page.',
  ].join('\n');
}

/**
 * Per-NAVIGATION distribution, which is the question `projectTimings` above
 * cannot answer. #44.
 *
 * `playwright.config.ts` records where the whole-test numbers left the
 * diagnosis: they "bound the problem, they do not separate a slow navigation
 * from a slow test around one". `page.goto: Test timeout of 30000ms exceeded`
 * names the TEST budget, so a 900ms navigation inside a 29s test and a 29s
 * navigation print the same line and call for opposite fixes — sharding or a
 * `navigationTimeout` on the heavy projects. These rows are what tells them
 * apart, on the run it happens rather than in an argument afterwards.
 *
 * Ordered by the slowest navigation, worst project first: the tail is the
 * finding, and #44 is about one navigation, not an average of thousands.
 *
 *  @param {any[]} records
 */
export function navTimings(records) {
  const byProject = new Map();
  for (const record of records ?? []) {
    const rows = byProject.get(record.project) ?? [];
    rows.push(record);
    byProject.set(record.project, rows);
  }

  return [...byProject]
    .map(([project, navigations]) => {
      const ascending = navigations
        .map((/** @type {{ durationMs: number }} */ n) => n.durationMs)
        .sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
      return {
        project,
        count: navigations.length,
        // Nearest-rank, the same `rank` the per-test table uses: an
        // interpolated median reports a duration no navigation actually took,
        // and every argument on #44 so far has been about specific observed
        // navigations.
        medianMs: rank(ascending, 0.5),
        p95Ms: rank(ascending, 0.95),
        maxMs: ascending[ascending.length - 1],
        erroredCount: navigations.filter(
          (/** @type {{ errored?: boolean }} */ n) => n.errored,
        ).length,
        slowest: [...navigations]
          .sort((a, b) => b.durationMs - a.durationMs)
          .slice(0, 3),
      };
    })
    .sort((a, b) => b.maxMs - a.maxMs);
}

/**
 * The navigation distribution as a markdown table.
 *
 * Unlike `formatTimings`, an empty result prints a SENTENCE rather than an
 * empty string. A blank space where a table should be reads as "nothing to
 * report"; on a collector, nothing to report is the failure mode.
 *
 *  @param {any[]} rows
 */
export function formatNavTimings(rows) {
  if (!rows.length)
    return 'No navigations were recorded — see the collector verdict below.';
  return [
    '| project | navigations | median | p95 | max | errored | slowest |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${r.project} | ${r.count} | ${r.medianMs} | ${r.p95Ms} | ${r.maxMs} | ` +
        `${r.erroredCount} | ` +
        `${r.slowest.map((/** @type {{ test: string, durationMs: number }} */ n) => `${n.test} (${n.durationMs}ms)`).join('; ')} |`,
    ),
    '',
    `Durations in ms, per \`page.goto\`. The per-test budget is ${TEST_BUDGET_MS}ms ` +
      'and a navigation is only part of a test, so a max approaching it is a ' +
      'stalled navigation — #44 — rather than a test that is merely long.',
  ].join('\n');
}

/**
 * Whether the collector was alive this run.
 *
 * THIS IS THE CONTROL ON EVERYTHING ABOVE, and it exists because every way of
 * getting the collection wrong fails identically: no records, an empty table,
 * a green run. Three were live possibilities while this was written — matching
 * `page.goto` instead of Playwright's actual step title `Navigate`, scanning
 * only top-level steps when `test.step` and `beforeEach` nest them, and
 * reading the json report, which strips `pw:api` steps entirely. A Playwright
 * upgrade that renames the step is the same failure arriving later.
 *
 * The tests it judges MUST be counted by an observer other than this
 * collector: `report` is the json reporter's output. Asked to count its own
 * tests, a reporter that never ran answers zero and certifies its own silence.
 *
 * Only tests in projects that must navigate are judged (#355). The `content`
 * project reads built files, and one of its specs never opens a page, so a
 * filtered run of that spec alone recorded nothing with the collector healthy
 * and exited 1 over a green suite. The config marks such a project with
 * `metadata: { requiresNavigation: false }`, and the report carries the mark.
 *
 * @param {{ navigations: number, report: Record<string, any> }} input
 *   `navigations` is a COUNT: the caller passes `navigations.length`, and the
 *   unit tests pass 0 and 4. Annotating it as the array made `navigations > 0`
 *   look like a defect; it is not, and the call site is what settled it.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function navTimingVerdict({ navigations, report }) {
  const { expected = 0, unexpected = 0, flaky = 0 } = report?.stats ?? {};
  const byProject = resultsByProject(report);
  const walked = [...byProject.values()].reduce((sum, n) => sum + n, 0);
  // The per-project count below is this script's own walk of the report. A
  // walk that found nothing would count no rendering tests and pass a dead
  // collector, so it must agree with the count Playwright keeps itself.
  if (walked !== expected + unexpected + flaky)
    return {
      ok: false,
      message:
        `The report's stats count ${expected + unexpected + flaky} test(s) with a ` +
        `result, and walking its suites found ${walked}. The navigation count ` +
        'cannot be judged against a population this script cannot read: check ' +
        'the json report shape `reportTests` in scripts/test-e2e.mjs expects.',
    };
  if (navigations > 0) return { ok: true };

  const excused = excusedFromNavigating(report);
  /** @param {boolean} wanted */
  const tally = (wanted) =>
    [...byProject].filter(([project]) => excused.has(project) === wanted);
  /** @param {[string, number][]} rows */
  const total = (rows) => rows.reduce((sum, [, n]) => sum + n, 0);
  const judged = tally(false);
  const excusedRows = tally(true);
  // No test that must navigate produced a result: a `--grep` that matched
  // nothing, a failure before any test ran, or a run of excused projects
  // only. There is no collector to prove alive.
  if (!total(judged)) return { ok: true };

  /** @param {[string, number][]} rows */
  const named = (rows) =>
    rows.map(([project, n]) => `${project} ${n}`).join(', ');
  const notCounted = total(excusedRows)
    ? ` Not counted: ${total(excusedRows)} result(s) from ${excusedRows.map(([p]) => p).join(', ')}, ` +
      'which the config excuses from navigating (`metadata.requiresNavigation: false`).'
    : '';
  return {
    ok: false,
    message:
      `${total(judged)} test(s) ran in projects that must navigate ` +
      `(${named(judged)}) and not one navigation was recorded, so the collector ` +
      `is broken, not the suite.${notCounted} Check that Playwright still titles ` +
      'a `page.goto` step `Navigate` in the `pw:api` category ' +
      '(tests/reporters/nav-timing-reporter.ts), and that the reporter is still ' +
      'in the list `mergeReporters` builds.',
  };
}

/**
 * The projects `playwright.config.ts` excuses from the navigation liveness
 * verdict, read from the json report, which copies each project's `metadata`
 * into `config.projects`. The config is the one place the mark is written; a
 * report without it excuses nothing, which fails closed.
 *
 * @param {Record<string, any>} report
 * @returns {Set<string>}
 */
export function excusedFromNavigating(report) {
  return new Set(
    (report?.config?.projects ?? [])
      .filter(
        (/** @type {{ metadata?: Record<string, unknown> }} */ p) =>
          p.metadata?.requiresNavigation === false,
      )
      .map((/** @type {{ name: string }} */ p) => p.name),
  );
}

/**
 * How many tests produced a result in each project: the outcomes the report's
 * `stats` counts as expected, unexpected or flaky. A skipped test ran nothing.
 *
 * @param {Record<string, any>} report
 * @returns {Map<string, number>}
 */
export function resultsByProject(report) {
  const counted = new Set(['expected', 'unexpected', 'flaky']);
  /** @type {Map<string, number>} */
  const byProject = new Map();
  for (const { test } of reportTests(report))
    if (counted.has(test.status))
      byProject.set(
        test.projectName,
        (byProject.get(test.projectName) ?? 0) + 1,
      );
  return byProject;
}

// Only when run, never when imported: the unit tests import the functions
// above. Comparing `process.argv[1]` with this file's path skipped the whole
// run, exit 0, from a checkout reached through a symlink (#221,
// `tests/unit/script-entry.test.ts`).
if (import.meta.main) main();
