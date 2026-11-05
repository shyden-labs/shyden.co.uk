# Translation reports (#97) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** APPROVED 2026-09-26, self-approved after review pass 7 found
nothing (operator rule of 2026-09-24; section "Review log" at the end).

**Goal:** A visitor on any beta-locale page can report a specific bad
translation from the footer, and the report lands in a D1 table the operator
reads and deletes once it has been dealt with.

**Architecture:** One pure, site-safe module (`src/lib/report.ts`) owns the
page table, the reportable strings, quote matching and the endpoint logic. The
footer imports it at build time for its `<datalist>`, and two thin Pages
Functions (`functions/api/report/index.js`, `health.js`) import it at run
time, so what is offered and what is accepted cannot drift apart. The homepage
posts a plain form and lands on a `:target` status. The two tool pages enhance
the same form with `fetch`, so a typed roster survives.

**Tech Stack:** Astro 7 (static), Cloudflare Pages Functions on workerd, D1,
wrangler (exact-pinned devDependency), Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-23-translation-reports-design.md`
(APPROVED 2026-09-25 after 7 review passes). Every section number below is
that spec's.

## Global Constraints

- Beta locales are derived with `isBetaLocale(lang)`, never listed. English
  never shows the form (spec 3.1).
- Field limits: `quote` 1–1000 UTF-16 code units and not blank;
  `suggestion` and `note` 0–1000. Lengths are counted **after** folding CRLF to
  LF and **before** normalisation (6.1).
- The body cap is **64 KiB** (65,536 bytes). A body of exactly that many bytes
  passes check 4, and one more byte answers `413` (6.1).
- Check order is exactly 1 → 9 of spec 6.1. Check 5 (`locale`/`page`) comes
  **before** the honeypot (6).
- JSON mode: `sent` 200 (the honeypot decoy too), `not-found` 422, `rejected`
  400, check 5 400, `failed` 503. Checks 1–4 keep 405/403/415/413 (6.1).
- Every endpoint response carries `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff` (6.1).
- Redirect mode answers `303` with `Location` = `localisePath(route, locale)`
  + `#report-<outcome>`, built only from the checked `locale` and `page`.
- On `failed`, the log line carries the error's name and message only. It
  never carries the quote, suggestion, note or any header (6.3).
- No personal data: no IP, cookie or user agent stored (8).
- The English copy is the operator-approved table in spec 3.5, verbatim.
- Status paragraphs carry `role="status"` and `tabindex="-1"`, and sit outside
  the `<details>` (3.2, 3.4).
- The homepage gains no script. Its inventory stays the inline theme script
  alone (`theme-script.spec.ts`) (3.3).
- Hit areas are at least 44 × 44 px, colours come from palette tokens only, and
  every input has `width: 100%` and `box-sizing: border-box` (3.4).
- The honeypot is visually hidden with `clip-path` in a 1px box. It uses no
  `display: none` and no absolute or off-screen positioning (3.2).
- No new npm package except `wrangler`, the operator's decision of
  2026-09-23 (spec section 2). The version is exact-pinned (`4.x.y`, no caret).
- Never create a wrangler config at the repository root. Pages would take it as
  both projects' source of truth (11, assumption 2).
- Never type a backslash-u escape into a file when the bytes matter. Build the
  character in code (`String.fromCharCode(0x2026)`), because the Write and
  Edit tools decode a typed escape (standing rule, 2026-09-15).
- Every new export starts as a stub that throws `new Error('not implemented')`.
  Every new test is seen failing on its own assertion, and any test that
  passes against a stub is a finding (10).
- Mutation runs execute the **whole** file, never a `-t` filter (10).

### Clarifications this plan makes (the spec is silent on them)

1. **Stored key names** follow the repo's existing unit-key convention
   (`back-translate.ts`, `label-check.ts`): site copy is `site.<path>`
   (`site.footer.registered`) and tool copy is its bare catalogue path
   (`errors.NO_STUDENTS`, `themes.animals[3]`). `renderedOn()` already reads
   keys in this form.
2. **Control characters.** Spec 10 lists "control characters" among check 7's
   boundaries but names no verdict. Check 7 answers `rejected` when any field
   holds a code point below U+0020 other than TAB and LF, or one in
   U+007F–U+009F. No browser form can produce one, and a stray NUL makes a
   D1 console row unreadable.
3. **JSON bodies.** Checks 1–4 answer with an empty body in both modes. Check 5
   in JSON mode answers `400 {"outcome":"rejected"}`, so the tool-page script
   shows the `rejected` status.
4. **An absent honeypot field** counts as empty.
5. **Rule 3 is matched without a regular expression.** A pattern like
   `^a.+b.+c$` backtracks polynomially on a 1000-unit quote. An anchored
   literal scan is exact for literal runs separated by non-empty wildcards,
   and it is linear.
6. **Rule 3 needs fixed wording.** A form whose literal runs hold fewer than
   2 characters in all (a message that is only `{name}`, say) would match
   every quote as "a whole rendered message", which would make check 8
   accept anything on that page. Rule 3 applies only to a form whose literal
   runs, joined and normalised, are at least 2 characters long, counted the
   way rule 2 counts.

## Review Focus

These are the inputs the spec implies but none of its tests exercises, most
likely first. Each one has a test in the owning task.

1. **A tool-page visitor double-clicks "Send report".** Exactly one report is
   stored, because the button is disabled while a submission is in flight.
   Task 10, `a double click stores one report`.
2. **A tool page gets a response it cannot read**, such as a 403, a 413, an
   HTML error page or a network failure. The page shows `failed` and throws
   nothing. Task 9: the `outcomeOf` unit tests (403, HTML, a foreign body),
   and the e2e test against the preview, whose answer to a POST is not ours.
3. **A Thai quote of one grapheme cluster that is three code points**
   (ที่). Rule 2 needs 2 graphemes, so it is `not-found`, and two clusters
   match. Task 5.
4. **Chinese fullwidth quotation marks** (U+FF02, U+FF07) and a modifier
   apostrophe (U+02BC) fold like the typographic ones, on both the quote and
   the forms, so the kind of quotation mark never decides a match. Task 5's
   normalise test.
5. **A second submission on a tool page after a first outcome.** Exactly one
   status is visible, and it is the new one, including when the first
   arrived by the plain POST's fragment (a click before the script loaded).
   Task 10, `a later outcome replaces the earlier one` and
   `an outcome in place supersedes the one a fragment shows`.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `package.json`, `package-lock.json` | `wrangler` exact-pinned devDependency; `test:functions` script | 1, 10 |
| `.github/workflows/deploy-dev.yml`, `deploy-prod.yml` | deploy through the locked `npx wrangler` | 1 |
| `tests/unit/pipeline-wiring.test.ts` | the no-global-wrangler guard; the `functions` job guard | 1, 10 |
| `src/lib/catalogue-leaves.ts` | the one catalogue walk, moved from `tests/` (site-safe now) | 3 |
| `tests/catalogue-leaves.ts` | re-exports the walk for every existing test importer | 3 |
| `tests/unit/one-home.test.ts` | the walk's home moves to `src/lib/catalogue-leaves.ts` | 3 |
| `src/lib/i18n/site.ts` | the `report` copy section, five locales | 4 |
| `src/lib/i18n/label-check.ts` | `report: CHROME` in `SITE_PAGES` | 4 |
| `tests/unit/report-copy.test.ts` | the approved English, pinned literally | 4 |
| `src/lib/i18n/index.ts` | `rawCatalogue(locale)` export | 5 |
| `src/lib/report.ts` | page table, reportable strings, normalise, match, endpoint, health | 5, 6 |
| `tests/unit/report.test.ts` | strings, forms, normalisation, matching | 5 |
| `tests/unit/report-endpoint.test.ts` | checks 1–8, `failed`, logging, health, schema; the migration and plumbing pins | 6, 7 |
| `migrations/0001_reports.sql` | the `reports` table (spec 7) | 7 |
| `functions/api/report/index.js`, `health.js` | ESM plumbing only | 7 |
| `docs/runbooks/translation-reports.md` | the D1 console statements and the public-ticket rule | 7 |
| `tests/unit/cli-only.test.ts` | liveness: the walk reaches the new Function | 7 |
| `src/components/Footer.astro` | the disclosure, the form, the status paragraphs, CSS | 8 |
| `tests/e2e/report-presence.spec.ts` | presence, datalist equality, `:target` status and focus (non-acting) | 8 |
| `tests/e2e/report-form.spec.ts` | keyboard, 44px, contrast, 320px, tool-page submit (acting) | 8, 9 |
| `src/scripts/report-form.ts` | `enhanceReportForm`, `outcomeOf`, `showStatus` | 9 |
| `src/scripts/glory-points.ts`, `classroom-groups.ts` | call `enhanceReportForm` when the form exists | 9 |
| `tests/unit/report-form.test.ts` | `outcomeOf` against real `Response` objects | 9 |
| `playwright.functions.config.ts` | the Functions-runtime project | 10 |
| `tests/functions/local.mjs`, `serve.mjs`, `wrangler.toml` | local server, local D1, row reader | 10 |
| `tests/functions/report.spec.ts` | real submissions on workerd | 10 |
| `tests/report-health.ts` | `expectReportsBound`, the health assertion's one home | 10, 12 |
| `.github/workflows/ci.yml` | `functions` job; `build-and-test` needs it | 10 |
| `tests/e2e/report-completeness.spec.ts` | rendered-DOM completeness | 11 |
| `tests/dev/dev-sanity.spec.ts`, `tests/prod/prod-sanity.spec.ts` | `@deployed-only` health and submission | 12 |
| `tests/e2e/__screenshots__/home-id-*-linux.png` | recaptured baselines | 13 |

---

## Before Task 1: ask the operator for the Cloudflare setup

Dev verification calls `/api/report/health` and fails closed without a
binding, so the merge waits on spec section 9's steps 1–2. Ask now, so the
setup is done by the time the PR is ready.

- [ ] Send a `PushNotification` and ask Shyden with `AskUserQuestion`. The
      question text carries the steps themselves, because he does not see prose
      outside it:
      "#97 needs two D1 databases and a binding before its PR can merge.
      (1) `npx wrangler d1 create shyden-reports-dev` and
      `npx wrangler d1 create shyden-reports`. (2) Once `migrations/0001_reports.sql`
      is on the branch (Task 7), run
      `npx wrangler d1 execute <name> --remote --file migrations/0001_reports.sql`
      for each. (3) Pages → `shyden-site-dev` → Settings → Bindings → D1 →
      variable `REPORTS` → `shyden-reports-dev`, and the same for
      `shyden-site` → `shyden-reports`. Steps 3–4 of the spec (the WAF rule, and
      confirming the Workers plan) come before the prod release. Will you do
      steps 1–3 now, or once the migration is pushed?"
      Options: "Now; I'll apply the migration when it's pushed" /
      "Once the migration is pushed". Continue with Task 1 either way.

---

### Task 1: wrangler is an exact-pinned devDependency that the deploys use

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `.github/workflows/deploy-dev.yml:130-136`, `.github/workflows/deploy-prod.yml:70-76`
- Test: `tests/unit/pipeline-wiring.test.ts` (new `describe` at the end)

**Interfaces:**
- Produces: `npx wrangler` resolves to the locked copy in every later task.

- [ ] **Step 1: Write the failing guard.** Append to
      `tests/unit/pipeline-wiring.test.ts`. `allWorkflows`, `DEPLOY_COMMAND`,
      `searched` and `readFileSync` are already in scope there.

```ts
/**
 * wrangler comes from the lockfile (#97, spec section 9).
 *
 * Both deploy workflows ran `npm install -g wrangler@4`, so any 4.x could
 * arrive at deploy time and bundle the Pages Functions differently from the
 * last deploy of the same commit. The locked copy is what the tests ran, and
 * Dependabot's npm ecosystem moves it as a reviewable diff.
 */
describe('wrangler comes from the lockfile (#97)', () => {
  it('is an exact-pinned devDependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('no workflow installs it globally', () => {
    const workflows = allWorkflows();
    const globalInstalls = workflows
      .filter(({ text }) =>
        /\bnpm\s+(?:install|i)\b[^\n]*(?:\s-g\b|\s--global\b)[^\n]*\bwrangler\b/.test(
          text,
        ),
      )
      .map(({ name }) => name);
    expect(
      searched(globalInstalls, {
        of: workflows.map(({ text }) => text),
        what: 'workflow texts',
      }),
    ).toEqual([]);
  });

  it('every deploy runs the locked copy', () => {
    const deploys = allWorkflows().flatMap(({ name, text }) =>
      text
        .split('\n')
        .filter((line) => line.includes(DEPLOY_COMMAND))
        .map((line) => `${name}: ${line.trim()}`),
    );
    expect(
      searched(
        deploys.filter((line) => !line.includes(`npx ${DEPLOY_COMMAND}`)),
        { of: deploys, what: 'wrangler deploy lines' },
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it red.**
      Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
      Expected: FAIL, three tests. `devDependencies.wrangler` is `undefined`;
      `globalInstalls` lists `deploy-dev.yml` and `deploy-prod.yml`; the deploy lines
      read `wrangler pages deploy …` with no `npx`.

- [ ] **Step 3: Install and pin.** Take the version from the last line of
      `npm view wrangler@4 version` (4.141.0 on 2026-09-26), then:
      Run: `npm install --save-dev --save-exact wrangler@<version> 2>&1 | tail -20`
      Read the whole tail. If npm reports a lifecycle script blocked by
      `allowScripts`, run `npx wrangler --version`. When it fails, add that
      exact `name@version: true` entry to `package.json`'s `allowScripts` and
      reinstall; grant only the scripts wrangler needs to run. Then run
      `command grep -rn "allowScripts" tests/unit` and satisfy any guard that
      reads the list.

- [ ] **Step 4: Switch both workflows.** In each deploy step, delete the
      `npm install -g wrangler@4` line and change
      `wrangler pages deploy dist …` to `npx wrangler pages deploy dist …`.
      Both jobs already run `npm ci` earlier (deploy-dev.yml:125,
      deploy-prod.yml:46), so the locked copy is present.

- [ ] **Step 5: Run it green, then the whole unit suite.**
      Run: `npx vitest run tests/unit/pipeline-wiring.test.ts` → PASS.
      Run: `npm run test:unit 2>&1 | tail -6` → all pass.

- [ ] **Step 6: Commit.**

```bash
git add package.json package-lock.json .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml tests/unit/pipeline-wiring.test.ts
git commit -m "build(deps): wrangler is an exact-pinned devDependency the deploys use (Refs #97)"
```

- [ ] **Step 7: Mutate both ways.** Put `npm install -g wrangler@4` back in
      `deploy-dev.yml`. Predict RED on `no workflow installs it globally`, run
      the whole file, and confirm. Restore with `git checkout -- .github/workflows/deploy-dev.yml`
      (HEAD is the green commit). Then change the pin to `^<version>`: predict
      RED on `is an exact-pinned devDependency`, confirm, and restore.

---

### Task 2: measure the six assumptions before building on them

Spec section 11 says to measure each assumption first. This is a throwaway
spike: nothing from it is committed except the Measurements table below.

**Files:**
- Create (throwaway, deleted in Step 7): `functions/api/spike.js`,
  `functions/api/spike-db.js`, `tests/unit/scratch-spike.test.ts`
- Create: `tests/functions/wrangler.toml` (kept if Step 3 uses it; Task 10
  commits it)
- Modify: this plan's "Measurements" table

**Interfaces:**
- Produces: the Measurements table, which Tasks 5, 7, 8 and 10 read to choose
  between each assumption's primary path and its fallback.

- [ ] **Step 1: A spike Function that exercises the bundle.** Create
      `functions/api/spike.js`:

```js
// THROWAWAY (#97 Task 2): deleted before any commit.
import { getSiteStrings, getStrings } from '../../src/lib/i18n/index';
import { parseMessage } from '../../src/lib/i18n/message';

export const onRequest = ({ request }) => {
  const thai = String.fromCharCode(0x0e17, 0x0e35, 0x0e48);
  const decomposed = String.fromCharCode(0x65, 0x0301);
  const graphemes =
    typeof Intl.Segmenter === 'function'
      ? [
          ...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(
            thai + thai,
          ),
        ].length
      : -1;
  return Response.json({
    site: getSiteStrings('vi').footer.registered,
    toolKeys: Object.keys(getStrings('vi')).length,
    parts: parseMessage('{n, plural, one {# a} other {# b}}').length,
    segmenter: typeof Intl.Segmenter,
    graphemes,
    nfcLength: decomposed.normalize('NFC').length,
    lower: 'I'.toLocaleLowerCase('vi'),
    origin: new URL(request.url).origin,
  });
};
```

- [ ] **Step 2: Serve it with no root config** (assumptions 1 and 2), in the
      background. `DEV_PASSWORD` is bound because `functions/_middleware.js`
      gates every non-prod hostname and fails closed without it:

```bash
npm run build > /dev/null 2>&1; echo build=$?
npx wrangler pages dev dist --ip 127.0.0.1 --port 8799 \
  --compatibility-date 2026-09-01 \
  --d1 REPORTS=00000000-0000-4000-8000-000000000097 \
  --persist-to .wrangler/functions-spike \
  --binding DEV_PASSWORD=functions-local > "$SCRATCH/pages-dev.log" 2>&1
```

      (Set `SCRATCH` to the session's scratchpad directory first, in the same
      command, since shell state does not persist between calls. Run the
      `pages dev` command with `run_in_background: true`.) Then
      `curl -s -u dev:functions-local http://127.0.0.1:8799/api/spike`.
      Record: did the bundle build (a `Compiled Worker successfully` line and
      no error in the log)? Did the JSON come back? Compare every field but
      `origin` with the same expressions run in Node, through a throwaway
      `tests/unit/scratch-spike.test.ts`. It imports the same modules, computes
      the same object, and writes it as JSON to `process.env.SPIKE_OUT`:
      `SPIKE_OUT="$SCRATCH/node.json" npx vitest run tests/unit/scratch-spike.test.ts`.
      Plain `node -e` cannot do this. Node 24 strips types but does not
      resolve the extensionless specifiers these modules use (`from './en'`),
      and it fails with `ERR_MODULE_NOT_FOUND` (measured in review pass 4).
      The test writes a file because vitest swallows a passing test's console
      output.
      **Assumption 1 holds** when the bundle builds and `site`, `toolKeys` and
      `parts` match Node. **Assumption 3 holds** when `segmenter`,
      `graphemes` (expect 2), `nfcLength` (expect 1) and `lower` match Node.
      Also record `origin`. Check 2 compares a POST's `Origin` header with
      the origin of `request.url`, and a browser on this server sends
      `http://127.0.0.1:8799`. If `origin` reads anything else, `pages dev`
      rewrites the request URL, and every Task 10 submission would get a 403.
      Stop there, and review check 2's comparison with the plan before Task 6.

- [ ] **Step 3: Apply the migration to that local D1 without a root config**
      (assumptions 2 and 5). Write the spec 7 migration to
      `$SCRATCH/0001_reports.sql` (Task 7 commits the same text). Create
      `tests/functions/wrangler.toml`:

```toml
# Local only: the functions-runtime tests' D1 (#97). Never at the repository
# root, where Pages would take it as both projects' source of truth and
# displace their dashboard bindings (spec section 11, assumption 2).
name = "shyden-site-functions-test"
compatibility_date = "2026-09-01"

[[d1_databases]]
binding = "REPORTS"
database_name = "reports-local"
database_id = "00000000-0000-4000-8000-000000000097"
```

      Then:

```bash
npx wrangler d1 execute reports-local --local --persist-to .wrangler/functions-spike \
  --config tests/functions/wrangler.toml --file "$SCRATCH/0001_reports.sql" > "$SCRATCH/d1-apply.log" 2>&1; echo rc=$?
npx wrangler d1 execute reports-local --local --persist-to .wrangler/functions-spike \
  --config tests/functions/wrangler.toml --json \
  --command "SELECT name FROM pragma_table_info('reports')" > "$SCRATCH/d1-pragma.json" 2>&1; echo rc=$?
```

      **Assumption 5 holds** when both exit 0, the `CHECK` constraints are
      accepted, and the pragma returns the eight column names.
      Now prove the running `pages dev` sees the same database. Create
      `functions/api/spike-db.js` holding
      `export const onRequest = async ({ env }) => Response.json(await env.REPORTS.prepare("SELECT name FROM pragma_table_info('reports')").all());`,
      restart `pages dev`, and `curl -s -u dev:functions-local http://127.0.0.1:8799/api/spike-db`.
      **Assumption 2 holds** when the Function lists the same eight columns.
      If it lists none, the two tools keyed the store differently: record the
      sqlite files under `.wrangler/functions-spike/v3/d1/` and try
      `--d1 REPORTS=reports-local`. If neither shares the file, the fallback
      is to apply the migration by opening that one sqlite file with
      Node's built-in `node:sqlite` after `pages dev` has created it; record
      which.

