/**
 * The floor record's browser stage, split into shards by measured time
 * (#608), as the e2e suite is (`scripts/e2e-shard-plan.mjs`, #607).
 *
 * Shyden ruled the cut 2026-10-28: "Shard it like e2e", "Keep 1 worker", and
 * "Engine+file, like e2e". So a shard runs the `[project] › file` pieces the
 * e2e planner hands it, from the same timings, at one worker. Every shard
 * plans from the same unfiltered `--list` of the floor specs, so nothing
 * passes between them; each reports what it ran in a manifest, and the join
 * refuses anything short of every piece run exactly once, on one tree, by
 * shards that all passed. One id is then measured by up to five shards, one
 * per engine, exactly as one unsharded run measures it today, so the record's
 * own refusals judge the joined observations unchanged.
 *
 * PURE: no process, no file. `scripts/record-floors.mjs` wires it.
 */
import {
  planShards,
  readTimings,
  testListText,
  unitsOfListing,
} from './e2e-shard-plan.mjs';

/**
 * @typedef {{ index: number, total: number }} Shard
 * @typedef {{ index: number, total: number, sha: string, status: number, units: string[] }} Manifest
 */

const SHA = /^[0-9a-f]{40}$/;

/** @param {unknown} value */
const isCount = (value) => Number.isInteger(value) && Number(value) >= 1;

/**
 * The pieces one shard runs, as a `--test-list` file, and the line its log
 * prints. Refused for a shard outside 1 to `total`.
 *
 * @param {{ listing: string, timingsText: string, shard: Shard }} run
 * @returns {{ testList: string, units: string[], report: string }}
 */
export function shardRecordRun({ listing, timingsText, shard }) {
  const { index, total } = shard;
  if (!isCount(total))
    throw new Error(
      `shard ${index} of ${total} is not a shard: ${total} is not a number of shards`,
    );
  if (!isCount(index) || index > total)
    throw new Error(`shard ${index} of ${total} is not a shard: 1 to ${total}`);

  const units = unitsOfListing(listing);
  const { source, seconds } = readTimings(timingsText);
  const plan = planShards(units, seconds, total);
  const mine = plan.shards[index - 1];
  if (mine === undefined)
    throw new Error(`the plan holds no shard ${index} of ${total}`);

  const lines = [
    `record shard ${index} of ${total} runs ${mine.units.length} of ${units.length} pieces, ` +
      `estimated ${(mine.seconds / 60).toFixed(1)} test-minutes, planned from run ${source}`,
  ];
  if (plan.unknown.length > 0)
    lines.push(
      `${plan.unknown.length} piece${plan.unknown.length === 1 ? '' : 's'} the timings do not know, ` +
        `weighed at ${Math.round(plan.estimate)} s: ${plan.unknown.join(', ')}`,
    );
  return {
    testList: testListText(mine.units),
    units: mine.units,
    report: lines.join('\n'),
  };
}

/**
 * @param {Manifest} manifest
 * @returns {string}
 */
export function shardManifest({ index, total, sha, status, units }) {
  return `${JSON.stringify({ index, total, sha, status, units })}\n`;
}

/**
 * A shard's manifest, or a refusal naming the field that is wrong: a field
 * read loosely would let a broken shard pass for a clean one.
 *
 * @param {string} text
 * @returns {Manifest}
 */
export function readManifest(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('a shard manifest is not JSON');
  }
  const record = /** @type {Record<string, unknown>} */ (
    typeof parsed === 'object' && parsed !== null ? parsed : {}
  );
  /** @type {[string, (value: unknown) => boolean, string][]} */
  const fields = [
    ['index', isCount, 'a shard number'],
    ['total', isCount, 'a number of shards'],
    [
      'sha',
      (value) => typeof value === 'string' && SHA.test(value),
      'a commit',
    ],
    ['status', Number.isInteger, 'an exit status'],
    [
      'units',
      (value) =>
        Array.isArray(value) && value.every((unit) => typeof unit === 'string'),
      'a list of pieces',
    ],
  ];
  for (const [field, valid, what] of fields)
    if (!valid(record[field]))
      throw new Error(
        `a shard manifest’s ${field} is ${JSON.stringify(record[field])}, not ${what}`,
      );
  return /** @type {Manifest} */ ({
    index: record.index,
    total: record.total,
    sha: record.sha,
    status: record.status,
    units: record.units,
  });
}

/**
 * Why the joined browser stage cannot be trusted, or nothing.
 *
 * `expected` is the join's own `--list` of the floor specs, so a piece is
 * judged against what the tree holds, never against what the shards say they
 * had: a piece no shard ran, or two ran, or one the listing does not hold, is
 * refused, as is a shard that did not report, reported twice, planned another
 * count, measured another commit, or failed, or passed with no observation
 * the join could read (`observed`, counted by the join from each shard's file,
 * never taken from the shard's word).
 *
 * @param {{ expected: readonly string[], total: number, sha: string, manifests: readonly Manifest[], observed: Readonly<Record<number, number>>, browserResult: string }} join
 * @returns {string[]}
 */
export function joinRefusals({
  expected,
  total,
  sha,
  manifests,
  observed,
  browserResult,
}) {
  /** @type {string[]} */
  const refusals = [];
  if (browserResult !== 'success')
    refusals.push(`the browser shards ended ${browserResult}, not success`);

  for (let index = 1; index <= total; index += 1) {
    const reports = manifests.filter((m) => m.index === index).length;
    if (reports === 0)
      refusals.push(`shard ${index} of ${total} did not report`);
    if (reports > 1)
      refusals.push(`shard ${index} of ${total} reported ${reports} times`);
  }
  for (const m of manifests) {
    if (m.index > total) {
      refusals.push(`a manifest names shard ${m.index}, outside 1 to ${total}`);
      continue;
    }
    if (m.total !== total)
      refusals.push(
        `shard ${m.index} planned ${m.total} shards, the join ${total}`,
      );
    if (m.sha !== sha)
      refusals.push(`shard ${m.index} measured ${m.sha}, the join ${sha}`);
    if (m.status !== 0)
      refusals.push(`shard ${m.index}’s Playwright run exited ${m.status}`);
    else if ((observed[m.index] ?? 0) === 0)
      refusals.push(
        `shard ${m.index} passed and recorded no floor: its observations are missing or empty`,
      );
  }

  /** @type {Map<string, number[]>} */
  const ranBy = new Map();
  for (const m of manifests)
    for (const unit of m.units)
      ranBy.set(unit, [...(ranBy.get(unit) ?? []), m.index]);
  const listed = new Set(expected);
  for (const [unit, shards] of ranBy)
    if (!listed.has(unit))
      refusals.push(
        `${unit} was run by shard ${shards.join(', ')} but the join’s listing does not hold it`,
      );
  for (const unit of expected) {
    const shards = ranBy.get(unit) ?? [];
    if (shards.length === 0) refusals.push(`${unit} was run by no shard`);
    if (shards.length > 1)
      refusals.push(`${unit} was run by shards ${shards.join(', ')}`);
  }
  return refusals;
}
