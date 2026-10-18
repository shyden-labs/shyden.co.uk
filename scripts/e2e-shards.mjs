#!/usr/bin/env node
/**
 * `build-and-test`'s verdict, once the e2e suite runs as parallel shards (#163).
 *
 * Branch protection requires `build-and-test` by NAME, and
 * `scripts/deploy-gate.mjs` deploys because that name concluded `success`.
 * Neither reads the work behind it. Before #163 the job ran the whole suite
 * itself, so its success meant the whole suite ran. Now it runs none of it: it
 * stands for the jobs that do, and it may only pass when two things hold.
 *
 * NEEDS. Every job it stands for SUCCEEDED. Not "did not fail": a skipped
 * required check is reported to branch protection as passing, so `skipped` and
 * `cancelled` are refusals exactly like `failure` (#157). That is also why the
 * job itself runs `if: always()` and refuses HERE, in a step. A condition that
 * turned false would skip it, and the skip would read as a pass.
 *
 * ACCOUNTS. The shards add up to the suite. Every shard can succeed while
 * together they run less than the suite holds: a shard never scheduled, a
 * filter that crept into one shard's command, a matrix that disagrees with the
 * total each shard was given. A shrinking population reads as green (#112,
 * #118). So each shard enumerates the WHOLE suite with an unfiltered
 * `playwright test --list` (`scripts/test-e2e.mjs`) and writes down what it
 * ran, and the sum is held here against a count that came from outside every
 * run.
 *
 * Usage, as the workflow runs it (each list a shell glob's expansion):
 *   NEEDS_JSON='${{ toJSON(needs) }}' node scripts/e2e-shards.mjs \
 *     <e2e account files> --capture <capture account files>
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { messageOf } from './errors.mjs';
import { isRecord } from '../src/lib/is-record.ts';
import { RUN_WHEN_DOCS_ONLY, SKIPPED_WHEN_DOCS_ONLY } from './docs-only.mjs';

/** @typedef {{ index: number, total: number }} Shard */

/**
 * What one shard writes down about its own run.
 *
 * @typedef {{
 *   shard: Shard,
 *   enumerated: number | null,
 *   executed: number | null,
 *   playwrightExitCode: number,
 *   listingStatus: number | null,
 *   seconds: number | null,
 *   listedUnits: Record<string, number> | null,
 *   ranUnits: Record<string, number> | null,
 * }} ShardAccount
 */

const SHARD_VALUE = /^(\d+)\/(\d+)$/;

/**
 * The shard a run was asked for, or `null` when it was asked for none.
 *
 * A value this module cannot place is refused by name. Playwright refuses it
 * too, but only after the account for it has been planned, and an account
 * nobody can reconcile turns up as arithmetic three steps later.
 *
 * @param {readonly string[]} argv
 * @returns {Shard | null}
 */
export function shardOf(argv = []) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    let value;
    if (arg.startsWith('--shard=')) {
      value = arg.slice('--shard='.length);
    } else if (arg === '--shard') {
      value = argv[i + 1];
      if (value === undefined)
        throw new Error('--shard was given no value: expected <index>/<total>');
    } else {
      continue;
    }

    const match = SHARD_VALUE.exec(value);
    const index = match ? Number(match[1]) : Number.NaN;
    const total = match ? Number(match[2]) : Number.NaN;
    if (!(index >= 1 && index <= total))
      throw new Error(
        `--shard=${value} is not a shard: expected <index>/<total>, with 1 <= index <= total`,
      );
    return { index, total };
  }
  return null;
}

/**
 * The file one shard's account is written to.
 *
 * Unique per shard, because the aggregating job downloads every shard's
 * artifact into one directory: two shards writing one name would overwrite
 * each other, and the survivor would read as a whole suite run once.
 *
 * @param {Shard} shard
 */
export function accountFileName({ index, total }) {
  return `e2e-account-${index}-of-${total}.json`;
}

/**
 * What a shard writes down about its own run, and the file it goes in: `null`
 * for a run that was not a shard, which writes nothing. Built here, beside the
 * verdict that reads it, so the one account a shard can write is one the
 * verdict can read.
 *
 * @param {{
 *   argv: readonly string[],
 *   enumerated: number | null,
 *   executed: number | null,
 *   playwrightExitCode: number,
 *   listingStatus: number | null,
 *   seconds: number | null,
 *   listedUnits: Record<string, number> | null,
 *   ranUnits: Record<string, number> | null,
 * }} run
 * @returns {{ file: string, account: ShardAccount } | null}
 */
