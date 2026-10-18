# Even e2e shards (#607)

Operator ruling 2026-10-18 (#607, comment 6250507921): split by **whole spec file per project**, from a committed timings file, refreshed by a **script run by hand** from a green CI run's shard logs; CI prints each shard's time and the slowest/mean ratio on every run.

Measured basis (comment 6250460434): today's `--shard=i/8` splits by count in project order, slowest/mean 1.49-1.77 over four runs; the spec-file split simulated at 1.03-1.06 on the same runs, trained on one and judged on the next.

## Shape

The e2e job keeps `--shard=i/N` and its account exactly as they are. One env var, `E2E_SHARD_PLAN=<timings file>`, set on the e2e step only, turns `scripts/test-e2e.mjs` from Playwright's count split to the planned one:

1. The unfiltered `--list` each shard already runs is parsed into units, `[project] › file`, each with its test count. The parse is fail-closed: the per-test lines it read must equal the listing's own `Total:` footer.
2. `planShards(units, timings, total)` assigns whole units to shards, longest first, each to the least-loaded shard (LPT). Deterministic: ties broken by key, then by shard index, so all N shards compute one plan from one listing. A unit absent from the timings file weighs the median of the listed units that are in it, and the plan names every such unit.
3. The shard's units are written as a `--test-list` file (Playwright 1.56+, `[project] › file` matches every test of that file in that project), and Playwright is run with `--test-list <file>` in place of `--shard`.
4. The account is unchanged: written from the caller's own argv, so it still names shard i of N, and `build-and-test` still holds the executed sum to the enumerated total (AC4). It gains one field, `seconds`, the Playwright run's wall time, which `scripts/e2e-shards.mjs` prints per shard with the slowest/mean ratio.
5. **Each spec file exactly once.** Playwright's split could never put a test in two shards; ours could, and the sum alone cannot see one file run twice while another of the same size ran nowhere. So each account also carries `listedUnits` (the listing's count per `[project] › file`) and `ranUnits` (the json report's), and build-and-test holds every file's runs across the shards to its listed count. That holds for Playwright's count split too, where a file may span two shards (capture shards).

Capture shards (`E2E_ENUMERATE=selection`) are left on `--shard`: they count a selection, and their balance was not measured. Setting `E2E_SHARD_PLAN` with selection, or without `--shard`, is refused by name.

## Files

- `scripts/e2e-shard-plan.mjs` (new, pure): `unitsOfListing(stdout)`, `planShards(units, timings, total)`, `testListText(units)`, `withoutShardArgs(args)`, `timingsFromLogs(texts)`.
- `scripts/e2e-shard-timings.mjs` (new CLI): reads shard log files, writes `tests/e2e-shard-timings.json`. How to fetch the logs is in its header.
- `tests/e2e-shard-timings.json` (new): `{ "source": "<run id>", "seconds": { "[webkit] › tests/e2e/x.spec.ts": 123.4 } }`, from run 39127037665 (or the latest green run at commit time).
- `scripts/test-e2e.mjs`: plan when `E2E_SHARD_PLAN` is set; time the run; `seconds` into the account.
- `scripts/e2e-shards.mjs`: `readAccount` accepts `seconds` (null or a non-negative finite number, else not an account); `shardTimes(accounts)` table + ratio, printed by `main`.
- `.github/workflows/ci.yml`: `E2E_SHARD_PLAN: tests/e2e-shard-timings.json` on the e2e step; the "EIGHT" comment rewritten.
- `tests/unit/e2e-shard-plan.test.ts` (new); `tests/unit/e2e-shards.test.ts` (seconds, table); `tests/unit/pipeline-wiring.test.ts` (the env var on the e2e step, absent on capture).
- `CLAUDE.md`: the CI shards paragraph names the plan and the refresh.

## Tests first (unit; no process, no socket, small fixtures)

- listing parse: units and counts from a fixture listing; a line it cannot read, or a footer that disagrees with the lines, throws naming both counts.
- plan: every unit in exactly one shard; deterministic for shuffled input; LPT balance on a fixture where count-splitting is lopsided; an unknown unit takes the median and is named; more shards than units refused; one shard holds everything at N=1.
- test-list text: one `[project] › file` line per unit; round-trips through the same split Playwright's `loadTestList` does (`›`, `[...]`).
- `withoutShardArgs`: drops `--shard=i/N` and `--shard i/N`, keeps everything else in order.
- timings from logs: sums per unit over `✓`/`✘` lines in ms, s and m; ignores other lines; two logs add up.
- account: `seconds` accepted when null or a number, refused when negative or a string; the table names every shard and the ratio.
- wiring: the e2e step sets `E2E_SHARD_PLAN` to a file that exists; the capture step does not.

## Verification

- Laptop: `npm run test:unit`, `npm run typecheck`, `npm run format`, lint.
- CI on the PR: all 8 shards green, account adds up; per-shard minutes from the new table.
- AC3: three CI runs (PR, dispatched re-run, the develop merge's run), slowest within 25% of mean, wall against 18 min.
- AC4 mutation, on a measuring commit (dropped after, never reverted): the plan omits one unit from shard 3; `build-and-test` must go red on "ran N of M". Second mutant: one unit in two shards, red on the sum.