- [ ] **Step 4: Read a row back while `pages dev` runs.** Insert one row
      through `wrangler d1 execute … --command "INSERT …"` and read it with
      `--json --command "SELECT …"`. Record whether the read works while the
      server holds the database. Task 10's row reader uses whichever works.

- [ ] **Step 5: `_headers` under `pages dev`** (assumption 6).
      `curl -s -D - -o /dev/null -u dev:functions-local http://127.0.0.1:8799/vi/ | command grep -i referrer-policy`
      **Assumption 6 holds** when `Referrer-Policy: strict-origin-when-cross-origin`
      comes back.

- [ ] **Step 6: Assumption 4 is measured in Task 8**, where the e2e status
      test runs on all five engines. Record "Task 8" here.

- [ ] **Step 7: Clean up and record.** Stop `pages dev` (TaskStop), then
      `rm functions/api/spike.js functions/api/spike-db.js tests/unit/scratch-spike.test.ts` and
      `rm -rf .wrangler/functions-spike`. Confirm `git status --short functions tests/unit`
      prints nothing. Keep
      `tests/functions/wrangler.toml` only if Step 3 used it. Fill the table
      below with the measured values, not the expected ones, and commit only
      the plan:

```bash
git add docs/superpowers/plans/2026-09-26-translation-reports.md
git commit -m "docs(plan): measure #97's six assumptions (Refs #97)"
```

#### Measurements (filled by Task 2)

| # | Assumption | Result, measured | Path taken |
| --- | --- | --- | --- |
| 1 | bundler follows imports into `src/lib/*.ts`, no Node APIs | holds: `Compiled Worker successfully`, no error; `site`, `toolKeys` (151), `parts` (1) equal Node's | primary |
| 2 | local D1 bound and migrated with no root config | holds: `d1 execute --config tests/functions/wrangler.toml` and `pages dev --d1 REPORTS=<id>` share one sqlite file under `v3/d1/`; the running server listed all eight columns, hot-reloading a new Function without a restart | shared store |
| 3 | `Intl.Segmenter`, `normalize` same in workerd as Node 24 | holds: `segmenter` function, `graphemes` 2, `nfcLength` 1, `lower` `i`, all equal Node's; `origin` reads `http://127.0.0.1:8799` | graphemes |
| 4 | `:target` and fragment focus in five engines | measured in Task 8 | per engine |
| 5 | D1 accepts the `CHECK`s and `pragma_table_info` | holds: both exit 0, pragma returns the eight names, and an empty `quote` is refused with `CHECK constraint failed: length(quote) BETWEEN 1 AND 1000` | primary |
| 6 | `pages dev` applies `dist/_headers` | holds: `referrer-policy: strict-origin-when-cross-origin` on `/vi/` | primary |

Step 4: a row inserted with `d1 execute --local` while `pages dev` held the
database read back with `--json --command "SELECT …"` (exit 0), so Task 10's
row reader can use `wrangler d1 execute`.

Also measured: `pages dev` loads `.env.local` unasked ("Using secrets defined
in .env.local"), which put the operator's `DEEPL_API_KEY` into the local
worker's `env`. The Functions never read it, and CI has no `.env.local`, but
the local server should not hand a secret to code under test. Task 10
measured that naming an `--env-file` does not stop the load (the banner still
listed `DEEPL_API_KEY`), and that `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`
does (the banner lists `DEV_PASSWORD` alone), so `serve.mjs` sets that.

**If assumption 1 fails:** add a Task 5a before Task 7. A script
(`scripts/report-table.mjs`, run by `npm run build` before `astro build`)
writes `functions/_generated/report-table.js` exporting
`reportableStrings`' output for every page and locale. The Function then
imports that module instead of `src/lib/i18n`. Record this in the
Measurements table and review the amended plan again before continuing.

**If assumption 6 fails:** Task 10's `Referrer-Policy` mutation moves to a unit
test. Add it to `tests/unit/report-endpoint.test.ts`:
`it('public/_headers keeps a Referrer-Policy under which a POST keeps its Origin', …)`,
reading `public/_headers` and asserting the value is one of
`strict-origin-when-cross-origin`, `strict-origin`, `origin`,
`origin-when-cross-origin`, `same-origin`, `no-referrer-when-downgrade` or
`unsafe-url`, and never `no-referrer`.

---

### Task 3: the catalogue walk moves to a site-safe home

`tests/catalogue-leaves.ts` holds the repo's one catalogue walk, and
`one-home.test.ts` pins it there. Shipped code cannot import the test tree,
so spec 4.2's rule applies: the walk moves to a shared site-safe module, and
the test tree re-exports it.

**Files:**
- Create: `src/lib/catalogue-leaves.ts`
- Modify: `tests/catalogue-leaves.ts` (becomes a re-export)
- Modify: `tests/unit/one-home.test.ts:219-286`

**Interfaces:**
- Produces: `catalogueLeaves(table: unknown, path?: string): Array<[string, unknown]>`
  and `stringLeaves(table: unknown): Array<[string, string]>` from
  `src/lib/catalogue-leaves.ts`, with the same behaviour as today.

- [ ] **Step 1: Point the one-home rule at the new home (red).** In
      `tests/unit/one-home.test.ts`, replace the `it('is implemented only in catalogue-leaves.ts', …)`
      body with:

```ts
  it('is implemented only in src/lib/catalogue-leaves.ts', () => {
    // The walk moved out of the test tree for #97, because the Pages Function
    // that validates a report needs it and shipped code cannot import tests/.
    // The rule still scans the test tree; it adds the one home in src/.
    const HOME = 'src/lib/catalogue-leaves.ts';
    const scanned = [...SCANNED.filter((path) => path.startsWith('tests/')), HOME];
    expect(
      scanned.filter((path) =>
        definesACatalogueWalker(readFileSync(path, 'utf8')),
      ),
    ).toEqual([HOME]);
  });
```

      Update the docblock above it: its first line reads
      "Walking a copy table lives in one place too: `src/lib/catalogue-leaves.ts`,
      which `tests/catalogue-leaves.ts` re-exports." Its KNOWN LIMIT paragraph
      gains one sentence: "The walk itself now ships (#97); its behaviour is
      pinned by `catalogue-leaves.test.ts`, which the move does not change."

- [ ] **Step 2: Run it red.**
      Run: `npx vitest run tests/unit/one-home.test.ts`
      Expected: FAIL. `readFileSync` throws ENOENT for `src/lib/catalogue-leaves.ts`.

- [ ] **Step 3: Move the walk.** `git mv tests/catalogue-leaves.ts src/lib/catalogue-leaves.ts`.
      Its docblock's mention of `one-home.test.ts` stays true. Then create
      `tests/catalogue-leaves.ts`:

```ts
/**
 * The catalogue walk, for the test tree. It lives in
 * `src/lib/catalogue-leaves.ts` since #97, because the Pages Function that
 * validates a translation report walks the same tables, and shipped code
 * cannot import tests/. Every existing importer keeps this path.
 */
export { catalogueLeaves, stringLeaves } from '../src/lib/catalogue-leaves';
```

- [ ] **Step 4: Run green, then the whole unit suite.** Ten files import
      the walk through the re-export: eight unit tests, `tests/workflow-jobs.ts`,
      and `tests/e2e/copy-reaches-a-page.spec.ts`. The unit suite never loads
      that last one, so the typecheck is what proves its import still resolves.
      Run: `npx vitest run tests/unit/one-home.test.ts tests/unit/catalogue-leaves.test.ts` → PASS.
      Run: `npm run test:unit 2>&1 | tail -6` → all pass.
      Run: `npm run typecheck 2>&1 | command grep -E "(error|warning|hint)s?"` → exactly three
      lines, each reading 0.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/catalogue-leaves.ts tests/catalogue-leaves.ts tests/unit/one-home.test.ts
git commit -m "refactor(i18n): the catalogue walk moves to a site-safe home (Refs #97)"
```

- [ ] **Step 6: Mutate.** Paste a private copy of the walk into a scratch
      file, `tests/unit/scratch-walker.test.ts`: the `gather` snippet from the
      "catches a walker whatever it is called" test inside
      `describe('walking a catalogue has exactly one home')`, exported. Two
      tests carry that title, and the other one's `gather` walks directories,
      which turns a different guard red. Predict RED on
      `is implemented only in src/lib/catalogue-leaves.ts`, run the whole file,
      and confirm. Delete the scratch file and confirm green.

---

### Task 4: the `report` copy, in five locales

**Files:**
- Modify: `src/lib/i18n/site.ts` (a `report` section in `siteEn`, `siteId`,
  `siteZh`, `siteVi`, `siteTh`)
- Modify: `src/lib/i18n/label-check.ts:142-152` (`report: CHROME`)
- Create: `tests/unit/report-copy.test.ts`

**Interfaces:**
- Produces: `SiteStrings['report']` with the keys `open`, `intro`,
  `quoteLabel`, `quoteHint`, `suggestionLabel`, `noteLabel`, `noteHint`,
  `honeypotLabel`, `send`, `sent`, `notFound`, `rejected`, `failed`.

- [ ] **Step 1: Pin the approved English (red).** Create
      `tests/unit/report-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { siteEn } from '../../src/lib/i18n/site';

/**
 * The report form's English, as the operator approved it on 2026-09-23 (#97,
 * spec 3.5). A literal pin, because a level needs one: every other guard
 * derives from the catalogue, so an edit here would move both sides together.
 */
describe('the report copy is the approved English (#97)', () => {
  it('matches spec 3.5 word for word', () => {
    expect(siteEn.report).toEqual({
      open: 'Report a translation problem',
      intro:
        'Reports go to Shyden Ltd and are deleted once they have been dealt with.',
      quoteLabel: 'Which words are wrong?',
      quoteHint:
        'Start typing and choose the words from the list, or copy them from the page.',
      suggestionLabel: 'What should it say? (optional)',
      noteLabel: 'Anything else? (optional)',
      noteHint: "Please don't include names or contact details.",
      honeypotLabel: 'Leave this field empty',
      send: 'Send report',
      sent: 'Thank you. Your report has been sent.',
      notFound:
        "We couldn't find those words on this page. Choose them from the list, or copy a shorter piece without any names or numbers.",
      rejected:
        "That report couldn't be sent. Please check the form and try again.",
      failed:
        "Something went wrong and your report wasn't sent. Please try again later.",
    });
  });
});
```

- [ ] **Step 2: Run it red.**
      Run: `npx vitest run tests/unit/report-copy.test.ts`
      Expected: FAIL, `siteEn.report` is `undefined` (astro check would also
      refuse the property; vitest runs first).

- [ ] **Step 3: Add the English section.** In `siteEn`, after `language`, add
      `report: { … }` with exactly the thirteen strings above, each written
      with straight ASCII apostrophes as in the test.

- [ ] **Step 4: Draft id, zh, vi and th.** `SiteStrings` is derived from
      `siteEn`, so `npm run typecheck` now fails on four missing sections, and
      on `label-check.ts`'s `SITE_PAGES`, a `Record<keyof SiteStrings, string>`
      with no `report` key (Step 5 maps it). Add a
      `report` section to each, machine-drafted like the rest of the file (no
      native speaker is available, operator 2026-09-20). Each draft follows
      its locale's existing house wording: read that locale's `footer`,
      `language` and `glory` sections first, reuse their word for "report",
      "translation", "page" and "optional", and write zh and th without spaces
      between words. `notFound` keeps its two sentences.

- [ ] **Step 5: Map the section in `label-check.ts`.** Add `report: CHROME,`
      to `SITE_PAGES`. The form sits in the footer of every beta page, so
      `renderedOn('site.report.send')` answers "the header or footer of every
      page". Without it, the live-catalogue tests throw
      `site.ts has no section "report"`.

- [ ] **Step 6: Run every i18n guard, then the whole unit suite.**
      Run: `npx vitest run tests/unit/report-copy.test.ts tests/unit/i18n.test.ts tests/unit/dead-copy.test.ts tests/unit/locale-fallbacks.test.ts tests/unit/message-parity.test.ts tests/unit/label-check.test.ts tests/unit/verified-labels.test.ts 2>&1 | tail -30`
      Expected: `report-copy` passes. `dead-copy` FAILS, listing the `report`
      group, because nothing in `src/` reads `.report` yet. That is correct:
      Task 8 renders the copy, so leave it red until then and note it in the
      commit. (Its individual keys may already pass on unrelated names, such
      as `.open` on a `<details>`. That is why Task 9 Step 7 checks what
      actually holds the section.) If `label-check` or
      `verified-labels` flags a `report.*` label of three words or fewer
      (likely `send`), resolve it the way that file's own failure message says
      (a cross-check against the locale's prose that uses the same English,
      or an entry in its awaiting-the-operator list). Never loosen the guard.
      Every other guard must pass.
      Run: `npm run typecheck 2>&1 | command grep -E "(error|warning|hint)s?"` → three lines, 0 each.

- [ ] **Step 7: Commit** (dead-copy stays red until Task 8; do not push until then).

```bash
git add src/lib/i18n/site.ts src/lib/i18n/label-check.ts tests/unit/report-copy.test.ts
git commit -m "feat(i18n): the report form's copy, approved English and four drafts (Refs #97)"
```

      The pre-push hook runs the unit suite, so this branch is not pushed
      between Task 4 and Task 8.

- [ ] **Step 8: Mutate.** Change `send: 'Send report'` to `'Send'`. Predict
      RED on `matches spec 3.5 word for word`, confirm, and restore.

---

### Task 5: `src/lib/report.ts` — the page table, the strings, and matching

**Files:**
- Modify: `src/lib/i18n/index.ts` (add `rawCatalogue`)
- Create: `src/lib/report.ts`
- Create: `tests/unit/report.test.ts`

**Interfaces:**
- Consumes: `catalogueLeaves` (Task 3); `SiteStrings['report']` (Task 4).
- Produces, all from `src/lib/report.ts`:
  - `PAGE_IDS: readonly ['home', 'glory-points', 'classroom-groups']`
  - `type PageId = (typeof PAGE_IDS)[number]`
  - `isPageId(value: unknown): value is PageId`
  - `pageIdFromPath(pathname: string): PageId | null`
  - `pagePath(page: PageId, locale: Locale): string`
  - `interface ReportForm { readonly display: string; readonly runs: readonly string[] }`
  - `interface ReportableString { readonly key: string; readonly forms: readonly ReportForm[] }`
  - `reportableStrings(page: PageId, locale: Locale): readonly ReportableString[]`
  - `reportOptions(page: PageId, locale: Locale): readonly string[]`
  - `normalise(text: string, locale: Locale): string`
  - `matchesForm(needle: string, form: ReportForm, locale: Locale): boolean`
    (both sides already normalised)
  - `matchingKeys(quote: string, page: PageId, locale: Locale): string[]`
- Produces from `src/lib/i18n/index.ts`: `rawCatalogue(locale: Locale): Catalogue`.

- [ ] **Step 1: Add `rawCatalogue` and the stubs.** In `src/lib/i18n/index.ts`,
      after `getStrings`:

```ts
/**
 * A locale's tool catalogue as written, every message still a template.
 * `getStrings` compiles each message into a function (#136), so a walk over
 * its result never sees one: 139 keys against 197. The translation-report
 * table (#97) walks this instead.
 */
export const rawCatalogue = (locale: Locale): Catalogue => CATALOGUES[locale];
```

      Create `src/lib/report.ts` with the docblock below, the types, the
      `PAGE_IDS` constant, and every function throwing
      `new Error('not implemented')`:

```ts
/**
 * Translation reports (#97). Which strings a page offers a visitor to
 * report, how a quote is matched against them, and the `/api/report`
 * endpoint.
 *
 * ONE HOME (spec 4.2). The footer imports this at build time for its
 * `<datalist>`, and the Pages Functions import it at run time to validate a
 * report, so what is offered and what is accepted cannot drift apart. It is
 * site-safe: it must never import a CLI-only module (`cli-only.test.ts`),
 * and it runs on workerd, so no Node API either.
 */
import { catalogueLeaves } from './catalogue-leaves';
import {
  DEFAULT_LOCALE,
  getSiteStrings,
  localisePath,
  rawCatalogue,
  type Locale,
  type SiteStrings,
} from './i18n';
import { isMessageTemplate, parseMessage, type MessagePart } from './i18n/message';

export const PAGE_IDS = ['home', 'glory-points', 'classroom-groups'] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface ReportForm {
  /** What the `<datalist>` offers: the literal text with each slot as an ellipsis. */
  readonly display: string;
  /** The literal text between slots: one more run than there are slots. */
  readonly runs: readonly string[];
}

export interface ReportableString {
  /** `site.<path>` for site copy, the bare catalogue path for tool copy. */
  readonly key: string;
  readonly forms: readonly ReportForm[];
}
```

- [ ] **Step 2: Write the failing tests.** Create `tests/unit/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PAGE_IDS,
  isPageId,
  matchesForm,
  matchingKeys,
  normalise,
  pageIdFromPath,
  pagePath,
  reportOptions,
  reportableStrings,
  type PageId,
} from '../../src/lib/report';
import {
  PREFIXED_LOCALES,
  getSiteStrings,
  rawCatalogue,
  type Locale,
} from '../../src/lib/i18n';
import { isMessageTemplate } from '../../src/lib/i18n/message';
import { catalogueLeaves } from '../../src/lib/catalogue-leaves';
import { renderedOn } from '../../src/lib/i18n/label-check';
import { nonEmpty, searched } from '../source-files';

const ELLIPSIS = String.fromCharCode(0x2026);
const keysOn = (page: PageId, locale: Locale) =>
  new Set(reportableStrings(page, locale).map(({ key }) => key));
const siteLeafKeys = (locale: Locale, section: string) =>
  catalogueLeaves(
    (getSiteStrings(locale) as Record<string, unknown>)[section],
    `site.${section}`,
  )
    .filter(([, value]) => typeof value === 'string')
    .map(([key]) => key);

describe('the page table', () => {
  it('knows the three pages with a footer and nothing else', () => {
    expect(PAGE_IDS).toEqual(['home', 'glory-points', 'classroom-groups']);
    expect(isPageId('home')).toBe(true);
    expect(isPageId('404')).toBe(false);
    expect(isPageId(undefined)).toBe(false);
  });

  it.each([
    ['/', 'home'],
    ['/vi/', 'home'],
    ['/vi', 'home'],
    ['/th/glory-points', 'glory-points'],
    ['/zh/classroom-groups/', 'classroom-groups'],
    ['/classroom-groups', 'classroom-groups'],
  ])('reads %s as %s', (path, page) => {
    expect(pageIdFromPath(path)).toBe(page);
  });

  it('reads an unknown path as no page', () => {
    expect(pageIdFromPath('/vi/nowhere')).toBeNull();
    expect(pageIdFromPath('/404')).toBeNull();
  });

  it('builds the path the site links use', () => {
    expect(pagePath('home', 'vi')).toBe('/vi/');
    expect(pagePath('classroom-groups', 'vi')).toBe('/vi/classroom-groups');
    expect(pagePath('glory-points', 'th')).toBe('/th/glory-points');
  });
});