export function shardAccount({
  argv,
  enumerated,
  executed,
  playwrightExitCode,
  listingStatus,
  seconds,
  listedUnits,
  ranUnits,
}) {
  const shard = shardOf(argv);
  if (shard === null) return null;
  return {
    file: accountFileName(shard),
    account: {
      shard,
      enumerated,
      executed,
      playwrightExitCode,
      listingStatus,
      seconds,
      listedUnits,
      ranUnits,
    },
  };
}

/**
 * What a shard prints about its count, in place of `reconcile()`'s PARTIAL
 * notice. That notice says a narrowed run was "NOT judged against the full
 * suite", which is true of `--project=chromium` at a desk and false of a CI
 * shard: build-and-test judges the sum.
 *
 * @param {ShardAccount} account
 */
export function shardNotice({ shard, enumerated, executed }) {
  const ran = executed === null ? 'an unreadable number' : String(executed);
  const of = enumerated === null ? 'an unknown number of' : `the ${enumerated}`;
  return (
    `\nSHARD ${shard.index} of ${shard.total} — ran ${ran} of ${of} tests the suite holds.\n` +
    'build-and-test holds the sum of every shard against the suite ' +
    '(scripts/e2e-shards.mjs).\n'
  );
}

/**
 * Why `build-and-test` must not pass on these needs: one finding for every job
 * it stands for that did not succeed. Empty only when it stands for at least
 * one job and every one of them succeeded.
 *
 * @param {unknown} needs The parsed `${{ toJSON(needs) }}`.
 * @returns {string[]}
 */
export function needsFindings(needs) {
  if (!isRecord(needs))
    return [
      `the jobs build-and-test stands for could not be read: ${JSON.stringify(needs)}`,
    ];

  // `toJSON(needs)` of a job that needs nothing is `{}`, and an aggregate that
  // stands for nothing agrees with everything.
  const jobs = Object.entries(needs);
  if (jobs.length === 0)
    return [
      'build-and-test stands for no job at all, so there is nothing it can vouch for',
    ];

  return jobs.flatMap(([job, state]) => {
    const result = isRecord(state) ? state.result : undefined;
    if (result === 'success') return [];
    return [
      typeof result === 'string'
        ? `${job} finished \`${result}\`, not \`success\``
        : `${job} reported no result at all`,
    ];
  });
}

/**
 * The jobs that run only where the scope job's own verdict says (#774, #822),
 * with the verdict each one reads and what a verdict that never asked for it
 * would let through. The capture shards run where a pull request can move a
 * release picture; the logs suite runs on a pull request into `main`, the
 * release, and nowhere else (Shyden, 2026-10-16: "a release cannot be cut
 * until all checks are complete, including this one").
 */
const SCOPED_JOBS = {
  capture: {
    verdict: 'capture',
    unguarded: 'a case with no picture would pass',
  },
  logs: {
    verdict: 'release',
    unguarded:
      'a release whose logs and audit trails were never checked would pass',
  },
};

/**
 * A scoped job runs only where scope said, so a skip is a pass there and a
 * refusal everywhere else. Judged here against that verdict, then left out of
 * what the docs-only and full-run verdicts read, which know nothing of it. A
 * verdict other than exactly `true` or `false` judges nothing, so it refuses:
 * an output that went missing must not read as "skip".
 *
 * @param {unknown} needs The parsed `${{ toJSON(needs) }}`.
 * @param {keyof typeof SCOPED_JOBS} name The scoped job.
 * @returns {{ findings: string[], rest: unknown }}
 */
