# Access service token expiry check (#796) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily job on `main` reads every Cloudflare Access service token's expiry from Cloudflare's API and opens one issue per token per expiry date, assigned to ShydenMcM, at least 30 days before it lapses; a run that cannot read the expiry fails and says so on an issue.

**Architecture:** The `waiting-reports` shape (#349, as tightened by #877): a pure module (`src/lib/access-expiry.ts`) reads the answers, a dependency-free script (`scripts/access-expiry.mjs`) does the fetching, and a workflow whose scheduled run only dispatches the check with `--ref main`; the check runs in a new `access-expiry` environment that accepts `main` alone. The Cloudflare envelope reader and the JSON request helper move to one home each so both scripts share them.

**Tech Stack:** Node 26 (type stripping, built-in `fetch`), Vitest (unit, logs, integration, guards suites), GitHub Actions.

**Spec:** issue #796 (ACs) and its design comment (Shyden, 2026-10-19): Cloudflare API `GET /accounts/{id}/access/service_tokens`, `expires_at`, permission Access: Service Tokens Read; every token watched; fail-closed on an empty list or unreadable expiry; one issue per token per expiry date, assigned to ShydenMcM, 30+ days ahead; token in `access-expiry`, `main` alone; schedule dispatches `--ref main`.

## Global Constraints

- The job holding the token runs no npm package code: no `npm ci`; the script imports Node built-ins and this repository's modules only.
- Unit tests start no process and open no socket; the script runs as a process only in `tests/integration/`.
- One test per case (`it.each` generates them); every absence search carries `searched(...)` and its own `floorBreach(<literal id>, <of>.length)`.
- Third-party actions pinned to the same 40-hex SHAs `waiting-reports.yml` uses, with their `# vX.Y.Z` comments.
- The repository, its issues and its Actions logs are public: nothing printed or posted carries a client id, a secret, or anything beyond a token's name and expiry.
- No closing keyword next to an issue number anywhere: `Refs #796`.

## Decisions taken here (the design was silent on them)

- **Warning window 45 days.** The AC asks for at least 30 days. A daily job that warned at exactly 30 days would miss that floor on the first failed run; 45 leaves 15 failed days of margin.
- **A `duration: forever` token without `expires_at` fails the check**, as the ruling says (unreadable expiry fails closed). None exists today (`prod-sanity-2` lasts one year); if one is ever made, the daily failure issue asks the question. Said in the PR.
- **Issues are found by exact title among `github-actions[bot]`'s issues, open or closed.** A closed warning still counts, so a rotated-and-closed warning is not reopened for the same expiry day; a new expiry date gets a new title.
- **Tasks 4-5 wait for #877 to be on `develop`.** They generalise #877's main-only tenant rule into one table of unattended environments rather than adding a sibling rule.

## Review Focus

1. Cloudflare answers `success: true` with an empty `result` (token deleted, wrong account id): must fail naming the empty list, never pass as "nothing due". Pinned in Task 2 (unit) and Task 3 (integration).
2. `expires_at` in a loose form `Date.parse` accepts (`"2027"`, `"Oct 15 2027"`): must fail, not be read as 1 January. Pinned in Task 2.
3. GitHub drops the assignee silently (e.g. a lost collaborator permission): the issue exists but nobody is told. The script must check the created issue's `assignees` and fail. Pinned in Task 3.
4. A matching warning sits past GitHub's first page of issues: must still be found, so no duplicate is opened every day. Pinned in Task 3.
5. A stranger opens an issue with the exact warning title on the public repo: must not silence the warning. Pinned in Task 2 (`missingTitles` ignores non-bot authors).

---

### Task 1: One home for the Cloudflare envelope and the JSON request

**Files:**
- Create: `src/lib/cloudflare-envelope.ts` (`errorsIn`, `resultOf`, moved from `src/lib/waiting-reports.ts`)
- Create: `scripts/json-answer.mjs` (`answerOf`, moved from `scripts/waiting-reports.mjs`, timeout now a parameter)
- Modify: `src/lib/waiting-reports.ts` (import both; re-export `errorsIn` so its tests keep their import)
- Modify: `scripts/waiting-reports.mjs` (import `answerOf`)
- Test: `tests/unit/cloudflare-envelope.test.ts`

**Interfaces:**
- Produces: `errorsIn(answer: unknown): string`; `resultOf(answer: unknown, what: string): unknown`; `answerOf(what: string, url: string, init: RequestInit, timeoutMs: number): Promise<unknown>`.

- [ ] **Step 1: Failing unit test** for `resultOf` (not an object, `success: false` with errors, `success: true` returns `result`), importing from `../../src/lib/cloudflare-envelope`.

```ts
import { describe, expect, it } from 'vitest';
import { errorsIn, resultOf } from '../../src/lib/cloudflare-envelope';

describe('resultOf reads a Cloudflare envelope (#796)', () => {
  it('returns the result once the envelope says success: true', () => {
    expect(resultOf({ success: true, result: [1] }, 'the list')).toEqual([1]);
  });
  it.each([
    ['a string', 'x', 'the list is not a JSON object'],
    ['success: false', { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
      'the list says success: false (10000 Authentication error)'],
    ['no success field', { result: [] }, 'the list says success: undefined'],
  ])('throws on %s', (_, answer, message) => {
    expect(() => resultOf(answer, 'the list')).toThrow(message);
  });
  it('errorsIn is empty for an answer with no errors', () => {
    expect(errorsIn({ errors: [] })).toBe('');
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/cloudflare-envelope.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Move `errorsIn` and `resultOf` (exported) verbatim into `cloudflare-envelope.ts` (imports `./is-record.ts` by full name; header comment: pure, erasable TypeScript only). In `waiting-reports.ts`: `import { errorsIn, resultOf } from './cloudflare-envelope.ts';` and `export { errorsIn } from './cloudflare-envelope.ts';`. Move `answerOf` into `scripts/json-answer.mjs` with signature `(what, url, init, timeoutMs)`, importing `errorsIn` from `../src/lib/cloudflare-envelope.ts`; `waiting-reports.mjs` calls `answerOf(what, url, init, timeoutMs())`.
- [ ] **Step 4:** Unit suite whole (`npm run test:unit`), typecheck, lint: green; `waiting-reports` unit tests unchanged and green.
- [ ] **Step 5:** Commit `One home for the Cloudflare envelope and the JSON request (Refs #796)`.

### Task 2: The pure reading of tokens and issues

**Files:**
- Create: `src/lib/access-expiry.ts`
- Test: `tests/unit/access-expiry.test.ts`, `tests/logs/access-expiry.test.ts`

**Interfaces:**
- Consumes: `resultOf` (Task 1), `isRecord`.
- Produces:
  - `WARN_DAYS = 45`, `ISSUE_AUTHOR = 'github-actions[bot]'`, `ASSIGNEE = 'ShydenMcM'`, `REQUEST_TIMEOUT_MS = 30_000`, `FAILURE_TITLE = 'The Access service token expiry check could not run'`
  - `type WatchedToken = { name: string; expiresAt: Date }`
  - `tokensFrom(answer: unknown): WatchedToken[]`
  - `dueSoon(tokens: WatchedToken[], now: Date): WatchedToken[]`
  - `titleFor(token: WatchedToken): string`, `bodyFor(token: WatchedToken, now: Date): string`
  - `missingTitles(wanted: string[], issues: unknown): string[]`
  - `openFailureIssue(issues: unknown): number | undefined`
  - `assigned(issue: unknown): boolean`

- [ ] **Step 1: Failing unit tests** (one per case):
  - `tokensFrom`: a one-token answer → `[{ name: 'prod-sanity-2', expiresAt: new Date('2027-10-15T23:55:00Z') }]`; throws `/is empty, so no token can be watched/` on `result: []`; `/total_pages: undefined, not 1/` without `result_info`; `/total_pages: 2, not 1/`; `/has no name/` on a missing or blank name; `/prod-sanity-2 has no readable expires_at/` on each of `undefined`, `null`, `'2027'`, `'Oct 15 2027'`, `'2027-10-15'` (date without time), `''`.
  - `dueSoon` at `now = 2027-08-31T23:55:00Z`: a token expiring exactly 45 days later is due; 45 days + 1 ms is not; an expired one is due.
  - `missingTitles`: a bot issue (open or closed) with the title removes it; the same title by `someone-else`, or on a pull request (`pull_request` key), does not; a duplicate wanted title is returned once; a non-list throws `/issues are not a list/`.
  - `openFailureIssue`: the open bot issue's number; `undefined` for a closed one or a stranger's.
  - `assigned`: true with `assignees: [{ login: 'ShydenMcM' }]`; false with `[]`, with another login, or with no `assignees`.
  - Constants pinned to literals (`WARN_DAYS` 45, `ASSIGNEE`, `ISSUE_AUTHOR`, `REQUEST_TIMEOUT_MS`).
- [ ] **Step 2: Failing logs tests** (public text, #822's pattern): `FAILURE_TITLE` literal and holds no digit; `titleFor` → `'The Access service token prod-sanity-2 expires on 2027-10-15'`; `bodyFor` for 40 days, 1 day, under a day, and expired:

```text
The Cloudflare Access service token `prod-sanity-2` expires at 2027-10-15 23:55 UTC, 40 days after this check.

Rotate it as docs/runbooks/cloudflare-access.md says under "Rotating a service token", then close this issue.
```
  (`1 day after`, `within a day of`, `expired at … UTC, before this check`); and no body holds `client_id` or a 32-hex string.
- [ ] **Step 3:** Run both → FAIL (module not found).
- [ ] **Step 4: Implement** `src/lib/access-expiry.ts`:

```ts
import { isRecord } from './is-record.ts';
import { resultOf } from './cloudflare-envelope.ts';

export const WARN_DAYS = 45;
export const ISSUE_AUTHOR = 'github-actions[bot]';
export const ASSIGNEE = 'ShydenMcM';
export const REQUEST_TIMEOUT_MS = 30_000;
/** Holds no digit and no token name, so the failure issue is one issue. */
export const FAILURE_TITLE = 'The Access service token expiry check could not run';

const DAY_MS = 86_400_000;
/** Cloudflare's `expires_at`: a full ISO time with a zone, nothing looser. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export type WatchedToken = { name: string; expiresAt: Date };

export const tokensFrom = (answer: unknown): WatchedToken[] => {
  const what = 'the Access service token list';
  const result = resultOf(answer, what);
  if (!Array.isArray(result)) throw new Error(`${what} holds no list of tokens`);
  if (result.length === 0)
    throw new Error(`${what} is empty, so no token can be watched`);
  const info = isRecord(answer) ? answer.result_info : undefined;
  const pages = isRecord(info) ? info.total_pages : undefined;
  if (pages !== 1)
    throw new Error(`${what} says total_pages: ${JSON.stringify(pages)}, not 1`);
  return result.map((token, index) => {
    const name = isRecord(token) ? token.name : undefined;
    if (typeof name !== 'string' || !/^[^\r\n]*\S[^\r\n]*$/.test(name))
      throw new Error(`token ${index + 1} of ${result.length} in ${what} has no name`);
    const raw = isRecord(token) ? token.expires_at : undefined;
    if (typeof raw !== 'string' || !ISO_TIME.test(raw) || Number.isNaN(Date.parse(raw)))
      throw new Error(
        `the Access service token ${name} has no readable expires_at (${JSON.stringify(raw)})`,
      );
    return { name, expiresAt: new Date(raw) };
  });
};

export const dueSoon = (tokens: WatchedToken[], now: Date): WatchedToken[] =>
  tokens.filter(
    ({ expiresAt }) => expiresAt.getTime() - now.getTime() <= WARN_DAYS * DAY_MS,
  );

const day = (at: Date) => at.toISOString().slice(0, 10);
const minute = (at: Date) => at.toISOString().slice(0, 16).replace('T', ' ');

export const titleFor = (token: WatchedToken): string =>
  `The Access service token ${token.name} expires on ${day(token.expiresAt)}`;

export const bodyFor = (token: WatchedToken, now: Date): string => {
  const left = token.expiresAt.getTime() - now.getTime();
  const days = Math.floor(left / DAY_MS);
  const at = `${minute(token.expiresAt)} UTC`;
  const when =
    left <= 0 ? `expired at ${at}, before this check`
    : days === 0 ? `expires at ${at}, within a day of this check`
    : `expires at ${at}, ${days === 1 ? '1 day' : `${days} days`} after this check`;
  return (
    `The Cloudflare Access service token \`${token.name}\` ${when}.\n\n` +
    'Rotate it as docs/runbooks/cloudflare-access.md says under ' +
    '"Rotating a service token", then close this issue.'
  );
};

/** The bot's own issues, pull requests left out; a list this cannot read throws. */
const botIssues = (issues: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(issues)) throw new Error("the repository's issues are not a list");
  return issues.filter(
    (issue): issue is Record<string, unknown> =>
      isRecord(issue) &&
      !('pull_request' in issue) &&
      isRecord(issue.user) &&
      issue.user.login === ISSUE_AUTHOR,
  );
};

