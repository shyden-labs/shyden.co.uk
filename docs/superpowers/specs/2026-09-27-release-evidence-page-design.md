# Release evidence page — design (#362)

## Why

The release protocol's step 4 is an interactive evidence page for the operator, and no page covers the release now waiting. Production is `a3a5adb` (2026-08-13). `develop` is 133 PR merges and 45 squash commits ahead of it; 47 of those 178 commits change a visitor-facing file. Per-ticket pages cover part of that, on older trees, and stopped when per-ticket sign-off was suspended on 2026-09-24.

The operator decided on 2026-09-27: build one release-wide page, **capture on all five engines**, and reuse `scripts/build-evidence-page.mjs`.

## What the operator gets

One published page, with the same sign-off mechanics as every ticket page:

1. **The release identity:** production's SHA, the release head's full SHA, and that head's `dev-verified` state.
2. **A change map.**
   - It has one row for each commit in the release that changes a visitor-facing file. Each row gives the commit, PR, ticket, subject and a classification:
     - **visible**, linked to the journeys that show it;
     - **no intended visible change**, with a one-line reason.
   - A visible row is **flagged** when a journey it cites failed on any engine, or passed on none.
   - The map ends with totals.
3. **The rest of the release, summarised:** commits touching no visitor-facing file, counted by the top-level area they change.
4. **Every journey:** the existing journey sections, with screenshots per assertion across five engines, a recording per journey, and ticks.
5. **Release checks:** tickable items for the operator's manual test on dev and for the prod setup. They sit in the same sign-off as the journeys, so a verdict covers them.

## Units

### `scripts/release-inventory.mjs` — what is in the release

- `VISITOR_PREFIXES = ['src/', 'functions/', 'migrations/', 'public/']`.
- `readCommits({ base, head, git })` walks `git rev-list --first-parent <base>..<head>`, oldest first. Each commit carries `sha`, `parents`, `subject` and `files`. `files` is `git diff --name-only <p1> <sha>`, what the commit brought to the first-parent line, the same for a PR merge and a squash. A merge's two parents are never diffed against each other: for a branch that sat behind `develop`, `<p1> <p2>` reports everything `develop` gained meanwhile as the PR's own work. Measured: #108's merge counted three `src/` files it never touched.

  `git` is injected: the CLI passes a runner around `execFileSync('git', …)`, and the tests pass a real temporary repository. It throws when `base` is not an ancestor of `head`, and on a commit with more than two parents, which this history has never had and which would need its own rule.
- `inventoryOf(commits)` is pure. For each commit it returns `{ sha, subject, pr, ticket, files, visitorFacing, areas }`.
  - `pr` comes from `Merge pull request #N` or from a squash subject's last `(#N)`.
  - `ticket` is a merge branch's leading digits (`from Shyden-Ltd/362-…`), or a squash subject's first `(#N)` when it carries two. Otherwise it is `null`.
  - `areas` is the sorted set of each file's top-level directory, or `(root)` for a file at the top level.