export function scopedJobFindings(needs, name) {
  if (!isRecord(needs)) return { findings: [], rest: needs };
  const { verdict, unguarded } = SCOPED_JOBS[name];
  const { [name]: state, ...rest } = needs;
  if (state === undefined)
    return {
      findings: [
        `${name} is not among the jobs build-and-test stands for, so ${unguarded}`,
      ],
      rest,
    };
  const result = isRecord(state) ? state.result : undefined;
  const outputs = isRecord(needs.scope) ? needs.scope.outputs : undefined;
  const said = isRecord(outputs) ? outputs[verdict] : undefined;
  if (said !== 'true' && said !== 'false')
    return {
      findings: [
        `scope handed on no ${verdict} verdict (${JSON.stringify(said)}), ` +
          `so ${name} finishing \`${String(result)}\` cannot be judged`,
      ],
      rest,
    };
  const [wanted, where] =
    said === 'true' ? ['success', 'runs'] : ['skipped', 'does not run'];
  return {
    findings:
      result === wanted
        ? []
        : [
            `${name} finished \`${String(result)}\` where scope said it ${where}, not \`${wanted}\``,
          ],
    rest,
  };
}

/**
 * Whether the scope job said this pull request is docs-only (#582). Only the
 * exact string the runner hands over for `docs_only=true` counts; anything
 * else is a full run, judged by its accounts.
 *
 * @param {unknown} needs The parsed `${{ toJSON(needs) }}`.
 * @returns {boolean}
 */
export function isDocsOnlyRun(needs) {
  if (!isRecord(needs) || !isRecord(needs.scope)) return false;
  const { outputs } = needs.scope;
  return isRecord(outputs) && outputs.docs_only === 'true';
}

/**
 * Why `build-and-test` must not pass a docs-only pull request: a job the
 * verdict skips that did anything but skip, or is not stood for at all; a job
 * it keeps that did not succeed; `checks` not stood for; or a shard account,
 * since no shard runs. Empty only when the pull request skipped exactly what
 * a docs-only verdict skips and everything else succeeded.
 *
 * @param {unknown} needs The parsed `${{ toJSON(needs) }}`.
 * @param {readonly string[]} accounts The account files that exist.
 * @returns {string[]}
 */
export function docsOnlyFindings(needs, accounts) {
  if (!isRecord(needs)) return needsFindings(needs);
  const skippedJobs = SKIPPED_WHEN_DOCS_ONLY.flatMap((job) => {
    const state = needs[job];
    if (state === undefined)
      return [
        `${job} is not among the jobs build-and-test stands for, so its skip proves nothing`,
      ];
    const result = isRecord(state) ? state.result : undefined;
    return result === 'skipped'
      ? []
      : [
          `${job} finished \`${String(result)}\` on a docs-only pull request, which skips it`,
        ];
  });
  const kept = Object.fromEntries(
    Object.entries(needs).filter(
      ([job]) => !SKIPPED_WHEN_DOCS_ONLY.includes(job),
    ),
  );
  const missing = RUN_WHEN_DOCS_ONLY.filter((job) => !(job in needs)).map(
    (job) =>
      `${job} is not among the jobs build-and-test stands for, so a docs-only pull request would pass untested`,
  );
  return [
    ...missing,
    ...needsFindings(kept),
    ...skippedJobs,
    ...accounts.map(
      (file) =>
        `${file} is a shard account, and no shard runs on a docs-only pull request`,
    ),
  ];
}

/** @param {unknown} value @returns {value is number} */
const isCount = (value) => Number.isInteger(value) && Number(value) >= 0;

/**
 * The account, if it is one: every field present and of its declared type.
 *
 * @param {unknown} value
 * @returns {ShardAccount | null}
 */
function readAccount(value) {
  if (!isRecord(value) || !isRecord(value.shard)) return null;
  const { index, total } = value.shard;
  const {
    enumerated,
    executed,
    playwrightExitCode,
    listingStatus,
    seconds,
    listedUnits,
    ranUnits,
  } = value;
  const unitsOk = (/** @type {unknown} */ units) =>
    units === null || (isRecord(units) && Object.values(units).every(isCount));
  const shardOk =
    Number.isInteger(index) &&
    Number.isInteger(total) &&
    Number(index) >= 1 &&
    Number(index) <= Number(total);
  const countOk = (/** @type {unknown} */ count) =>
    count === null || isCount(count);
  if (
    !shardOk ||
    !countOk(enumerated) ||
    !countOk(executed) ||
    !Number.isInteger(playwrightExitCode) ||
    !(listingStatus === null || Number.isInteger(listingStatus)) ||
    // The run's wall time (#607): null where it was never timed, and present
    // either way, so an account that dropped it is refused, not read as fast.
    !(
      seconds === null ||
      (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0)
    ) ||
    !unitsOk(listedUnits) ||
    !unitsOk(ranUnits)
  )
    return null;
  return /** @type {ShardAccount} */ (value);
}