export const missingTitles = (wanted: string[], issues: unknown): string[] => {
  const have = new Set(botIssues(issues).map(({ title }) => title));
  return [...new Set(wanted)].filter((title) => !have.has(title));
};

export const openFailureIssue = (issues: unknown): number | undefined => {
  const open = botIssues(issues).find(
    ({ title, state }) => title === FAILURE_TITLE && state === 'open',
  );
  return typeof open?.number === 'number' ? open.number : undefined;
};

export const assigned = (issue: unknown): boolean =>
  isRecord(issue) &&
  Array.isArray(issue.assignees) &&
  issue.assignees.some((who) => isRecord(who) && who.login === ASSIGNEE);
```

- [ ] **Step 5:** Run unit + logs files → PASS; whole unit suite, typecheck, lint green; CPU report shows each new test under 0.07 s.
- [ ] **Step 6:** Commit `Reading a service token's expiry, and the warning it earns (Refs #796)`.

### Task 3: The script, against stand-ins

**Files:**
- Create: `scripts/access-expiry.mjs`
- Create: `tests/json-stand-in.ts` (the recording stand-in, moved out of `waiting-reports-script.test.ts`; the floor and `searched` stay at each call site with their literal ids)
- Modify: `tests/integration/waiting-reports-script.test.ts` (import the stand-in)
- Test: `tests/integration/access-expiry-script.test.ts`

