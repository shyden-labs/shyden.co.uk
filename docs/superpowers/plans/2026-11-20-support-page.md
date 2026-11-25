# Support Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/support` in five languages and an English `/support/ticket`. Both embed ShyDesk's `<shydesk-support>`, and the ShyDesk host is picked when the site is built.

**Architecture:** One `SupportPage.astro` component, rendered by `src/pages/support.astro` (en) and `src/pages/[locale]/support.astro`. A `TicketPage.astro` is rendered by `src/pages/support/ticket.astro`. A pure module `src/lib/shydesk.ts` resolves the embed origin from `PUBLIC_SHYDESK_URL`. Copy lives in `site.ts`, and the `--shydesk-*` properties map onto palette tokens.

**Tech Stack:** Astro, TypeScript, Vitest (unit), Playwright (e2e, dev-sanity).

**Spec:** `docs/superpowers/specs/2026-11-20-support-page-design.md`

## Global Constraints

- Live host: `https://shydesk.dpdns.org`. Dev host: `https://shydesk.shydesk-non-prod.workers.dev`. Product: `shyden-co-uk`.
- Embed: `<script src="<host>/embed.js" defer></script>`, a classic script and never `type="module"`.
- English copy (approved): heading `Support`, line `Questions, problems or ideas about any Shyden Labs product? Send a message here and the reply comes by email.`
- No "we/us/our/I/me/my/solo" in public copy.
- zh/vi/th are drafted by DeepL and id is written by hand. Every line gets a Google Cloud Translation read-back before commit, with a per-line writer/reader table posted on #1032.
- Mobile-first: no horizontal scroll at 320px or wider, 44px touch targets, WCAG AA in both themes.
- Unit tests start no process and reach no network. Only unit, format and typecheck run on the laptop. E2e, guards and integration run in CI via the PR.
- Strict TDD: each test is run red before its code. A slip means starting again.
- Commits say `Refs #1032`, never a closing keyword. Squash into `develop`.

## Review Focus

1. **Turnstile under automation on dev.** The real-input journey must pass the Turnstile check, or fail naming Turnstile, never skip. If Turnstile refuses automation, stop and ask Shyden and ShyDesk (Task 5).
2. **The ticket page opened without `#t=`.** The ShyDesk piece handles it. The page must still render its heading and pass the page walk (Task 3 page-walk coverage).
3. **`PUBLIC_SHYDESK_URL` with a trailing slash or a path.** `shydeskOrigin` normalises to the origin, so `embed.js` never gets `//embed.js` (Task 1).
4. **A production build with the variable unset** must name the live host and contain no `workers.dev` (Task 4).
5. **Dark theme.** The `--shydesk-*` values follow the theme tokens, not literals, so the form stays AA when the theme flips (Task 3 contrast).

---

### Task 1: The ShyDesk host for each build

**Files:**
- Create: `src/lib/shydesk.ts`
- Test: `tests/unit/shydesk.test.ts`

**Interfaces:**
- Produces:
  - `SHYDESK_LIVE = 'https://shydesk.dpdns.org'`
  - `SHYDESK_PRODUCT = 'shyden-co-uk'`
  - `shydeskOrigin(configured: string | undefined): string`
  - `embedScriptUrl(origin: string): string`, which returns `${origin}/embed.js`

- [ ] **Step 1: Write the failing tests:**
  - `shydeskOrigin(undefined)` gives `'https://shydesk.dpdns.org'`.
  - `shydeskOrigin('')` gives the same.
  - `shydeskOrigin('https://shydesk.shydesk-non-prod.workers.dev/')` gives the origin without the slash.
  - `shydeskOrigin('https://x.example/some/path')` gives `'https://x.example'`.
  - `shydeskOrigin('http://x.example')` throws `/https/`.
  - `shydeskOrigin('not a url')` throws.
  - `embedScriptUrl('https://shydesk.dpdns.org')` gives `'https://shydesk.dpdns.org/embed.js'`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/shydesk.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** with `new URL(...).origin`, refusing a protocol other than `https:`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Mutate once (drop the https check) and watch the http test go red. Restore it.
- [ ] **Step 6:** Commit with `git add src/lib/shydesk.ts tests/unit/shydesk.test.ts` and the message "The support page knows ShyDesk's host for each build (Refs #1032)".

### Task 2: Copy in five languages