/** @param {Shard} shard */
const named = ({ index, total }) => `shard ${index} of ${total}`;

/**
 * Why these accounts do not add up to the suite. Empty only when every shard
 * of one run reported exactly once, all of them enumerated the same non-empty
 * suite, and between them they ran all of it.
 *
 * @param {readonly unknown[]} accounts
 * @returns {string[]}
 */
export function accountFindings(accounts) {
  if (accounts.length === 0)
    return [
      'no shard accounted for itself, so there is no evidence that any of the suite ran',
    ];

  /** @type {string[]} */
  const findings = [];
  /** @type {ShardAccount[]} */
  const valid = [];
  accounts.forEach((value, position) => {
    const account = readAccount(value);
    if (account) valid.push(account);
    else
      findings.push(
        `account ${position + 1} is not an account: ${JSON.stringify(value)}`,
      );
  });

  // WHICH SHARDS. Every index of one total, exactly once.
  const totals = [...new Set(valid.map(({ shard }) => shard.total))];
  if (totals.length > 1) {
    findings.push(
      `the shards disagree on how many shards there are: ${totals.join(', ')}`,
    );
  } else if (totals.length === 1) {
    const [total] = totals;
    for (let index = 1; index <= total; index += 1) {
      const reports = valid.filter(({ shard }) => shard.index === index).length;
      if (reports === 0)
        findings.push(`${named({ index, total })} never accounted for itself`);
      else if (reports > 1)
        findings.push(
          `${named({ index, total })} reported ${reports} accounts, one run's worth each`,
        );
    }
  }

  // EACH SHARD'S OWN RUN. A failed listing or run is fatal whatever it counted.
  for (const { shard, executed, playwrightExitCode, listingStatus } of valid) {
    if (listingStatus !== 0)
      findings.push(
        `${named(shard)} could not enumerate the suite: \`playwright test --list\` exited ${listingStatus}`,
      );
    if (playwrightExitCode !== 0)
      findings.push(
        `${named(shard)} failed: Playwright exited ${playwrightExitCode}`,
      );
    if (executed === null)
      findings.push(`${named(shard)} accounted for no tests at all`);
    else if (executed === 0)
      findings.push(
        `${named(shard)} ran no tests, which is a broken measurement, not a small shard`,
      );
  }

  // THE SUM, against a count that came from outside every run.
  const enumerations = [...new Set(valid.map(({ enumerated }) => enumerated))];
  if (enumerations.includes(null)) {
    findings.push('a shard could not say how many tests the suite holds');
  } else if (enumerations.length > 1) {
    findings.push(
      `the shards enumerated different suites: ${enumerations.join(', ')} tests`,
    );
  } else if (enumerations.length === 1) {
    const [suite] = /** @type {number[]} */ (enumerations);
    if (suite === 0) {
      findings.push(
        'the shards enumerated no tests, which is a broken measurement, not a suite size',
      );
    } else if (valid.every(({ executed }) => executed !== null)) {
      const ran = valid.reduce(
        (sum, { executed }) => sum + Number(executed),
        0,
      );
      if (ran !== suite)
        findings.push(
          `the shards ran ${ran} of the ${suite} tests the suite holds`,
        );
    }
  }

  findings.push(...unitFindings(valid));
  return findings;
}

/**
 * EACH SPEC FILE, exactly once (#607). The sum above cannot see a spec file
 * run by two shards while another of the same size ran in none, and since
 * the split is this repository's own plan rather than Playwright's, that is
 * a defect a planner could have. So every shard writes down, per
 * `[project] › file`, how many tests the listing holds and how many it ran,
 * and each file's runs across the shards must equal its listed count. That
 * holds for Playwright's count split too, where one file's tests can
 * legitimately span two shards.
 *
 * @param {readonly ShardAccount[]} valid
 * @returns {string[]}
 */
