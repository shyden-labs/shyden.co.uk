# #475: the floor recorder reads a Playwright run

Refs #475, Group 5a of #446. Follows #468 (the ratchet) and #469 (cross-checks).

## Design

- `scripts/record-floors.mjs` runs the unit suite with `FLOORS_RECORD` set,
  then `npx playwright test --workers=1` over `floorSpecs()` (the specs whose
  text calls `floorBreach`) on every project, in `localImage()` with
  `--platform linux/amd64`. Both records go to `decideRecord` together.
- The record file sits in a git-ignored `.floors-record-*` directory at the
  checkout's root: the container mounts the checkout and nothing else, and
  Playwright empties `test-results/` as it starts.
- `runRefusal(suite, run)` is the one judge of a run, unit or Playwright, so a
  Playwright run is refused exactly as a unit run is. Docker is asked for
  first, before minutes of unit suite.
- `containerArgs` (`scripts/playwright-image.mjs`) builds the `docker run`
  vector for both local container runs, `visual.mjs` and the recorder.
- `nonEmpty` moves to `scripts/errors.mjs`, re-exported by
  `tests/source-files.ts`, so a script's directory read is proved where it is
  read (`one-home`'s rule) from the same one home.

## Acceptance criteria to proof

| AC | Proof |
| --- | --- |
| 1 | `tests/e2e/floors-under-playwright.spec.ts` (content project): the record's `site` equals this file's own marked line, read from its text; judge mode returns the same breach text as under vitest. Mutation M6. |
| 2 | `floors.test.ts`: the docker and npx stand-ins (did not start, failed, judged together, scratch directory removed, `floors.json` byte-identical); `runRefusal` per suite; `playwrightRecordArgs` (platform before image, record path inside the container, refuses a path outside the checkout and an empty spec list, one worker, no update flag). CI refusal is the existing `script-entry` probe. Mutations M7-M13. |
| 3 | The record run itself: `decideRecord` refuses one id read with two values, so one recorded id means one value on every project. |
| 4 | Both floors after their verdicts; `GROUP_5` 7 to 5; first figures read against `find dist -name '*.html'` (16) and `importFile` per locale (4). |
| 5 | Cross-checks with no literal: built paths against `deployedRoutes()` and the 404; problems against the faulty rows. |
| 6 | Mutations M1-M4 (floor one short, grown, both floors). |
| 7 | Review passes below; CI by job name; merge commit; dev deploy verified. |

## Mutations, predicted before running

M1 pages recorded +1: RED. M2 pages recorded -1: RED. M3 problems +1: RED.
M4 problems -1: RED. M5 the walk drops a page: RED. M6 `callSite` one line
low: RED under Playwright. M7 a failed Playwright run trusted: RED. M8 the
container's record dropped: RED. M9 scratch directory kept: RED. M10
`floorSpecs` blind: RED. M11 `floorSpecs` blind to one spec: RED. M12 the
host path handed to the container: RED. M13 a non-zero unit exit trusted: RED.

## Review passes

1. Running it found five: `one-home` refused the unproved `readdirSync` (fixed
   with `nonEmpty` from its moved home); `anchored-presence` read three
   presence matchers as over source text (made exact equalities); two
   emulated browsers at once timed out 11 of 35 journeys (one worker, measured
   passing); the first record ran with the new spec untracked, so the
   tracked-file declaration count missed its 3 bodies (staged, re-recorded);
   an empty spec list would have been a stack trace (refused by name).
2. The mutation matrix and the whole unit and e2e runs on the committed tree;
   its results are posted on #475.