**Files:**
- Modify: `src/lib/i18n/site.ts` (add `support: { title, description, heading, intro, ticketTitle, ticketHeading }` to `siteEn` and to each locale object)
- Test: the existing `tests/unit/i18n.test.ts`, `message-parity`, `locale-fallbacks` and `dead-copy` (dead-copy fails until Task 3 renders the copy, so commit this task together with Task 3)

**Interfaces:**
- Produces: `getSiteStrings(locale).support.{title, description, heading, intro, ticketTitle, ticketHeading}`

- [ ] **Step 1:** Add the English values:
  - `title: 'Support — Shyden'`
  - `description: 'Send Shyden Labs a question, a problem or an idea about any product.'`
  - `heading: 'Support'`
  - `intro`: the approved line
  - `ticketTitle: 'Your support conversation — Shyden'`
  - `ticketHeading: 'Your support conversation'`

  `description`, `ticketTitle` and `ticketHeading` were approved by Shyden on 2026-11-20 (AskUserQuestion).
- [ ] **Step 2:** Run `npm run typecheck`. Expected: FAIL, because id/zh/vi/th lack `support` (`Catalogue`/`SiteStrings` typing).
- [ ] **Step 3: Draft the other locales:**
  - zh, vi and th go through DeepL (`src/lib/i18n/translate.ts` pipeline).
  - id is written by hand.
  - Run the Google read-back on every line (`read-back.ts`) and save the writer/reader table to `.superpowers/sdd/1032/read-back.md`.
- [ ] **Step 4:** Run `npm run typecheck`. Expected: PASS.

### Task 3: The pages

**Files:**
- Create:
  - `src/components/pages/SupportPage.astro`
  - `src/components/pages/TicketPage.astro`
  - `src/pages/support.astro`
  - `src/pages/[locale]/support.astro` (copy the `classroom-groups.astro` route pattern)
  - `src/pages/support/ticket.astro`
- Modify:
  - `tests/site-pages.ts`: add `HEADING_FOR['/support']` and `TITLE_FOR['/support']`.
  - `tests/e2e/checks/served-page.ts`: add a `'/support'` inventory entry and one for `/support/ticket`. The entry for an external classic `defer` script in `<head>` or body uses whatever label the file's classifier yields, so read the classifier first.
  - `astro.config.*` sitemap `filter`: exclude `/support/ticket/`.
  - The e2e path list in `tests/e2e/published-paths.ts` if `sitePaths()` does not see nested pages; it doesn't, so add `/support/ticket` the way `docsPaths` adds the API docs.
- Test:
  - `tests/e2e/page-walk.spec.ts` (picks up `/support` per locale through `sitePaths()`)
  - `tests/e2e/support.spec.ts`
  - `tests/guards/contrast.test.ts` (new token pairs, if the guard enumerates pairs by usage)

**Interfaces:**
- Consumes: `shydeskOrigin`, `embedScriptUrl` and `SHYDESK_PRODUCT` (Task 1), and `support.*` strings (Task 2).
- `SupportPage.astro` props: `{ locale: Locale }`.
- `TicketPage.astro` has no props and is English.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/support.spec.ts`, as one journey per page with soft assertions:
  - **`/support` in each locale** (one test per locale):
    - The `h1` reads `support.heading`.
    - The intro paragraph reads `support.intro`.
    - Exactly one `shydesk-support` exists, with `product="shyden-co-uk"`, `view="contact"` and `lang=<locale>`.
    - Exactly one `script[src$="/embed.js"]` exists, with `defer`, no `type="module"`, and a src origin equal to `https://shydesk.dpdns.org` (the e2e builds production).
  - **`/support/ticket`:**
    - The `h1` reads `ticketHeading`.
    - `shydesk-support[view="ticket"]` is present.
    - `meta[name=robots][content=noindex]` is present.
    - The page is not in `/sitemap-0.xml`.
  - In `site-pages.test.ts`, the `HEADING_FOR` coverage test goes red on its own once the page file exists.
- [ ] **Step 2:** Run `npx vitest run tests/unit/site-pages.test.ts`. Expected: FAIL, `/support` has no heading. The e2e stays CI's: push the branch and open the PR as a draft so CI shows red.
- [ ] **Step 3: Implement the pages:**
  - Use `BaseLayout` with `title`/`description`. The ticket page passes `noIndex` and `localised={false}`.
  - Use `<style is:global>` for `shydesk-support { --shydesk-font: var(--font-body); --shydesk-text: var(--ink); --shydesk-background: var(--surface); --shydesk-accent: var(--accent); --shydesk-accent-text: var(--on-accent); --shydesk-border: var(--border-strong); --shydesk-error: var(--danger); display: block; }`. It is global because the element's inherited properties must apply whatever scope stamps it.
  - The script tag is `<script is:inline src={embedScriptUrl(origin)} defer></script>`, so Astro does not bundle it.
  - `origin = shydeskOrigin(import.meta.env.PUBLIC_SHYDESK_URL)`.