function unitFindings(valid) {
  /** @type {string[]} */
  const findings = [];
  for (const { shard, listedUnits, ranUnits } of valid) {
    if (listedUnits === null)
      findings.push(
        `${named(shard)} could not say which spec files the suite holds`,
      );
    if (ranUnits === null)
      findings.push(`${named(shard)} could not say which spec files it ran`);
  }
  if (findings.length > 0 || valid.length === 0) return findings;

  const canonical = (/** @type {Record<string, number>} */ units) =>
    JSON.stringify(Object.entries(units).sort(([a], [b]) => (a < b ? -1 : 1)));
  const listings = new Set(
    valid.map(({ listedUnits }) =>
      canonical(/** @type {Record<string, number>} */ (listedUnits)),
    ),
  );
  if (listings.size > 1) return ['the shards listed different spec files'];

  const listed = /** @type {Record<string, number>} */ (valid[0].listedUnits);
  /** @type {Map<string, number>} */
  const ran = new Map(Object.keys(listed).map((key) => [key, 0]));
  for (const { ranUnits } of valid)
    for (const [key, count] of Object.entries(
      /** @type {Record<string, number>} */ (ranUnits),
    ))
      ran.set(key, (ran.get(key) ?? 0) + count);
  for (const [key, count] of [...ran].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const holds = Object.hasOwn(listed, key) ? listed[key] : 0;
    if (count !== holds)
      findings.push(`${key}: the shards ran ${count} of its ${holds} tests`);
  }
  return findings;
}

/**
 * Each shard's Playwright run time and how far the slowest is from the mean,
 * as a Markdown table for the log and the job summary (#607). The split is
 * planned from timings refreshed by hand (`scripts/e2e-shard-timings.mjs`),
 * so this is where a plan going stale shows: in every run, not only in one
 * that hits the job's limit. Accounts that are not accounts are left out;
 * the verdict already names them.
 *
 * @param {readonly unknown[]} accounts
 */
export function shardTimes(accounts) {
  const valid = /** @type {ShardAccount[]} */ (
    accounts.map(readAccount).filter((account) => account !== null)
  ).sort((a, b) => a.shard.index - b.shard.index);
  const rows = valid.map(
    ({ shard, seconds }) =>
      `| ${shard.index} of ${shard.total} | ${seconds === null ? 'not timed' : (seconds / 60).toFixed(1)} |`,
  );
  const timed = valid
    .map(({ seconds }) => seconds)
    .filter((seconds) => seconds !== null);
  const table = ['| shard | minutes |', '| --- | --- |', ...rows].join('\n');
  if (timed.length === 0) return `${table}\n\nno shard was timed`;
  const slowest = Math.max(...timed) / 60;
  const mean = timed.reduce((sum, s) => sum + s, 0) / timed.length / 60;
  return (
    `${table}\n\nslowest ${slowest.toFixed(1)} min, mean ${mean.toFixed(1)} min: ` +
    `slowest/mean ${(slowest / mean).toFixed(2)}`
  );
}

/**
 * The account files build-and-test was handed: the e2e shards' first, then,
 * after `--capture`, the capture shards' (#774). Each list is a shell glob's
 * expansion, so an unmatched one arrives as its pattern and is refused by
 * name. `capture` is null when no `--capture` was handed over at all.
 *
 * @param {readonly string[]} args
 * @returns {{ e2e: string[], capture: string[] | null }}
 */
export function accountArguments(args) {
  const at = args.indexOf('--capture');
  return at === -1
    ? { e2e: [...args], capture: null }
    : { e2e: args.slice(0, at), capture: args.slice(at + 1) };
}

/**
 * Why the capture shards do not add up to the selection (#774). Where scope
 * said the capture runs, they are held to it exactly as the e2e shards are
 * held to the suite: each shard counted the selection it was handed
 * (`E2E_ENUMERATE=selection`), and between them they ran all of it. Where
 * scope said it does not run, no capture account may exist.
 *
 * @param {boolean} runs
 * @param {readonly unknown[]} accounts
 * @returns {string[]}
 */
export function captureAccountFindings(runs, accounts) {
  if (!runs)
    return accounts.length === 0
      ? []
      : [
          `the capture: ${accounts.length} shard accounts were written, where scope said the capture does not run`,
        ];
  return accountFindings(accounts).map((finding) => `the capture: ${finding}`);
}

/**
 * One account, read from the file it was given. A file that is not JSON
 * arrives as something that is not an account, which the verdict names.
 *
 * @param {string} file
 * @returns {unknown}
 */
