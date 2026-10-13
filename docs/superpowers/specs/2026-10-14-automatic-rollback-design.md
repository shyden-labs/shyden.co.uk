# A release that fails its live check rolls itself back: design (#748)

**Ticket:** #748. **Rulings:** #748 comments 6156956394 and 6157078223 (operator, 2026-10-14), and the ticket's own
2026-10-13 choice, *"Automatic, no approval (Recommended)"*.

## Goal

When a deploy to production fails its own live check, production puts itself back to the deployment it served
before that deploy, in about a minute, with nobody needed, and the operator is told in an issue what happened, what
is live and what to do. Dev gets the same, from the same code. Every failed production run also tells the operator,
whichever job failed.

## Today (origin/develop `c599b64a`, read 2026-10-14)

- `deploy-prod.yml`: `deploy-prod` (environment `prod`, operator approval; build, placeholder guard,
  `wrangler pages deploy`) then `smoke-and-verify` (`playwright.prod.config.ts` against `https://shyden.co.uk`, then
  `prod-verified`). A failed check leaves the bad build live, and **nothing tells anyone**: only `deploy-dev.yml` has a
  `report-failure` job (#725).
- `rollback.yml`: manual, behind `prod-rollback`'s approval; finds a target (`scripts/rollback-target.mjs`) or takes
  the operator's id straight to an inline `curl -X POST …/deployments/<id>/rollback`.
- `deploy-dev.yml`: `gate`/`test` -> `deploy-dev` (environment `dev`) -> `verify-dev` -> `dev-verified` (develop only)
  -> `report-failure` (`scripts/deploy-failure.mjs`, develop only).
- **Measured, and unmeasured:** `deploy-prod.yml` has never run (the last push to `main`, 2026-08-13, ran the older
  pipeline). So how a refused approval looks to downstream jobs is unmeasured here. Whether a Pages rollback adds a
  list entry (#406), and whether Cloudflare accepts a rollback to the deployment already live, are unmeasured too;
  this design needs neither. The `dev` environment refuses every branch but `develop` (run 38328484066), although the
  App reads no rule on it (#769).

## Design

### 1. Know what was live before the deploy (AC1)

`node scripts/pages.mjs live <project>` makes ONE `GET /accounts/<account>/pages/projects/<project>` and prints the
project's `canonical_deployment.id`. It refuses, naming why: a missing setting, a non-2xx answer, a body without the
id, or an id that is not `^[A-Za-z0-9-]+$` (the shape `rollback.yml` already enforces before an id reaches a URL or
`$GITHUB_OUTPUT`). The parse is a pure function in `src/lib/pages.ts`, which `rollback-target.mjs` reads the same
field through (one home). The base URL is `endpoint('CLOUDFLARE_API_URL', 'https://api.cloudflare.com/client/v4')`, so
tests point it at a local stand-in.

It runs in `deploy-prod` and in `deploy-dev` straight after checkout and setup-node, before `npm ci` and the build, so
a failed read stops the deploy in seconds: with nothing recorded there is nothing to fall back to. Its output becomes
the job output `before`.

### 2. Promote it back, then confirm (AC2)

`node scripts/pages.mjs rollback <project> <id>` makes ONE `POST …/deployments/<id>/rollback` and no list read, then
ONE `GET` of the project; it succeeds only when `canonical_deployment.id` is `<id>`, and otherwise exits 1 naming what
is live. One script with two commands, because both share one Cloudflare client. `rollback.yml`'s "Promote it" step
calls it too (its inline curl goes; its own empty-target refusal stays in shell before the call), so the manual and
automatic rollbacks share the one promote.

### 3. Where the rollback runs (AC2, AC3)

Both workflows run the same step, named `Roll back to the deployment before this deploy` (one constant,
`ROLLBACK_STEP` in `src/lib/deploy-failure.ts`, so the notice can find it in the run's jobs):

```yaml
- name: Roll back to the deployment before this deploy
  if: failure()            # dev only: a step of verify-dev
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    BEFORE: ${{ needs.deploy-<x>.outputs.before }}
  run: node scripts/pages.mjs rollback <project> "${BEFORE}"
```

**Prod: its own job**, after the check:

```yaml
rollback-prod:
  name: Roll prod back to the deployment before this release
  needs: [deploy-prod, smoke-and-verify]
  if: >-
    !cancelled() && github.ref == 'refs/heads/main' &&
    needs.deploy-prod.result == 'success' && needs.smoke-and-verify.result == 'failure'
  environment: { name: prod-autorollback, url: https://shyden.co.uk }
  timeout-minutes: 5
```

- **Not a bare `failure()`** (AC2's wording): `failure()` is true when any ancestor job failed, including a
  `deploy-prod` refused at its approval or failing its build, which changed nothing live. The condition names each
  result.
- **`!cancelled()`**: a manual `rollback.yml` cancels this run (the shared `shyden-prod-publish` lock); the automatic
  one must then stay out of its way. The job runs inside the same run, so it already holds that lock.
- **`github.ref == 'refs/heads/main'`** pins in the repository what the environment also enforces: only `main` rolls
  production back.
- **Its environment, `prod-autorollback`**, accepts `main` alone and has no reviewer: the operator's 2026-10-13 choice,
  the second unattended exception beside `prod-cron` (global rule updated, §7). It holds the prod Pages token and
  account id. Creating it is the operator's (administration). Until it exists, its first step fails closed naming the
  missing secret, exactly like `rollback.yml`'s "Check the secrets are set".
- Steps: check the secrets; checkout; setup-node; the rollback step above. No `npm ci`: the script imports nothing from
  `node_modules`. A separate job, never a step of `smoke-and-verify`, because that job runs `npm ci` and Playwright, and
  third-party package code never shares a job with a production token.

**Dev: the last step of `verify-dev`**, with `if: failure()`. `verify-dev` already runs in `dev`, the environment
holding the dev Cloudflare pair, and a step needs no new runner. A separate dev job would sit downstream of
`deploy-dev`'s and `verify-dev`'s conditions, where `skippedUpstreamFindings` (`tests/workflow-jobs.ts`) requires each
need to have succeeded; a rollback needs `verify-dev` to have FAILED, and that guard is not widened around this code.
A guard pins that the rollback step's `run:` is the same in both workflows apart from the project name.

### 4. The notice for every failed run (AC4, ruling 2)

`src/lib/deploy-failure.ts` and `scripts/deploy-failure.mjs` take the pipeline from the workflow (`PIPELINE=dev` or
`prod`) instead of assuming dev. Per pipeline: the ref it reports for (`develop` / `main`), the title
(`The dev deploy failed: dev is behind develop` stays; prod gets `A production release failed`), the opening sentence
and the closing instruction. Dedupe stays: a failure while a notice of the same title is open comments on it.

`deploy-prod.yml` gains `report-failure` (needs every job, `if: always()`, `contents: read`, `actions: read`,
`issues: write`, no environment), like dev's. The rollback's outcome is the conclusion of the step named
`ROLLBACK_STEP` in the run's jobs answer, which the script already reads (success, failure, or absent/skipped);
`before` comes from `NEEDS` (the deploy job's outputs; that job succeeded whenever a rollback ran). The body adds a
**Rollback** section:

- rolled back: *Production now serves deployment `<before>`, the one before this release. `main` (commit `<sha>`) and
  the live site now differ. Next: fix forward and redeploy `main`, or revert the release on `main`.*
- rollback failed (including a missing secret): *The automatic rollback failed: production still serves the release
  that failed its check. Roll back by hand with `rollback.yml` (deployment `<before>`).*
- no rollback (the failure came before or without a deploy): *Nothing was deployed, or the deploy itself failed:
  production should still serve what it served before (deployment `<before>`, when it was read); check the live
  site.* When the read of `before` is what failed, the notice says so and names no deployment.

It always names the failing job, step and last error line (today's `failureOf` / `lastErrorLine`), because a check can
fail for a reason that is not the release's fault. Dev's notice gains the same section in dev's words.

**A refused approval** is reported like any failure: unmeasured how it looks (above), and a notice too many beats
none, the script's own stance. The operator who refused it retires the notice.

### 5. Proof (AC5, ruling of comment 6157078223)

After the merge, a one-line PR adds a planted failing `@deployed-only` test to `tests/dev/dev-sanity.spec.ts` (with
its annotation reason). Every PR check passes (deployed-only tests run only after a deploy), it merges, `deploy-dev`
records `before` and deploys, `verify-dev` fails, its rollback step promotes `before`, and `report-failure` opens the
notice with the Rollback section. Read: the job results by name, `canonical_deployment` back to `before` (the job's own
confirm line), the issue's body, and the time from `verify-dev`'s end to the confirm (the "within a minute" figure,
quoted on the ticket). A second PR removes the planted test; develop's next deploy is green and `dev-verified`
returns. No switch stays in any workflow.

### 6. Tests (AC6)

- **Unit** (`tests/unit/pages.test.ts`, `deploy-failure.test.ts`): the canonical-id parse (absent, wrong shape, good);
  the confirm; the rollback outcome from a jobs answer; `before` from the needs; notice text per pipeline and per
  rollback outcome; an unknown pipeline refused. One test per case, RED first against stubs.
- **Integration** (`tests/integration/pages-script.test.ts`, `deploy-failure-script.test.ts`, both on one stand-in
  server extracted to `tests/integration/stand-in-api.ts`, since the duplication guard refuses a copied one): the
  script against a local stand-in Cloudflare that records requests: `live` makes one GET; `rollback` makes exactly one POST
  to `/deployments/<id>/rollback` then one project GET, never a list; a non-2xx, a `success: false`, and a canonical
  that did not move each exit 1 naming it; no token in the output. The prod notice end to end against the stand-in
  GitHub.
- **Guards** (`pipeline-wiring`): `rollback-prod`'s `needs`, exact `if` and environment; dev's rollback step last in
  `verify-dev` under `if: failure()`; `before` handed through `env:`; `pages.mjs live` before `npm ci` in both deploy
  jobs, its output named `before`; the two rollback steps' `run:` equal apart from the project; both report jobs
  aggregates naming every other job, with `PIPELINE`; the Cloudflare-environment table gains the automatic and dev
  rollbacks (matched by the command, not a URL); `rollback.yml` promotes through the script. Each mutation-verified
  both ways, floors recorded.
- **The environment itself** is repository administration no repository test reads (none reads `prod-rollback`'s
  either). Once the operator creates it, its branch policy, reviewers and secret names are read through the API and
  quoted on #748; the job's own `github.ref` condition is the in-repo half.

### 7. Rules and docs

- `~/.claude/CLAUDE.md` (Branching, "Every path to production"): the ONE exception becomes two, naming the automatic
  rollback's environment (main only, promote-only job, operator choice 2026-10-13); the reference file gets the
  history. Global, because the rule is global.
- Repo `CLAUDE.md`, Releasing: what happens when a release fails its live check, and what the notice asks.
- The operator's steps, asked as soon as this spec is approved: create `prod-autorollback` (deployment branches: `main` only; no
  reviewer; secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for the prod account). Until it exists, a
  failed release cannot roll back (the job fails closed and the notice says so), so it is asked early.

## Out of scope

- Rolling back when the deploy job itself fails part-way (`wrangler` erroring after it promoted): the notice says to
  check the live site; a measured case would get its own ticket.
- Changing who may dispatch `deploy-dev.yml` (#769).

## Risks

- A live check that fails for a reason outside the release (Cloudflare, GitHub runners) rolls back a good release.
  Accepted by the operator's choice; the notice names the failing check and its error so he can redeploy.
- "The check failed" means its whole job failed, setup included: an `npm ci` or browser install that fails in
  `smoke-and-verify` or `verify-dev` rolls back too. Same acceptance; the notice names the failing step, so a setup
  failure reads as one.
- The prod path is proved by identical code on dev, not by a run on prod (ruling 1). The first real prod rollback is
  read by name when it happens.

## Review log

- Pass 1 (whole document, placeholder and ambiguity scan): 3 findings. A placeholder job output nothing reads
  (removed); "first step" of a job that needs checkout first (now "straight after checkout and setup-node, before
  `npm ci`"); the operator's environment asked late (moved to spec approval).
- Pass 2 (whole document read): 2 findings. §7 still said "when the PR is ready" beside "as soon as the spec is
  approved"; the "no rollback" notice named `<before>` even when reading it was the failure.
- Pass 3 (whole document read, the changed lines again): no findings. Self-approved 2026-10-14 (operator 2026-09-24:
  review to zero, then approve).
- Pass 4 (reopened by planning, which read the guards the design meets): 4 findings. A separate dev rollback job is
  refused by `skippedUpstreamFindings` (now a step of `verify-dev`); no test reads an environment's settings, so §6's
  claim was false (now read once and quoted); `rollsProdBack` matches the inline URL the design removes (matchers by
  command); two scripts sharing one client would duplicate it (now `pages.mjs live|rollback`).
- Pass 5 (whole document read): 2 findings. §7 still said a guard reads the environment (it is read once, by hand);
  the Risks did not say a failed setup step inside the check job rolls back too.
- Pass 6 (the two changed passages read again, the rest unchanged since pass 5; scans for `pages-live`,
  `pages-rollback`, `rollback-dev`, `guard reading`, placeholders): no findings. Self-approved again 2026-10-14.
