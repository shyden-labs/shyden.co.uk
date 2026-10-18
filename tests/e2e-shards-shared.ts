/**
 * `build-and-test` passing must still mean what it meant before the suite was
 * split: every step ran, and the WHOLE suite ran (#163).
 *
 * Branch protection and `scripts/deploy-gate.mjs` both read one conclusion by
 * name and never the work behind it. Once the suite runs as parallel shards,
 * `build-and-test` does none of that work itself; it stands for jobs that did.
 * So its verdict has two halves, and each one catches something the other
 * cannot:
 *
 * - NEEDS. Every job it stands for must have SUCCEEDED. A skipped job is not
 *   a failed one, and a skipped required check reads as passing (#157), so
 *   `skipped` and `cancelled` are refusals exactly like `failure`.
 * - ACCOUNTS. The shards must add up to the suite. Every shard can succeed
 *   while running fewer tests than the suite holds: a shard never scheduled,
 *   a filter that crept into one shard's command, a shard total that
 *   disagrees with the matrix. Shards that together run less still pass, and
 *   that is the shrinking-population class this repo keeps finding (#112,
 *   #118). Each shard enumerates the whole suite with an unfiltered
 *   `playwright test --list` and records what it ran, so the sum is held
 *   against a count that comes from outside every run, as `test-e2e.mjs`
 *   already does for an unsharded run.
 */

/**
 * One shard's account, declared here rather than imported so a fixture that
 * disagrees with the contract fails to compile (#157).
 */
export interface Account {
  shard: { index: number; total: number };
  enumerated: number | null;
  executed: number | null;
  playwrightExitCode: number;
  listingStatus: number | null;
  seconds: number | null;
  listedUnits: Record<string, number> | null;
  ranUnits: Record<string, number> | null;
}

export const SUITE = 2210;

/** The suite's spec files, as every shard of `whole()` lists them. */
export const WHOLE_UNITS: Record<string, number> = {
  '[chromium] › 1.spec.ts': 553,
  '[chromium] › 2.spec.ts': 553,
  '[chromium] › 3.spec.ts': 552,
  '[chromium] › 4.spec.ts': 552,
};

export const account = (
  index: number,
  executed: number,
  over: Partial<Account> = {},
): Account => ({
  shard: { index, total: 4 },
  enumerated: SUITE,
  executed,
  playwrightExitCode: 0,
  listingStatus: 0,
  seconds: 600,
  // One spec file per shard, the four adding up to SUITE (#607).
  listedUnits: WHOLE_UNITS,
  ranUnits: { [`[chromium] › ${index}.spec.ts`]: executed },
  ...over,
});

/** Four shards that together ran exactly the suite: 553 + 553 + 552 + 552. */
export const whole = (): Account[] => [
  account(1, 553),
  account(2, 553),
  account(3, 552),
  account(4, 552),
];

/**
 * A docs-only pull request (#582): the jobs that build or serve the site are
 * skipped, so build-and-test cannot add up accounts. It passes only when the
 * scope job's verdict says docs-only, every job it skips WAS skipped, and
 * every job it keeps succeeded.
 */
export const docsOnlyNeeds = (
  overrides: Record<
    string,
    { result: string; outputs: Record<string, string> } | undefined
  > = {},
) => {
  const needs: Record<string, unknown> = {
    image: { result: 'success', outputs: { ref: 'image@sha256:x' } },
    scope: { result: 'success', outputs: { docs_only: 'true' } },
    checks: { result: 'success', outputs: {} },
    e2e: { result: 'skipped', outputs: {} },
    'sanity-on-build': { result: 'skipped', outputs: {} },
    functions: { result: 'skipped', outputs: {} },
  };
  for (const [job, state] of Object.entries(overrides))
    if (state === undefined) delete needs[job];
    else needs[job] = state;
  return needs;
};