- `releaseTests(files, read)` picks the capture selection from source, **parsed with `typescript`, never grepped**, so a comment cannot decide it. It returns `file:line` for every `test(` call whose callback calls `shoot(` directly, or calls a same-file function that does. Helpers are followed to a fixed point, because `classroom-groups-projector.spec.ts` captures only through `expectNothingOutOfReach`. A file importing `../evidence-fixture` (the evidence tooling's own spec) is skipped. `read` is injected. Selecting by `file:line` runs every iteration of a looped test and none of the 300-odd tests in those files that capture nothing.
- CLI: `node scripts/release-inventory.mjs --base <sha> --head <sha>` prints `{ base, head, entries }` as JSON, and `--tests` prints the selection, one `file:line` per line.

### `scripts/release-map.mjs` — the release's judgement, checked

Classification lives in the repo at `docs/releases/<base7>.json`. It holds `{ base, headline, lede, signoff: { lede, approve }, gapGroup, checks: [{ id, group, label }], entries: { <full sha>: { kind: 'visible', journeys: [<full title path>] } | { kind: 'gap', check } | { kind: 'none', reason } } }`. A **gap** is a visitor-facing change that no capturing journey shows. Its `check` says what to try by hand, and it becomes a tickable check, `gap-<sha7>`, under `gapGroup`, so it sits inside the sign-off rather than in a list that is read once. It names no head: the head is the one being released, and it is read at build time.

`changeMapOf({ inventory, release, journeys, statuses })` **throws**, naming the offending SHA or title, in eight cases:

- `release.base` differs from `inventory.base`;
- a visitor-facing entry has no classification (**unclassified**);
- a classification names a SHA that is not a visitor-facing entry of the inventory (**stale**);
- a `visible` classification cites no journeys (**empty**);
- a `visible` classification cites a title that is not a journey (**unknown journey**). When building, a journey is a title with captures in this run's manifest, the same set the builder renders as `j-` sections; a test that ran but captured nothing has no section to link to. Under `--check`, only a listing exists, so a journey is any title in it. That catches a mistyped title before the merge but not a non-capturing one, which the build then refuses.
- a `none` classification has an empty reason;
- a `gap` classification has an empty `check`;
- a classification's `kind` is none of `visible`, `gap` or `none`.

It returns `{ rows, totals, otherAreas }`. A row is **flagged** in either case:

- any result of a cited journey is neither `passed` nor `skipped`;
- a cited journey passed on no engine at all.

A skip on its own is not a flag, because some journeys are skipped on an engine by design (for example, mobile-only behaviour). `renderChangeMap(map)` escapes every value and links each journey to `#j-<slugOf(title)>`, the anchor the builder already writes (`<section class="journey" id="j-…">`). `slugOf` is exported from the builder, which gives it one home.

### `scripts/build-release-content.mjs` — the content file

This CLI reads the release file, runs the inventory from `base` to `--head`, and reads the capture's report from `--evidence`. It then writes the content JSON the builder already accepts:

- `title`, `eyebrow`, `headline` and `lede`;
- `ids`: production, head and `dev-verified`;
- `sections`: the change map and the summary;
- `checks`;
- `signoffKey: release-<head7>`.

It reads `dev-verified` for the head through an injected reader; the CLI's reader is `gh api repos/{o}/{r}/commits/<sha>/statuses`, taking the latest `dev-verified`. It **refuses** when that status is not `success`. It holds no release prose, and the builder's existing no-prose guard is extended to this file. It takes the report's and manifest's filenames from `evidence-files.mjs`, because a guard in `evidence-page.test.ts` refuses any script that spells them.

### `scripts/build-evidence-page.mjs` — one addition

`content.checks` renders as tickable rows, grouped under each check's `group` text in first-seen order, so the dev manual test and the prod setup read as two lists while the builder holds no prose. Each row is marked up the way the page script already finds a journey: the row is `id="j-check-<id>"` with its label in an `h3` (read by `linkTo` and toggled `done`), and its box is `<input type="checkbox" id="chk-check-<id>" data-journey="check-<id>">`. That covers all three ways the script reaches a journey: the `input[data-journey]` binding, the `chk-` lookup that skips an id with no box, and the `j-` section. A tick therefore persists, shows, and counts with no change to the page script's logic. The one change is the wording: on a page with checks, the progress line reads "journeys and checks reviewed" instead of "journeys reviewed", chosen at build time. Each check's id, `check-<id>`, joins the page's `JOURNEYS` list, so the verdict covers it and `journeysOfPage` returns it. A check id must match `^[a-z0-9-]+$`, be unique, and not collide with a journey id; otherwise the build throws. The builder is otherwise untouched, which keeps the conflict with #205's branch small.

A second addition, for the same no-prose reason: `content.signoff`, optional `{ lede, approve }`, replaces the sign-off section's two ticket-shaped strings ("This ticket progresses only on your explicit decision below." and "Signed off — may merge to develop"). On a release page they would name the wrong decision. Without it, every existing page renders exactly as before.

### Instrumentation

`report-form.spec.ts` (#97) and `not-found-report.spec.ts` (#350) call `shoot()` after their assertions. They must meet the house meta-guards:

- `capture-after-assertion`;
- `evidence-recording` (`test.use(recorded)` only if the spec acts);
- `viewport-tagging`.

### House rules every new script meets

Three meta-guards apply to every new script, each derived from the files on disk:

- `script-entry.test.ts` scans every file under `scripts/`: each CLI prints `usage:` on bad arguments and runs `main` only as the entry point.
- `one-home.test.ts` refuses a near-duplicate function, so `renderChangeMap` escapes with the builder's `esc`, which is exported, never a copy.
- `evidence-page.test.ts` refuses a respelled evidence filename.

The plan runs the whole unit suite over the new files, not only their own tests.

## Flow

1. The code PR merges to `develop`: the tooling and the instrumentation. Dev deploys, and `dev-verified` is read off the commit.
2. **Capture:** `EVIDENCE_DIR=<dir> npm run test:e2e -- --workers=2 $(node scripts/release-inventory.mjs --tests)`, on all five engines, against `develop`'s head. Nothing else runs meanwhile.
3. **Before the content merges**, `build-release-content.mjs --check --manifest <dir>/manifest.jsonl` validates the release file against the release's one laptop capture (#765): it refuses every cited title no row of that run carries, all of them in one refusal, each with its entry. A listing (`npx playwright test --list --reporter=json <specs>`) carries every title and no results, so it proves a title runs, not that it captures: a looped case that returns before its `shoot` is listed and passes. `--check --listing` says so, and is refused unless `--listing-only` asks for it by name. `--check` skips the `dev-verified` read, because a branch head never carries one, and writes no content file: it can only pass or refuse. A named case is fixed so it captures, never dropped or cited around; a second capture for the release is allowed for exactly that (operator 2026-10-14).
4. **Content, then page:** `build-release-content.mjs` builds the content, then `build-evidence-page.mjs` builds the page. Assets are uploaded with `upload-evidence-assets.mjs`, and the page is published with `{"db": {}, "assets": {}}`.
5. **Verified:** the asset count equals the manifest's media count, every image and recording loads, and the sign-off doc key reads `release-<head7>`.

A later merge that changes a visitor-facing file makes step 4 throw **unclassified** until the release file classifies it. That is the point: the page cannot quietly describe a tree it was not built for.

## Error handling

Every refusal is a thrown `Error` naming what to fix. There is no partial page, and nothing is silently skipped. This matches the builder's standing rule that "nothing is silently dropped".

## Testing

Unit tests (vitest), written red first against throwing stubs:

- **Inventory:** a temporary repository holding a squash commit, a PR merge whose branch changes `functions/` while `develop` moves on beside it (so a parent-to-parent diff would wrongly include `develop`'s change), and a merge whose PR changes only `tests/`. It checks files per shape, `pr` and `ticket` parsing, `areas`, the ancestor refusal, and `releaseTests` over fixture sources (direct, through a helper, through a helper's helper, a comment naming `shoot(`, the fixture import).
- **Map:** each throw; the flag (one engine failed, so flagged; every engine skipped, so flagged; one engine skipped and the rest passed, so not flagged); totals; escaping; and anchors equal to `#j-` plus `slugOf`.
- **Content:** the `dev-verified` refusal, the `signoffKey`, `--check` against a listing (titles validated, no flag computed, no `dev-verified` read, nothing written), and no prose in the script.
- **Builder:** `checks` render with the `j-check-` row, its `h3` and the `chk-check-` box, group under their headings, join `JOURNEYS`, and switch the progress wording. A duplicate, a malformed id, or a collision with a journey throws.
- **e2e:** `evidence-page.spec.ts` shows a check ticking and persisting, alongside a journey tick.

Mutations, each predicted before it runs:

- a merges-only walk;
- a dropped prefix;
- a merge diffed parent to parent (`<p1> <p2>`) instead of `<p1> <sha>`;
- each of the eight throws removed;
- a gap left out of the checks;
- the flag treating `skipped` as a failure;
- the flag ignoring a failure when another engine passed;
- `renderChangeMap` writing a subject unescaped (a fixture subject carries `<img src=x onerror=…>`);
- a journey link written without the `j-` prefix;
- the totals counting a flagged row as unflagged;
- a non-visitor-facing commit left out of the area counts;
- `signoffKey` written as the ticket default instead of `release-<head7>`;
- release prose added to `build-release-content.mjs` (the no-prose guard must go red);
- checks left out of `JOURNEYS`;
- a check's box written without `chk-check-<id>`;
- the `dev-verified` check removed;
- `--check` reading `dev-verified` anyway (it must pass on a branch head);
- `--check` writing the content file;
- each of the builder's three check-id refusals removed (duplicate, malformed, collision);
- the progress wording left at "journeys reviewed" on a page with checks;
- `content.signoff` ignored (the release page reads "may merge to develop");
- checks rendered in one list, ignoring `group`;
- `releaseTests` keeping the fixture spec;
- `releaseTests` keeping a test that never reaches `shoot(`;
- `releaseTests` not following a helper (the projector's journeys vanish);
- `releaseTests` following helpers one level only (a helper calling a helper that shoots is missed);
- the ancestor refusal removed;
- the more-than-two-parents refusal removed;
- a squash's `pr` taken from its first `(#N)` instead of its last;
- a single-ref squash given that ref as its `ticket`;
- a top-level file given no area instead of `(root)`;
- each new `shoot()` moved before its assertion.

## Out of scope

- Opening or merging the `develop` → `main` promotion, which is the operator's alone.
- The #205 carousel and its #206–#212 follow-ups. This page uses the current builder.
- Rewriting per-ticket pages.

## Review log

- **Pass 1 (2026-09-27):** checked every path, anchor, markup hook and CLI the spec relies on against `origin/develop`: `upload-evidence-assets.mjs`, the `../evidence-fixture` import, the `content` project's `CONTENT_ONLY_SPECS` (no capturing spec among them, so five engines), and `test-e2e.mjs` passthrough. **3 findings, all fixed:**
  - the anchor is `#j-<slug>`;
  - checks reuse `data-journey`, so the page script needs no change;
  - a skip on its own no longer flags a row.
- **Pass 2 (2026-09-27):** full read, plus the scripts-wide meta-guards (`script-entry`, `one-home`, and the evidence-filename contract in `evidence-page.test.ts`). **7 findings, all fixed:**
  - two sentences still described the old flag rule (lines 18 and 113);
  - the throws were miscounted (six, not five);
  - `gh api` named as the `dev-verified` reader;
  - the evidence filenames come from `evidence-files.mjs`;
  - `esc` is exported, not copied;
  - the house-rules section added.
- **Pass 3 (2026-09-27):** full read. **3 findings, all fixed:**
  - six throws now sit in six bullets;
  - a commit with more than two parents throws;
  - checks carry a `group`, rendered as headings taken from content.
- **Pass 4 (2026-09-27):** full read, plus the page script's three lookups of a journey (`input[data-journey]`, `chk-<id>`, `j-<id>`). **1 finding, fixed:** a check needs the `chk-` box and the `j-` row with an `h3`, or it never shows ticked and never counts. The progress wording now names checks.
- **Pass 5 (2026-09-27):** full read. **1 finding, fixed:** journey titles could be validated only after the merge; `--check` against a Playwright listing now validates them before it.
- **Pass 6 (2026-09-27):** full read, plus a walk of the branch's own first-parent commits through the inventory (tests, scripts and docs only, so none is visitor-facing and the branch needs no classification of itself). **1 finding, fixed:** `--check` would have refused on the missing `dev-verified`; it now skips that read and writes nothing.
- **Pass 7 (2026-09-27):** full read, plus each branch the spec introduces matched against a mutation. **1 finding, fixed:** five branches had none (`--check`'s two, the builder's three check-id refusals, the progress wording, `group`); each now has one.
- **Pass 8 (2026-09-27):** full read, plus the inventory's branches matched against mutations. **1 finding, fixed:** six branches had none (the ancestor and parent-count refusals, `pr` and `ticket` parsing, `(root)`, and the `shoot(` requirement); each now has one.
- **Pass 9 (2026-09-27):** full read, plus the map's and content's branches matched against mutations. **1 finding, fixed:** six had none (escaping, the `j-` anchor, totals, area counts, `signoffKey`, the no-prose guard); each now has one.
- **Pass 10 (2026-09-27):** full read, with every mechanical check re-run: `a3a5adb` is an ancestor of `origin/develop` (`merge-base --is-ancestor`, rc 0); a `--list --reporter=json` of `not-found.spec.ts` carries 20 `describe > test` titles per engine with zero results; anchors, markup hooks, meta-guards and a mutation for every branch all hold. **No findings.** Spec approved under the operator's review-to-zero mandate (2026-09-24).
- **Plan-time amendment (2026-09-27), found while reading the builder for the plan:**
  - a cited title must be a captured journey (`order` comes from the manifest), not merely a report title; `--check`'s weaker test is stated;
  - the sign-off section's ticket wording ("may merge to develop") would misname the release decision, so `content.signoff` overrides it, with a mutation added.
- **Plan-time amendment 2 (2026-09-27):** a fixture for the plan showed `git diff <p1> <p2>` reporting `develop`'s own changes as a stale branch's work (#108's merge was a false positive). Every commit is now diffed against its first parent. The count is 47, not 48, and the mutation is restated.
- **Plan-time amendment 3 (2026-09-27):** the listing showed 139 capturing journeys, not the ~60 counted from source; locale loops expand and one spec captures through a helper. The selection is now `file:line` of each capturing test, found through helpers to a fixed point, so a capture runs about 148 tests per engine rather than 449. The operator re-confirmed five engines against the corrected numbers.
- **Plan-time amendment 4 (2026-09-27):** classifying the 47 commits for the plan needed a third kind. Four visible changes have no capturing journey (#41's handover language, #251's roster labels, #256's CSV header, #352's iOS zoom), and forcing them into `visible` or `none` would have misreported them. `gap` was added; each gap becomes a check. Two refusals were added (an empty `check`, an unknown `kind`), and `signoff` and `gapGroup` live in the release file because the scripts hold no prose.
