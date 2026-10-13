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

`scripts/pages-live.mjs <project>` makes ONE `GET /accounts/<account>/pages/projects/<project>` and prints the
project's `canonical_deployment.id`. It refuses, naming why: a missing setting, a non-2xx answer, a body without the
id, or an id that is not `^[A-Za-z0-9-]+$` (the shape `rollback.yml` already enforces before an id reaches a URL or
`$GITHUB_OUTPUT`). The parse is a pure function in `src/lib/pages.ts`, shared with `rollback-target.mjs`, which reads
the same field today (one home).

It runs in `deploy-prod` and in `deploy-dev` straight after checkout and setup-node, before `npm ci` and the build, so a failed read stops
the deploy in seconds: with nothing recorded there is nothing to fall back to. Its output becomes the job output
`before`. The base URL is `endpoint('CLOUDFLARE_API_URL', 'https://api.cloudflare.com/client/v4')`, so tests point it
at a local stand-in.

### 2. Promote it back, then confirm (AC2)

`scripts/pages-rollback.mjs <project> <id>` makes ONE `POST …/deployments/<id>/rollback` and no list read, then ONE
`GET` of the project; it succeeds only when `canonical_deployment.id` is `<id>`, and otherwise exits 1 naming what is
live. `rollback.yml`'s "Promote it" step calls the same script (its inline curl goes), so the manual and automatic
rollbacks share the one promote.

### 3. The rollback job (AC2, AC3)

In `deploy-prod.yml`:

```yaml
rollback-prod:
  name: Roll prod back to the deployment before this release
  needs: [deploy-prod, smoke-and-verify]
  if: ${{ !cancelled() && needs.deploy-prod.result == 'success' && needs.smoke-and-verify.result == 'failure' }}
  environment: { name: prod-autorollback, url: https://shyden.co.uk }
  timeout-minutes: 5
```

- **Not a bare `failure()`** (AC2's wording): `failure()` is true when any ancestor job failed, including a
  `deploy-prod` refused at its approval or failing its build, which changed nothing live. Rolling back then would
  promote a deployment that is already live, or, with `before` unset, fail. The condition names each result.
- **`!cancelled()`**: a manual `rollback.yml` cancels this run (the shared `shyden-prod-publish` lock); the automatic
  one must then stay out of its way. The job runs inside the same run, so it already holds that lock.
- **Its environment, `prod-autorollback`**, accepts `main` alone and has no reviewer: the operator's 2026-10-13 choice,
  the second unattended exception beside `prod-cron` (global rule updated, §7). It holds the prod Pages token and
  account id. Creating it is the operator's (administration). Until it exists, the first step fails closed naming the
  missing secret, exactly like `rollback.yml`'s "Check the secrets are set".
- Steps: check the secrets; checkout; setup-node; `node scripts/pages-rollback.mjs shyden-site "$BEFORE"`, with
  `BEFORE` from `needs.deploy-prod.outputs.before` through `env:` (no expression inside `run:`). No `npm ci`: the
  scripts import nothing from `node_modules`.

`deploy-dev.yml` gains `rollback-dev`, the same job on `[deploy-dev, verify-dev]`, environment `dev`, project
`shyden-site-dev`. A guard pins that the two jobs' steps are identical apart from the project name and environment.

### 4. The notice for every failed run (AC4, ruling 2)

`src/lib/deploy-failure.ts` and `scripts/deploy-failure.mjs` take the pipeline from the workflow (`PIPELINE=dev` or
`prod`) instead of assuming dev. Per pipeline: the ref it reports for (`develop` / `main`), the title
(`The dev deploy failed: dev is behind develop` stays; prod gets `A production release failed`), the opening sentence
and the closing instruction. Dedupe stays: a failure while a notice of the same title is open comments on it.

`deploy-prod.yml` gains `report-failure` (needs every job, `if: always()`, `contents: read`, `actions: read`,
`issues: write`, no environment), like dev's. `NEEDS` now carries the rollback job's result and `before`, and the
body adds a **Rollback** section:

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
records `before` and deploys, `verify-dev` fails, `rollback-dev` promotes `before`, and `report-failure` opens the
notice with the Rollback section. Read: the job results by name, `canonical_deployment` back to `before` (the job's own
confirm line), the issue's body, and the time from `verify-dev`'s end to the confirm (the "within a minute" figure,
quoted on the ticket). A second PR removes the planted test; develop's next deploy is green and `dev-verified`
returns. No switch stays in any workflow.

### 6. Tests (AC6)

- **Unit** (`tests/unit/pages.test.ts`, `deploy-failure.test.ts`): the canonical-id parse (absent, wrong shape, good);
  the confirm; notice text per pipeline and per rollback outcome; pipeline settings refused when unknown. One test
  per case, RED first against stubs.
- **Integration** (`tests/integration/pages-scripts.test.ts`, `deploy-failure-script.test.ts`): each script against a
  local stand-in Cloudflare that records requests: `pages-live` makes one GET; `pages-rollback` makes exactly one POST
  to `/deployments/<id>/rollback` then one project GET, never a list; a non-2xx, a `success: false`, and a canonical
  that did not move each exit 1 naming it; no token in the output. The prod notice end to end against the stand-in
  GitHub.
- **Guards** (`pipeline-wiring`): the rollback jobs' `needs`, exact `if`, environment names; `prod-autorollback` read
  from the API as `main`-only with no reviewer (integration, as `prod-rollback` is); `before` handed through `env:`;
  `pages-live` runs before `npm ci` in both deploy jobs; `rollback-dev` and `rollback-prod` steps equal
  modulo project/environment; `report-failure` needs every job in `deploy-prod.yml`; `rollback.yml` promotes through
  the script. Each mutation-verified both ways, floors recorded.

### 7. Rules and docs

- `~/.claude/CLAUDE.md` (Branching, "Every path to production"): the ONE exception becomes two, naming the automatic
  rollback's environment (main only, promote-only job, operator choice 2026-10-13); the reference file gets the
  history. Global, because the rule is global.
- Repo `CLAUDE.md`, Releasing: what happens when a release fails its live check, and what the notice asks.
- The operator's steps, asked as soon as this spec is approved: create `prod-autorollback` (deployment branches: `main` only; no
  reviewer; secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for the prod account). The guard reading the
  environment goes red until it exists, so asking early keeps it off the PR's critical path.

## Out of scope

- Rolling back when the deploy job itself fails part-way (`wrangler` erroring after it promoted): the notice says to
  check the live site; a measured case would get its own ticket.
- Changing who may dispatch `deploy-dev.yml` (#769).

## Risks

- A live check that fails for a reason outside the release (Cloudflare, GitHub runners) rolls back a good release.
  Accepted by the operator's choice; the notice names the failing check and its error so he can redeploy.
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