describe('a page offers its own sections plus the chrome', () => {
  it.each(PREFIXED_LOCALES)('%s: home carries every leaf of site.home', (locale) => {
    const keys = keysOn('home', locale);
    for (const key of nonEmpty(siteLeafKeys(locale, 'home'), 'site.home leaves'))
      expect(keys, key).toContain(key);
  });

  it.each(PREFIXED_LOCALES)('%s: glory-points carries every leaf of site.glory and none of site.home', (locale) => {
    const keys = keysOn('glory-points', locale);
    for (const key of nonEmpty(siteLeafKeys(locale, 'glory'), 'site.glory leaves'))
      expect(keys, key).toContain(key);
    expect([...keys].filter((key) => key.startsWith('site.home.'))).toEqual([]);
  });

  it.each(PREFIXED_LOCALES)('%s: classroom-groups carries every string leaf of the raw tool catalogue', (locale) => {
    const keys = keysOn('classroom-groups', locale);
    const tool = nonEmpty(
      catalogueLeaves(rawCatalogue(locale)).filter(([, v]) => typeof v === 'string'),
      'tool catalogue leaves',
    );
    for (const [key] of tool) expect(keys, key).toContain(key);
  });

  it('no page offers the 404 copy', () => {
    for (const page of PAGE_IDS)
      expect([...keysOn(page, 'vi')].filter((key) => key.startsWith('site.notFound.'))).toEqual([]);
  });

  it('every page carries every chrome entry, bare strings and the report section included', () => {
    const chrome = Object.keys(getSiteStrings('vi')).filter(
      (section) => !['home', 'glory', 'notFound'].includes(section),
    );
    expect(chrome).toEqual(expect.arrayContaining(['nav', 'footer', 'language', 'report', 'menuLabel', 'skipToContent']));
    for (const page of PAGE_IDS)
      for (const section of chrome)
        for (const key of siteLeafKeys('vi', section))
          expect(keysOn(page, 'vi'), `${page} ${key}`).toContain(key);
  });

  it('agrees with label-check about which site sections are chrome', () => {
    // Two derivations of one fact: label-check's SITE_PAGES says where a
    // section is read, this module says which pages offer it. A section
    // label-check calls chrome must be on every page here, and one it gives a
    // single page must be on that page alone.
    const CHROME = renderedOn('site.nav.home');
    for (const section of Object.keys(getSiteStrings('vi'))) {
      const where = renderedOn(`site.${section}.x`);
      const pages = PAGE_IDS.filter((page) =>
        [...keysOn(page, 'vi')].some((key) => key === `site.${section}` || key.startsWith(`site.${section}.`)),
      );
      if (where === CHROME) expect(pages, section).toEqual([...PAGE_IDS]);
      else if (where === 'the 404 page') expect(searched(pages, { of: [...PAGE_IDS], what: 'pages' }), section).toEqual([]);
      else expect(pages.map((page) => pagePath(page, 'en')), section).toEqual([where]);
    }
  });
});

describe('display forms', () => {
  it('gives a message one form per branch, each slot an ellipsis', () => {
    // A select, not a plural: every beta locale has only the `other` plural
    // category, so a plural there renders one form (unless it has `=n` keys).
    const english = catalogueLeaves(rawCatalogue('en'));
    const [key] = nonEmpty(
      english.filter(([k, v]) => !k.includes('[') && typeof v === 'string' && /,\s*select\s*,/.test(v)),
      'select messages',
    )[0];
    const entry = reportableStrings('classroom-groups', 'vi').find((s) => s.key === key);
    expect(entry, key).toBeDefined();
    expect(entry!.forms.length).toBeGreaterThan(1);
    expect(entry!.forms.length).toBeLessThanOrEqual(3);
    for (const form of entry!.forms) {
      expect(form.display).toBe(form.runs.join(ELLIPSIS));
      expect(form.display).not.toMatch(/[{}#]/);
    }
  });

  it('never parses site copy as a message', () => {
    for (const { key, forms } of reportableStrings('home', 'vi').filter((s) => s.key.startsWith('site.')))
      expect(forms, key).toHaveLength(1);
  });

  it('treats a tool string as a message exactly when its English is one', () => {
    const english = new Map(catalogueLeaves(rawCatalogue('en')));
    const tool = reportableStrings('classroom-groups', 'th').filter((s) => !s.key.startsWith('site.'));
    const isMessage = (key: string) => {
      const reference = english.get(key);
      return !key.includes('[') && typeof reference === 'string' && isMessageTemplate(reference);
    };
    // Both directions, each proven non-empty: plain copy is one literal form,
    // and a message never shows its template syntax.
    for (const { key, forms } of nonEmpty(tool.filter((s) => !isMessage(s.key)), 'plain tool strings')) {
      expect(forms, key).toHaveLength(1);
      expect(forms[0].runs, key).toHaveLength(1);
    }
    for (const { key, forms } of nonEmpty(tool.filter((s) => isMessage(s.key)), 'tool messages'))
      for (const form of forms) expect(form.display, key).not.toMatch(/[{}]/);
  });

  it('offers each display once, and every one of them', () => {
    const options = reportOptions('glory-points', 'id');
    expect(new Set(options).size).toBe(options.length);
    const displays = reportableStrings('glory-points', 'id').flatMap((s) => s.forms.map((f) => f.display));
    expect(new Set(options)).toEqual(new Set(displays));
  });
});

describe('normalise', () => {
  const NBSP = String.fromCharCode(0x00a0);
  const ZWSP = String.fromCharCode(0x200b);
  const BOM = String.fromCharCode(0xfeff);
  const WJ = String.fromCharCode(0x2060);
  const LSQ = String.fromCharCode(0x2018);
  const RSQ = String.fromCharCode(0x2019);
  const LDQ = String.fromCharCode(0x201c);
  const RDQ = String.fromCharCode(0x201d);
  const FULL_DQ = String.fromCharCode(0xff02);
  const FULL_SQ = String.fromCharCode(0xff07);
  const MOD_APOS = String.fromCharCode(0x02bc);

  it('composes NFD into NFC', () => {
    const nfd = 'Vie' + String.fromCharCode(0x0302, 0x0323) + 't';
    expect(normalise(nfd, 'vi')).toBe(normalise('Vi' + String.fromCharCode(0x1ec7) + 't', 'vi'));
  });

  it('removes zero-width characters', () => {
    expect(normalise(`a${ZWSP}b${WJ}c${BOM}`, 'id')).toBe('abc');
  });

  it('maps every Unicode space to one ASCII space and trims', () => {
    expect(normalise(`  a${NBSP}${NBSP}b\t\nc  `, 'id')).toBe('a b c');
  });

  it('folds typographic, fullwidth and modifier quotes to ASCII', () => {
    expect(normalise(`${LSQ}a${RSQ} ${LDQ}b${RDQ} ${FULL_DQ}c${FULL_DQ} ${FULL_SQ}d${MOD_APOS}`, 'zh')).toBe(`'a' "b" "c" 'd'`);
  });

  it('lower-cases in the locale', () => {
    expect(normalise('HELLO', 'id')).toBe('hello');
  });
});

describe('matching a quote (spec 5)', () => {
  const vi = getSiteStrings('vi');

  it('rule 1: the exact text of a form, as the type-ahead offers it', () => {
    expect(matchingKeys(vi.report.open, 'home', 'vi')).toContain('site.report.open');
  });

  it('rule 1 survives case and spacing', () => {
    const noisy = `  ${vi.report.open.toUpperCase()}  `;
    expect(matchingKeys(noisy, 'home', 'vi')).toContain('site.report.open');
  });

  it('rule 2: a piece of fixed wording of at least two characters', () => {
    const piece = vi.report.intro.slice(0, 12);
    expect(matchingKeys(piece, 'home', 'vi')).toContain('site.report.intro');
  });

  it('rule 2 refuses one character and accepts two', () => {
    const text = vi.report.open;
    expect(matchingKeys(text.slice(0, 1), 'home', 'vi')).toEqual([]);
    expect(matchingKeys(text.slice(0, 2), 'home', 'vi').length).toBeGreaterThan(0);
  });

  it('rule 2 counts Thai graphemes, not code points', () => {
    // One grapheme cluster, three code points: too short however it is counted
    // in UTF-16. Two clusters are long enough.
    const th = getSiteStrings('th').report.open;
    const clusters = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(th)].map((s) => s.segment);
    // A cluster of several code points that has a cluster after it.
    const at = nonEmpty(
      [...clusters.keys()].filter((i) => i < clusters.length - 1 && [...clusters[i]].length > 1),
      'multi-code-point Thai clusters with a successor',
    )[0];
    expect(matchingKeys(clusters[at], 'home', 'th')).toEqual([]);
    expect(matchingKeys(clusters[at] + clusters[at + 1], 'home', 'th')).toContain('site.report.open');
  });

  it('rule 3: a whole rendered message with real values in its slots', () => {
    const messages = nonEmpty(
      reportableStrings('classroom-groups', 'vi').filter((s) => s.forms.some((f) => f.runs.length === 2 && f.runs.every((r) => r.trim().length > 0))),
      'messages with one slot between two literal runs',
    );
    const { key, forms } = messages[0];
    const form = forms.find((f) => f.runs.length === 2 && f.runs.every((r) => r.trim().length > 0))!;
    expect(matchingKeys(`${form.runs[0]}30${form.runs[1]}`, 'classroom-groups', 'vi')).toContain(key);
  });

  it('refuses a fragment that spans a slot without being the whole message', () => {
    const { forms } = nonEmpty(
      reportableStrings('classroom-groups', 'vi').filter((s) => s.forms.some((f) => f.runs.length === 2 && f.runs[0].trim().length > 3 && f.runs[1].trim().length > 3)),
      'messages with long runs either side of one slot',
    )[0];
    const form = forms.find((f) => f.runs.length === 2 && f.runs[0].trim().length > 3 && f.runs[1].trim().length > 3)!;
    const spanning = `${form.runs[0].slice(-3)}30${form.runs[1].slice(0, 3)}`;
    expect(matchingKeys(spanning, 'classroom-groups', 'vi')).toEqual([]);
  });

  it('stores every key a quote matches', () => {
    const counts = new Map<string, string[]>();
    for (const { key, forms } of reportableStrings('classroom-groups', 'vi'))
      for (const { display } of forms) counts.set(display, [...(counts.get(display) ?? []), key]);
    const [display, keys] = nonEmpty([...counts].filter(([, k]) => new Set(k).size > 1), 'displays shared by two keys')[0];
    // Every key that owns the display; rule 2 may add a key whose longer text contains it.
    expect(matchingKeys(display, 'classroom-groups', 'vi')).toEqual(expect.arrayContaining([...new Set(keys)]));
  });

  it('matches nothing for text that is not on the page', () => {
    expect(matchingKeys('this sentence is on no page at all', 'home', 'vi')).toEqual([]);
    expect(matchingKeys('   ', 'home', 'vi')).toEqual([]);
  });

  it('rule 3 needs two characters of fixed wording (clarification 6)', () => {
    const slotsOnly = { display: `${ELLIPSIS}`, runs: ['', ''] };
    const oneLetter = { display: `a${ELLIPSIS}`, runs: ['a', ''] };
    const worded = { display: `ab${ELLIPSIS}`, runs: ['ab', ''] };
    expect(matchesForm('anything at all', slotsOnly, 'vi')).toBe(false);
    expect(matchesForm('anything at all', oneLetter, 'vi')).toBe(false);
    expect(matchesForm('ab and more', worded, 'vi')).toBe(true);
    expect(matchesForm('ab', worded, 'vi')).toBe(true);
  });

  it('rule 3 wants every slot non-empty and every run in order', () => {
    const form = { display: `a${ELLIPSIS}b${ELLIPSIS}c`, runs: ['a', 'b', 'c'] };
    expect(matchesForm('a1b2c', form, 'vi')).toBe(true);
    expect(matchesForm('abc', form, 'vi')).toBe(false);
    expect(matchesForm('a1bc', form, 'vi')).toBe(false);
    expect(matchesForm('ab1c', form, 'vi')).toBe(false);
    expect(matchesForm('a1c2b', form, 'vi')).toBe(false);
  });

  it('a nonsense quote matches nothing on any page in any locale', () => {
    // Clarification 6: a form made only of slots would match every quote
    // through rule 3. This holds on the live catalogues whatever they gain.
    for (const locale of PREFIXED_LOCALES)
      for (const page of PAGE_IDS)
        expect(matchingKeys('zq7 xv9 wk3 on no page', page, locale), `${page} ${locale}`).toEqual([]);
  });

  it('offers only its own page: a home string is not found on glory-points', () => {
    const homeOnly = nonEmpty(
      reportOptions('home', 'vi').filter((o) => !reportOptions('glory-points', 'vi').includes(o) && o.length > 12),
      'long home-only displays',
    )[0];
    expect(matchingKeys(homeOnly, 'glory-points', 'vi')).toEqual([]);
  });

  it('answers a 1000-unit quote against every classroom-groups form promptly', () => {
    // A tripwire, not the Workers CPU budget: rule 3 is a linear scan
    // (clarification 5). A backtracking pattern such as ^a.+b.+c$ is
    // polynomial on a long quote of this shape; this bound is not a
    // measurement of one, only a line it must stay under.
    const quote = 'a'.repeat(999) + 'b';
    const started = performance.now();
    matchingKeys(quote, 'classroom-groups', 'vi');
    expect(performance.now() - started).toBeLessThan(250);
  });
});
```

- [ ] **Step 3: Run red.**
      Run: `npx vitest run tests/unit/report.test.ts 2>&1 | tail -40`
      Expected: every test FAILS with `not implemented`, except those that fail
      on `nonEmpty` over a stub's result. Any PASS is a finding: fix the test
      before implementing.

- [ ] **Step 4: Implement.** Replace the stubs in `src/lib/report.ts`:

```ts
const ELLIPSIS = String.fromCharCode(0x2026);
/** A private-use character: marks a slot inside a form, and never occurs in copy. */
const SLOT = String.fromCodePoint(0xe000);

interface PageEntry {
  readonly route: string;
  /** The site-catalogue section only this page reads. */
  readonly siteSection?: keyof SiteStrings;
  /** Whether the page reads the raw tool catalogue (`getStrings`). */
  readonly toolCatalogue: boolean;
}

/** Spec section 4's table. The facts: HomePage reads `.home`, GloryPointsPage `.glory`, ClassroomGroupsPage `getStrings`. */
const PAGES: Record<PageId, PageEntry> = {
  home: { route: '/', siteSection: 'home', toolCatalogue: false },
  'glory-points': { route: '/glory-points', siteSection: 'glory', toolCatalogue: false },
  'classroom-groups': { route: '/classroom-groups', toolCatalogue: true },
};

/** Only the English-footed 404 renders this, so no form offers it (spec 3.1). */
const NEVER_OFFERED: ReadonlySet<string> = new Set(['notFound']);

export const isPageId = (value: unknown): value is PageId =>
  typeof value === 'string' && (PAGE_IDS as readonly string[]).includes(value);

export function pageIdFromPath(pathname: string): PageId | null {
  const route = localisePath(pathname, DEFAULT_LOCALE).replace(/\/+$/, '') || '/';
  return PAGE_IDS.find((page) => PAGES[page].route === route) ?? null;
}

export const pagePath = (page: PageId, locale: Locale): string =>
  localisePath(PAGES[page].route, locale);

/** Chrome: every top-level site entry no single page owns, derived so a new one is offered the day it is added. */
function chromeSections(): string[] {
  const owned = new Set<string>(NEVER_OFFERED);
  for (const page of PAGE_IDS) {
    const section = PAGES[page].siteSection;
    if (section) owned.add(section);
  }
  return Object.keys(getSiteStrings(DEFAULT_LOCALE)).filter((section) => !owned.has(section));
}

/** Every form a template can render, slots as SLOT, one per plural or select branch. */
function slotted(parts: readonly MessagePart[]): string[] {
  let forms = [''];
  for (const part of parts) {
    if (part.kind === 'text') forms = forms.map((form) => form + part.text);
    else if (part.kind === 'count' || part.kind === 'value') forms = forms.map((form) => form + SLOT);
    else {
      const branches = [...part.branches.values()].flatMap(slotted);
      forms = forms.flatMap((form) => branches.map((branch) => form + branch));
    }
  }
  return forms;
}

function formsOf(text: string, isMessage: boolean): ReportForm[] {
  const raw = isMessage ? slotted(parseMessage(text)) : [text];
  return [...new Set(raw)].map((form) => {
    const runs = form.split(SLOT);
    return { display: runs.join(ELLIPSIS), runs };
  });
}

const stringsOnly = (leaves: Array<[string, unknown]>): Array<[string, string]> =>
  leaves.filter((leaf): leaf is [string, string] => typeof leaf[1] === 'string');

function siteStrings(locale: Locale, sections: readonly string[]): ReportableString[] {
  const table = getSiteStrings(locale) as Record<string, unknown>;
  return sections.flatMap((section) =>
    stringsOnly(catalogueLeaves(table[section], `site.${section}`)).map(([key, text]) => ({
      key,
      forms: formsOf(text, false),
    })),
  );
}

/** English decides what is a message, and arrays are never compiled (`compileCatalogue`). */
function toolStrings(locale: Locale): ReportableString[] {
  const english = new Map(catalogueLeaves(rawCatalogue(DEFAULT_LOCALE)));
  return stringsOnly(catalogueLeaves(rawCatalogue(locale))).map(([key, text]) => {
    const reference = english.get(key);
    const isMessage = !key.includes('[') && typeof reference === 'string' && isMessageTemplate(reference);
    return { key, forms: formsOf(text, isMessage) };
  });
}

const tables = new Map<string, readonly ReportableString[]>();

export function reportableStrings(page: PageId, locale: Locale): readonly ReportableString[] {
  const cacheKey = `${page}:${locale}`;
  let table = tables.get(cacheKey);
  if (!table) {
    const { siteSection, toolCatalogue } = PAGES[page];
    const sections = siteSection ? [siteSection, ...chromeSections()] : chromeSections();
    table = [...(toolCatalogue ? toolStrings(locale) : []), ...siteStrings(locale, sections)];
    tables.set(cacheKey, table);
  }
  return table;
}

export const reportOptions = (page: PageId, locale: Locale): readonly string[] => [
  ...new Set(reportableStrings(page, locale).flatMap(({ forms }) => forms.map(({ display }) => display))),
];

const ZERO_WIDTH: ReadonlySet<number> = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const SINGLE_QUOTES: ReadonlySet<number> = new Set([0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x02bc, 0xff07]);
const DOUBLE_QUOTES: ReadonlySet<number> = new Set([0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0xff02]);

/** Spec 5's normalisation, applied to the quote and to every form alike. */
export function normalise(text: string, locale: Locale): string {
  const folded = [...text.normalize('NFC')]
    .filter((ch) => !ZERO_WIDTH.has(ch.codePointAt(0)!))
    .map((ch) => {
      const point = ch.codePointAt(0)!;
      if (SINGLE_QUOTES.has(point)) return "'";
      if (DOUBLE_QUOTES.has(point)) return '"';
      return ch;
    })
    .join('');
  return folded.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(locale);
}

const segmenters = new Map<Locale, Intl.Segmenter>();

/**
 * Whether `text` holds at least two characters: graphemes where the runtime
 * segments them, code points otherwise (spec 11, assumption 3). It stops at
 * the second, because the endpoint asks this once per form (about 200 on
 * classroom-groups) of a quote of up to 1000 units, on workerd's CPU budget.
 */
function hasTwoCharacters(text: string, locale: Locale): boolean {
  let units: Iterator<unknown>;
  if (typeof Intl.Segmenter === 'function') {
    let segmenter = segmenters.get(locale);
    if (!segmenter) {
      segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
      segmenters.set(locale, segmenter);
    }
    units = segmenter.segment(text)[Symbol.iterator]();
  } else units = text[Symbol.iterator]();
  return !units.next().done && !units.next().done;
}

/** Rule 3 as an anchored literal scan: each slot a non-empty wildcard, no backtracking. */
function wholeMessage(quote: string, runs: readonly string[]): boolean {
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (!quote.startsWith(first) || !quote.endsWith(last)) return false;
  let at = first.length;
  for (const run of runs.slice(1, -1)) {
    const found = quote.indexOf(run, at + 1);
    if (found < 0) return false;
    at = found + run.length;
  }
  return quote.length - last.length >= at + 1;
}

/**
 * Spec 5's three rules for one form. Both sides arrive normalised: `needle`
 * by `normalise`, the form's runs by normalising them joined on SLOT, so a
 * space either side of a slot survives.
 */
export function matchesForm(needle: string, form: ReportForm, locale: Locale): boolean {
  if (needle === '') return false;
  if (needle === form.display) return true;
  if (hasTwoCharacters(needle, locale) && form.runs.some((run) => run.includes(needle))) return true;
  // Clarification 6: a form with under 2 characters of fixed wording would match anything.
  const wholeMessageAllowed = form.runs.length > 1 && hasTwoCharacters(form.runs.join(''), locale);
  return wholeMessageAllowed && wholeMessage(needle, form.runs);
}

const normalisedTables = new Map<string, readonly ReportableString[]>();

/** A page's strings with every form normalised once, cached per page and locale. */
function normalisedStrings(page: PageId, locale: Locale): readonly ReportableString[] {
  const cacheKey = `${page}:${locale}`;
  let table = normalisedTables.get(cacheKey);
  if (!table) {
    table = reportableStrings(page, locale).map(({ key, forms }) => ({
      key,
      forms: forms.map(({ runs }) => {
        const normalRuns = normalise(runs.join(SLOT), locale).split(SLOT);
        return { display: normalRuns.join(ELLIPSIS), runs: normalRuns };
      }),
    }));
    normalisedTables.set(cacheKey, table);
  }
  return table;
}

/** Every key whose forms the quote matches (spec 5); empty when it is `not-found`. */
export function matchingKeys(quote: string, page: PageId, locale: Locale): string[] {
  const needle = normalise(quote, locale);
  return normalisedStrings(page, locale)
    .filter(({ forms }) => forms.some((form) => matchesForm(needle, form, locale)))
    .map(({ key }) => key);
}
```

      If Task 2 recorded that workerd has no `Intl.Segmenter`,
      `hasTwoCharacters` already falls back to code points; nothing else
      changes.

- [ ] **Step 5: Run green, then everything.**
      Run: `npx vitest run tests/unit/report.test.ts` → PASS.
      Run: `npm run test:unit 2>&1 | tail -6` → only `dead-copy` fails, on
      the `report` group (Task 8 fixes it).
      Run: `npm run typecheck 2>&1 | command grep -E "(error|warning|hint)s?"` → three lines, 0 each.
      Run: `npx prettier --write src/lib/report.ts src/lib/i18n/index.ts tests/unit/report.test.ts`.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/report.ts src/lib/i18n/index.ts tests/unit/report.test.ts
git commit -m "feat(report): the page table, reportable strings and quote matching (Refs #97)"
```

- [ ] **Step 7: Mutate, whole file each time, predicting first.**
      (a) Remove a section from the page table: delete `home`'s `siteSection`.
      Chrome is derived by exclusion, so `site.home` becomes chrome and is
      offered on every page → RED on "none of site.home" and on "agrees with
      label-check". (b) Accept any quote (`return reportableStrings(page, locale).map(({ key }) => key);`
      at the top of `matchingKeys`) → RED on "matches nothing" and on "spans a
      slot". (c) In `matchesForm`'s rule-2 line, delete
      `hasTwoCharacters(needle, locale) && ` → RED on "refuses one character"
      (one letter of `open` is inside a run). (d) Make `hasTwoCharacters`'s body
      `return text.length >= 2;` → RED on the Thai test (a three-unit
      cluster passes as two characters).
      (e) Set `wholeMessageAllowed` to `form.runs.length > 1` → RED on
      "rule 3 needs two characters of fixed wording". (f) In `wholeMessage`,
      search from `at` instead of `at + 1` → RED on `'ab1c'` (an empty
      first slot). (g) Change the last line of `wholeMessage` to `>= at` →
      RED on `'a1bc'` (an empty last slot).
      Restore each with `git checkout -- src/lib/report.ts`.

