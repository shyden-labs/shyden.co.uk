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
 * Usage, as the workflow runs it:
 *   NEEDS_JSON='${{ toJSON(needs) }}' node scripts/e2e-shards.mjs <accounts-dir>
 */
import { existsSync, readFileSync } from 'node:fs';
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
 * }} run
 * @returns {{ file: string, account: ShardAccount } | null}
 */
export function shardAccount({
  argv,
  enumerated,
  executed,
  playwrightExitCode,
  listingStatus,
}) {
  const shard = shardOf(argv);
  if (shard === null) return null;
  return {
    file: accountFileName(shard),
    account: { shard, enumerated, executed, playwrightExitCode, listingStatus },
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
  const { enumerated, executed, playwrightExitCode, listingStatus } = value;
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
    !(listingStatus === null || Number.isInteger(listingStatus))
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

  return findings;
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
  const files = process.argv.slice(2);

  /** @type {unknown} */
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS_JSON ?? '');
  } catch {
    needs = undefined;
  }

  const present = files.filter((file) => existsSync(file));
  const docsOnly = isDocsOnlyRun(needs);
  const findings = docsOnly
    ? // No shard runs, and the download is skipped, so the glob arrives
      // unmatched; any account that does exist is refused by name.
      docsOnlyFindings(needs, present)
    : [
        ...needsFindings(needs),
        ...files
          .filter((file) => !existsSync(file))
          .map(
            (file) => `${file} does not exist, so it holds no shard's account`,
          ),
        ...accountFindings(present.map((file) => loadAccount(file))),
      ];
  if (findings.length > 0) {
    console.error(
      `\n${RULE}\n  build-and-test REFUSED — the jobs it stands for do not add up to a pass\n\n` +
        `${findings.map((finding) => `  - ${finding}`).join('\n')}\n${RULE}\n`,
    );
    process.exit(1);
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
