# shyden.co.uk

The **Shyden Labs** website, plus two free tools it hosts.

Live at [shyden.co.uk](https://shyden.co.uk). Staged at `dev.shyden.co.uk`, which
sits behind Basic auth and disallows crawling.

## What's on the site

| Route               | What it is                                                                             | Ships JS |
| ------------------- | -------------------------------------------------------------------------------------- | -------- |
| `/`                 | Company homepage                                                                       | **no**   |
| `/glory-points`     | Glory Points Calculator — a client-side companion tool for the third-party YeeTalk app | yes      |
| `/classroom-groups` | Classroom Group Creator — builds fair random groups from a class list, for teachers    | yes      |
| `/404`              | Not-found page                                                                         | no       |

Every route also exists in four more languages: `/id/` (Bahasa Indonesia),
`/zh/`, `/vi/` and `/th/`. Locales are declared in `src/lib/i18n/locales.ts`;
copy lives in `src/lib/i18n/{en,id,zh,vi,th,site}.ts`.

**The homepage fetches no JavaScript**: its one script, the theme script, is
inline (#142), and `deploy-prod.yml` fails the release if the homepage ever
fetches one.

## Tech

- **[Astro](https://astro.build)** static site generator.
- **Cloudflare Pages** hosting, deployed by `wrangler` from CI.
- Fonts self-hosted via `@fontsource`; sound effects self-hosted in
  `src/assets/sfx/`. **No third-party requests at runtime.**
- Node **24** (`.nvmrc`). Formatting by Prettier.

## Development

    npm install
    npm run dev          # http://localhost:4321
    npm run build        # → dist/
    npm run format       # prettier --check .

### Dependencies allowed to run code at install time

npm runs a dependency's own `install`/`postinstall` scripts during `npm ci`, as
you, with your environment — in CI, that means with the repo's secrets in reach.
`allowScripts` in `package.json` is the list of packages permitted to do it.
Three are, and each genuinely needs it:

| Package    | Script        | Why it needs one                                                                                                                |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `esbuild`  | `postinstall` | Downloads the prebuilt binary for your platform. Astro's build cannot run without it.                                           |
| `fsevents` | `install`     | Compiles the native macOS file-watching binding Vitest and the dev server use for fast reloads. Darwin-only; a no-op elsewhere. |
| `workerd`  | `postinstall` | Installs the Cloudflare Workers runtime `wrangler` runs Pages Functions in, locally and in the `functions` tests.               |

Entries are pinned to a version (`esbuild@0.28.1`, not `esbuild`) for the same
reason actions are pinned to a SHA rather than a tag: a grant to a _name_ is a
grant to every future release of that package, approved by nobody. A Dependabot
bump therefore fails `tests/unit/install-scripts.test.ts` until someone
re-approves — that failure is the review, and it is the point.

    npm install-scripts approve esbuild    # then read the diff

**Read the diff every time.** On npm 11.19 `npm install-scripts approve
--dry-run` edits `package.json` regardless of the flag.

## Testing

| Command                | What it covers                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`    | Vitest — pure logic, i18n completeness, pipeline wiring                                                     |
| `npm run test:e2e`     | Playwright, 6 projects (five browsers plus `content`), against a built `dist/`                              |
| `npm test`             | both of the above                                                                                           |
| `npm run test:devices` | Real-device gauntlet — emulated + real Android Chrome (CDP) + real iOS Safari (WebDriver) against one build |
| `npm run dashboard`    | Live read-only view of a gauntlet run at http://localhost:4322                                              |
| `npm run test:ios`     | iOS-specific Vitest config                                                                                  |

Two further Playwright suites verify the **deployed** sites:

- `tests/dev/dev-sanity.spec.ts` via `playwright.dev.config.ts` — verifies
  `dev.shyden.co.uk` after each dev deploy.
- `tests/prod/prod-sanity.spec.ts` via `playwright.prod.config.ts` — verifies
  production in a real browser before `prod-verified` is posted.

Every pull request also runs both against its own build first
(`npm run test:sanity`, the `sanity-on-build` job, #335). Only the tests tagged
`@deployed-only`, which need a Pages Function or a real database, wait for the
deploy.

The device gauntlet does **not** run in CI (no phones there), and does not cover
Brave or Firefox on Android. It proves exactly one iOS engine: every iOS browser
is WKWebView.

## Branching and release

`develop` is the default branch. Nothing reaches production without being
deployed to dev and verified there first.

```
feature/xxx ──PR──▶ develop ──push──▶ deploy-dev ──▶ dev.shyden.co.uk
                 │                    gate                  │
            build-and-test            deploy                │
            + visual                  dev-sanity            │
            + closing-keywords        post dev-verified ◀───┘
             (required)                   on that SHA
                                               │
develop ──promotion PR──▶ main   requires: build-and-test + visual + dev-verified
                           │
                         push ──▶ deploy-prod  approval gate → deploy →
                           │                    smoke → browser check →
                           │                    post prod-verified
                           └──▶ release-tag     tag + GitHub release
```

| Branch              | Required checks                                  | Direct push |
| ------------------- | ------------------------------------------------ | ----------- |
| `develop` (default) | `build-and-test` + `visual` + `closing-keywords` | no          |
| `main`              | `build-and-test` + `visual` + `dev-verified`     | no          |

The deploy gate (`scripts/deploy-gate.mjs`) reads the same pull-request checks,
`build-and-test` and `visual`, off the merged head before it deploys to dev.

`dev-verified` is a **commit status**, so it is bound to a SHA rather than a
branch. A promotion PR's head _is_ develop's head, which is why the status
carries across with no copying step.

`develop` must not require `dev-verified` — that status is produced _by_ pushing
to develop, so requiring it would deadlock.

### Workflows

| File              | Trigger                               | Does                                                                                 |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `ci.yml`          | every pull request, or called         | `build-and-test` (checks, 8 e2e shards, `sanity-on-build`, `functions`) and `visual` |
| `deploy-dev.yml`  | push to `develop`, or manual dispatch | gate (or, dispatched, the suite) → deploy dev → dev-sanity → post `dev-verified`     |
| `deploy-prod.yml` | push to `main`                        | approval gate → deploy prod → smoke → browser check → post `prod-verified`           |
| `release-tag.yml` | push to `main`                        | tags and creates the GitHub release                                                  |
| `rollback.yml`    | manual dispatch                       | rolls production back to a previous Cloudflare deployment                            |

`deploy-dev.yml` can be dispatched on any branch to put it on dev, but the
`dev-verified` status is only posted for `develop` — otherwise a feature branch
could earn the status main's protection requires and skip integration entirely.

A pull request that changes only documentation (`scripts/docs-only.mjs`, #582)
skips the e2e shards, `sanity-on-build` and `functions`; `build-and-test` still
runs and passes only when exactly those were skipped and everything else
succeeded.

`tests/unit/pipeline-wiring.test.ts` holds this shape up. It exists because the
dev sanity suite and its config were both written and then referenced by nothing
in CI, so "deployed to dev" only meant `wrangler` had not errored.

## Hosting

- Cloudflare Pages project `shyden-site`. Build: `npm run build`, output `dist`,
  Node 24.
- Custom domain `shyden.co.uk`; `shytalk.shyden.co.uk` points at ShyTalk.
- The outbound ShyTalk link is env-derived (`PUBLIC_SHYTALK_URL`) so a dev build
  never links to production. Both sanity suites assert this.

## Conventions

`CLAUDE.md` is the working agreement — mobile-first, TDD, WCAG AA, and a set of
hard-won notes about failures this codebase has actually shipped (JSX whitespace,
flex eating authored spaces, scoped styles missing runtime DOM, intrinsic
`min-width` forcing horizontal scroll). Read it before changing layout or copy.