---

### Task 6: `src/lib/report.ts` — the endpoint, the health check, and logging

**Files:**
- Modify: `src/lib/report.ts` (append)
- Create: `tests/unit/report-endpoint.test.ts`

**Interfaces:**
- Consumes: `isPageId`, `pagePath`, `normalise`, `matchingKeys` (Task 5);
  `isLocale`, `isBetaLocale` from `./i18n`.
- Produces, from `src/lib/report.ts`:
  - `MAX_FIELD_UNITS = 1000`, `MAX_BODY_BYTES = 65536`
  - `REPORT_COLUMNS: readonly ['id', 'received_at', 'locale', 'page', 'quote', 'keys', 'suggestion', 'note']`
  - `type Outcome = 'sent' | 'not-found' | 'rejected' | 'failed'`
  - `interface ReportsStatement { bind(...values: unknown[]): ReportsStatement; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> }`
  - `interface ReportsDatabase { prepare(query: string): ReportsStatement }`
  - `interface ReportEnv { readonly REPORTS?: ReportsDatabase }`
  - `handleReport(request: Request, env: ReportEnv, log?: (line: string) => void): Promise<Response>`
  - `reportHealth(request: Request, env: ReportEnv, log?: (line: string) => void): Promise<Response>`
  - `schemaMatches(columns: readonly string[]): boolean`

- [ ] **Step 1: Stubs.** Append the constants, the types and three throwing
      functions with the signatures above. Add `isBetaLocale, isLocale` to the
      `./i18n` import.

- [ ] **Step 2: Write the failing tests.** Create
      `tests/unit/report-endpoint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  MAX_FIELD_UNITS,
  REPORT_COLUMNS,
  handleReport,
  reportHealth,
  schemaMatches,
} from '../../src/lib/report';
import { getSiteStrings } from '../../src/lib/i18n';

/**
 * Real `Request` objects, no stand-in database (spec 10). Checks 1–8 return
 * before the database is touched, so they need none; `failed` runs with the
 * REPORTS binding absent, which is a real failure the health check also
 * reports. Check 9 succeeding is proved on a real local D1 (Task 10).
 */
const ORIGIN = 'https://dev.shyden.co.uk';
const ENDPOINT = `${ORIGIN}/api/report`;
const HEALTH = `${ORIGIN}/api/report/health`;
const FORM = 'application/x-www-form-urlencoded';
const quote = getSiteStrings('vi').report.open;
const NO_DB = {};

type Fields = Record<string, string>;
const valid = (extra: Fields = {}): Fields => ({ locale: 'vi', page: 'home', quote, suggestion: '', note: '', website: '', ...extra });

function post(fields: Fields | string, init: { headers?: Record<string, string>; json?: boolean; method?: string } = {}) {
  const body = typeof fields === 'string' ? fields : new URLSearchParams(fields).toString();
  return new Request(ENDPOINT, {
    method: init.method ?? 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': FORM, ...(init.json ? { Accept: 'application/json' } : {}), ...init.headers },
    body: init.method && init.method !== 'POST' ? undefined : body,
  });
}

const answer = async (request: Request, lines: string[] = []) => handleReport(request, NO_DB, (line) => lines.push(line));
const outcomeOf = async (response: Response) => ((await response.json()) as { outcome: string }).outcome;

describe('checks 1-4: the request itself', () => {
  it('1: refuses any method but POST with 405 and Allow', async () => {
    const response = await answer(new Request(ENDPOINT, { method: 'GET', headers: { Origin: ORIGIN } }));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('2: refuses a missing Origin, a foreign one, and "null"', async () => {
    for (const origin of [undefined, 'https://evil.example', 'null']) {
      const headers: Record<string, string> = { 'Content-Type': FORM };
      if (origin) headers.Origin = origin;
      const response = await answer(new Request(ENDPOINT, { method: 'POST', headers, body: new URLSearchParams(valid()).toString() }));
      expect(response.status, String(origin)).toBe(403);
    }
  });

  it('3: refuses any content type but a urlencoded form, parameters allowed', async () => {
    expect((await answer(post(valid(), { headers: { 'Content-Type': 'application/json' } }))).status).toBe(415);
    expect((await answer(post(valid(), { headers: { 'Content-Type': 'multipart/form-data; boundary=x' } }))).status).toBe(415);
    expect((await answer(post(valid(), { headers: { 'Content-Type': `${FORM}; charset=UTF-8` } }))).status).not.toBe(415);
  });

  it('4: accepts a body of exactly 64 KiB and refuses one byte more', async () => {
    const base = new URLSearchParams(valid()).toString() + '&pad=';
    const exact = base + 'a'.repeat(MAX_BODY_BYTES - base.length);
    expect(new TextEncoder().encode(exact).byteLength).toBe(MAX_BODY_BYTES);
    expect((await answer(post(exact))).status).not.toBe(413);
    expect((await answer(post(exact + 'a'))).status).toBe(413);
  });

  it('4: stops reading a body that declares no length once it passes 64 KiB', async () => {
    // A chunked body carries no Content-Length, so only the read itself can
    // enforce the cap. This one holds 1 MiB; buffering it all would pull 64
    // chunks, and stopping at the cap pulls about five.
    const chunk = new TextEncoder().encode('a'.repeat(16 * 1024));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 64) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': FORM },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('Content-Length')).toBeNull();
    expect((await answer(request)).status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
});

describe('check 5 and the honeypot', () => {
  it('5: refuses English, an unknown locale and an unknown page with a plain 400', async () => {
    for (const fields of [valid({ locale: 'en' }), valid({ locale: 'fr' }), valid({ page: 'admin' }), valid({ page: '' })]) {
      const response = await answer(post(fields));
      expect(response.status, JSON.stringify(fields)).toBe(400);
      expect(response.headers.get('Location')).toBeNull();
    }
  });

  it('5 comes before the honeypot: a filled honeypot with an unknown page is a 400, never a redirect', async () => {
    const response = await answer(post(valid({ page: 'https://evil.example', website: 'x' })));
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('6: a filled honeypot answers sent and stores nothing, even with no database', async () => {
    const lines: string[] = [];
    const response = await answer(post(valid({ website: 'http://spam.example' })), lines);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/vi/#report-sent');
    // The same report without the honeypot reaches the missing database,
    // which logs one line. One line in all, so the log was live and the
    // honeypot request never tried to store.
    await answer(post(valid()), lines);
    expect(lines).toHaveLength(1);
  });
});

describe('check 7: lengths and content', () => {
  const units = (n: number) => 'x'.repeat(n);

  it('refuses an empty, a blank and a zero-width-only quote', async () => {
    for (const q of ['', '   ', String.fromCharCode(0x200b, 0x200b)]) {
      const response = await answer(post(valid({ quote: q })));
      expect(response.headers.get('Location'), JSON.stringify(q)).toBe('/vi/#report-rejected');
    }
  });

  it(`accepts a suggestion and note of ${MAX_FIELD_UNITS} units and refuses ${MAX_FIELD_UNITS + 1}`, async () => {
    for (const field of ['suggestion', 'note']) {
      const at = await answer(post(valid({ [field]: units(MAX_FIELD_UNITS) })));
      expect(at.headers.get('Location'), field).not.toBe('/vi/#report-rejected');
      const over = await answer(post(valid({ [field]: units(MAX_FIELD_UNITS + 1) })));
      expect(over.headers.get('Location'), field).toBe('/vi/#report-rejected');
    }
  });

  it('refuses a quote of 1001 units', async () => {
    const response = await answer(post(valid({ quote: units(MAX_FIELD_UNITS + 1) })));
    expect(response.headers.get('Location')).toBe('/vi/#report-rejected');
  });

  it('counts an emoji as two units, as maxlength does', async () => {
    const emoji = String.fromCodePoint(0x1f600);
    const at = await answer(post(valid({ note: emoji.repeat(MAX_FIELD_UNITS / 2) })));
    expect(at.headers.get('Location')).not.toBe('/vi/#report-rejected');
    const over = await answer(post(valid({ note: emoji.repeat(MAX_FIELD_UNITS / 2) + 'x' })));
    expect(over.headers.get('Location')).toBe('/vi/#report-rejected');
  });

  it('folds CRLF before counting: a 1000-unit note that arrives longer is allowed', async () => {
    const line = 'x'.repeat(99);
    const note = Array.from({ length: 10 }, () => line).join('\r\n');
    expect(note.length).toBe(1008);
    expect(note.replace(/\r\n/g, '\n').length).toBe(999);
    const response = await answer(post(valid({ note })));
    expect(response.headers.get('Location')).not.toBe('/vi/#report-rejected');
  });

  it('refuses a control character other than TAB and LF, in any field', async () => {
    // The quote keeps its real match in front, so without check 7 it would be
    // sent (a CR folds to a space) or not-found, and never rejected.
    for (const name of ['quote', 'suggestion', 'note'])
      for (const code of [0x00, 0x07, 0x0d, 0x1b, 0x7f, 0x85]) {
        const ch = String.fromCharCode(code);
        const value = name === 'quote' ? `${quote}${ch}` : `a${ch}b`;
        const response = await answer(post(valid({ [name]: value })));
        expect(response.headers.get('Location'), `${name} ${code.toString(16)}`).toBe('/vi/#report-rejected');
      }
    const tabbed = await answer(post(valid({ note: 'a\tb\nc' })));
    expect(tabbed.headers.get('Location')).not.toBe('/vi/#report-rejected');
  });
});

describe('check 8 and the redirect', () => {
  it('answers not-found for a quote on no page', async () => {
    const response = await answer(post(valid({ quote: 'on no page at all, anywhere' })));
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/vi/#report-not-found');
  });

  it('builds Location from the checked locale and page only, never from Referer', async () => {
    const response = await answer(post(valid({ page: 'classroom-groups', quote: 'on no page at all' }), { headers: { Referer: 'https://evil.example/x' } }));
    expect(response.headers.get('Location')).toBe('/vi/classroom-groups#report-not-found');
  });
});

describe('check 9 with no database: failed, and a clean log line', () => {
  it('answers failed when the REPORTS binding is absent', async () => {
    const response = await answer(post(valid()));
    expect(response.headers.get('Location')).toBe('/vi/#report-failed');
  });

  it('logs the error name and message, and no visitor text or header', async () => {
    const lines: string[] = [];
    const secret = 'the-suggestion-7f3a';
    await answer(post(valid({ suggestion: secret, note: 'note-9c1d' }), { headers: { 'User-Agent': 'agent-2b8e' } }), lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^report failed: \w+: /);
    for (const leak of [secret, 'note-9c1d', 'agent-2b8e', quote, ORIGIN]) expect(lines[0]).not.toContain(leak);
  });
});

describe('JSON mode', () => {
  it.each([
    [valid({ website: 'x' }), 200, 'sent'],
    [valid({ quote: 'on no page at all, anywhere' }), 422, 'not-found'],
    [valid({ quote: ' ' }), 400, 'rejected'],
    [valid({ page: 'admin' }), 400, 'rejected'],
    [valid(), 503, 'failed'],
  ])('%j answers %i %s', async (fields, status, outcome) => {
    const response = await answer(post(fields, { json: true }));
    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(await outcomeOf(response)).toBe(outcome);
  });

  it('keeps checks 1-4 on their own codes', async () => {
    expect((await answer(post(valid(), { json: true, headers: { Origin: 'https://evil.example' } }))).status).toBe(403);
  });
});

describe('every response', () => {
  it('carries no-store and nosniff', async () => {
    const requests = [
      new Request(ENDPOINT, { method: 'GET' }),
      post(valid(), { headers: { Origin: 'https://evil.example' } }),
      post(valid({ page: 'admin' })),
      post(valid()),
      post(valid(), { json: true }),
    ];
    for (const request of requests) {
      const response = await answer(request);
      expect(response.headers.get('Cache-Control'), `${response.status}`).toBe('no-store');
      expect(response.headers.get('X-Content-Type-Options'), `${response.status}`).toBe('nosniff');
    }
  });
});

describe('the health check', () => {
  it('answers 503 ok:false with no binding, and logs why', async () => {
    const lines: string[] = [];
    const response = await reportHealth(new Request(HEALTH), NO_DB, (line) => lines.push(line));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(lines).toHaveLength(1);
  });

  it('refuses any method but GET with 405 and Allow, before touching the binding', async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const response = await reportHealth(new Request(HEALTH, { method: 'POST' }), NO_DB, log);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // A GET with no binding logs why, so one line in all proves the log was
    // live and the POST never reached the binding.
    await reportHealth(new Request(HEALTH), NO_DB, log);
    expect(lines).toHaveLength(1);
  });

  it('matches the migration column set exactly, in any order', () => {
    expect(REPORT_COLUMNS).toEqual(['id', 'received_at', 'locale', 'page', 'quote', 'keys', 'suggestion', 'note']);
    expect(schemaMatches([...REPORT_COLUMNS].reverse())).toBe(true);
    expect(schemaMatches(REPORT_COLUMNS.slice(1))).toBe(false);
    expect(schemaMatches([...REPORT_COLUMNS, 'status'])).toBe(false);
    expect(schemaMatches([])).toBe(false);
  });
});
```

- [ ] **Step 3: Run red.**
      Run: `npx vitest run tests/unit/report-endpoint.test.ts 2>&1 | tail -40`
      Expected: every test FAILS with `not implemented`, except the
      `REPORT_COLUMNS` literal. That one fails on `schemaMatches`. The
      streamed check-4 test fails on the stub's throw, before its pull count
      is read. Any PASS is a finding.

- [ ] **Step 4: Implement.** Replace the three stubs:

```ts
const JSON_STATUS: Record<Outcome, number> = { sent: 200, 'not-found': 422, rejected: 400, failed: 503 };
/** `_headers` does not apply to Function responses, so every answer sets its own (spec 6.1). */
const ALWAYS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const;
const FORM_TYPE = 'application/x-www-form-urlencoded';
const INSERT = `INSERT INTO reports (${REPORT_COLUMNS.join(', ')}) VALUES (${REPORT_COLUMNS.map((_, at) => `?${at + 1}`).join(', ')})`;
const HEALTH_QUERY = "SELECT name FROM pragma_table_info('reports')";

const plain = (status: number, extra: Record<string, string> = {}): Response =>
  new Response(null, { status, headers: { ...ALWAYS, ...extra } });

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...ALWAYS, 'Content-Type': 'application/json; charset=utf-8' } });

const wantsJson = (request: Request): boolean => (request.headers.get('Accept') ?? '').includes('application/json');

/** Redirect mode's target is built from checked values only: nothing the visitor typed reaches a header. */
const outcome = (result: Outcome, request: Request, locale: Locale, page: PageId): Response =>
  wantsJson(request)
    ? json({ outcome: result }, JSON_STATUS[result])
    : plain(303, { Location: `${pagePath(page, locale)}#report-${result}` });

/** Below U+0020 except TAB and LF, or U+007F–U+009F: nothing a browser form sends. */
const hasControlCharacter = (text: string): boolean =>
  [...text].some((ch) => {
    const point = ch.codePointAt(0)!;
    return (point < 0x20 && point !== 0x09 && point !== 0x0a) || (point >= 0x7f && point <= 0x9f);
  });

const within = (text: string, min: number): boolean =>
  text.length >= min && text.length <= MAX_FIELD_UNITS && !hasControlCharacter(text);

/** A textarea's maxlength counts a line break as one unit; submission sends CRLF (spec 6.1). */
const field = (fields: URLSearchParams, name: string): string => (fields.get(name) ?? '').replace(/\r\n/g, '\n');

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : 'NonError: a value that is not an Error was thrown';

/**
 * The body, or null once it passes `cap` bytes. A chunked body declares no
 * Content-Length, so `arrayBuffer()` would hold all of it (up to the
 * platform's 100 MB) before check 4 could refuse it.
 */
async function readCapped(request: Request, cap: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

export async function handleReport(request: Request, env: ReportEnv, log: (line: string) => void = console.error): Promise<Response> {
  if (request.method !== 'POST') return plain(405, { Allow: 'POST' });
  const origin = request.headers.get('Origin');
  if (origin === null || origin !== new URL(request.url).origin) return plain(403);
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== FORM_TYPE) return plain(415);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return plain(413);
  const body = await readCapped(request, MAX_BODY_BYTES);
  if (body === null) return plain(413);

  const fields = new URLSearchParams(new TextDecoder().decode(body));
  const locale = fields.get('locale');
  const page = fields.get('page');
  if (!isLocale(locale) || !isBetaLocale(locale) || !isPageId(page))
    return wantsJson(request) ? json({ outcome: 'rejected' }, 400) : plain(400);

  if (field(fields, 'website') !== '') return outcome('sent', request, locale, page);

  const quote = field(fields, 'quote');
  const suggestion = field(fields, 'suggestion');
  const note = field(fields, 'note');
  if (!within(quote, 1) || normalise(quote, locale) === '' || !within(suggestion, 0) || !within(note, 0))
    return outcome('rejected', request, locale, page);

  const keys = matchingKeys(quote, page, locale);
  if (keys.length === 0) return outcome('not-found', request, locale, page);

  try {
    if (!env.REPORTS) throw new Error('the REPORTS binding is missing');
    await env.REPORTS.prepare(INSERT)
      .bind(crypto.randomUUID(), new Date().toISOString(), locale, page, quote, JSON.stringify(keys), suggestion, note)
      .run();
  } catch (error) {
    log(`report failed: ${describeError(error)}`);
    return outcome('failed', request, locale, page);
  }
  return outcome('sent', request, locale, page);
}

export const schemaMatches = (columns: readonly string[]): boolean =>
  columns.length === REPORT_COLUMNS.length && REPORT_COLUMNS.every((column) => columns.includes(column));

/** Proves the binding and the migration without writing a row, and returns no counts or content (spec 6.2). */
export async function reportHealth(request: Request, env: ReportEnv, log: (line: string) => void = console.error): Promise<Response> {
  if (request.method !== 'GET') return plain(405, { Allow: 'GET' });
  let ok = false;
  try {
    if (!env.REPORTS) throw new Error('the REPORTS binding is missing');
    const { results } = await env.REPORTS.prepare(HEALTH_QUERY).all<{ name: string }>();
    ok = schemaMatches(results.map(({ name }) => name));
    if (!ok) log('report health: the reports table does not match the migration');
  } catch (error) {
    log(`report health: ${describeError(error)}`);
  }
  return json({ ok }, ok ? 200 : 503);
}
```

- [ ] **Step 5: Run green, then everything.**
      Run: `npx vitest run tests/unit/report-endpoint.test.ts tests/unit/report.test.ts` → PASS.
      Run: `npm run typecheck 2>&1 | command grep -E "(error|warning|hint)s?"` → three lines, 0 each.
      Run: `npx prettier --write src/lib/report.ts tests/unit/report-endpoint.test.ts`.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/report.ts tests/unit/report-endpoint.test.ts
git commit -m "feat(report): the endpoint's nine checks, the health check and a clean log (Refs #97)"
```