- [ ] **Step 4:** Run `npm run test:unit` and `npm run typecheck`. Expected: PASS. Push, and CI's e2e and page walk go green on all three engines.
- [ ] **Step 5:** Commit Tasks 2 and 3 together: "The support page and the ticket page, in five languages (Refs #1032)".

### Task 4: Dev gets the dev host; production never names workers.dev

**Files:**
- Modify:
  - `.github/workflows/deploy-dev.yml`: the build step's `env` gets `PUBLIC_SHYDESK_URL: https://shydesk.shydesk-non-prod.workers.dev`.
  - `playwright.dev.config.ts`: its on-build `buildEnv` gets the same value.
- Create: `tests/guards/no-workers-dev-in-production.test.ts`, or a check in the existing dist guard family if one reads `dist/`. Read `tests/guards/` first and prefer adding to an existing reader.
- Test: `tests/guards/pipeline-wiring.test.ts` (add an assertion that the dev build step sets `PUBLIC_SHYDESK_URL` to exactly the dev host)

- [ ] **Step 1: Write the failing tests:**
  - **Guard:** every file under the production `dist/` contains no `workers.dev`. The population must be non-empty, so use `searched()` from `tests/source-files.ts`.
  - **Wiring:** `deploy-dev.yml`'s build env names `PUBLIC_SHYDESK_URL: https://shydesk.shydesk-non-prod.workers.dev`, and `deploy-prod.yml` sets no `PUBLIC_SHYDESK_URL`.
- [ ] **Step 2:** Watch each fail once:
  - Wiring: run before the yml edit.
  - Guard: build once with `PUBLIC_SHYDESK_URL=https://shydesk.shydesk-non-prod.workers.dev npm run build` into a scratch `dist`. Guards are CI's, so prove it red on a scratch commit pushed to the PR branch, then revert in the next commit before review. Alternatively, ask whether a single local guard run is allowed.
- [ ] **Step 3:** Edit both yml/config files.
- [ ] **Step 4:** CI green. Commit: "Dev's support page loads Non-Prod ShyDesk; production never names workers.dev (Refs #1032)".

### Task 5: A real message reaches dev ShyDesk

**Files:**
- Modify: `tests/dev/dev-sanity.spec.ts`
- Create: a small photo fixture `tests/fixtures/support-photo.png`, under 50 KB and our own image

- [ ] **Step 1: Write the test** `'a message typed on /support reaches dev ShyDesk and shows in its thread'`, tagged `@deployed-only` with the reason "needs dev ShyDesk, which allows only https://dev.shyden.co.uk as an origin":
  - Pick the category with the real keyboard or pointer.
  - Type the email `support-test+<run id>@shyden.co.uk`, the subject and the message with `keyboard.type`.
  - Attach the photo with `page.waitForEvent('filechooser')` after a real click on the attach control.
  - Pass Turnstile.
  - Send with a real click.
  - Expect the confirmation and the thread to contain the message text.

  Locate inside the shadow root through Playwright's built-in piercing locators.
- [ ] **Step 2:** It runs only after the dev deploy. Its first run after merge is its red-to-green proof. Before merge, prove it red against the current dev site, which has no `/support`, by dispatching `deploy-dev.yml` on the PR branch. Anything can deploy to dev.
- [ ] **Step 3:** If Turnstile blocks the automated browser, stop: tell Shyden and send ShyDesk the error text (Review Focus 1).
- [ ] **Step 4:** Commit: "A real message from the support page reaches dev ShyDesk (Refs #1032)".

### Task 6: Close-out

- [ ] Run the PR's CI. Every job is read by name and green on the head SHA. Squash-merge into `develop`.
- [ ] On the `deploy-dev.yml` run: the Task 5 journey passes and `dev-verified` is on the merge commit.
- [ ] Post on #1032:
  - every AC with its evidence, "N of N"
  - the copy table for Shyden's approval of `description` and `ticketTitle`/`ticketHeading`
  - the production half waiting on live ShyDesk (shyden-labs/shydesk#19)
