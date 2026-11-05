# Handover — 2026-10-06 19:26Z: #582 (docs-only CI fast path) is merged and dev-verified (develop at `d691c5c`). This handover's own PR is the first docs-only run, and it measures AC5.

## The release decision (operator, 2026-10-04, recorded on #390, #446, #515 and #403; #552 added 2026-10-05)

- **Gates the release:** the #390 tranches (#497-#499), #510 (the probes), the conversion stories #530-#532 and #544, #494 (the summary), #362 (the evidence page), #553, then the operator's manual test. The operator releases.
- **#553 (visual flake) is counted as gating**, because a required check that fails at random is a P0 defect under the global zero-tolerance rule. The operator has not ruled on it.
- **Everything else below P0 is fixed forward**: the rest of the guard audit (#446, #469, #471-#474, #476, #478-#482), #547, #512, #514 and #576 come after the release.
- **DeepL runs whenever it can. Floors everywhere** (#534). **The recorder repeats until stable** (#525). **Deliberately empty fixtures take a floor of 0** (#528).
- **Alert 13: "A: Guard it"**, done in #457. The alert stays open. Dependabot's next `astro` bump will be red on `ASTRO_READ` by design: re-read the gate the tripwire's message names before moving it.
- **One-unit floors take two mutants** (loss + growth); a population of 2 or more takes a real drop-one after any pin. Tool: `.superpowers/sdd/lossmut.py <spec.py>`.
- **#582, operator 2026-10-06 18:33Z: `visual` keeps running on a docs-only PR** (it is required by name and `deploy-gate.mjs` refuses it skipped), so `image` runs too. Only `e2e` (8 shards), `functions` and `sanity-on-build` are skipped.

## Done this session

| Ticket | PR   | Merge     | dev-verified | Note                                                                                                                                                                                                                                   |
| ------ | ---- | --------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #582   | #583 | `d691c5c` | 19:25:43Z    | `scope` job + `scripts/docs-only.mjs`; `build-and-test` judges a docs-only verdict; the #157 guard knows the aggregate shape; 23 mutants as predicted (one prediction corrected, M2); 4 new floors, each matching an independent count |

**#582 stays open until AC5 is measured.** This PR changes `HANDOVER.md` alone, so its CI run is the first docs-only one. Read it by job (`gh run view <id> --json jobs`): expect `scope` to print `docs-only`, `e2e`/`functions`/`sanity-on-build` `skipped`, and `checks`/`visual`/`image`/`build-and-test` `success`. Post the wall time and runner-minutes on #582 against 15 min and 83 runner-minutes, with every AC's evidence, then close it.

**Found this session:**

- **Floors recorded with new files untracked, a third time** (#390 F50, #475, #582). Every delta reconciled, because the reconcile reads the same blind set; the mutation harness's baseline caught it. Evidence added to **#547** (the recorder refusing untracked files). Until it lands, `git add -A` is the first command of every record.
- **The full `npm run floors:record` was refused by `tests/e2e/feature-words.spec.ts`**: 11 failed and 9 passed, each failure a 30 s timeout at load average about 13. `--unit` was the right mode for #582, since no browser floor moved, but the Playwright-floor stories (#544, #530-#532) need the full record, so expect it there. Open PR #381 (#380) budgets exactly these locale-copy journeys.

## Resume, in order

1. **Finish #582**: measure this PR's run (above), post the evidence, close it, mark it Done.
2. **#497** (tranche 26, from **row 348**; next finding **F206**), then #498, #499. The recipe is #492's: read each row whole, record findings in the row, prove each with a predicted pair, file P4s fixed forward on one collection ticket, a one-commit ledger PR (now docs-only, so about 2-3 minutes of CI), then a #390 progress comment. Harness shapes: `../shyden.co.uk-492/.superpowers/sdd/492/mut492.py`, and `../shyden.co.uk-582/.superpowers/sdd/582/mut582.py`, which refuses a red baseline and holds the test count.
3. **#544, #530, #531, #532** (Playwright floors: `npm run floors:record`, Docker, one worker). The recipe is #545's `patch545.py`/`mut545.py` in `../shyden.co.uk-545/.superpowers/sdd/545/`. Every one-unit floor takes a loss mutant too. One PR at a time: each merge puts the next into conflict on `floors.json` and the burn-down, resolved by `.superpowers/sdd/resolve-floors-merge.py` and a re-record. Expect the feature-words timeouts above.
4. **#553**: reproduce first per its ACs. No retry, no longer timeout, no mask.
5. #510 (ask the operator about #459's probe), #494, #362.
6. Merged worktrees that can be removed: `-457`, `-475`, `-492`, `-515`, `-522` to `-529`, `-536` to `-545`, `-548`, `-552`, `-570`, `-572`; `-582` once #582 is closed (it holds `mut582.py`), and `-582h` once this PR merges. `-475` holds `board.py` (already copied to `.superpowers/sdd/yawelo/board.py`).
7. **Never search or read evidence in the main checkout: it is on the stale branch `380-locale-copy-budget`.** Search a develop worktree, with a known positive.

## Running

Nothing.

## Progress (shyden.co.uk)

Measured from the board at 19:26Z with `.superpowers/sdd/yawelo/board.py` (277 stories): 213 closed, 858 of 1121 points (87 closed and 3 open stories unscored, counted at the closed-scored mean of 4.05, assumed). Pace over the last 7 days (measured): 67 stories and 289 points, which is 9.6 stories and 41.3 points a day. Release path left (measured from `.superpowers/sdd/release-path.txt`, each ticket's Estimate): **11 tickets, 53 points** (#362, #494, #497-#499, #510, #530-#532, #544, #553), then the operator's manual test. #582 (5 points) closes on this PR's measurement.

- By tickets: 213 / 277 = **77% complete**. ETA release-ready 2026-10-08 to 2026-10-12 (11 tickets at 9.6 a day, about 1.2 working days, plus serial CI rounds), medium confidence.
- By effort: 858 / 1121 = **77% complete**. ETA release-ready 2026-10-08 to 2026-10-12 (53 points at 41.3 a day, about 1.3 working days), medium confidence. #553's cause is not yet found, the Playwright stories need Docker runs (and may meet the feature-words timeouts), and the operator's manual test is an outside wait.