**Interfaces:**
- Consumes: Task 1 `answerOf`; Task 2 everything.
- Produces: `node scripts/access-expiry.mjs [report-failure]`; env `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_READ_TOKEN` (check mode), `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_API_URL`, `GITHUB_SERVER_URL` + `GITHUB_RUN_ID` (report-failure), `CLOUDFLARE_API_BASE`, `ACCESS_EXPIRY_TIMEOUT_MS`. Exit 2 on a wrong argument, 1 on any failure.
- `standIn(side)` returns `{ received, url, answer(fn), start(), stop(), record(), everything() }`; `everything()` sends the sentinel and returns every request including it, for the call site's `searched` + `floorBreach`.

- [ ] **Step 1: Failing integration tests**, each a spawned process against Cloudflare and GitHub stand-ins, `now` fixed by stand-in expiry dates relative to `Date.now()`:
  1. One token 10 days out, no issues → one `POST /repos/o/r/issues` with `titleFor`'s title, `bodyFor`'s first sentence, `assignees: ['ShydenMcM']`; exit 0. **The planted near-expiry (AC2).**
  2. Same, a closed bot issue already holding the title → no POST; exit 0.
  3. Same, the matching issue on GitHub's page 2 (page 1 holds 100 others) → no POST; both pages requested.
  4. One token 200 days out → exit 0, and GitHub received nothing (`everything()` + `searched` + `floorBreach('access-expiry-script/stand-in-requests', all.length)`).
  5. Empty token list → exit 1, stderr `is empty, so no token can be watched`, GitHub received nothing.
  6. `expires_at` missing → exit 1 naming the token.
  7. Cloudflare HTTP 403 with `errors` → exit 1, stderr `Cloudflare answered HTTP 403 (10000 Authentication error)`.
  8. GitHub creates the issue with `assignees: []` → exit 1, stderr `opened without ShydenMcM assigned`.
  9. Two tokens, one due → exactly one POST.
  10. Cloudflare request: `GET /accounts/<id>/access/service_tokens?per_page=1000`, `authorization: Bearer <token>`.
  11. `report-failure`, no open failure issue → POST issue `FAILURE_TITLE`, body the run URL, assignee; never touches Cloudflare (`everything()` on the Cloudflare stand-in, its own floor `access-expiry-script/cloudflare-untouched`).
  12. `report-failure`, an open failure issue #7 → POST `/issues/7/comments` with the run URL; no new issue.
  13. Cloudflare never answers, `ACCESS_EXPIRY_TIMEOUT_MS=200` → exit 1 within the suite's limit.
  14. A wrong argument → exit 2, usage line.