function loadAccount(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    return { unreadable: file, error: messageOf(cause) };
  }
}

const RULE = '='.repeat(72);

function main() {
  // The FILES, never a directory to list: the workflow hands over its shell
  // glob's expansion. A glob that matched nothing arrives as the pattern
  // itself, a path that does not exist, and is refused by name; no files at
  // all is no accounts, which the verdict refuses too. So an empty download
  // cannot pass as an empty directory that proved nothing (#84).
  const { e2e: files, capture: captureFiles } = accountArguments(
    process.argv.slice(2),
  );

  /** @type {unknown} */
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS_JSON ?? '');
  } catch {
    needs = undefined;
  }

  const present = files.filter((file) => existsSync(file));
  // The scoped jobs first: each is judged against scope's verdict, not by
  // whether the pull request is docs-only, and the rest never see them.
  const capture = scopedJobFindings(needs, 'capture');
  const logs = scopedJobFindings(capture.rest, 'logs');
  const docsOnly = isDocsOnlyRun(logs.rest);
  // The capture's accounts, wherever scope gave a verdict it could read;
  // any other verdict is already refused there.
  const said =
    isRecord(needs) && isRecord(needs.scope) && isRecord(needs.scope.outputs)
      ? needs.scope.outputs.capture
      : undefined;
  const captureRuns = said === 'true';
  const captureAccounts =
    captureFiles === null
      ? [
          'build-and-test was handed no --capture accounts, so the capture shards cannot be added up',
        ]
      : said === 'true' || said === 'false'
        ? [
            ...(captureRuns
              ? captureFiles
                  .filter((file) => !existsSync(file))
                  .map(
                    (file) =>
                      `the capture: ${file} does not exist, so it holds no shard's account`,
                  )
              : []),
            ...captureAccountFindings(
              captureRuns,
              captureFiles
                .filter((file) => existsSync(file))
                .map((file) => loadAccount(file)),
            ),
          ]
        : [];
  const findings = [
    ...capture.findings,
    ...logs.findings,
    ...captureAccounts,
    ...(docsOnly
      ? // No shard runs, and the download is skipped, so the glob arrives
        // unmatched; any account that does exist is refused by name.
        docsOnlyFindings(logs.rest, present)
      : [
          ...needsFindings(logs.rest),
          ...files
            .filter((file) => !existsSync(file))
            .map(
              (file) =>
                `${file} does not exist, so it holds no shard's account`,
            ),
          ...accountFindings(present.map((file) => loadAccount(file))),
        ]),
  ];
  // Every run, refused or not: a shard running long matters most in a run
  // that failed, and this is where a stale plan shows (#607).
  if (!docsOnly && present.length > 0) {
    const times = shardTimes(present.map((file) => loadAccount(file)));
    console.log(`\n${RULE}\n  E2E SHARD TIMES\n${RULE}\n${times}\n`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### e2e shard times\n\n${times}\n`,
      );
  }
  if (findings.length > 0) {
    console.error(
      `\n${RULE}\n  build-and-test REFUSED — the jobs it stands for do not add up to a pass\n\n` +
        `${findings.map((finding) => `  - ${finding}`).join('\n')}\n${RULE}\n`,
    );
    process.exit(1);
  }

  if (captureRuns) {
    const accounts = /** @type {ShardAccount[]} */ (
      /** @type {string[]} */ (captureFiles).map((file) => loadAccount(file))
    );
    console.log(
      `${accounts.length} capture shards ran ${accounts[0].enumerated} of the ` +
        `${accounts[0].enumerated} cases the release selection holds.`,
    );
  }
  if (docsOnly) {
    console.log(
      'A docs-only pull request: checks and every job it keeps succeeded, and ' +
        `${SKIPPED_WHEN_DOCS_ONLY.join(', ')} were skipped, as its verdict requires (#582).`,
    );
    return;
  }
  const accounts = present.map((file) => loadAccount(file));
  const [{ enumerated }] = /** @type {ShardAccount[]} */ (accounts);
  console.log(
    `${accounts.length} shards ran ${enumerated} of the ${enumerated} tests the suite holds, ` +
      'and every job build-and-test stands for succeeded.',
  );
}

// Only when run, never when imported: the unit suite imports the verdict.
if (import.meta.main) main();