- [ ] **Step 7: Mutate, whole file each time, predicting first** (spec 10's
      endpoint mutations). Restore each with `git checkout -- src/lib/report.ts`.
      (a) Store when the honeypot is filled: delete the `website` line → RED
      on check 6, because the missing binding logs a line. (b) Remove the
      Origin check → RED on check 2. (c) Build `Location` from
      `request.headers.get('Referer')` when present → RED on "never from
      Referer". (d) `MAX_FIELD_UNITS` → `Infinity` in `within` → RED on the
      1001 tests. (e) Swap `'not-found': 422` and `rejected: 400` → RED in
      JSON mode. (f) `reportHealth` answers `json({ ok: true }, 200)` without
      querying → RED on the 503 test. (g) Log `quote` in the catch → RED on
      the leak test. (h) Move the honeypot line above check 5 (read `locale`
      and `page` first, unchecked, and cast them) → RED on "5 comes before the
      honeypot": the unchecked `page` either throws in `pagePath` or
      redirects, and neither is a plain 400. (i) Count before folding: add
      `|| (fields.get('note') ?? '').length > MAX_FIELD_UNITS` to the
      `rejected` condition → RED on the CRLF test (1008 raw units). Dropping
      the fold altogether is not this mutation: the CR it leaves is a control
      character, so check 7 would refuse the note for a different reason.
      (j) Buffer the whole body: replace the `readCapped` call with
      `new Uint8Array(await request.arrayBuffer())` and its `null` test with
      `body.byteLength > MAX_BODY_BYTES` → RED on "stops reading": the status
      is still 413, and the pull count reads 65. (k) Delete `reportHealth`'s
      method line → RED on the health 405 test: it answers 503 and logs.
      (l) Check the quote's length alone: replace `!within(quote, 1)` with
      `!(quote.length >= 1 && quote.length <= MAX_FIELD_UNITS)` → RED on
      "refuses a control character … in any field", naming `quote`, and on no
      other test: the blank, zero-width and 1001-unit quotes are still refused.

---

### Task 7: the migration, the Functions, and the runbook

**Files:**
- Create: `migrations/0001_reports.sql`
- Create: `functions/api/report/index.js`, `functions/api/report/health.js`
- Create: `docs/runbooks/translation-reports.md`
- Modify: `tests/unit/cli-only.test.ts` (liveness), `tests/unit/report-endpoint.test.ts` (migration pin)

**Interfaces:**
- Consumes: `handleReport`, `reportHealth`, `REPORT_COLUMNS` (Task 6).
- Produces: `POST /api/report` and `GET /api/report/health` on any Pages
  deployment of this repo.

- [ ] **Step 1: Failing tests.** Append to `tests/unit/report-endpoint.test.ts`
      (add `import { readFileSync } from 'node:fs';` and
      `import { codeWithoutComments } from './source-text';`). Both read
      comment-stripped text, so a comment naming a column or an import cannot
      satisfy them (standing rule, #23):

```ts
describe('the migration', () => {
  // SQL line comments stripped: the migration's own column notes must not satisfy this.
  const sql = () =>
    readFileSync('migrations/0001_reports.sql', 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');

  it('creates exactly the columns the endpoint writes and the health check expects', () => {
    const body = /CREATE TABLE reports \(([\s\S]*)\);/.exec(sql())?.[1];
    expect(body, 'a CREATE TABLE reports statement').toBeDefined();
    const columns = body!
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0]);
    expect(columns).toEqual([...REPORT_COLUMNS]);
  });

  it('bounds every text column the way check 7 does', () => {
    // Anchored to each column's own line, so no other text can satisfy them
    // (`anchored-presence.test.ts`). The literal 1000 is tied to check 7 by
    // the pin on MAX_FIELD_UNITS.
    expect(MAX_FIELD_UNITS).toBe(1000);
    const text = sql();
    expect(text).toMatch(/^\s*quote\s+TEXT NOT NULL CHECK \(length\(quote\) BETWEEN 1 AND 1000\),\s*$/m);
    expect(text).toMatch(/^\s*suggestion\s+TEXT NOT NULL DEFAULT '' CHECK \(length\(suggestion\) <= 1000\),\s*$/m);
    expect(text).toMatch(/^\s*note\s+TEXT NOT NULL DEFAULT '' CHECK \(length\(note\) <= 1000\)\s*$/m);
  });
});

describe('the Pages Functions are plumbing only', () => {
  it.each([
    ['functions/api/report/index.js', 'handleReport'],
    ['functions/api/report/health.js', 'reportHealth'],
  ])('%s hands the request to %s', (file, handler) => {
    const code = codeWithoutComments(file, readFileSync(file, 'utf8'));
    expect(code).toMatch(new RegExp(`import \\{ ${handler} \\} from '\\.\\./\\.\\./\\.\\./src/lib/report'`));
    expect(code).toMatch(/^export const onRequest/m);
  });
});
```

      And in `tests/unit/cli-only.test.ts`, after `'resolves the imports it judges'`:

```ts
  it('walks the Pages Functions too', () => {
    // #97 put site code behind a Function. functions/ was already in the
    // walk; this proves the new one is reached, not merely listed.
    expect(shipped()).toContain('functions/api/report/index.js');
    expect(importsOf('functions/api/report/index.js').map(stem)).toContain('src/lib/report');
  });
```

- [ ] **Step 2: Run red.**
      Run: `npx vitest run tests/unit/report-endpoint.test.ts tests/unit/cli-only.test.ts 2>&1 | tail -20`
      Expected: FAIL. The migration and plumbing tests throw ENOENT, and
      `walks the Pages Functions too` fails on `toContain`, because
      `shipped()` does not list the file yet.

- [ ] **Step 3: The migration.** Create `migrations/0001_reports.sql` with
      spec section 7's statement verbatim (the `CREATE TABLE reports (…);`
      block, including its column comments).

- [ ] **Step 4: The Functions.** Create `functions/api/report/index.js`:

```js
/**
 * POST /api/report — a translation report from the footer form (#97).
 *
 * Plumbing only, like `_middleware.js`: every check lives in
 * `src/lib/report.ts`, unit-tested with real Request objects. Any method
 * reaches it, so the handler itself answers 405 with `Allow: POST`.
 *
 * ESM is required: wrangler ships ZERO Functions for a file using CommonJS.
 */
import { handleReport } from '../../../src/lib/report';

/** @param {{ request: Request, env: import('../../../src/lib/report').ReportEnv }} context */
export const onRequest = ({ request, env }) => handleReport(request, env);
```

      Create `functions/api/report/health.js`:

```js
/**
 * GET /api/report/health — proves the REPORTS binding and the migration
 * without writing a row (#97, spec 6.2). 200 {"ok":true} or 503 {"ok":false}.
 *
 * Plumbing only, like `index.js`: the handler answers any other method with
 * 405 itself, where a unit test can see it. Behind the dev Basic Auth gate
 * like every other path; a no-op gate on prod.
 */
import { reportHealth } from '../../../src/lib/report';

/** @param {{ request: Request, env: import('../../../src/lib/report').ReportEnv }} context */
export const onRequest = ({ request, env }) => reportHealth(request, env);
```

      If Task 2 took assumption 1's fallback, the imports read the generated
      table module instead (Task 5a).

- [ ] **Step 5: The runbook.** Create `docs/runbooks/translation-reports.md`.
      Spec section 7 writes the delete as `WHERE id = ?`, but the D1 console
      binds no parameters, so a runbook statement run as written would fail.
      The runbook spells out the id to replace:

````markdown
# Translation reports — runbook (#97)

Reports from the footer form land in the D1 table `reports`: database
`shyden-reports` on prod, `shyden-reports-dev` on dev, each bound to its Pages
project as `REPORTS`. A row exists only while its report is pending. Dealing
with a report deletes it; nothing is kept "just in case".

Run these in the Cloudflare dashboard's D1 console.

```sql
SELECT id, received_at, locale, page, quote, keys, suggestion, note
  FROM reports ORDER BY received_at;
-- once a report has been dealt with, with <id> replaced by its id from the SELECT
DELETE FROM reports WHERE id = '<id>';
-- dev database only: the rows the dev sanity suite writes, one per dev deploy
DELETE FROM reports WHERE note LIKE 'automated dev check %';
```

**A ticket raised from a report goes into a public repository.** It carries
the locale, the key and, once reviewed, the suggested wording. It never
carries the note.

`GET /api/report/health` answers `200 {"ok":true}` when the binding and the
table's columns match `migrations/0001_reports.sql`, and `503` otherwise. The
dev and prod sanity suites call it after every deploy.
````

- [ ] **Step 6: Run green, then everything.**
      Run: `npx vitest run tests/unit/report-endpoint.test.ts tests/unit/cli-only.test.ts` → PASS.
      Run: `npm run typecheck 2>&1 | command grep -E "(error|warning|hint)s?"` → three lines, 0 each.
      This is where assumption 1 is proven in `astro check`: the Functions are
      `checkJs`, so a bad import path or JSDoc type fails here.

- [ ] **Step 7: Commit.**

```bash
git add migrations/0001_reports.sql functions/api/report docs/runbooks/translation-reports.md tests/unit/report-endpoint.test.ts tests/unit/cli-only.test.ts
git commit -m "feat(report): the reports migration, the two Functions and the runbook (Refs #97)"
```

- [ ] **Step 8: Mutate.** (a) Drop the `note` line from the migration → RED
      on "creates exactly the columns". (b) Leave the `note` column deleted but
      add a comment line `-- note TEXT NOT NULL DEFAULT ''` in its place →
      still RED, which proves the comment is stripped. (c) Comment out
      `index.js`'s import line and add a comment repeating it → RED on "hands
      the request to handleReport". Restore each.

---

### Task 8: the footer form, and its presence in every beta locale

**Files:**
- Modify: `src/components/Footer.astro`
- Create: `tests/e2e/report-presence.spec.ts` (no action, so no recording)
- Create: `tests/e2e/report-form.spec.ts` (acts, so `test.use(recorded)`)

**Interfaces:**
- Consumes: `pageIdFromPath`, `reportOptions`, `MAX_FIELD_UNITS`, `type Outcome`
  (Tasks 5–6); `SiteStrings['report']` (Task 4).
- Produces: the DOM contract Task 9's script reads. These are
  `form[data-report-form]` inside `details[data-report]`, the fields `locale`,
  `page`, `quote`, `suggestion`, `note` and `website`, one
  `button[type="submit"]`, and four `p.report-status[data-report-status="<outcome>"]`
  with ids `report-sent`, `report-not-found`, `report-rejected` and
  `report-failed`. The script sets `data-report-state` on each: `shown` on
  the one it shows, `superseded` on the rest.

- [ ] **Step 1: Failing presence tests.** Create `tests/e2e/report-presence.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { filesUnder, searched } from '../source-files';
import { PREFIXED_LOCALES, getSiteStrings, isBetaLocale, isLocale } from '../../src/lib/i18n';
import { PAGE_IDS, pagePath, reportOptions, type Outcome } from '../../src/lib/report';

/**
 * The report form's presence and contents, read from what was built (#97,
 * spec 3.2 and 10). Derived from dist/, so a page added later is judged the
 * day it is built, and English is covered by the same walk that covers the
 * beta locales. Read inside the test, never at module scope: Playwright loads
 * this file before its web server rebuilds dist/, so a module-scope read
 * would judge the previous build, and a mutation would never reach it.
 */
const built = () =>
  filesUnder('dist', (path) => /\.html$/.test(path)).map((file) => ({
    file,
    html: readFileSync(file, 'utf8'),
  }));
const langOf = (html: string) => /<html[^>]*\slang="([^"]+)"/.exec(html)?.[1];

test('a built page with a footer carries the form exactly when its locale is beta', () => {
  const footed = built().filter(({ html }) => html.includes('<footer'));
  const findings = footed.flatMap(({ file, html }) => {
    const lang = langOf(html);
    const want = isLocale(lang) && isBetaLocale(lang);
    const has = html.includes('data-report-form');
    return has === want ? [] : [`${file}: lang=${lang} form=${has}`];
  });
  expect(searched(findings, { of: footed.map(({ file }) => file), what: 'built pages with a footer' })).toEqual([]);
  expect(footed.filter(({ html }) => html.includes('data-report-form')).length).toBeGreaterThan(0);
});

for (const locale of PREFIXED_LOCALES)
  for (const page of PAGE_IDS)
    test(`${pagePath(page, locale)}: the type-ahead offers exactly this page's strings`, async ({ page: tab }) => {
      await tab.goto(pagePath(page, locale));
      const offered = await tab.locator('#report-strings option').evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      );
      expect(new Set(offered)).toEqual(new Set(reportOptions(page, locale)));
      expect(offered.length).toBe(reportOptions(page, locale).length);
    });

const OUTCOMES: readonly Outcome[] = ['sent', 'not-found', 'rejected', 'failed'];
const COPY: Record<Outcome, 'sent' | 'notFound' | 'rejected' | 'failed'> = {
  sent: 'sent',
  'not-found': 'notFound',
  rejected: 'rejected',
  failed: 'failed',
};

for (const locale of PREFIXED_LOCALES)
  for (const outcome of OUTCOMES)
    test(`${locale}: #report-${outcome} shows, takes focus, and hides the rest`, async ({ page }) => {
      await page.goto(`${pagePath('home', locale)}#report-${outcome}`);
      const shown = page.locator(`#report-${outcome}`);
      await expect(shown).toBeVisible();
      await expect(shown).toHaveText(getSiteStrings(locale).report[COPY[outcome]]);
      await expect(shown).toHaveAttribute('role', 'status');
      await expect(shown).toBeFocused();
      for (const other of OUTCOMES.filter((o) => o !== outcome)) {
        await expect(page.locator(`#report-${other}`)).toHaveCount(1);
        await expect(page.locator(`#report-${other}`)).toBeHidden();
      }
    });
```

      **Assumption 4.** If an engine fails `toBeFocused` while `toBeVisible`
      passes, re-run that one test with full output to confirm the cause. Then
      add `browserName` to the test's fixtures and replace the focus line with
      `if (browserName === '<engine>') test.info().annotations.push({ type: 'focus-not-moved', description: '<the measured reason>' }); else await expect(shown).toBeFocused();`,
      naming only the engine that was measured. Record the engine and the
      reason in the Measurements table (row 4). The homepage gains no script
      to force focus (spec 11).

- [ ] **Step 2: Failing acting tests.** Create `tests/e2e/report-form.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { recorded } from './evidence';
import { atLeast44, expectNoHorizontalScroll } from '../viewport';
import { contrastRatio } from './helpers';
import { PREFIXED_LOCALES, getSiteStrings } from '../../src/lib/i18n';
import { PAGE_IDS, pagePath } from '../../src/lib/report';

test.use(recorded);

test('the disclosure opens from the keyboard and walks its fields in order', async ({ page }) => {
  await page.goto(pagePath('home', 'vi'));
  const t = getSiteStrings('vi').report;
  const summary = page.locator('[data-report] summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-report]')).toHaveAttribute('open', '');
  for (const label of [t.quoteLabel, t.suggestionLabel, t.noteLabel]) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label, { exact: true })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: t.send })).toBeFocused();
  // The hints are joined by aria-describedby (spec 3.4).
  await expect(page.getByLabel(t.quoteLabel, { exact: true })).toHaveAccessibleDescription(t.quoteHint);
  await expect(page.getByLabel(t.noteLabel, { exact: true })).toHaveAccessibleDescription(t.noteHint);
  // A formatter that re-wraps `<textarea></textarea>` gives it a default
  // value of whitespace, which a visitor would then submit.
  await expect(page.getByLabel(t.suggestionLabel, { exact: true })).toHaveValue('');
  await expect(page.getByLabel(t.noteLabel, { exact: true })).toHaveValue('');
});

test('every control is at least 44px, every text meets AA, every field has a 3:1 boundary', async ({ page }) => {
  await page.goto(pagePath('glory-points', 'th'));
  const t = getSiteStrings('th').report;
  await page.locator('[data-report] summary').click();
  for (const target of [
    page.locator('[data-report] summary'),
    page.getByLabel(t.quoteLabel, { exact: true }),
    page.getByLabel(t.suggestionLabel, { exact: true }),
    page.getByLabel(t.noteLabel, { exact: true }),
    page.getByRole('button', { name: t.send }),
  ])
    await atLeast44(target);
  for (const text of [
    page.locator('[data-report] summary'),
    page.locator('[data-report] form > p').first(),
    page.locator('#report-quote-hint'),
    page.locator('#report-note-hint'),
    page.locator('label[for="report-quote"]'),
    page.getByRole('button', { name: t.send }),
  ])
    expect(await contrastRatio(text)).toBeGreaterThanOrEqual(4.5);
  // WCAG 1.4.11: each field's boundary is --border-strong, the token
  // contrast.test.ts scores at 3:1. #133 shipped --border (1.17:1) on every
  // control. Resolved by the browser, so both sides are computed rgb.
  const strong = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--border-strong)';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  for (const label of [t.quoteLabel, t.suggestionLabel, t.noteLabel])
    await expect(page.getByLabel(label, { exact: true })).toHaveCSS('border-top-color', strong);
});

for (const locale of PREFIXED_LOCALES)
  for (const pageId of PAGE_IDS)
    test(`${pagePath(pageId, locale)}: no sideways scroll at 320px with the form open`, { tag: '@emulated-viewport' }, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(pagePath(pageId, locale));
      await page.locator('[data-report] summary').click();
      await expect(page.locator('[data-report]')).toHaveAttribute('open', '');
      await expectNoHorizontalScroll(page);
      // Page-level scrollWidth is not containment (CLAUDE.md): nothing in the
      // form may escape the footer's own column.
      const column = await page.locator('footer .inner').boundingBox();
      expect(column, 'the footer column has a box').not.toBeNull();
      const boxes = await page
        .locator('[data-report] form > *:not(.hp):not(input[type="hidden"]):not(datalist)')
        .evaluateAll((els) => els.map((el) => ({ right: el.getBoundingClientRect().right, name: el.tagName })));
      for (const box of boxes) expect(box.right, box.name).toBeLessThanOrEqual(column!.x + column!.width + 0.5);
      // Liveness by content, after the invariant: the widest controls were measured.
      expect(boxes.map(({ name }) => name)).toEqual(expect.arrayContaining(['INPUT', 'TEXTAREA', 'BUTTON']));
    });
```

- [ ] **Step 3: Run red.** Build, then run both specs on one engine first:
      Run: `npm run build > /dev/null 2>&1; npx playwright test tests/e2e/report-presence.spec.ts tests/e2e/report-form.spec.ts --project=chromium 2>&1 | tail -30`
      Expected: every test FAILS. The presence walk lists every beta page
      with `form=false`, and the other tests time out on the missing locators.
      English pages are not among the findings, because they rightly have no
      form. That is why the walk also asserts that at least one built page
      carries the form: without that line, a build with no form anywhere would
      fail only on the beta pages the walk happened to find.

- [ ] **Step 4: Implement the footer.** In `src/components/Footer.astro`'s
      frontmatter, add:

```ts
import { MAX_FIELD_UNITS, pageIdFromPath, reportOptions, type Outcome } from '../lib/report';

// The report form (#97): beta locales only, derived, so English never shows
// it. The page comes from the route, so no page has to remember a prop; a
// path the table does not know renders no form, and the presence check in
// report-presence.spec.ts fails on it rather than letting it go quietly.
const reportPage = isBetaLocale(lang) ? pageIdFromPath(Astro.url.pathname) : null;
const reportStatuses: ReadonlyArray<[Outcome, string]> = [
  ['sent', t.report.sent],
  ['not-found', t.report.notFound],
  ['rejected', t.report.rejected],
  ['failed', t.report.failed],
];
```

      In the markup, directly after the `betaNotice` paragraph:

```astro
    {reportPage && (
      <details class="report" data-report>
        <summary>{t.report.open}</summary>
        <form method="post" action="/api/report" data-report-form>
          <p>{t.report.intro}</p>
          <input type="hidden" name="locale" value={lang} />
          <input type="hidden" name="page" value={reportPage} />
          <label for="report-quote">{t.report.quoteLabel}</label>
          <input
            id="report-quote"
            name="quote"
            type="text"
            list="report-strings"
            required
            maxlength={MAX_FIELD_UNITS}
            autocomplete="off"
            aria-describedby="report-quote-hint"
          />
          <p id="report-quote-hint" class="hint">{t.report.quoteHint}</p>
          <datalist id="report-strings">
            {reportOptions(reportPage, lang).map((option) => <option value={option} />)}
          </datalist>
          <label for="report-suggestion">{t.report.suggestionLabel}</label>
          <textarea id="report-suggestion" name="suggestion" maxlength={MAX_FIELD_UNITS}></textarea>
          <label for="report-note">{t.report.noteLabel}</label>
          <textarea
            id="report-note"
            name="note"
            maxlength={MAX_FIELD_UNITS}
            aria-describedby="report-note-hint"></textarea>
          <p id="report-note-hint" class="hint">{t.report.noteHint}</p>
          <div class="hp" aria-hidden="true">
            <label for="report-website">{t.report.honeypotLabel}</label>
            <input id="report-website" name="website" tabindex="-1" autocomplete="off" />
          </div>
          <button type="submit">{t.report.send}</button>
        </form>
      </details>
    )}
    {reportPage &&
      reportStatuses.map(([result, text]) => (
        <p id={`report-${result}`} class="report-status" role="status" tabindex="-1" data-report-status={result}>
          {text}
        </p>
      ))}