- [ ] **Step 2:** Do not run integration locally (CI's suite). Typecheck the new file.
- [ ] **Step 3: Implement** `scripts/access-expiry.mjs`:

```js
#!/usr/bin/env node
/**
 * Warn before a Cloudflare Access service token lapses (#796). Run daily on
 * `main` by `.github/workflows/access-expiry.yml`.
 *
 *   node scripts/access-expiry.mjs                  read every token, warn
 *   node scripts/access-expiry.mjs report-failure   say the check could not run
 *
 * Cloudflare first: GitHub is not touched until every token's expiry has been
 * read and one falls within WARN_DAYS. Imports nothing from `node_modules`.
 * Prints and posts token names and expiry times only: the logs are public.
 */
import { die, messageOf } from './errors.mjs';
import { endpoint, setting } from './settings.mjs';
import { answerOf } from './json-answer.mjs';
import {
  ASSIGNEE, FAILURE_TITLE, REQUEST_TIMEOUT_MS, WARN_DAYS,
  assigned, bodyFor, dueSoon, missingTitles, openFailureIssue, titleFor, tokensFrom,
} from '../src/lib/access-expiry.ts';

const PAGE = 100;
const MOST_PAGES = 100;

const timeoutMs = () =>
  process.env.ACCESS_EXPIRY_TIMEOUT_MS === undefined
    ? REQUEST_TIMEOUT_MS
    : Number(setting('ACCESS_EXPIRY_TIMEOUT_MS', /^[1-9]\d*$/));

const github = () => {
  const api = endpoint('GITHUB_API_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const token = setting('GITHUB_TOKEN', /^\S+$/);
  const issues = `${api}/repos/${repository}/issues`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'shyden-access-expiry',
  };
  const send = (url, body) =>
    answerOf('GitHub', url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs());
  return {
    /** Every issue, open and closed, every page. */
    async all() {
      const every = [];
      for (let page = 1; page <= MOST_PAGES; page += 1) {
        const batch = await answerOf('GitHub',
          `${issues}?state=all&per_page=${PAGE}&page=${page}`, { headers }, timeoutMs());
        if (!Array.isArray(batch)) throw new Error("GitHub's issue list is not a list");
        every.push(...batch);
        if (batch.length < PAGE) return every;
      }
      throw new Error(`the repository holds more than ${PAGE * MOST_PAGES} issues`);
    },
    async open(title, body) {
      const issue = await send(issues, { title, body, assignees: [ASSIGNEE] });
      if (!assigned(issue))
        throw new Error(`issue "${title}" was opened without ${ASSIGNEE} assigned`);
    },
    comment: (number, body) => send(`${issues}/${number}/comments`, { body }),
  };
};

const readTokens = async () => {
  const base = endpoint('CLOUDFLARE_API_BASE', 'https://api.cloudflare.com/client/v4');
  const account = setting('CLOUDFLARE_ACCOUNT_ID', /^[0-9a-f]{32}$/);
  const token = setting('CLOUDFLARE_ACCESS_READ_TOKEN', /^\S+$/);
  return tokensFrom(await answerOf('Cloudflare',
    `${base}/accounts/${account}/access/service_tokens?per_page=1000`,
    { headers: { authorization: `Bearer ${token}` } }, timeoutMs()));
};

const check = async () => {
  const repo = github();
  const tokens = await readTokens();
  for (const { name, expiresAt } of tokens)
    console.log(`${name} expires ${expiresAt.toISOString()}`);
  const now = new Date();
  const due = dueSoon(tokens, now);
  if (due.length === 0) {
    console.log(`${tokens.length} watched; none expires within ${WARN_DAYS} days.`);
    return;
  }
  const missing = new Set(missingTitles(due.map(titleFor), await repo.all()));
  for (const token of due) {
    const title = titleFor(token);
    if (!missing.delete(title)) continue;
    await repo.open(title, bodyFor(token, now));
    console.log(`Opened: ${title}`);
  }
};

const reportFailure = async () => {
  const server = endpoint('GITHUB_SERVER_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const run = setting('GITHUB_RUN_ID', /^\d+$/);
  const url = `${server}/${repository}/actions/runs/${run}`;
  const repo = github();
  const open = openFailureIssue(await repo.all());
  if (open === undefined) await repo.open(FAILURE_TITLE, url);
  else await repo.comment(open, url);
  console.log('Reported the failure.');
};

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || (mode !== undefined && mode !== 'report-failure')) {
    console.error('usage: node scripts/access-expiry.mjs [report-failure]');
    process.exit(2);
  }
  await (mode === 'report-failure' ? reportFailure() : check()).catch((error) =>
    die(messageOf(error)),
  );
}
```

- [ ] **Step 4:** Typecheck (JSDoc types where `astro check` asks), lint, format, unit suite green. The integration suite runs in the PR's CI.
- [ ] **Step 5:** Commit `The expiry check as a script, proved against stand-ins (Refs #796)`.

### Task 4: The workflow, its guards and the runbook (after #877 is on `develop`)

**Files:**
- Merge `origin/develop` (with #877) into the branch first.
- Create: `.github/workflows/access-expiry.yml`
- Modify: `tests/guards/pipeline-wiring.test.ts`
- Modify: `docs/runbooks/cloudflare-access.md`

- [ ] **Step 1: Failing guards:**
  - `CLOUDFLARE_ENVIRONMENTS` gains `{ does: 'reads the Access service tokens', environment: 'access-expiry', in: watchesAccessTokens }`, with `watchesAccessTokens = (s) => /^[ \t]*node scripts\/access-expiry\.mjs[ \t]*$/m.test(s)`.
  - #877's reports-count tenant rule becomes one table, `UNATTENDED_ENVIRONMENTS` (`reports-count`: `CLOUDFLARE_D1_READ_TOKEN`, `REPORTS_COUNT_SECRETS`, `countsWaitingReports`; `access-expiry`: `CLOUDFLARE_ACCESS_READ_TOKEN`, `['CLOUDFLARE_ACCESS_READ_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']`, `watchesAccessTokens`), one generated test per row: only its job is a tenant, on `github.ref == 'refs/heads/main'` alone, holding exactly its secrets, and its token read nowhere else. Floors: `pipeline-wiring/reports-count-jobs` (kept) and `pipeline-wiring/access-expiry-jobs` (new), each row carrying `floor: (n: number) => floorBreach('<its literal id>', n)`, so the id is a literal where it is written and never interpolated.
  - The waiting-reports workflow block becomes a `describe.each` over both daily workflows (file, check job name, cron, concurrency group, script, secrets, job env), so the dispatch-only-on-schedule, `--ref main`, main-only, permissions, steps and failure-step tests are one set run twice. Crons: `17 1 * * *` and `43 1 * * *`.
- [ ] **Step 2:** Guards run in CI (PR); locally typecheck + unit.
- [ ] **Step 3: Workflow** `.github/workflows/access-expiry.yml`: header comment as `waiting-reports.yml`'s; `schedule: cron '43 1 * * *'` (08:43 WIB, off the hour), `workflow_dispatch`; `permissions: contents: read`; `concurrency: { group: access-expiry, cancel-in-progress: false }`; job `dispatch` (`if: github.event_name == 'schedule'`, `actions: write`, `gh workflow run access-expiry.yml --ref main`); job `check` (`if: github.ref == 'refs/heads/main'`, `environment: access-expiry`, `contents: read` + `issues: write`, env `GITHUB_TOKEN`; steps checkout + setup-node at waiting-reports' SHAs, `node scripts/access-expiry.mjs` with the two Cloudflare secrets in the step's env, then `if: failure()` `node scripts/access-expiry.mjs report-failure`).
- [ ] **Step 4: Runbook (AC3).** Replace "To replace the token" with a `## Rotating a service token` section: create the new token in Zero Trust → Service credentials; store its pair as `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` in the `prod` GitHub environment; swap it into `prod-automation`; run a release's prod-sanity (or dispatch it) to prove it; delete the old token; close the warning issue. Add `## The expiry check (#796)`: what it reads, when it warns (45 days), and the one-time setup (Cloudflare API token with **Access: Service Tokens Read** on the account; GitHub environment `access-expiry`, deployment branches `main` alone, no reviewer, the unattended-job exception; secrets `CLOUDFLARE_ACCESS_READ_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
- [ ] **Step 5:** Format, lint, typecheck, unit green. Commit `The expiry check runs daily on main alone (Refs #796)`.

### Task 5: Floors, PR, mutants, merge, live proof

- [ ] **Step 1:** Push; open draft PR (body via `node scripts/closing-keywords.mjs`); dispatch `record-floors.yml` (`branch: 796-access-token-expiry`, `mode: full`) once CI has run; pull the record's commit.
- [ ] **Step 2: Mutants**, each its own branch pushed for CI, verdicts posted in the PR:
  - `796-mut-window`: `<=` → `<` in `dueSoon` → RED unit "exactly 45 days later is due".
  - `796-mut-empty`: drop the empty-list throw → RED unit + integration 5.
  - `796-mut-assignee`: drop the `assigned` check → RED integration 8.
  - `796-mut-ref`: drop `check`'s `if:` → RED pipeline-wiring main-only row for `access-expiry`.
  - `796-mut-dispatch`: `--ref develop` → RED the dispatch test for `access-expiry.yml`.
  - `796-mut-loose`: replace the `ISO_TIME` test with `Date.parse` alone → RED unit `'2027'`.
- [ ] **Step 3:** Ready, CI green on `headRefOid`, merge into `develop` with a merge commit; `dev-verified` read off the commit.
- [ ] **Step 4: Live proof after the release (the workflow runs on `main` alone).** Shyden creates the Cloudflare API token and the `access-expiry` environment (`main` alone) with its two secrets; read back `gh api repos/shyden-labs/shyden.co.uk/environments/access-expiry/deployment-branch-policies`. **Before** the secrets exist, a dispatch on `main` must fail and open `FAILURE_TITLE` assigned to ShydenMcM (the planted failure on the real runner). Then with the secrets: dispatch, read the log: `prod-sanity-2 expires 2027-10-15T23:55:00.000Z`, `1 watched; none expires within 45 days.` Close #796 N of N ACs.