```

      Append to the component's `<style>`:

```css
  /* The report form (#97). Tokens only, so the computed-style contrast
     guards apply; every control 44px; inputs take their width from the
     column, because an input's intrinsic width once pinned #cg-form wide at
     320px. */
  .report summary {
    min-height: 44px;
    padding-block: 0.6rem;
    cursor: pointer;
    color: var(--accent);
  }
  .report form {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .report input,
  .report textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 44px;
    padding: 0.5rem;
    font: inherit;
    color: var(--ink);
    background: var(--bg);
    /* --border-strong, never --border: a control's only boundary must reach
       3:1 (WCAG 1.4.11), and --border is decorative (#133). */
    border: 1px solid var(--border-strong);
    border-radius: 6px;
  }
  .report textarea {
    min-height: 5rem;
  }
  .report button {
    justify-self: start;
    min-width: 44px;
    min-height: 44px;
    padding: 0.5rem 1rem;
    font: inherit;
    color: var(--bg);
    background: var(--accent);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  /* Visually hidden in a 1px box in normal flow. Never display: none, which
     some bots skip; never positioned, which is how BetaBadge once produced
     sideways scroll at 320px. */
  .hp {
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* A status shows when it is the fragment's target (the homepage, after its
     303) or when the tool-page script marks it. Outside the <details>, which
     renders nothing while closed. */
  .report-status {
    display: none;
    color: var(--ink);
  }
  .report-status:target,
  .report-status[data-report-state='shown'] {
    display: block;
  }
  /* A tool page reached by the plain POST's 303 (a click before its script
     loaded) keeps that status as its :target. The script supersedes it when
     it shows a newer one, so exactly one is ever visible. Last, so it wins
     over :target at equal specificity. */
  .report-status[data-report-state='superseded'] {
    display: none;
  }
  @media print {
    .report,
    .report-status {
      display: none;
    }
  }
```

      Before settling the colours, check which tokens `contrast.test.ts` scores
      as a pair (`command grep -n "accent\|--bg\|--ink" tests/unit/contrast.test.ts | head`).
      The button's `--bg` on `--accent` and the summary's `--accent` on the
      footer ground must be pairs it already scores. If one is not, use the
      pair that `Button.astro` uses for a filled button, so that no new
      unscored pair is painted.

- [ ] **Step 5: Run green, all five engines.**
      Run: `npm run build > /dev/null 2>&1; npx playwright test tests/e2e/report-presence.spec.ts tests/e2e/report-form.spec.ts 2>&1 | tail -30`
      Expected: all pass, unless an engine does not move focus (assumption 4;
      Step 1 says what to do). Then:
      Run: `npx vitest run tests/unit/dead-copy.test.ts` → PASS now that the
      footer reads every `t.report.*` key.
      Run: `npm run test:unit 2>&1 | tail -6` → all pass. Watch for
      `evidence-recording`, `viewport-tagging`, `capture-after-assertion`,
      `absence-liveness` and `colour-literals`: when one flags the new code,
      change the code, never the guard.
      Run: `npm run test:e2e 2>&1 | tail -15` → the whole suite, default
      workers. A new `<details>` in every beta footer can meet any spec that
      derives disclosures or counts footer elements; read every failure's
      error text before touching anything.
      Run: `npx prettier --write src/components/Footer.astro tests/e2e/report-presence.spec.ts tests/e2e/report-form.spec.ts`.

- [ ] **Step 6: Commit.**

```bash
git add src/components/Footer.astro tests/e2e/report-presence.spec.ts tests/e2e/report-form.spec.ts
git commit -m "feat(report): the footer's report form in every beta locale (Refs #97)"
```

- [ ] **Step 7: Mutate, predicting first, whole spec file each time, on
      chromium ((g) on `content`).** Rebuild after every source edit (the suite measures `dist/`),
      and restore with `git checkout -- src/components/Footer.astro`. (a) Drop
      the `isBetaLocale` gate (`const reportPage = pageIdFromPath(…)`) → RED on
      the presence walk, English pages. (b) Gate it to `lang === 'vi'` → RED
      on the presence walk for id, zh and th. (c) Delete the
      `.report-status:target` selector → RED on every `#report-*` test.
      (d) Append `.report summary { min-height: 30px; padding-block: 0; }` →
      RED on 44px (the padding goes too, so the text's own line box cannot
      reach 44px). (e)
      `#report-quote` gets `width: 400px` (append
      `.report #report-quote { width: 400px; }`) → RED on the 320px tests.
      (f) Draw the fields' border in `var(--border)` → RED on "every field
      has a 3:1 boundary", naming `border-top-color`.
      (g) Put the tool-page script in the footer (spec 10's wording). Append
      to `Footer.astro`, after `</style>`:

```astro
<script>
  import { enhanceReportForm } from '../scripts/report-form';
  const form = document.querySelector<HTMLFormElement>('[data-report-form]');
  if (form) enhanceReportForm(form);
</script>
```

      A bare `import '../scripts/report-form.ts'` is no mutation: the module
      only exports functions, so the build drops it and emits no script at
      all (measured in review pass 4, GREEN with no chunk in `dist/_astro`).
      This is valid once Task 9 has created the file, so run (g) after Task 9,
      on the `content` project, the only one that runs `theme-script.spec.ts`
      (`--project=chromium` finds no tests there and exits 1):
      `npx playwright test tests/e2e/theme-script.spec.ts --project=content`
      → RED on all 16 pages the inventory checks, the homepage and the 404
      among them, each gaining a module it did not carry. Confirm each RED
      names the property you broke, then restore and confirm green.

---

### Task 9: the tool pages submit in place

**Files:**
- Create: `src/scripts/report-form.ts`
- Create: `tests/unit/report-form.test.ts`
- Modify: `src/scripts/glory-points.ts`, `src/scripts/classroom-groups.ts` (one call each)
- Modify: `tests/e2e/report-form.spec.ts` (append)

**Interfaces:**
- Consumes: the DOM contract from Task 8; `type Outcome` (type-only import).
- Produces: `enhanceReportForm(form: HTMLFormElement): void`,
  `outcomeOf(response: Response): Promise<Outcome>`,
  `showStatus(root: ParentNode, outcome: Outcome): HTMLElement | null`.

- [ ] **Step 1: Stubs and failing unit tests.** Create
      `src/scripts/report-form.ts` with the three exports throwing
      `not implemented`, and `tests/unit/report-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { outcomeOf } from '../../src/scripts/report-form';

/** The tool-page script's reading of a response: real Response objects, no network. */
describe('outcomeOf', () => {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it.each([
    ['sent', 200],
    ['not-found', 422],
    ['rejected', 400],
    ['failed', 503],
  ])('reads %s from its own status', async (outcome, status) => {
    expect(await outcomeOf(json({ outcome }, status))).toBe(outcome);
  });

  it('reads failed from anything it cannot trust', async () => {
    expect(await outcomeOf(new Response(null, { status: 403 }))).toBe('failed');
    expect(await outcomeOf(new Response('<!doctype html><p>Not found', { status: 404 }))).toBe('failed');
    expect(await outcomeOf(json({ outcome: 'hacked' }, 200))).toBe('failed');
    expect(await outcomeOf(json(null, 200))).toBe('failed');
    expect(await outcomeOf(json(['sent'], 200))).toBe('failed');
  });
});
```

      Run: `npx vitest run tests/unit/report-form.test.ts` → every test FAILS
      on `not implemented`.

- [ ] **Step 2: Implement.** Replace the stubs:

```ts
/**
 * The tool pages submit the report form in place (#97, spec 3.3).
 *
 * `/classroom-groups` keeps a teacher's roster in memory only, so a
 * full-page POST would wipe the class list. Each tool page's own script calls
 * `enhanceReportForm`; the footer carries no script, so nothing new reaches
 * the homepage, which keeps the plain POST and its `:target` status. If this
 * script fails to load, the plain POST still works, and there is then no
 * roster to lose.
 */
// Type-only, deliberately: a value import would put report.ts's catalogue
// walk and matcher into the browser bundle for nothing.
import type { Outcome } from '../lib/report';

// A Record, so adding an outcome to the union without adding it here fails
// to compile; the list is the Record's keys.
const EVERY_OUTCOME: Record<Outcome, true> = { sent: true, 'not-found': true, rejected: true, failed: true };
const isOutcome = (value: unknown): value is Outcome =>
  typeof value === 'string' && Object.hasOwn(EVERY_OUTCOME, value);

/** The outcome a response carries, and `failed` for anything else: a 403, an HTML page, a body that is not ours. */
export async function outcomeOf(response: Response): Promise<Outcome> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return 'failed';
  }
  const outcome = body && typeof body === 'object' && !Array.isArray(body) ? (body as { outcome?: unknown }).outcome : undefined;
  return isOutcome(outcome) ? outcome : 'failed';
}

/** Show exactly one status and move focus to it, as the fragment does on the homepage. */
export function showStatus(root: ParentNode, outcome: Outcome): HTMLElement | null {
  let shown: HTMLElement | null = null;
  for (const status of root.querySelectorAll<HTMLElement>('[data-report-status]')) {
    const match = status.dataset.reportStatus === outcome;
    // 'superseded' outranks :target, which a URL fragment may still hold
    // (Footer.astro's CSS), so exactly one status is visible.
    status.dataset.reportState = match ? 'shown' : 'superseded';
    if (match) shown = status;
  }
  shown?.focus();
  return shown;
}

/** Send the form with fetch and never reload; one submission at a time. */
export function enhanceReportForm(form: HTMLFormElement): void {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  let pending = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    if (button) button.disabled = true;
    const body = new URLSearchParams();
    for (const [name, value] of new FormData(form)) if (typeof value === 'string') body.append(name, value);
    let outcome: Outcome = 'failed';
    try {
      outcome = await outcomeOf(await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body }));
    } catch {
      outcome = 'failed';
    } finally {
      pending = false;
      if (button) button.disabled = false;
    }
    if (outcome === 'sent') form.reset();
    showStatus(document, outcome);
  });
}
```

      Run: `npx vitest run tests/unit/report-form.test.ts` → PASS. Nothing
      calls `enhanceReportForm` yet.

- [ ] **Step 3: Failing e2e test for the tool page.** Append to
      `tests/e2e/report-form.spec.ts`, and add `getStrings` to its
      `../../src/lib/i18n` import. The preview serving `dist/` runs no Function, so a submission
      meets a response that is not ours. That is the `failed` path, and the
      roster must survive it (spec 3.3's hazard; Task 10 proves `sent` on the
      real runtime).

```ts
test('/vi/classroom-groups submits in place: failed shows, takes focus, and the roster survives', async ({ page }) => {
  const tool = getStrings('vi');
  const t = getSiteStrings('vi').report;
  await page.goto(pagePath('classroom-groups', 'vi'));
  await page.locator('#cg-students-toggle').click();
  await page.getByRole('button', { name: tool.rosterAddStudent }).click();
  await page.locator('.cg-student').first().getByLabel(tool.rosterColName).fill('Lan');
  await page.evaluate(() => ((window as unknown as { unreloaded: boolean }).unreloaded = true));

  await page.locator('[data-report] summary').click();
  await page.getByLabel(t.quoteLabel, { exact: true }).fill(t.open);
  await page.getByRole('button', { name: t.send }).click();

  const failed = page.locator('#report-failed');
  await expect(failed).toBeVisible();
  await expect(failed).toHaveText(t.failed);
  await expect(failed).toBeFocused();
  await expect(page.locator('#report-sent')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { unreloaded?: boolean }).unreloaded)).toBe(true);
  await expect(page.locator('.cg-student').first().getByLabel(tool.rosterColName)).toHaveValue('Lan');
  await expect(page.getByLabel(t.quoteLabel, { exact: true })).toHaveValue(t.open);
});
```

- [ ] **Step 4: Run it red.** Nothing is wired yet, so the form does a plain
      POST, and the preview answers with a page that is not the tool.
      Run: `npm run build > /dev/null 2>&1; npx playwright test tests/e2e/report-form.spec.ts -g "submits in place" --project=chromium 2>&1 | tail -15`
      Expected: FAIL. `#report-failed` never becomes visible, because the
      browser navigated away and the roster went with it.

- [ ] **Step 5: Wire both tool scripts, and run green.** At the end of
      `src/scripts/glory-points.ts` and of `src/scripts/classroom-groups.ts`,
      add the lines below. Put the import after the file's last complete
      single-line import (`^import .*;$`), never inside a multi-line one:

```ts
import { enhanceReportForm } from './report-form';
// …
// The footer's report form exists only in beta locales (#97).
const reportForm = document.querySelector<HTMLFormElement>('[data-report-form]');
if (reportForm) enhanceReportForm(reportForm);
```

      Run: `npm run build > /dev/null 2>&1; npx playwright test tests/e2e/report-form.spec.ts 2>&1 | tail -15` → all pass, five engines.
      Run: `npx playwright test tests/e2e/theme-script.spec.ts 2>&1 | tail -5` → PASS.
      The tool pages still carry one external module each, because
      `report-form.ts` is bundled into it.
      Run: `npm run test:unit 2>&1 | tail -6` → all pass.
      Run: `npx prettier --write src/scripts/report-form.ts src/scripts/glory-points.ts src/scripts/classroom-groups.ts tests/unit/report-form.test.ts tests/e2e/report-form.spec.ts`.

- [ ] **Step 6: Commit.**

```bash
git add src/scripts/report-form.ts src/scripts/glory-points.ts src/scripts/classroom-groups.ts tests/unit/report-form.test.ts tests/e2e/report-form.spec.ts
git commit -m "feat(report): the tool pages submit the report in place (Refs #97)"
```

- [ ] **Step 7: Mutate.** (a) Delete `event.preventDefault();` and rebuild →
      RED on the tool-page test: the roster is gone and `unreloaded` is
      undefined. (b) Delete `shown?.focus();` and rebuild → RED on
      `toBeFocused`. (c) Return `'sent'` from `outcomeOf`'s catch → RED in
      `report-form.test.ts`. Restore each with
      `git checkout -- src/scripts/report-form.ts`.
      (d) What holds the `report` copy in `dead-copy`? Its group check
      matches `\.report\b` anywhere in `src/`, and `from './report-form'`
      now satisfies it by itself. Delete the footer's whole report markup
      (not the frontmatter), and predict RED on `dead-copy` naming the report
      keys whose names no other code shares, such as `report.quoteLabel` and
      `report.honeypotLabel`. Keys like `open` or `intro` may be read
      elsewhere under the same name, so do not predict them. Confirm that
      the key-level check is what catches it, and record that in the PR body. If it stays green, the section is unguarded: make
      `isReferenced` ignore module specifiers (strip `from '…'` and
      `import('…')` strings before matching), mutation-verify that change both
      ways, and commit it separately.

---

### Task 10: the real Function on workerd, in CI

**Files:**
- Create: `playwright.functions.config.ts`
- Create: `tests/functions/local.mjs`, `tests/functions/serve.mjs`,
  `tests/functions/report.spec.ts`, `tests/report-health.ts`; keep or create
  `tests/functions/wrangler.toml` (Task 2)
- Modify: `package.json` (`test:functions`), `.github/workflows/ci.yml`
  (`functions` job, `build-and-test.needs`)
- Modify: `tests/unit/pipeline-wiring.test.ts` (the job guard)

**Interfaces:**
- Consumes: everything above; the Measurements table (rows 2, 3, 5, 6).
- Produces: `npm run test:functions`, and the `functions` CI job that
  `build-and-test` needs.

- [ ] **Step 1: The local constants and row reader.** Create
      `tests/functions/local.mjs`:

```js
/**
 * The functions-runtime tests' local stack (#97, spec 10): `wrangler pages
 * dev` serving dist/ with the real Functions on workerd, over a local D1 that
 * has the real migration applied. One home for the values the server, the
 * config and the specs must agree on.
 */
import { spawnSync } from 'node:child_process';

export const PORT = 8799;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** The dev middleware gates every non-prod host and fails closed without a password. */
export const PASSWORD = 'functions-local';
export const PERSIST = '.wrangler/functions-test';
export const CONFIG = 'tests/functions/wrangler.toml';
export const DATABASE = 'reports-local';
export const DATABASE_ID = '00000000-0000-4000-8000-000000000097';

/**
 * Run wrangler's D1 CLI against the local database, and fail loudly with its own words.
 * @param {readonly string[]} args
 * @returns {string} stdout
 */
export function d1(args) {
  const run = spawnSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--local', '--persist-to', PERSIST, '--config', CONFIG, ...args], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`wrangler d1 execute failed (${run.status}): ${run.stderr || run.stdout}`);
  return run.stdout;
}

/**
 * Every stored report whose note is exactly `note`. Each test writes a note
 * of its own, so tests never read each other's rows. The note travels as
 * a SQL string literal, so single quotes are doubled.
 * @param {string} note
 * @returns {Array<{ locale: string, page: string, quote: string, keys: string, suggestion: string, note: string }>}
 */
export function reportsWithNote(note) {
  const literal = `'${note.replaceAll("'", "''")}'`;
  const out = d1(['--json', '--command', `SELECT locale, page, quote, keys, suggestion, note FROM reports WHERE note = ${literal}`]);
  return JSON.parse(out)[0].results;
}
```

      If Task 2 recorded that `wrangler d1 execute` cannot read while `pages
      dev` holds the database, replace `reportsWithNote`'s body with a
      read-only `node:sqlite` open of the one `.sqlite` file under
      `${PERSIST}/v3/d1/`, found by `readdirSync` and asserted to be exactly
      one file.

      Then create `tests/report-health.ts`, the health assertion's one home.
      This suite and the dev and prod sanity suites (Task 12) all call it,
      and `duplication.test.ts` refuses three copies of the body:

```ts
import { expect, type APIRequestContext } from '@playwright/test';

/**
 * The report endpoint's health check answers ok (#97, spec 6.2): the REPORTS
 * binding is present and its table has the migration's columns. The one home
 * for the functions-runtime suite and the dev and prod sanity suites.
 */
export async function expectReportsBound(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/report/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
}
```

- [ ] **Step 2: The server.** Create `tests/functions/serve.mjs`:

```js
#!/usr/bin/env node
/**
 * Build, reset the local D1, apply the real migration, then serve dist/ with
 * the real Functions (#97). Playwright's webServer runs this for every run,
 * never reusing a server, so each run and each mutation meets a fresh build
 * and a fresh database. The first test proves the binding and the migration.
 */
import { rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { DATABASE_ID, PASSWORD, PERSIST, PORT, d1 } from './local.mjs';

/**
 * @param {string} command
 * @param {string[]} args
 */
const step = (command, args) => {
  const run = spawnSync(command, args, { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`${command} ${args.join(' ')} exited ${run.status}`);
    process.exit(run.status ?? 1);
  }
};

rmSync(PERSIST, { recursive: true, force: true });
step('npm', ['run', 'build']);
d1(['--file', 'migrations/0001_reports.sql']);

const server = spawn(
  'npx',
  ['wrangler', 'pages', 'dev', 'dist', '--ip', '127.0.0.1', '--port', String(PORT), '--compatibility-date', '2026-09-01', '--d1', `REPORTS=${DATABASE_ID}`, '--persist-to', PERSIST, '--binding', `DEV_PASSWORD=${PASSWORD}`],
  { stdio: 'inherit' },
);
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM']))
  process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 1));
```

      Use the `--d1` form that Task 2 measured as sharing the store.

- [ ] **Step 3: The config.** Create `playwright.functions.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PASSWORD } from './tests/functions/local.mjs';

/**
 * The Functions-runtime suite (#97, spec 10): real submissions to the real
 * Pages Functions on workerd, through `wrangler pages dev`. One worker,
 * because every test shares one server and one local database.
 */
export default defineConfig({
  testDir: './tests/functions',
  workers: 1,
  forbidOnly: !!process.env.CI,
  webServer: {
    command: 'node tests/functions/serve.mjs',
    // webServer takes no credentials, and the dev gate answers 401 without
    // them, which Playwright counts as up. So readiness only means "serving";
    // the health test, first in the file with one worker, is what proves the
    // binding and the migration.
    url: `${BASE_URL}/`,
    // Never reuse: a server left running would hold an older build, and a
    // mutation would then be tested against code it never reached.
    reuseExistingServer: false,
    timeout: 240_000,
  },
  use: {
    baseURL: BASE_URL,
    colorScheme: 'dark',
    httpCredentials: { username: 'dev', password: PASSWORD, send: 'always' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 4: The runtime tests.** Create `tests/functions/report.spec.ts`
      (each is seen red by its own mutation in Step 8):

```ts
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { getSiteStrings, getStrings } from '../../src/lib/i18n';
import { pagePath } from '../../src/lib/report';
import { expectReportsBound } from '../report-health';
import { reportsWithNote } from './local.mjs';

const vi = getSiteStrings('vi').report;
const tool = getStrings('vi');
const noteFor = (what: string) => `functions test ${what} ${randomUUID()}`;

async function fillReport(page: Page, quote: string, note: string) {
  await page.locator('[data-report] summary').click();
  await page.getByLabel(vi.quoteLabel, { exact: true }).fill(quote);
  await page.getByLabel(vi.noteLabel, { exact: true }).fill(note);
}

test('the health check sees the binding and the migrated table', async ({ request }) => {
  await expectReportsBound(request);
});

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  // The tag is `isolated-context-tagging`'s rule for every spec directory:
  // javaScriptEnabled is inert on the real-device harness. This suite never
  // runs there, and the tag says so rather than leaving it to be noticed.
  test('the homepage posts, lands on #report-sent, and the row is stored', { tag: '@requires-isolated-context' }, async ({ page }) => {
    const note = noteFor('homepage');
    await page.goto(pagePath('home', 'vi'));
    await fillReport(page, vi.open, note);
    await page.getByRole('button', { name: vi.send }).click();
    await expect(page).toHaveURL(/\/vi\/#report-sent$/);
    await expect(page.locator('#report-sent')).toBeVisible();
    const rows = reportsWithNote(note);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ locale: 'vi', page: 'home', quote: vi.open, suggestion: '', note });
    expect(JSON.parse(rows[0].keys)).toContain('site.report.open');
  });

  test('a quote on no page lands on #report-not-found and stores nothing', { tag: '@requires-isolated-context' }, async ({ page }) => {
    const note = noteFor('not-found');
    await page.goto(pagePath('home', 'vi'));
    await fillReport(page, 'on no page at all, anywhere', note);
    await page.getByRole('button', { name: vi.send }).click();
    await expect(page).toHaveURL(/#report-not-found$/);
    await expect(page.locator('#report-not-found')).toBeVisible();
    expect(reportsWithNote(note)).toEqual([]);
  });
});

test('a cross-origin POST is refused and stores nothing', async ({ request }) => {
  const note = noteFor('cross-origin');
  const response = await request.post('/api/report', {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    data: new URLSearchParams({ locale: 'vi', page: 'home', quote: vi.open, note }).toString(),
  });
  expect(response.status()).toBe(403);
  expect(reportsWithNote(note)).toEqual([]);
});

test.describe('on a tool page', () => {
  async function typeARoster(page: Page) {
    await page.goto(pagePath('classroom-groups', 'vi'));
    await page.locator('#cg-students-toggle').click();
    await page.getByRole('button', { name: tool.rosterAddStudent }).click();
    await page.locator('.cg-student').first().getByLabel(tool.rosterColName).fill('Lan');
  }

  test('/vi/classroom-groups sends in place and the roster is still there', async ({ page }) => {
    const note = noteFor('roster');
    await typeARoster(page);
    await fillReport(page, vi.open, note);
    await page.getByRole('button', { name: vi.send }).click();
    const sent = page.locator('#report-sent');
    await expect(sent).toBeVisible();
    await expect(sent).toBeFocused();
    await expect(page.locator('.cg-student').first().getByLabel(tool.rosterColName)).toHaveValue('Lan');
    await expect(page.getByLabel(vi.quoteLabel, { exact: true })).toHaveValue('');
    expect(reportsWithNote(note)).toHaveLength(1);
  });

  test('a double click stores one report', async ({ page }) => {
    const note = noteFor('double-click');
    await typeARoster(page);
    await fillReport(page, vi.open, note);
    await page.getByRole('button', { name: vi.send }).dblclick();
    await expect(page.locator('#report-sent')).toBeVisible();
    expect(reportsWithNote(note)).toHaveLength(1);
  });

  test('a later outcome replaces the earlier one', async ({ page }) => {
    const note = noteFor('replace');
    await typeARoster(page);
    await fillReport(page, 'on no page at all, anywhere', note);
    await page.getByRole('button', { name: vi.send }).click();
    await expect(page.locator('#report-not-found')).toBeVisible();
    await page.getByLabel(vi.quoteLabel, { exact: true }).fill(vi.open);
    await page.getByRole('button', { name: vi.send }).click();
    await expect(page.locator('#report-sent')).toBeVisible();
    await expect(page.locator('#report-not-found')).toBeHidden();
    await expect(page.locator('.report-status:visible')).toHaveCount(1);
  });

  test('an outcome in place supersedes the one a fragment shows', async ({ page }) => {
    // A click before the script loads posts the plain form and lands here
    // with a fragment; the next report is sent in place.
    const note = noteFor('fragment');
    await page.goto(`${pagePath('classroom-groups', 'vi')}#report-not-found`);
    await expect(page.locator('#report-not-found')).toBeVisible();
    await fillReport(page, vi.open, note);
    await page.getByRole('button', { name: vi.send }).click();
    await expect(page.locator('#report-sent')).toBeVisible();
    await expect(page.locator('#report-not-found')).toBeHidden();
    await expect(page.locator('.report-status:visible')).toHaveCount(1);
    expect(reportsWithNote(note)).toHaveLength(1);
  });
});
```

      `tests/functions/` is a new spec directory, and every guard that derives
      its scope from `specDirs()` now reads it. That includes each one built on
      `expectNothingFound` (`viewport-tagging`, `capture-after-assertion`,
      `isolated-context-tagging` among them), and it is why the two
      JavaScript-disabled tests carry `@requires-isolated-context`.
      `absence-liveness` and `duplication` read every `.ts` under `tests/`.
      `evidence-recording` reads `tests/e2e` only, so no recording is
      declared here.

- [ ] **Step 5: The script, and run it red.** Add
      `"test:functions": "playwright test --config=playwright.functions.config.ts"`
      to `package.json`'s scripts. The `--config=` form keeps it clear of
      `pipeline-wiring`'s "calling Playwright directly" guard.
      The Function under test already exists (Task 7), so these tests cannot
      be seen red against a stub. Each one is seen red by its own mutation in
      Step 8 instead, one per test. Run them green now:
      Run: `npm run test:functions 2>&1 | tail -20` → 8 passed. Read the
      total: a run that lists fewer tests dropped some.

- [ ] **Step 6: The CI job, guarded first.** Append to the `describe` from
      Task 1 in `tests/unit/pipeline-wiring.test.ts`:

```ts
  it('the functions job runs the functions-runtime suite', () => {
    // That build-and-test needs the job is already derived by "stands for
    // every other ci.yml job that is not required by name itself"; this pins
    // what the job runs, read from the parsed workflow.
    expect(jobNamed('ci.yml', 'functions').runs).toEqual([
      'npm ci',
      'npx playwright install --with-deps chromium',
      'npm run test:functions',
    ]);
  });
```

      Run it: RED (`ci.yml defines no job 'functions'`). Then add to
      `ci.yml`, after `sanity-on-build`, copying the pinned SHAs from the
      neighbouring jobs exactly:

```yaml
  # The real Pages Functions on workerd (#97): `wrangler pages dev` serves
  # this tree's dist/ over a local D1 with the real migration applied, and a
  # browser submits real reports to it. build-and-test needs it, so it gates
  # with no change to branch protection.
  functions:
    runs-on: ubuntu-26.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:functions
      - name: Keep the failing run's Playwright traces
        if: failure()
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: playwright-traces-${{ github.run_id }}-${{ github.run_attempt }}-functions
          path: test-results/
          retention-days: 14
          if-no-files-found: warn
```

      Change `build-and-test`'s line to `needs: [checks, e2e, sanity-on-build, functions]`.
      (`WorkflowJob.needs` is `readonly string[]`, `tests/workflow-jobs.ts:18`.)
      Run: `npx vitest run tests/unit/pipeline-wiring.test.ts` → PASS.
      Run: `npm run test:unit 2>&1 | tail -6` → all pass. `unboundedJobFindings`
      and the permissions guards read the new job.

- [ ] **Step 7: Commit.**

```bash
git add playwright.functions.config.ts tests/functions tests/report-health.ts package.json .github/workflows/ci.yml tests/unit/pipeline-wiring.test.ts
git commit -m "test(report): real submissions on workerd, as a functions job build-and-test needs (Refs #97)"
```

- [ ] **Step 8: See every runtime test red, predicting first, whole file each
      time.** `serve.mjs` rebuilds, so each mutation reaches `dist/` and the
      Function. Restore each with `git checkout -- <file>`, since HEAD is the
      green commit.
      (a) Health: in `serve.mjs`, drop the `d1(['--file', …])` line → RED on
      "the health check sees …" (503, no table).
      (b) Homepage: set `Referrer-Policy: no-referrer` in `public/_headers` →
      RED on the homepage submission. The POST's `Origin` is `null`, so
      check 2 refuses it; this is spec 10's `Referrer-Policy` mutation. If
      Task 2 found that `pages dev` ignores `_headers`, this mutation is the
      unit test from Task 2's fallback instead.
      (c) Not-found: in `src/lib/report.ts`, make `matchingKeys` return
      `['site.report.open']` for any non-empty needle → RED on "stores
      nothing".
      (d) Cross-origin: remove the Origin check → RED on the 403.
      (e) Roster: delete `event.preventDefault();` in `report-form.ts` → RED
      on "the roster is still there".
      (f) Double click: delete `if (pending) return;` and both `disabled`
      lines → record whether the double-click test goes RED. If it stays
      green, the post-`sent` reset (which empties a required field) is also
      blocking the second submission. Say so in the PR body, and keep the test
      as the guard of the behaviour a visitor sees.
      (g) Replace: in `showStatus`, mark only the match
      (`if (match) status.dataset.reportState = 'shown';`) → RED on "a later
      outcome replaces the earlier one" and on "supersedes the one a
      fragment shows".
      (h) Fragment: in `Footer.astro`, delete the
      `[data-report-state='superseded']` rule → RED on "supersedes the one a
      fragment shows" only: two statuses are visible. The other test stays
      green, because a status the script never showed falls back to
      `display: none`; say so when recording it.
      (i) Pipeline: remove `functions` from `build-and-test.needs` → RED on
      `pipeline-wiring`'s existing "stands for every other ci.yml job that is
      not required by name itself". Then change the job's last step to
      `npm run test:sanity` → RED on "the functions job runs the
      functions-runtime suite".

---

### Task 11: completeness, read from the rendered page

**Files:**
- Create: `tests/e2e/report-completeness.spec.ts`

**Interfaces:**
- Consumes: `reportOptions`, `normalise`, `PAGE_IDS`, `pagePath` (Task 5);
  `catalogueLeaves` (Task 3); `rawCatalogue`, `getSiteStrings`.

- [ ] **Step 1: Write the test.**

```ts
import { test, expect } from './fixtures';
import { recorded } from './evidence';
import { searched } from '../source-files';
import { catalogueLeaves } from '../../src/lib/catalogue-leaves';
import { PREFIXED_LOCALES, getSiteStrings, rawCatalogue, type Locale } from '../../src/lib/i18n';
import { PAGE_IDS, normalise, pagePath, reportOptions } from '../../src/lib/report';
import { isMessageTemplate } from '../../src/lib/i18n/message';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';

test.use(recorded);

/**
 * Every catalogue string a visitor can see on a page is one that page offers
 * to report (#97, spec 10). Read from the RENDERED DOM after the page's
 * script has run: the tool strings arrive by script, so a static read of the
 * HTML would never find one and pass for nothing (spec review pass 3).
 * Compared by text, not key, because the same words can live under two keys
 * and the visitor picks words. Text the page draws from somewhere other than
 * a catalogue is left out, derived from its source: the language switcher's
 * endonyms come from LOCALE_METADATA, and each locale's own also sits in the
 * tool catalogue's `csvLanguageName`, so on a page without the tool it read
 * as a tool string left unoffered (measured in review pass 4).
 */
const NOT_CATALOGUE_COPY = Object.values(LOCALE_METADATA).map(({ nativeName }) => nativeName);
function plainCatalogueTexts(locale: Locale): string[] {
  const english = new Map(catalogueLeaves(rawCatalogue('en')));
  const tool = catalogueLeaves(rawCatalogue(locale)).filter(([key, value]) => {
    const reference = english.get(key);
    return typeof value === 'string' && !(typeof reference === 'string' && !key.includes('[') && isMessageTemplate(reference));
  });
  const site = catalogueLeaves(getSiteStrings(locale)).filter(([key, value]) => typeof value === 'string' && !key.startsWith('notFound.'));
  return [...new Set([...tool, ...site].map(([, value]) => normalise(value as string, locale)))].filter((text) => text.length > 0);
}

for (const locale of PREFIXED_LOCALES)
  for (const pageId of PAGE_IDS)
    test(`${pagePath(pageId, locale)}: every catalogue string on the page is reportable there`, async ({ page }) => {
      await page.goto(pagePath(pageId, locale));
      if (pageId === 'classroom-groups') await page.locator('#cg-students-toggle').click();
      const rendered = await page.evaluate(() => {
        const texts: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (parent && parent.checkVisibility() && node.textContent?.trim()) texts.push(node.textContent);
        }
        return texts;
      });
      const onPage = new Set(rendered.map((text) => normalise(text, locale)));
      const offered = new Set(reportOptions(pageId, locale).map((option) => normalise(option, locale)));
      const elsewhere = new Set(NOT_CATALOGUE_COPY.map((text) => normalise(text, locale)));
      const found = plainCatalogueTexts(locale).filter((text) => onPage.has(text) && !elsewhere.has(text));
      const missing = found.filter((text) => !offered.has(text));
      expect(searched(missing, { of: found, what: 'catalogue strings rendered on the page' })).toEqual([]);
    });
```

- [ ] **Step 2: Run it and watch it be live.**
      Run: `npm run build > /dev/null 2>&1; npx playwright test tests/e2e/report-completeness.spec.ts --project=chromium 2>&1 | tail -15` → all pass.
      Then mutate: in `reportableStrings`, change the `sections` line to
      `const sections = chromeSections();`, so no page offers its own
      section. Predict RED on the four home and the four glory-points tests,
      with `missing` naming home and glory copy, and classroom-groups green.
      Confirm. Two obvious mutations cannot go red here. Deleting a page's
      `siteSection` makes the section chrome, offered on every page, because
      chrome is derived by exclusion. Adding `'glory'` to `NEVER_OFFERED`
      changes nothing, because glory-points' own `siteSection` still offers
      it (measured in review pass 4: 12 passed). For classroom-groups, set its
      `toolCatalogue: false` and predict RED on its four tests, with tool
      strings named, which proves the script-injected strings are read.
      Restore and confirm green on all five engines:
      Run: `npx playwright test tests/e2e/report-completeness.spec.ts 2>&1 | tail -8`.

- [ ] **Step 3: Commit.**

```bash
git add tests/e2e/report-completeness.spec.ts
git commit -m "test(report): every catalogue string on a page is reportable there (Refs #97)"
```

---

### Task 12: the deployed-site checks

**Files:**
- Modify: `tests/dev/dev-sanity.spec.ts`, `tests/prod/prod-sanity.spec.ts`

- [ ] **Step 1: Dev.** Append to `tests/dev/dev-sanity.spec.ts`. Add
      `getSiteStrings` to its `../../src/lib/i18n/index` import (which already
      brings `localisePath`), and add
      `import { expectReportsBound } from '../report-health';`.
      Each test's details are an object literal written in place:
      `playwright-declarations.test.ts` refuses details it cannot read, and a
      shared constant is one (measured in review pass 4). The path is derived,
      because `route-coverage.test.ts` refuses a locale-prefixed literal in a
      deploy gate:

```ts
test(
  'the report endpoint is bound to its migrated database',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description: 'the report endpoint is a Pages Function with a D1 binding, and a preview of dist/ runs no Pages Function',
    },
  },
  async ({ request }) => {
    await expectReportsBound(request);
  },
);

test(
  'a real report from the Vietnamese homepage reaches #report-sent',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description: 'the report endpoint is a Pages Function with a D1 binding, and a preview of dist/ runs no Pages Function',
    },
  },
  async ({ page }) => {
    // Writes one row per dev deploy, in the dev database only. The runbook's
    // "automated dev check" statement clears them (docs/runbooks/translation-reports.md).
    const t = getSiteStrings('vi').report;
    const home = localisePath('/', 'vi');
    await page.goto(home);
    await page.locator('[data-report] summary').click();
    await page.getByLabel(t.quoteLabel, { exact: true }).fill(t.open);
    await page.getByLabel(t.noteLabel, { exact: true }).fill(`automated dev check ${process.env.GITHUB_SHA ?? 'local'}`);
    await page.getByRole('button', { name: t.send }).click();
    await expect(page).toHaveURL((url) => url.pathname === home && url.hash === '#report-sent');
    await expect(page.locator('#report-sent')).toBeVisible();
  },
);
```

- [ ] **Step 2: Prod.** Append to `tests/prod/prod-sanity.spec.ts`, and add
      `import { expectReportsBound } from '../report-health';`:

```ts
test(
  'the report endpoint is bound to its migrated database',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description: 'the report endpoint is a Pages Function with a D1 binding, and a preview of dist/ runs no Pages Function',
    },
  },
  async ({ request }) => {
    // Health only: automation never writes to the production database.
    await expectReportsBound(request);
  },
);
```

- [ ] **Step 3: Run the guards and the on-build suites.**
      Run: `npx vitest run tests/unit/sanity-on-build.test.ts tests/unit/pipeline-wiring.test.ts` → PASS.
      Run: `npm run test:sanity 2>&1 | tail -10` → PASS, with the three new tests
      left out by `grepInvert`. The deployed runs happen after the merge.

- [ ] **Step 4: Commit.**

```bash
git add tests/dev/dev-sanity.spec.ts tests/prod/prod-sanity.spec.ts
git commit -m "test(report): the deployed health checks and one real dev submission (Refs #97)"
```

- [ ] **Step 5: Mutate.** Delete the `annotation` from the prod test → predict
      RED on `sanity-on-build.test.ts`'s `tests tagged @deployed-only each
      says, where it is written, why only the deployed site can answer it`,
      with the message "a @deployed-only test must carry a deployed-only
      annotation with a reason", and the file's other five tests green
      (measured in review pass 5). Restore.

---

### Task 13: the visual baselines

The footer grows on beta-locale pages. `home-id` is the only baselined beta page.

- [ ] **Step 1: Find what moved.**
      Run: `npm run test:visual 2>&1 | tail -20` (the pinned container,
      `linux/amd64`, and nothing else running).
      Expected: RED on the four `home-id-*` captures only. Anything else that
      goes red is a finding to explain before recapturing.
- [ ] **Step 2: Recapture those alone.**
      Run: `npm run test:visual:update -- --grep "home-id" 2>&1 | tail -8`.
- [ ] **Step 3: Review old against new by eye** (`git diff --stat`, then open
      both PNGs of each pair). The only change is the footer's closed
      disclosure, one line below the BETA notice.
- [ ] **Step 4: Compare all, writing nothing.**
      Run: `npm run test:visual 2>&1 | tail -8` → all pass, zero written.
- [ ] **Step 5: Commit.**

```bash
git add tests/e2e/__screenshots__
git commit -m "test(visual): home-id baselines carry the report disclosure (Refs #97)"
```

---

### Task 14: the full gate, the mutation audit, and the PR

- [ ] **Step 1: The AC audit.** Write the table AC → assertion (spec:line)
      → mutation for spec section 12's ACs 2–11 and 13, in the PR body. An
      empty cell is a finding, and it gets fixed before Step 2.
- [ ] **Step 2: Confirm the whole mutation list** of spec section 10. Every
      mutation has a row: Tasks 5–11 ran them. List each one with its
      observed RED.
- [ ] **Step 3: The local gates.**
      `npm run format && npm run typecheck && npm run test:unit && npm run test:e2e && npm run test:functions && npm run test:sanity`,
      one at a time, reading each verdict whole. Then check the deployed-site
      suites for any fact this change moved, since they never run before the
      merge: `command grep -rln "footer\|<details\|toHaveCount" tests/dev tests/prod tests/device`,
      and read each hit that counts or measures footer content.
- [ ] **Step 4: Push and open the PR into `develop`.** Check the body with
      `node scripts/closing-keywords.mjs <file> "this pull request body"`. The
      body says `Refs #97` and never puts a closing keyword beside the number.
- [ ] **Step 5: Wait for CI in the background**, then read every job by name
      on the head SHA, read from `gh pr view --json headRefOid` into a file.
      The PR touches `src/lib/i18n/`, so `back-translation.yml`'s
      `back-translation review` runs too. It fails only when the engine errors
      or nothing was read back (`livenessProblems`), never on a score, so its
      green says nothing about the Task 4
      drafts. Download its artifact
      (`gh run download <run id> -n back-translation`), read every `report.*`
      row, and redraft any whose back-translation names a different thing.
      Its score cannot judge a short label (`Tình dục` scored 100); those are
      `label-check`'s, in Task 4 Step 6.
- [ ] **Step 6: The merge waits on the operator's Cloudflare setup** (steps
      1–2). Once he confirms, merge with a merge commit, watch the dev deploy,
      read `dev-verified` off the commit and each job by name, close #97 with
      `gh issue close 97`, and move its card to Done on the Shyden Site board
      (`PVT_kwDOEOcG584BiyCS`, title asserted first).
- [ ] **Step 7: File the follow-ups** from spec section 2: the review script
      (each report beside its English source and a back-translation of the
      suggestion); the count-only notification; and the 404's `notFound`
      copy, which has no report route (spec 3.1).

---

## Review log

Each pass runs the mechanical checks, then reads the whole document. The
checks: every path, export and command the plan names exists on
`origin/develop` or is created by a named task; every interface a task
consumes is produced by an earlier task with the same name and type; every
spec section maps to a task; the plan's test code meets this repo's
meta-guards; and the file carries no backslash-u escape. From pass 4, the
meta-guard check is RUN, not read. Every code block is materialised into a
scratch worktree of `origin/develop`, each insertion asserting that its
anchor matched once, and then `astro check`, the whole unit suite and the
plan's e2e specs run there. The only failures allowed are those the harness's
own English placeholder drafts cause (`i18n.test.ts`, naming `report.*` keys
alone). Reading had cleared the seven guards passes 1-3 named, while running
found six more that none of those passes had listed.

**Pass 1 (2026-09-26, against `origin/develop` at 9782fa4, merged into this
branch): 14 findings, all fixed.** Checked mechanically: `WorkflowJob.needs`
(`tests/workflow-jobs.ts:18`), Playwright's `TestConfigWebServer` fields,
`HTTPCredentials.send`, `visual.mjs`'s argument forwarding, `dead-copy`'s
matching, and a scan for backslash-u escapes (none; one pattern hit was the
word "succeeding").

1. `playwright.functions.config.ts` gave `webServer` an `httpCredentials`
   field it does not have, so `astro check` would refuse it. Readiness is now
   `/`, and the first test proves the binding.
2. A message made only of slots would match every quote through rule 3, so
   check 8 would accept anything on that page. Clarification 6 now bounds
   rule 3, `matchesForm` is exported so the bound has unit tests, and a
   nonsense-quote test runs over every page and locale.
3. Mutation (f), searching from `at`, could not be observed with `'a1bc'`.
   `'ab1c'` observes it, and a new mutation (g) covers the last slot.
4. The Thai test could index past the last grapheme cluster, and one of its
   assertions tested nothing.
5. "Stores every key" compared sets exactly, although rule 2 can add a key
   whose longer text contains the display.
6. The migration and Function-plumbing tests read raw source. They strip
   comments now, and a mutation keeps a comment in place to prove it.
7. The 320px test measured the page's scroll only. It also measures the form
   against the footer column (CLAUDE.md: "page-level scrollWidth is not
   containment"), with a liveness check by content.
8. Nothing asserted `aria-describedby`. The keyboard test checks both
   accessible descriptions now.
9. `tests/e2e/report-pages.ts` re-exported with an alias for no gain, and a
   `void browserName` line was a placeholder. Both are gone.
10. Task 9 wired the scripts before its e2e test existed, so the test could
    not be seen red. The wiring is now its own step, after the red run.
11. `dead-copy`'s `\.report\b` is satisfied by `from './report-form'`. Task 9
    Step 7 checks what actually guards the section, and fixes the guard if
    nothing does. Task 4's prediction names the group.
12. `local.mjs` had untyped parameters, which `checkJs` refuses.
13. The runtime tests had no red proof. Step 8 now gives each of the seven a
    mutation.
14. The Task 2 spike put two handlers in one file, used an undefined
    `$SCRATCH`, and Task 3's mutation named a file that did not exist yet.

**Pass 2 (2026-09-26, a full read of every line after pass 1's fixes, plus
the mechanical path check): 22 findings, all fixed.** The path check: of 67
distinct backticked paths, every full path absent from `origin/develop` is a
file a task creates, or the spec (on this branch). Also checked: the visual
suite's test titles (`${name} renders the same pixels`, so `--grep "home-id"`
selects), and `evidence-recording`'s scope (`tests/e2e` only).

1. Every beta locale has only the `other` plural category, so "a message
   gives one form per branch" would have picked a plural and seen one form.
   It picks a `select` now.
2. "Exactly when its English is one" asserted one direction. Both directions
   are asserted now, and each is proven non-empty.
3. A test named "survives case, spacing and typographic quotes" tested no
   quotes. It is named for what it asserts.
4. The performance test's comment claimed a measurement nobody made.
5. Mutation (a) in Task 5 predicted a red that could not happen: with chrome
   derived by exclusion, deleting `glory`'s `siteSection` makes it chrome,
   and it is still offered. The mutation deletes `home`'s now, and names the
   two tests that go red.
6. Mutation (c) was ambiguous once there were two `>= 2`s, and (d) did not
   say what to replace.
7. The same exclusion defect sat in Task 11's completeness mutation. It adds
   `glory` to `NEVER_OFFERED` now, and says why the obvious mutation is none.
8. Mutation (i), dropping the CRLF fold, would have gone red for the wrong
   reason: the CR it leaves is a control character. It adds a raw-length
   check instead. Mutation (h) says how the unchecked page fails.
9. The cli-only comment cited "#54" without evidence. The citation is gone.
10. Task 7's red expectation named ENOENT for a test that fails on `toContain`.
11. Task 8 imported `getStrings` for a test Task 9 adds, which `astro check`
    would flag as unused. Task 9 adds the import.
12. The button's `--bg` on `--accent` was never measured. It joins the AA list.
13. A re-wrapped `<textarea></textarea>` gets a whitespace default. The
    keyboard test asserts both textareas start empty.
14. Mutation (d) in Task 8 could stay above 44px through padding alone.
15. Mutation (f) used an unrelated inline script rather than spec 10's "the
    tool-page script in the footer", and could not run before Task 9.
16. `report-form.ts` repeated the `Outcome` union as a list nothing checked. A
    `Record<Outcome, true>` makes the compiler check it.
17. The `dead-copy` mutation predicted `report.intro`, a name other code may
    read.
18. `serve.mjs`'s docblock said the server waits on the health route, which
    pass 1 had changed.
19. `serve.mjs` had untyped parameters and a `string[]` of signals, both of
    which `checkJs` refuses.
20. `reuseExistingServer: !process.env.CI` would let a local mutation run
    against a server holding an older build. It is `false` now.
21. Task 10 Step 4 was titled "failing" for tests that cannot be seen red
    against a stub, and Step 6 told the reader to look up a field name this
    review had already checked.
22. Task 10 said `evidence-recording` reads `tests/functions/`. It reads
    `tests/e2e` only.

**Pass 3 (2026-09-26, `origin/develop` at 9782fa4, the branch level with it;
a full read of every line plus the mechanical checks): 10 findings, all
fixed.** The path check: of 48 distinct backticked paths, every one absent
from `origin/develop` is created by a named task, is the spec, is a
conditional fallback's output (`scripts/report-table.mjs`,
`functions/_generated/report-table.js`), a build output (`dist/_headers`,
from `public/_headers`) or a throwaway (`functions/api/spike-db.js`,
`tests/unit/scratch-walker.test.ts`). Also checked against the tree: every
name Tasks 1-12 import (`allWorkflows`, `DEPLOY_COMMAND`, `jobNamed`,
`workflowSteps`, `SCANNED`, `definesACatalogueWalker`, `renderedOn`,
`CATALOGUES`, `isMessageTemplate`, `MessagePart`, `localisePath`'s prefix
handling, `codeWithoutComments`, `shipped`/`importsOf`/`stem`, `atLeast44`,
`expectNoHorizontalScroll`, `contrastRatio`, `recorded`), the workflow line
ranges, `ci.yml`'s pinned SHAs and job shape, the roster selectors, the
sanity-on-build failure text, and the four `home-id` baselines. No
backslash-u escape.

1. Task 1 named a variable `global`, shadowing Node's global object. It is
   `globalInstalls`.
2. Task 3 said eleven files import the walk. Ten do, one of them an e2e spec
   the unit suite never loads, so the step now says the typecheck is what
   proves that import.
3. `lengthOf` built a new `Intl.Segmenter` and segmented the whole quote once
   per form, about 200 times for a 1000-unit quote on every classroom-groups
   request, on workerd's CPU budget. `hasTwoCharacters` caches one segmenter
   per locale and stops at the second grapheme. Mutation (d) follows it.
4. `handleReport` called `arrayBuffer()` before check 4, so a chunked body
   with no `Content-Length` was held whole (up to 100 MB) before the 413.
   `readCapped` stops at the cap; a streamed-body test counts the pulls, and
   mutation (j) sees it red.
5. `health.js` answered 405 itself, logic in a "plumbing only" file that no
   unit test reached. `reportHealth` takes the request and answers 405, with
   a test and mutation (k).
6. `report-presence.spec.ts` read `dist/` at module scope. Playwright loads
   the file before its web server rebuilds, so the walk judged the previous
   build and a mutation could not reach it. It reads inside the test.
7. The fields' border was `--border`, which `tokens.css` calls decorative
   and which #133 found at 1.17:1 on every control. It is `--border-strong`
   (WCAG 1.4.11), asserted in computed rgb, with mutation (f) in Task 8.
8. A tool page reached by the plain POST's 303 keeps that status as its
   `:target`, so a later in-place outcome showed two statuses. One state
   attribute (`data-report-state`, `shown` or `superseded`) replaces
   `data-shown`, with a new functions test and mutations (g) and (h). A
   second attribute beside `data-shown` was rejected: it would have left
   `data-shown`'s removal unobservable.
9. Task 2's spike never measured the origin of `request.url` under `pages
   dev`, which check 2 compares with. It records it, and stops before Task 6
   if the URL is rewritten.
10. The endpoint test named its URL `URL_` to dodge the global `URL`. It is
    `ENDPOINT`.

**Pass 4 (2026-09-26, `origin/develop` at 9782fa4, the branch level with it;
a full read of every line, the path check, and for the first time the plan's
code RUN): 14 findings, all fixed.** The path check: of 36 backticked paths
absent from `origin/develop`, 30 are created by a named task, and the other
six are the spec, the two conditional-fallback outputs, a build output, or a
throwaway. Every code block was assembled into a scratch worktree, each
insertion asserting that its anchor matched once. On that tree, after the
fixes below: `astro check` 0 errors, 0 warnings, 0 hints (so `readCapped`'s
narrowing in the `for` condition and the `as RequestInit` cast compile);
the whole unit suite green except `i18n.test.ts`, which names only the
harness's English placeholder drafts; the three e2e specs 56/56 on chromium;
and 40 of the plan's mutations run, each RED where the plan predicts: Task 5's
seven, Task 6's eleven, Task 7's three, Task 1's two, Task 3's and Task 4's,
Task 8's seven, Task 9's four, both halves of Task 10's (i), and Task 11's
two. Task 10's other eight need
wrangler and Task 2's measurements, so Task 10 runs them. No backslash-u
escape.

1. Task 2 compared the spike with `node -e` importing the `.ts` modules.
   Node 24 strips types but does not resolve their extensionless specifiers
   (`ERR_MODULE_NOT_FOUND`, reproduced). The comparison is a throwaway vitest
   file that writes JSON.
2. Task 5's mutation (c) changed a `>= 2` that pass 3's `hasTwoCharacters`
   had removed. It deletes the rule-2 guard now.
3. Task 10's note named two guards as reading `tests/functions/`. Every
   `specDirs()` guard does, and `absence-liveness` and `duplication` read all
   of `tests/`.
4. `absence-liveness` flagged four absence assertions. The deploy-line and
   404-page ones go through `searched`. The two log collectors are proved
   live in the same test: a request that must log follows, and one line in
   all is asserted.
5. `anchored-presence` flagged the migration's `toContain` checks, whose
   hand-made SQL stripper it cannot see. They are anchored to each column's
   line now, with the 1000 pinned through `MAX_FIELD_UNITS`.
6. `anchored-presence` also flagged Task 10's `needs` assertion, which
   repeated `pipeline-wiring`'s existing "stands for every other ci.yml job".
   The new test pins the job's `runs` instead, and mutation (i) names the
   existing test.
7. `isolated-context-tagging` refused the two JavaScript-disabled runtime
   tests untagged. They carry `@requires-isolated-context`.
8. `duplication` found the dev and prod health bodies identical, and the
   runtime suite had a third copy. `tests/report-health.ts`
   (`expectReportsBound`) is their one home.
9. `playwright-declarations` refused dev's shared `PAGES_FUNCTION` details.
   Each test writes its details in place, and the "if it needs" hedge is gone.
10. `route-coverage` refused dev's `'/vi/'`. It is `localisePath('/', 'vi')`,
    and the URL check compares the path and hash.
11. `astro check` reported an unused `c` in the Thai test (`- 1 hint`), which
    fails the plan's own three-zeros gate. It walks `clusters.keys()`.
12. Task 11's completeness test read the switcher's endonym (from
    `LOCALE_METADATA`, and equal to the tool catalogue's own
    `csvLanguageName`) as tool copy unoffered on home and glory-points: eight
    false REDs on the first run. Text from `LOCALE_METADATA` is left out,
    derived from its source.
13. Task 11's mutation, adding `'glory'` to `NEVER_OFFERED`, is a no-op:
    glory-points' own `siteSection` still offers it (12 passed). The mutation
    drops every page's own section and turns eight tests RED.
14. Task 8's mutation (g) was a bare side-effect import, which the build drops
    (no chunk emitted, GREEN), run on chromium, where `theme-script.spec.ts`
    has no tests. It adds the enhancement call and runs on `content`: RED on
    all 16 pages. Task 3's mutation also named one of two tests sharing a
    title; it names the catalogue one.

**Pass 5 (2026-09-26, `origin/develop` at 9782fa4, the branch level with it;
the harness re-run on a fresh worktree, the path check, and a full read of
every line): 5 findings, all fixed, and 3 harness defects.** On the
assembled tree: `astro check` 0 errors, 0 warnings, 0 hints; the unit suite
2,571 passed and 1 failed, `i18n.test.ts`, naming only the twelve `report.*`
placeholder drafts; the three e2e specs 56/56 on chromium. All 41 mutations
the harness now holds ran, each RED where the plan predicts: Task 1's two,
Task 3's, Task 4's, Task 5's seven, Task 6's eleven, Task 7's three, Task
8's seven, Task 9's four, both halves of Task 10's (i), Task 11's two and
Task 12's. 11a turned 8 tests RED with classroom-groups' 4 green, and 11b
turned exactly those 4 RED. Task 10's other eight still need wrangler and
Task 2's measurements. The path check: every path absent from
`origin/develop` is created by a named task, is the spec, a conditional
fallback's output, a build output, a throwaway, or not a path (`/vi/`,
`linux/amd64`). No backslash-u escape. After the fixes, re-extracting the
plan's 52 blocks showed only the runbook's changed, and assembly does not
read it, so the run above stands for the fixed plan.

1. Task 4 Step 4 predicted `astro check` failing on four missing sections.
   It fails on a fifth, `label-check.ts`'s `SITE_PAGES`, a
   `Record<keyof SiteStrings, string>` that Step 5 maps.
2. Nothing read the back-translation of the Task 4 drafts. The PR runs
   `back-translation review`, which fails only when the engine errors or
   reads nothing back, never on a score. Task 14 Step 5 now downloads its
   report and reads every `report.*` row.
3. The runbook's `DELETE FROM reports WHERE id = ?;`, copied from spec 7,
   cannot run in the D1 console, which binds no parameters. It names the
   `'<id>'` to replace.
4. Pass 4's log counted 40 mutations run and 8 deferred, and Task 12's
   annotation mutation was in neither count. It had never run. It runs now,
   RED as predicted.
5. That mutation's prediction quoted the assertion's message as if it were a
   test title. It names the test,
   `tests tagged @deployed-only each says, where it is written, why only
   the deployed site can answer it`, and gives the message beside it.

The harness (`.superpowers/sdd/97-plan-review/`, gitignored):
- Mutation 4's anchor matched five times, because the English placeholders
  copy `siteEn` into every locale, so it never applied. It now edits the
  occurrence inside `siteEn` and asserts it lies there.
- Four of pass 4's mutations had been run by hand and were never added to the
  harness: Task 3's, Task 9's (d) and Task 11's two. They are in it now, with
  Task 12's. Task 9 (d) listed eight unrendered keys, `report.quoteLabel`
  and `report.honeypotLabel` among them.
- `mutate.py` read `mut-<id>.json` without deleting the previous run's copy
  first, so a vitest run that wrote no report would have been scored from
  the stale file. It deletes the file before each run, and restores the
  mutated file in a `finally`.

**Pass 6 (2026-09-26, `origin/develop` at 9782fa4, the branch level with it;
the harness re-run on a fresh worktree, the path check, and a full read of
every line): 1 finding, fixed.** On the assembled tree: `astro check` 0
errors, 0 warnings, 0 hints; the unit suite 2,571 passed and 1 failed,
`i18n.test.ts`, naming only the `report.*` placeholder drafts; the three e2e
specs 56/56 on chromium; all 41 harnessed mutations RED where predicted (30
unit, 11 browser). The path check: every path absent from `origin/develop`
is created by a named task, is the spec, a conditional fallback's output, a
build output, a throwaway, or not a path (an import specifier, `/vi/`,
`linux/amd64`). No backslash-u escape. After the fix, the plan was
re-extracted and re-assembled, and `astro check` (0/0/0), the unit suite
(the same one failure) and all 31 unit mutations were run again, each AS
PREDICTED.

1. Task 6's `refuses a control character other than TAB and LF, in any
   field` put the character in `note` alone, so check 7 could stop reading
   the quote with nothing going red. It loops over `quote`, `suggestion` and
   `note` now. The quote keeps its real match in front, so without check 7
   it would be `sent` or `not-found`, never `rejected`. The new mutation (l)
   checks the quote's length alone: 1 of 32 RED, `quote 0: expected
   '/vi/#report-not-found' to be '/vi/#report-rejected'`. It is in the
   harness, which now holds 42 mutations.

**Pass 7 (2026-09-26, `origin/develop` at 9782fa4, the branch level with it;
the harness re-run on a fresh worktree from the branch head, the path check,
and a full read of every line): no findings. The plan is APPROVED.** On the
assembled tree: `astro check` 0 errors, 0 warnings, 0 hints; the unit suite
2,571 passed and 1 failed, `i18n.test.ts`, naming only the twelve `report.*`
placeholder drafts; the three e2e specs 56/56 on chromium. All 42 harnessed
mutations ran, each RED where predicted: 31 unit (31 "applied" lines beside
31 verdicts, so none was a no-op) and 11 browser, whose per-spec totals held
steady across mutations (29 presence, 15 form, 12 completeness, 33 on
`content`), so no test dropped out. The path check listed the same 43 paths
absent from `origin/develop`, each created by a named task, the spec, a
conditional fallback's output, a build output, a throwaway, or not a path.
The cited line ranges (`deploy-dev.yml:130-136`, `deploy-prod.yml:70-76`,
`one-home.test.ts:219-286`, `label-check.ts:142-152`,
`tests/workflow-jobs.ts:18`) were re-read and still hold. No backslash-u
escape. Task 10's (a)-(h) remain for Task 10 itself, since they need
wrangler and Task 2's measurements.
