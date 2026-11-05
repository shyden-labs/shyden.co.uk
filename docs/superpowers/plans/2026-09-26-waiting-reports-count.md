# The waiting-reports count (#349) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** on each day that translation reports wait in production, the operator gets one comment on issue #360 saying how many, and nothing else.

**Architecture:** a pure module (`src/lib/waiting-reports.ts`) reads Cloudflare's and GitHub's answers, and a script (`scripts/waiting-reports.mjs`) wires it to Node's `fetch`. A scheduled workflow (`.github/workflows/waiting-reports.yml`) runs the script in the `reports-count` environment, which holds a D1 Read token and the account id, and nothing else. The count is read first. GitHub is touched only for a count above zero, or to say the count could not be read.

**Tech Stack:** Node 24 (type stripping, native `fetch`), TypeScript, Vitest, GitHub Actions, Cloudflare D1 REST API.

**Spec:** `docs/superpowers/specs/2026-09-23-translation-reports-design.md`, section 15 (#349).

## Global Constraints

- The comment is exactly `1 translation report is waiting.` or `<n> translation reports are waiting.`: no quote, suggestion, note, locale, page or date (spec 15.1).
- The failure notice is exactly `The waiting-reports count could not be read.` followed by the run's URL, and holds no digit of its own (15.2).
- At most one **count** per UTC day. A failure notice does not count (15.1).
- Anything that is not a non-negative integer count is a failure, never a zero (15.2).
- Only the database named exactly `shyden-reports` is counted, found by `uuid` (15.2).
- The job has `permissions: { contents: read, issues: write }`, environment `reports-count`, no `npm ci`, and runs at `17 1 * * *` and on `workflow_dispatch` (15.3).
- `src/lib/waiting-reports.ts` is erasable TypeScript: Node runs it by stripping types, with no build step. Any sibling it imports is named with its `.ts` extension (refinement 3).
- The operator's three setup steps (15.6) are read back before the merge. The write-refusal probe (15.5) passes before the merge.
- Every new guard is mutation-verified. Commit before any mutation.
- Commit messages carry `Refs #349`, never a closing keyword.

## Refinements over the spec

The spec was approved before this code was run. Writing and running it changed seven things, each recorded here so the spec and the code can be read together:

1. **`since=` on the comments list.** GitHub lists an issue's comments oldest first, 30 a page by default and 100 at most. After 30 to 100 days of daily counts, today's comment would sit beyond the first page and `postedToday` would never see it. The script asks only for comments updated since midnight UTC (Review Focus 1).
2. **A 30 s timeout on every request** (`REQUEST_TIMEOUT_MS`). A request that hangs would otherwise run until the job's `timeout-minutes` ends the job. GitHub documents `failure()` as true when a previous step *fails*, and does not say a `failure()` step runs in a job ended that way, so the plan does not rely on it. A hang fails its own step within 30 s instead, and the failure notice follows as documented (Review Focus 2). `WAITING_REPORTS_TIMEOUT_MS` shortens it for the test alone.
3. **`src/lib/is-record.ts`.** `duplication.test.ts` refused the module's `isRecord` as a copy of `tests/workflow-jobs.ts`'s `isMapping`. `scripts/e2e-shards.mjs` held a third copy. All three now import one home (Task 1).
4. **Four more exports** than 15.4 names: `NOTICE_AUTHOR`, `REQUEST_TIMEOUT_MS`, `errorsIn` and `startOfUtcDay`. The script uses three of them, `postedToday` uses `NOTICE_AUTHOR`, and each carries a test.
5. **The #241 array is renamed** from `PAGES_ENVIRONMENTS` to `CLOUDFLARE_ENVIRONMENTS`, and its rule's title changes to match. Reading a count changes no Pages project, so the old name would describe the new row wrongly. 15.3's "nothing else may read secrets in `reports-count`" gets its own test.
6. **The notice issue exists: #360**, created while this plan was written, assigned to `ShydenMcM`. Its card was archived off the Shyden Site board, because it is where notices arrive, not work. The write-refusal probe moves **before** the merge, since the operator holds the token anyway.
7. **One run at a time.** A dispatch during the scheduled run could have each run list no count for today, and each post one. The workflow's `concurrency` group queues the second run, never cancelling the first, so the second run's list sees the first run's comment.

## Review Focus

1. **An issue with more than a page of comments.** After 30 to 100 days, depending on page size, a list without `since=` would show only the oldest comments, and a second count would be posted every re-run. Pinned in Task 3 (_lists only today's comments_) and Task 2 (`startOfUtcDay`).
2. **A Cloudflare that accepts the connection and never answers.** A hang must fail the step inside the job's budget, so the failure notice still runs. Pinned in Task 3 (_a Cloudflare that never answers times out_) and Task 2 (`REQUEST_TIMEOUT_MS` is 30 000).
3. **Midnight UTC.** Yesterday's count at 23:59:59Z must not silence today's, and a +07:00 clock must not move the day. Pinned in Task 2 (`postedToday`, `startOfUtcDay`).
4. **An answer that is almost right.** A count of `"3"`, `null`, `1.5`, `-1` or `2**53`, a missing field, zero rows or two rows must be a failure, never a zero. So must a database id that would reshape the query's URL (`../../x`), refused before the query is sent, and a missing secret, refused before any request. Pinned in Task 2 (`countFrom`'s `it.each`, the UUID check) and Task 3 (a 403 carrying HTML; _a missing secret stops before any request_).
5. **A stranger's comment on the public notice issue:** one whose author's account was deleted (`user: null`), or with a shape nobody expected. It is not the bot's count, and it must never stop the day's count, or every day's after it. Pinned in Task 2 (_finds today's count beside comments it cannot read, which are not counts_).

---

### Task 1: One home for `isRecord`

**Files:**
- Create: `src/lib/is-record.ts`
- Test: `tests/unit/is-record.test.ts`
- Modify: `tests/workflow-jobs.ts` (drop `isMapping`, import `isRecord`)
- Modify: `scripts/e2e-shards.mjs` (drop its `isRecord`, import the home)

**Interfaces:**
- Produces: `isRecord(value: unknown): value is Record<string, unknown>`, from `src/lib/is-record.ts`. It imports nothing.

- [ ] **Step 1: Write the failing test**

`tests/unit/is-record.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isRecord } from '../../src/lib/is-record';

describe('isRecord', () => {
  it('accepts a plain object, empty or not', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ name: 'shyden-reports' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', '{}'],
    ['a number', 0],
    ['undefined', undefined],
  ])('refuses %s', (_, value) => {
    expect(isRecord(value)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it red**

Create `src/lib/is-record.ts` as a stub, so each test fails on its own assertion rather than on an import:

```ts
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  throw new Error(`not implemented: ${String(value)}`);
};
```

Run: `npx vitest run tests/unit/is-record.test.ts`
Expected: `Tests  6 failed (6)`, each with `not implemented`.

- [ ] **Step 3: Implement**

`src/lib/is-record.ts`:

```ts
/**
 * Whether a parsed value is a plain object whose keys can be read: not
 * `null`, and not an array, both of which `typeof` calls `'object'`.
 *
 * The one home for this check: `tests/workflow-jobs.ts` and
 * `scripts/e2e-shards.mjs` each held a copy when #349 was about to add a third.
 * Imports nothing, and is erasable TypeScript, so a script Node runs by
 * stripping types can import it as well as the site and the tests.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
```

- [ ] **Step 4: Point the two copies at the home**

`tests/workflow-jobs.ts` loses its `isMapping` definition, and every `isMapping` becomes `isRecord` (12 occurrences before the edit: 1 definition and 11 uses). `scripts/e2e-shards.mjs` loses its own `isRecord` and imports the home with its `.ts` extension, because Node runs it without a build:

```diff
@@ -2,4 +2,5 @@ import { parseDocument } from 'yaml';
 import { stringLeaves } from './catalogue-leaves';
 import { withoutCommentLines } from './unit/source-text';
+import { isRecord } from '../src/lib/is-record';
 
 /**
@@ -55,7 +56,4 @@ export interface WorkflowJob {
 }
 
-const isMapping = (value: unknown): value is Record<string, unknown> =>
-  value !== null && typeof value === 'object' && !Array.isArray(value);
-
 const withoutStringLiterals = (condition: string): string =>
   condition.replace(/'(?:[^']|'')*'/g, "''");
@@ -128,5 +126,5 @@ function runsOf(job: Record<string, unknown>, where: string): string[] {
   return steps.flatMap((step: unknown, index) => {
     const which = `${where}: step ${index + 1}`;
-    if (!isMapping(step)) throw new Error(`${which} is not a mapping`);
+    if (!isRecord(step)) throw new Error(`${which} is not a mapping`);
     if (step.run === undefined) return [];
     if (typeof step.run !== 'string')
@@ -142,5 +140,5 @@ function environmentOf(
   const { environment } = job;
   if (environment === undefined) return undefined;
-  const name = isMapping(environment) ? environment.name : environment;
+  const name = isRecord(environment) ? environment.name : environment;
   if (typeof name !== 'string' || name.trim() === '')
     throw new Error(`${where}: environment names no environment`);
@@ -215,13 +213,13 @@ export function parseCleanYaml(text: string, file: string): unknown {
 export function workflowJobs(text: string, file: string): WorkflowJob[] {
   const root = parseCleanYaml(text, file);
-  const jobs = isMapping(root) ? root.jobs : undefined;
-  if (!isMapping(jobs)) throw new Error(`${file} has no jobs mapping`);
+  const jobs = isRecord(root) ? root.jobs : undefined;
+  if (!isRecord(jobs)) throw new Error(`${file} has no jobs mapping`);
   const shared = secretsReadIn(
-    isMapping(root) ? root.env : undefined,
+    isRecord(root) ? root.env : undefined,
     `${file}'s env`,
   );
   return Object.entries(jobs).map(([id, body]) => {
     const where = `${file} job '${id}'`;
-    if (!isMapping(body)) throw new Error(`${where} is not a mapping`);
+    if (!isRecord(body)) throw new Error(`${where} is not a mapping`);
     return {
       id,
@@ -404,9 +402,9 @@ const POSTED_STATUS = /-f\s+context=(\S+)/g;
 export function producibleContexts(text: string, file: string): string[] {
   const root = parseCleanYaml(text, file);
-  const jobs = isMapping(root) ? root.jobs : undefined;
-  if (!isMapping(jobs)) throw new Error(`${file} has no jobs mapping`);
+  const jobs = isRecord(root) ? root.jobs : undefined;
+  if (!isRecord(jobs)) throw new Error(`${file} has no jobs mapping`);
 
   const contexts = Object.entries(jobs).map(([id, body]) => {
-    const declared = isMapping(body) ? body.name : undefined;
+    const declared = isRecord(body) ? body.name : undefined;
     return typeof declared === 'string' ? declared : id;
   });
@@ -462,5 +460,5 @@ export function inheritedPermissionsFindings(
     if (typeof permissions === 'string')
       return [`${file} grants every scope with the '${permissions}' shorthand`];
-    if (!isMapping(permissions))
+    if (!isRecord(permissions))
       return [`${file} declares permissions that are not a mapping`];
     return Object.entries(permissions)
@@ -487,5 +485,5 @@ export function workflowLevelWrites(permissions: unknown): string[] {
   if (typeof permissions === 'string')
     return permissions === 'read-all' ? [] : ['every scope'];
-  if (!isMapping(permissions)) return [];
+  if (!isRecord(permissions)) return [];
   return Object.entries(permissions)
     .filter(([, value]) => value === 'write')
```

```diff
@@ -29,4 +29,5 @@
 import { existsSync, readFileSync } from 'node:fs';
 import { messageOf } from './errors.mjs';
+import { isRecord } from '../src/lib/is-record.ts';
 
 /** @typedef {{ index: number, total: number }} Shard */
@@ -143,8 +144,4 @@ export function shardNotice({ shard, enumerated, executed }) {
 }
 
-/** @param {unknown} value @returns {value is Record<string, unknown>} */
-const isRecord = (value) =>
-  value !== null && typeof value === 'object' && !Array.isArray(value);
-
 /**
  * Why `build-and-test` must not pass on these needs: one finding for every job
```

Check that the rename applied: `command grep -c isMapping tests/workflow-jobs.ts` prints `0`, and `command grep -c isRecord tests/workflow-jobs.ts` prints `12`.

- [ ] **Step 5: Run green**

Run: `npx vitest run tests/unit/is-record.test.ts tests/unit/workflow-jobs.test.ts tests/unit/e2e-shards.test.ts tests/unit/pipeline-wiring.test.ts`
Expected: all pass. Then `npx astro check` shows `- 0 errors`, `- 0 warnings`, `- 0 hints`: three lines, matched with `(error|warning|hint)s?`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/is-record.ts tests/unit/is-record.test.ts tests/workflow-jobs.ts scripts/e2e-shards.mjs
git commit -m "One home for isRecord, before a third copy arrives (Refs #349)"
```

---

### Task 2: The pure module

**Files:**
- Create: `src/lib/waiting-reports.ts`
- Test: `tests/unit/waiting-reports.test.ts`

**Interfaces:**
- Consumes: `isRecord` from `./is-record.ts` (Task 1).
- Produces, all from `src/lib/waiting-reports.ts`:
  - `REPORTS_DATABASE = 'shyden-reports'`, `COUNT_SQL = 'SELECT count(*) FROM reports'`, `FAILURE_NOTICE`, `NOTICE_AUTHOR = 'github-actions[bot]'`, `REQUEST_TIMEOUT_MS = 30_000`;
  - `databaseIdFrom(list: unknown): string`, the uuid, or a throw;
  - `countFrom(answer: unknown): number`, or a throw;
  - `noticeFor(count: number): string | null`;
  - `errorsIn(answer: unknown): string`, ` (<code> <message>; …)` or `''`;
  - `startOfUtcDay(now: Date): string`, `YYYY-MM-DDT00:00:00Z`;
  - `postedToday(comments: unknown, now: Date): boolean`, or a throw.

- [ ] **Step 1: Write the failing tests**

`tests/unit/waiting-reports.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  COUNT_SQL,
  FAILURE_NOTICE,
  NOTICE_AUTHOR,
  REPORTS_DATABASE,
  REQUEST_TIMEOUT_MS,
  countFrom,
  databaseIdFrom,
  errorsIn,
  noticeFor,
  postedToday,
  startOfUtcDay,
} from '../../src/lib/waiting-reports';

/**
 * The waiting-reports count (#349, spec section 15). Every malformed answer
 * must THROW: a zero posts nothing, so an answer misread as zero would
 * silence the operator's notice without anyone noticing.
 */

const PROD_ID = '0b9e6c1a-2f4d-4e8a-9c3b-5d7e1f2a3b4c';
const DEV_ID = '7f3a2b1c-9d8e-4f6a-8b5c-1e2d3c4b5a69';

/** A D1 list answer, in Cloudflare's envelope. */
const listing = (databases: unknown[]) => ({
  success: true,
  errors: [],
  messages: [],
  result: databases,
});

/** A D1 query answer to `COUNT_SQL`, in Cloudflare's envelope. */
const counted = (count: unknown) => ({
  success: true,
  errors: [],
  messages: [],
  result: [{ success: true, meta: {}, results: [{ 'count(*)': count }] }],
});

describe('the constants are pinned to their literal values', () => {
  it('counts every row of the production reports table', () => {
    expect(COUNT_SQL).toBe('SELECT count(*) FROM reports');
    expect(REPORTS_DATABASE).toBe('shyden-reports');
  });

  it('the failure notice is one fixed sentence holding no digit', () => {
    expect(FAILURE_NOTICE).toBe('The waiting-reports count could not be read.');
    expect(FAILURE_NOTICE).not.toMatch(/\d/);
  });

  it('the notice author is the workflow token, and requests give up after 30s', () => {
    expect(NOTICE_AUTHOR).toBe('github-actions[bot]');
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});

describe('databaseIdFrom', () => {
  it('picks the exact name out of a list holding the dev database beside it', () => {
    const list = listing([
      { uuid: DEV_ID, name: 'shyden-reports-dev' },
      { uuid: PROD_ID, name: 'shyden-reports' },
    ]);
    expect(databaseIdFrom(list)).toBe(PROD_ID);
  });

  it('throws when only the dev database is listed', () => {
    const list = listing([{ uuid: DEV_ID, name: 'shyden-reports-dev' }]);
    expect(() => databaseIdFrom(list)).toThrow(
      /holds 0 databases named shyden-reports/,
    );
  });

  it('throws when two databases carry the name', () => {
    const list = listing([
      { uuid: PROD_ID, name: 'shyden-reports' },
      { uuid: DEV_ID, name: 'shyden-reports' },
    ]);
    expect(() => databaseIdFrom(list)).toThrow(
      /holds 2 databases named shyden-reports/,
    );
  });

  it('throws on an id that is not a UUID, since it goes into a URL path', () => {
    const list = listing([{ uuid: '../../x', name: 'shyden-reports' }]);
    expect(() => databaseIdFrom(list)).toThrow(/has no uuid/);
  });

  it('throws on success: false, naming Cloudflare errors', () => {
    const list = {
      success: false,
      errors: [{ code: 10000, message: 'Authentication error' }],
      result: null,
    };
    expect(() => databaseIdFrom(list)).toThrow(
      'the D1 database list says success: false (10000 Authentication error)',
    );
  });

  it('throws when the result is not a list', () => {
    expect(() => databaseIdFrom({ success: true, result: {} })).toThrow(
      /no list of databases/,
    );
    expect(() => databaseIdFrom('<html>')).toThrow(/not a JSON object/);
  });
});

describe('countFrom', () => {
  it('reads a zero and a three', () => {
    expect(countFrom(counted(0))).toBe(0);
    expect(countFrom(counted(3))).toBe(3);
  });

  it.each([
    ['a string', '3'],
    ['a fraction', 1.5],
    ['a negative', -1],
    ['null', null],
    ['a missing count', undefined],
    ['an unsafe integer', 2 ** 53],
  ])('throws on %s, never reading it as a count', (_, value) => {
    expect(() => countFrom(counted(value))).toThrow(/not a whole number/);
  });

  it('throws on success: false', () => {
    expect(() =>
      countFrom({ ...counted(3), success: false, errors: [] }),
    ).toThrow('the D1 query says success: false');
  });

  it('throws when the statement itself failed', () => {
    const answer = counted(3);
    answer.result[0].success = false;
    expect(() => countFrom(answer)).toThrow(/statement failed/);
  });

  it.each([
    ['no statement', { success: true, result: [] }, /answered no statement/],
    [
      'no rows',
      { success: true, result: [{ success: true, results: [] }] },
      /exactly one row/,
    ],
    [
      'two rows',
      {
        success: true,
        result: [
          {
            success: true,
            results: [{ 'count(*)': 1 }, { 'count(*)': 2 }],
          },
        ],
      },
      /exactly one row/,
    ],
  ])('throws on %s', (_, answer, message) => {
    expect(() => countFrom(answer)).toThrow(message);
  });
});

describe('noticeFor', () => {
  it('says nothing at zero, the singular at one and the plural above', () => {
    expect(noticeFor(0)).toBeNull();
    expect(noticeFor(1)).toBe('1 translation report is waiting.');
    expect(noticeFor(2)).toBe('2 translation reports are waiting.');
    expect(noticeFor(117)).toBe('117 translation reports are waiting.');
  });
});

describe('errorsIn', () => {
  it('lists each code and message, and is empty when there are none', () => {
    expect(
      errorsIn({
        errors: [
          { code: 7500, message: 'not authorized' },
          { code: 7403, message: 'forbidden' },
        ],
      }),
    ).toBe(' (7500 not authorized; 7403 forbidden)');
    expect(errorsIn({ errors: [] })).toBe('');
    expect(errorsIn('<html>')).toBe('');
  });
});

describe('startOfUtcDay', () => {
  it("is midnight UTC on the instant's UTC day, even where local time differs", () => {
    expect(startOfUtcDay(new Date('2026-09-26T23:59:59.999Z'))).toBe(
      '2026-09-26T00:00:00Z',
    );
    expect(startOfUtcDay(new Date('2026-09-27T00:00:00.000+07:00'))).toBe(
      '2026-09-26T00:00:00Z',
    );
  });
});

describe('postedToday', () => {
  const NOW = new Date('2026-09-26T01:17:30Z');
  const comment = (login: string, body: string, created_at: string) => ({
    user: { login },
    body,
    created_at,
  });

  it("finds the bot's count from earlier the same UTC day", () => {
    const comments = [
      comment(
        NOTICE_AUTHOR,
        '3 translation reports are waiting.',
        '2026-09-26T00:00:00Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(true);
  });

  it("does not count yesterday's count, one second before midnight UTC", () => {
    const comments = [
      comment(
        NOTICE_AUTHOR,
        '3 translation reports are waiting.',
        '2026-09-25T23:59:59Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(false);
  });

  it('does not count a failure notice, so a re-run still reports', () => {
    const comments = [
      comment(
        NOTICE_AUTHOR,
        `${FAILURE_NOTICE}\n\nhttps://github.com/o/r/actions/runs/1`,
        '2026-09-26T01:17:10Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(false);
  });

  it('does not count a count posted by anyone else', () => {
    const comments = [
      comment(
        'ShydenMcM',
        '1 translation report is waiting.',
        '2026-09-26T01:00:00Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(false);
  });

  it('does not count a bot comment that only resembles a count', () => {
    const comments = [
      comment(
        NOTICE_AUTHOR,
        '1 translation reports are waiting.',
        '2026-09-26T01:00:00Z',
      ),
      comment(
        NOTICE_AUTHOR,
        '0 translation reports are waiting.',
        '2026-09-26T01:00:00Z',
      ),
      comment(
        NOTICE_AUTHOR,
        '3 translation reports are waiting. Quote: x',
        '2026-09-26T01:00:00Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(postedToday([], NOW)).toBe(false);
  });

  it('throws on a list it cannot read, rather than risk a second count', () => {
    expect(() => postedToday({ message: 'Not Found' }, NOW)).toThrow(
      /not a list/,
    );
  });

  it("finds today's count beside comments it cannot read, which are not counts", () => {
    const unreadable = [
      { body: '3 translation reports are waiting.' },
      {
        user: null,
        body: '3 translation reports are waiting.',
        created_at: '2026-09-26T01:00:00Z',
      },
      {
        user: { login: NOTICE_AUTHOR },
        body: '3 translation reports are waiting.',
        created_at: 'soon',
      },
    ];
    expect(postedToday(unreadable, NOW)).toBe(false);
    expect(
      postedToday(
        [
          ...unreadable,
          comment(
            NOTICE_AUTHOR,
            '3 translation reports are waiting.',
            '2026-09-26T01:00:00Z',
          ),
        ],
        NOW,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run them red against throwing stubs**

`src/lib/waiting-reports.ts` as a stub. The constants hold their real values: a constant has no body to stub, and its test pins the literal.

```ts
export const REPORTS_DATABASE = 'shyden-reports';
export const COUNT_SQL = 'SELECT count(*) FROM reports';
export const FAILURE_NOTICE = 'The waiting-reports count could not be read.';
export const NOTICE_AUTHOR = 'github-actions[bot]';
export const REQUEST_TIMEOUT_MS = 30_000;
const stub = (name: string): never => {
  throw new Error(`not implemented: ${name}`);
};
export const errorsIn = (_answer: unknown): string => stub('errorsIn');
export const databaseIdFrom = (_list: unknown): string => stub('databaseIdFrom');
export const countFrom = (_answer: unknown): number => stub('countFrom');
export const noticeFor = (_count: number): string | null => stub('noticeFor');
export const startOfUtcDay = (_now: Date): string => stub('startOfUtcDay');
export const postedToday = (_comments: unknown, _now: Date): boolean =>
  stub('postedToday');
```

Run: `npx vitest run tests/unit/waiting-reports.test.ts`
Expected: the three constant tests pass, and **every other test fails**. A test that passes against this stub is vacuous: fix it before going on. The `toThrow` tests match the message each real throw names, never a bare `toThrow()`, so the stub's `not implemented` cannot satisfy them.

- [ ] **Step 3: Implement**

`src/lib/waiting-reports.ts`:

```ts
/**
 * The waiting-reports count (#349): how many translation reports wait in the
 * production `reports` table, read from Cloudflare's D1 API and told to the
 * operator as at most one count a day, on one issue, on days any wait.
 *
 * Pure: every function here works from its arguments alone, and returns a
 * value or throws. `scripts/waiting-reports.mjs` does the fetching. Node runs
 * this file by stripping its types, with no build step, so it uses erasable
 * TypeScript only (no enums, namespaces or parameter properties), and imports
 * only `is-record.ts`, which imports nothing, by its full name.
 *
 * Anything this cannot read as a count is an error, never a zero: a zero
 * sends nothing, so a misread zero would silence the notice with no one the
 * wiser.
 */
import { isRecord } from './is-record.ts';

/** The production database. `shyden-reports-dev` is never counted. */
export const REPORTS_DATABASE = 'shyden-reports';

export const COUNT_SQL = 'SELECT count(*) FROM reports';

/** Holds no digit, so no reading of it can pass for a count. */
export const FAILURE_NOTICE = 'The waiting-reports count could not be read.';

/** Who posts with the workflow's `GITHUB_TOKEN`. */
export const NOTICE_AUTHOR = 'github-actions[bot]';

/** Each Cloudflare and GitHub request gives up after this long. */
export const REQUEST_TIMEOUT_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The code and message of each entry in an answer's `errors` list, for a
 * failure's text. Nothing this job asks either side for holds a report's
 * content, so no error about it can carry one into the public log.
 */
export const errorsIn = (answer: unknown): string => {
  const errors = isRecord(answer) ? answer.errors : undefined;
  if (!Array.isArray(errors) || errors.length === 0) return '';
  const each = errors.map((error) =>
    isRecord(error)
      ? `${String(error.code)} ${String(error.message)}`
      : JSON.stringify(error),
  );
  return ` (${each.join('; ')})`;
};

/** A Cloudflare answer's `result`, once its envelope says it succeeded. */
const resultOf = (answer: unknown, what: string): unknown => {
  if (!isRecord(answer)) throw new Error(`${what} is not a JSON object`);
  if (answer.success !== true)
    throw new Error(
      `${what} says success: ${JSON.stringify(answer.success)}${errorsIn(answer)}`,
    );
  return answer.result;
};

/**
 * The id of the one database named exactly `shyden-reports`, from the D1
 * list endpoint's answer. The endpoint's `name` filter is undocumented as to
 * whether it matches exactly, so its answer is filtered again here. The id
 * is checked against the UUID shape because it goes into a URL path.
 */
export const databaseIdFrom = (list: unknown): string => {
  const result = resultOf(list, 'the D1 database list');
  if (!Array.isArray(result))
    throw new Error('the D1 database list holds no list of databases');
  const named = result.filter(
    (database) => isRecord(database) && database.name === REPORTS_DATABASE,
  );
  if (named.length !== 1)
    throw new Error(
      `the D1 database list holds ${named.length} databases named ` +
        `${REPORTS_DATABASE}, not exactly 1`,
    );
  const [database] = named;
  const uuid = isRecord(database) ? database.uuid : undefined;
  if (typeof uuid !== 'string' || !UUID.test(uuid))
    throw new Error(`${REPORTS_DATABASE} has no uuid in the D1 database list`);
  return uuid;
};

/** The count from the D1 query endpoint's answer to `COUNT_SQL`. */
export const countFrom = (answer: unknown): number => {
  const result = resultOf(answer, 'the D1 query');
  const statement = Array.isArray(result) ? result[0] : undefined;
  if (!isRecord(statement))
    throw new Error('the D1 query answered no statement');
  if (statement.success === false)
    throw new Error(`the D1 query's statement failed${errorsIn(answer)}`);
  const rows = statement.results;
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0]))
    throw new Error('the D1 query did not answer exactly one row');
  const count = rows[0]['count(*)'];
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
    throw new Error(
      `the D1 query's count is ${JSON.stringify(count)}, not a whole number`,
    );
  return count;
};

/** The day's comment for `count`, or `null` when there is nothing to say. */
export const noticeFor = (count: number): string | null => {
  if (count === 0) return null;
  return count === 1
    ? '1 translation report is waiting.'
    : `${count} translation reports are waiting.`;
};

/** Whether `body` is a count notice, spelled exactly as `noticeFor` spells it. */
const isCountNotice = (body: unknown): boolean => {
  if (typeof body !== 'string') return false;
  const digits = /^([1-9]\d*) /.exec(body)?.[1];
  return digits !== undefined && noticeFor(Number(digits)) === body;
};

/** Midnight UTC on `now`'s day, as the ISO time GitHub's `since` takes. */
export const startOfUtcDay = (now: Date): string =>
  `${now.toISOString().slice(0, 10)}T00:00:00Z`;

/** The UTC day of an ISO time, or `undefined` when it is not one. */
const utcDayOf = (time: unknown): string | undefined => {
  const at = typeof time === 'string' ? Date.parse(time) : Number.NaN;
  return Number.isNaN(at) ? undefined : new Date(at).toISOString().slice(0, 10);
};

/**
 * Whether `NOTICE_AUTHOR` has already posted a count on `now`'s UTC day, from
 * the issue's comments as GitHub lists them. A failure notice, or a count
 * posted by anyone else, does not count, so a re-run after a failed morning
 * still reports.
 *
 * A comment this cannot read as the bot's count is simply not one. The issue
 * is public: a stranger's comment, or one whose author's account was deleted,
 * must not stop every day's count from then on. Only a list this cannot read
 * throws, rather than risk a second count or none.
 */
export const postedToday = (comments: unknown, now: Date): boolean => {
  if (!Array.isArray(comments))
    throw new Error("the issue's comments are not a list");
  const today = now.toISOString().slice(0, 10);
  return comments.some(
    (comment) =>
      isRecord(comment) &&
      isRecord(comment.user) &&
      comment.user.login === NOTICE_AUTHOR &&
      isCountNotice(comment.body) &&
      utcDayOf(comment.created_at) === today,
  );
};
```

- [ ] **Step 4: Run green**

Run: `npx vitest run tests/unit/waiting-reports.test.ts`
Expected: `Tests  32 passed (32)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/waiting-reports.ts tests/unit/waiting-reports.test.ts
git commit -m "Read the waiting-reports count out of D1's answers, refusing anything but a count (Refs #349)"
```

---

### Task 3: The script, run as a real process

**Files:**
- Create: `scripts/waiting-reports.mjs`
- Test: `tests/unit/waiting-reports-script.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `die` and `messageOf` from `scripts/errors.mjs`.
- Produces: `node scripts/waiting-reports.mjs` (count mode) and `node scripts/waiting-reports.mjs report-failure`. Exit 0 on success, 1 on any failure (a `✗ ` line on stderr), 2 on a wrong argument.
  - Reads `CLOUDFLARE_ACCOUNT_ID` (32 lowercase hex) and `CLOUDFLARE_D1_READ_TOKEN` in count mode only.
  - Reads `NOTICE_ISSUE`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_API_URL`, and, for `report-failure`, `GITHUB_SERVER_URL` and `GITHUB_RUN_ID`.
  - Optional: `CLOUDFLARE_API_BASE` and `WAITING_REPORTS_TIMEOUT_MS`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/waiting-reports-script.test.ts`. The stand-ins answer from this process's event loop, so the script is spawned with async `spawn`: `spawnSync` would block the loop, and every scenario would hang. Its environment is built whole, never inherited, so no real credential in the shell can reach it.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { FAILURE_NOTICE } from '../../src/lib/waiting-reports';
import { searched } from '../source-files';

/**
 * `scripts/waiting-reports.mjs` as a real process (#349, spec 15.5), against
 * two local stand-ins answering in Cloudflare's and GitHub's shapes. Each
 * stand-in records what it received, so "no request reached GitHub" is read
 * off GitHub's own record, after a sentinel proves that record is live (#118).
 *
 * Spawned with async `spawn`, never `spawnSync`: the stand-ins answer from
 * this process's event loop, which `spawnSync` would block.
 */

const SCRIPT = join(process.cwd(), 'scripts/waiting-reports.mjs');
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const PROD_ID = '0b9e6c1a-2f4d-4e8a-9c3b-5d7e1f2a3b4c';
const DEV_ID = '7f3a2b1c-9d8e-4f6a-8b5c-1e2d3c4b5a69';
const ISSUE = '4242';
const SENTINEL = '/sentinel';

type Received = { method: string; url: string; body: string; auth: string };

/** A local HTTP server that records each request and answers via `respond`. */
const standIn = (side: string) => {
  const received: Received[] = [];
  let respond: (
    request: Received,
  ) => { status: number; body: unknown } | null = () => ({
    status: 404,
    body: {},
  });
  let server: Server;
  let url = '';
  return {
    received,
    get url() {
      return url;
    },
    answer(next: typeof respond) {
      respond = next;
    },
    async start() {
      server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          const got = {
            method: request.method ?? '',
            url: request.url ?? '',
            body,
            auth: request.headers.authorization ?? '',
          };
          received.push(got);
          if (got.url === SENTINEL) {
            response.writeHead(200).end('{}');
            return;
          }
          const reply = respond(got);
          if (reply === null) return; // never answer: the script must time out
          response.writeHead(reply.status, {
            'content-type': 'application/json',
          });
          // A string body goes out as it is, so a test can send what is not JSON.
          response.end(
            typeof reply.body === 'string'
              ? reply.body
              : JSON.stringify(reply.body),
          );
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    /** What reached this stand-in, closed by a sentinel it must also hold. */
    async record() {
      await fetch(`${url}${SENTINEL}`);
      expect(received.at(-1)?.url, 'the stand-in is recording').toBe(SENTINEL);
      return received.slice(0, -1);
    },
    /**
     * That nothing reached this stand-in: the requests before the sentinel,
     * searched with the sentinel in the population, so an empty record is
     * proved to be a live one (#118).
     */
    async expectNothingReceived() {
      await fetch(`${url}${SENTINEL}`);
      const all = [...received];
      expect(all.at(-1)?.url, 'the stand-in is recording').toBe(SENTINEL);
      expect(
        searched(all.slice(0, -1), {
          of: all,
          what: `requests the ${side} stand-in recorded, the sentinel included`,
        }),
      ).toEqual([]);
    },
  };
};

const cloudflare = standIn('Cloudflare');
const github = standIn('GitHub');

/** Cloudflare's answers, per scenario. */
let databases: unknown[];
let queryAnswer: { status: number; body: unknown };
/** GitHub's list of the issue's comments, per scenario. */
let comments: unknown[];

const envelope = (result: unknown) => ({
  success: true,
  errors: [],
  messages: [],
  result,
});
const waiting = (count: number) => ({
  status: 200,
  body: envelope([
    { success: true, meta: {}, results: [{ 'count(*)': count }] },
  ]),
});

beforeAll(async () => {
  await cloudflare.start();
  await github.start();
});
afterAll(async () => {
  await cloudflare.stop();
  await github.stop();
});
beforeEach(() => {
  cloudflare.received.length = 0;
  github.received.length = 0;
  databases = [
    { uuid: DEV_ID, name: 'shyden-reports-dev' },
    { uuid: PROD_ID, name: 'shyden-reports' },
  ];
  queryAnswer = waiting(3);
  comments = [];
  cloudflare.answer(({ method, url }) => {
    if (
      method === 'GET' &&
      url === `/accounts/${ACCOUNT}/d1/database?name=shyden-reports`
    )
      return { status: 200, body: envelope(databases) };
    if (
      method === 'POST' &&
      url === `/accounts/${ACCOUNT}/d1/database/${PROD_ID}/query`
    )
      return queryAnswer;
    return { status: 404, body: { success: false, errors: [] } };
  });
  github.answer(({ method, url }) => {
    const path = `/repos/Shyden-Ltd/shyden.co.uk/issues/${ISSUE}/comments`;
    if (method === 'GET' && url.startsWith(`${path}?`))
      return { status: 200, body: comments };
    if (method === 'POST' && url === path) return { status: 201, body: {} };
    return { status: 404, body: {} };
  });
});

/** Run the script with only the variables the workflow gives it. */
const run = (
  args: string[] = [],
  overrides: Record<string, string> = {},
): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        PATH: process.env.PATH,
        CLOUDFLARE_API_BASE: cloudflare.url,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        CLOUDFLARE_D1_READ_TOKEN: 'cf-read-token',
        GITHUB_API_URL: github.url,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'Shyden-Ltd/shyden.co.uk',
        GITHUB_RUN_ID: '36000000001',
        GITHUB_TOKEN: 'gh-token',
        NOTICE_ISSUE: ISSUE,
        ...overrides,
      },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });

const posts = (requests: Received[]) =>
  requests.filter(({ method }) => method === 'POST');

describe('the count mode', () => {
  it('3 waiting posts one comment, and nothing else', async () => {
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(out).toContain('Waiting reports: 3');
    const sent = await github.record();
    expect(posts(sent).map(({ body }) => JSON.parse(body))).toEqual([
      { body: '3 translation reports are waiting.' },
    ]);
    expect(sent.every(({ auth }) => auth === 'Bearer gh-token')).toBe(true);
  });

  it('asks Cloudflare with the read token, for the production id only', async () => {
    await run();
    const asked = await cloudflare.record();
    expect(asked.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET /accounts/${ACCOUNT}/d1/database?name=shyden-reports`,
      `POST /accounts/${ACCOUNT}/d1/database/${PROD_ID}/query`,
    ]);
    expect(JSON.parse(asked[1].body)).toEqual({
      sql: 'SELECT count(*) FROM reports',
    });
    expect(asked.every(({ auth }) => auth === 'Bearer cf-read-token')).toBe(
      true,
    );
  });

  it("lists only today's comments, so an old issue's first page cannot hide today's", async () => {
    const before = new Date().toISOString().slice(0, 10);
    await run();
    const after = new Date().toISOString().slice(0, 10);
    const [list] = await github.record();
    const since = new URL(list.url, github.url).searchParams.get('since');
    // Either side of midnight UTC, if the run straddled it.
    expect([`${before}T00:00:00Z`, `${after}T00:00:00Z`]).toContain(since);
  });

  it('0 waiting exits 0 and sends GitHub nothing at all', async () => {
    queryAnswer = waiting(0);
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(out).toContain('Waiting reports: 0');
    await github.expectNothingReceived();
  });

  it('a bot count from today means nothing is posted', async () => {
    comments = [
      {
        user: { login: 'github-actions[bot]' },
        body: '2 translation reports are waiting.',
        created_at: new Date().toISOString(),
      },
    ];
    const { code, out } = await run();
    expect(code, out).toBe(0);
    const sent = await github.record();
    expect(sent.map(({ method }) => method)).toEqual(['GET']);
  });

  it("today's failure notice does not stop a re-run's count", async () => {
    comments = [
      {
        user: { login: 'github-actions[bot]' },
        body: `${FAILURE_NOTICE}\n\nhttps://github.com/x/y/actions/runs/1`,
        created_at: new Date().toISOString(),
      },
    ];
    const { code, out } = await run();
    expect(code, out).toBe(0);
    expect(posts(await github.record())).toHaveLength(1);
  });
});

describe('a count that cannot be read is a failure, never a zero', () => {
  /** A failed run: non-zero, no count claimed, and GitHub never reached. */
  const expectFailedQuietly = async ({
    code,
    out,
  }: {
    code: number | null;
    out: string;
  }) => {
    expect(code, out).toBe(1);
    expect(out).toMatch(/^✗ /m);
    expect(out).not.toMatch(/0 translation report|Waiting reports/);
    await github.expectNothingReceived();
  };

  it('a D1 port with nothing listening', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expectFailedQuietly(
      await run([], { CLOUDFLARE_API_BASE: `http://127.0.0.1:${port}` }),
    );
  });

  it('success: false', async () => {
    queryAnswer = {
      status: 200,
      body: { success: false, errors: [{ code: 7500, message: 'x' }] },
    };
    await expectFailedQuietly(await run());
  });

  it('an HTTP 403 whose body is not JSON, named as such', async () => {
    cloudflare.answer(() => ({ status: 403, body: '<html>' }));
    const result = await run();
    await expectFailedQuietly(result);
    expect(result.out).toContain('Cloudflare answered HTTP 403, not JSON');
  });

  it('a list holding only shyden-reports-dev, which sends no query', async () => {
    databases = [{ uuid: DEV_ID, name: 'shyden-reports-dev' }];
    await expectFailedQuietly(await run());
    const asked = await cloudflare.record();
    expect(asked.map(({ method }) => method)).toEqual(['GET']);
  });

  it('a Cloudflare that never answers times out, rather than outliving the job', async () => {
    cloudflare.answer(() => null);
    const started = Date.now();
    await expectFailedQuietly(
      await run([], { WAITING_REPORTS_TIMEOUT_MS: '300' }),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('a missing secret stops before any request', async () => {
    await expectFailedQuietly(await run([], { CLOUDFLARE_D1_READ_TOKEN: '' }));
    await cloudflare.expectNothingReceived();
  });
});

describe('the report-failure mode', () => {
  it("posts the fixed sentence with the run's URL, and asks Cloudflare nothing", async () => {
    const { code, out } = await run(['report-failure'], {
      CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_D1_READ_TOKEN: '',
    });
    expect(code, out).toBe(0);
    expect(
      posts(await github.record()).map(({ body }) => JSON.parse(body)),
    ).toEqual([
      {
        body:
          'The waiting-reports count could not be read.\n\n' +
          'https://github.com/Shyden-Ltd/shyden.co.uk/actions/runs/36000000001',
      },
    ]);
    await cloudflare.expectNothingReceived();
  });

  it('refuses an unknown mode with exit 2, sending nothing', async () => {
    const { code } = await run(['report-failures']);
    expect(code).toBe(2);
    await github.expectNothingReceived();
    await cloudflare.expectNothingReceived();
  });
});
```

- [ ] **Step 2: Run them red against a script that does nothing**

Create `scripts/waiting-reports.mjs` holding only `#!/usr/bin/env node`, so it exits 0 having sent nothing.

Run: `npx vitest run tests/unit/waiting-reports-script.test.ts`
Expected: `Tests  14 failed (14)`. Each test fails on its own assertion: exit code, output, or what a stand-in received. A test that passes against a script doing nothing is vacuous.

- [ ] **Step 3: Implement**

`scripts/waiting-reports.mjs`:

```js
#!/usr/bin/env node
/**
 * Tell the operator how many translation reports wait in production (#349).
 * Run daily by `.github/workflows/waiting-reports.yml`.
 *
 *   node scripts/waiting-reports.mjs                  count, and maybe post
 *   node scripts/waiting-reports.mjs report-failure   post the failure notice
 *
 * The count comes first: GitHub is not touched until D1 has answered with a
 * count above zero, so a failure or a zero sends GitHub nothing. At most one
 * count is posted per UTC day, on issue `NOTICE_ISSUE`. `report-failure` never
 * reads a Cloudflare variable, and posts a sentence that names no count.
 *
 * Reads `NOTICE_ISSUE`, `GITHUB_TOKEN` and `GITHUB_REPOSITORY` in both modes;
 * `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_READ_TOKEN` in count mode only;
 * `GITHUB_SERVER_URL` and `GITHUB_RUN_ID` in `report-failure` only; and the
 * endpoints `CLOUDFLARE_API_BASE` (default Cloudflare's v4 API) and
 * `GITHUB_API_URL` (set by Actions), so the tests can point it at local
 * stand-ins. `WAITING_REPORTS_TIMEOUT_MS` shortens the request timeout for
 * the same reason. It never fetches a report, so nothing it prints can come
 * from one: the repository's Actions logs are public.
 *
 * Imports nothing from `node_modules`: the job holding the token runs no
 * third-party package code. Exits 2 on a wrong argument, 1 on any failure.
 */
import { die, messageOf } from './errors.mjs';
import {
  COUNT_SQL,
  FAILURE_NOTICE,
  REPORTS_DATABASE,
  REQUEST_TIMEOUT_MS,
  countFrom,
  databaseIdFrom,
  errorsIn,
  noticeFor,
  postedToday,
  startOfUtcDay,
} from '../src/lib/waiting-reports.ts';

/**
 * An environment variable, refused unless it matches `shape`, since each one
 * ends up in a URL, a header, a comment or a timeout.
 *
 * @param {string} name
 * @param {RegExp} shape
 * @returns {string}
 */
const setting = (name, shape) => {
  const value = process.env[name] ?? '';
  if (!shape.test(value))
    die(`${name} is not set, or not in its expected shape`);
  return value;
};

/**
 * An environment variable holding an http(s) URL, without a trailing slash.
 *
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
const endpoint = (name, fallback) => {
  const value = process.env[name] ?? fallback ?? '';
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url?.protocol !== 'https:' && url?.protocol !== 'http:')
    die(`${name} is not set, or not an http(s) URL`);
  return value.replace(/\/+$/, '');
};

const timeoutMs = () =>
  process.env.WAITING_REPORTS_TIMEOUT_MS === undefined
    ? REQUEST_TIMEOUT_MS
    : Number(setting('WAITING_REPORTS_TIMEOUT_MS', /^[1-9]\d*$/));

/**
 * The parsed JSON a request answers with. Any failure to get a 2xx JSON
 * answer throws, naming the side, the status, and each entry of any `errors`
 * list the answer holds, and nothing else from the body.
 *
 * @param {string} what
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<unknown>}
 */
const answerOf = async (what, url, init) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs()),
  });
  const text = await response.text();
  /** @type {unknown} */
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    throw new Error(`${what} answered HTTP ${response.status}, not JSON`);
  }
  if (!response.ok)
    throw new Error(
      `${what} answered HTTP ${response.status}${errorsIn(answer)}`,
    );
  return answer;
};

/** The issue the notices go on, and a client for its comments. */
const noticeIssue = () => {
  const api = endpoint('GITHUB_API_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const issue = setting('NOTICE_ISSUE', /^[1-9]\d*$/);
  const token = setting('GITHUB_TOKEN', /^\S+$/);
  const comments = `${api}/repos/${repository}/issues/${issue}/comments`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'shyden-waiting-reports',
  };
  return {
    /** @param {Date} now */
    listToday: (now) =>
      answerOf(
        'GitHub',
        `${comments}?since=${startOfUtcDay(now)}&per_page=100`,
        { headers },
      ),
    /** @param {string} body */
    post: (body) =>
      answerOf('GitHub', comments, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      }),
  };
};

/** The production count, read from D1. */
const readCount = async () => {
  const base = endpoint(
    'CLOUDFLARE_API_BASE',
    'https://api.cloudflare.com/client/v4',
  );
  const account = setting('CLOUDFLARE_ACCOUNT_ID', /^[0-9a-f]{32}$/);
  const token = setting('CLOUDFLARE_D1_READ_TOKEN', /^\S+$/);
  const headers = { authorization: `Bearer ${token}` };
  const databases = `${base}/accounts/${account}/d1/database`;
  const id = databaseIdFrom(
    await answerOf(
      'Cloudflare',
      `${databases}?name=${encodeURIComponent(REPORTS_DATABASE)}`,
      { headers },
    ),
  );
  return countFrom(
    await answerOf('Cloudflare', `${databases}/${id}/query`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ sql: COUNT_SQL }),
    }),
  );
};

const count = async () => {
  const issue = noticeIssue();
  const waiting = await readCount();
  console.log(`Waiting reports: ${waiting}`);
  const notice = noticeFor(waiting);
  if (notice === null) return;
  const now = new Date();
  if (postedToday(await issue.listToday(now), now)) {
    console.log('A count was already posted today; nothing posted.');
    return;
  }
  await issue.post(notice);
  console.log('Posted.');
};

const reportFailure = async () => {
  const server = endpoint('GITHUB_SERVER_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const run = setting('GITHUB_RUN_ID', /^\d+$/);
  await noticeIssue().post(
    `${FAILURE_NOTICE}\n\n${server}/${repository}/actions/runs/${run}`,
  );
  console.log('Posted the failure notice.');
};

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || (mode !== undefined && mode !== 'report-failure')) {
    console.error('usage: node scripts/waiting-reports.mjs [report-failure]');
    process.exit(2);
  }
  await (mode === 'report-failure' ? reportFailure() : count()).catch((error) =>
    die(messageOf(error)),
  );
}
```

- [ ] **Step 4: Run green**

Run: `npx vitest run tests/unit/waiting-reports-script.test.ts tests/unit/script-entry.test.ts tests/unit/one-home.test.ts`
Expected: all pass. `script-entry.test.ts` holds the `import.meta.main` rule. `one-home.test.ts` would refuse a URL checked by a regex holding `\/\/`, which is why `endpoint()` uses `URL.canParse`.

- [ ] **Step 5: Commit**

```bash
git add scripts/waiting-reports.mjs tests/unit/waiting-reports-script.test.ts
git commit -m "The waiting-reports script: count first, then at most one count a day (Refs #349)"
```

---

### Task 4: The workflow, its guards, and the runbook

**Files:**
- Create: `.github/workflows/waiting-reports.yml`
- Modify: `tests/unit/pipeline-wiring.test.ts` (the #241 row, a `reports-count` rule, and a `describe` for the workflow)
- Modify: `docs/runbooks/translation-reports.md` (a new section)

**Interfaces:**
- Consumes: the script's two command lines (Task 3); notice issue **#360**.
- Produces: the job `count` in `reports-count`; `countsWaitingReports(scripts: string): boolean` and `REPORTS_COUNT_SECRETS` in `pipeline-wiring.test.ts`.

- [ ] **Step 1: Write the failing guards**

Apply this diff to `tests/unit/pipeline-wiring.test.ts`:

```diff
@@ -189,4 +189,14 @@ const rollsProdBack = (scripts: string) =>
   /\/pages\/projects\/shyden-site(?![\w.-])/.test(scripts) &&
   /\/rollback\b/.test(scripts);
+// Reading the production reports count (#349): the script's count mode, with
+// no argument, as a whole command line. A shell comment naming it is not a
+// reader, and neither is `report-failure`, which never reads Cloudflare.
+const countsWaitingReports = (scripts: string) =>
+  /^[ \t]*node scripts\/waiting-reports\.mjs[ \t]*$/m.test(scripts);
+/** The two secrets `reports-count` holds, sorted as `WorkflowJob.secrets` is. */
+const REPORTS_COUNT_SECRETS = [
+  'CLOUDFLARE_ACCOUNT_ID',
+  'CLOUDFLARE_D1_READ_TOKEN',
+];
 
 /** The job block owning `needle`, from a workflow's comment-stripped text. */
@@ -560,6 +570,8 @@ describe('the deploy pipeline runs what it claims to', () => {
   // them from, derived from its steps and never from the file's name. The dev
   // and prod tokens share one name, one per environment, so the environment
-  // is the only thing choosing which project a job can reach.
-  const PAGES_ENVIRONMENTS = [
+  // is the only thing choosing which project a job can reach. Reading the
+  // production reports count changes nothing, and still has its own
+  // environment and token (#349), so a job that reads it is a row here too.
+  const CLOUDFLARE_ENVIRONMENTS = [
     {
       does: 'deploys shyden-site-dev',
@@ -574,12 +586,17 @@ describe('the deploy pipeline runs what it claims to', () => {
       in: rollsProdBack,
     },
+    {
+      does: 'reads the production reports count',
+      environment: 'reports-count',
+      in: countsWaitingReports,
+    },
   ];
 
-  it('a Cloudflare secret is read only in the environment of the project its job changes (#241)', () => {
+  it('a Cloudflare secret is read only in the environment of what its job does (#241, #349)', () => {
     const readers = everyJob().filter(({ job }) =>
       job.secrets.some((secret) => secret.startsWith('CLOUDFLARE_')),
     );
     const misplaced = readers.flatMap(({ where, job }) => {
-      const acts = PAGES_ENVIRONMENTS.filter((act) =>
+      const acts = CLOUDFLARE_ENVIRONMENTS.filter((act) =>
         act.in(job.runs.join('\n')),
       );
@@ -588,5 +605,5 @@ describe('the deploy pipeline runs what it claims to', () => {
           `${where} reads Cloudflare secrets and ` +
             (acts.length === 0
-              ? 'changes no Pages project'
+              ? 'does nothing a Cloudflare environment is for'
               : acts.map(({ does }) => does).join(' and ')),
         ];
@@ -607,4 +624,36 @@ describe('the deploy pipeline runs what it claims to', () => {
   });
 
+  // `reports-count` holds a token that reads production's reports table, so
+  // it holds exactly the count's two secrets, and nothing but the count reads
+  // them. The rule above places a job by what it does; this one keeps the
+  // environment from gaining a second tenant, or the token a second reader.
+  it('only the waiting-reports count reads secrets in reports-count, or its token anywhere (#349)', () => {
+    const jobs = everyJob();
+    const strays = jobs.flatMap(({ where, job }) => {
+      const inCount = job.environment === 'reports-count';
+      const readsToken = job.secrets.includes('CLOUDFLARE_D1_READ_TOKEN');
+      if (!inCount)
+        return readsToken
+          ? [`${where} reads CLOUDFLARE_D1_READ_TOKEN outside reports-count`]
+          : [];
+      const findings: string[] = [];
+      if (!countsWaitingReports(job.runs.join('\n')))
+        findings.push(`${where} is in reports-count and counts no reports`);
+      const secrets = storedSecrets(job);
+      if (secrets.join() !== REPORTS_COUNT_SECRETS.join())
+        findings.push(
+          `${where} reads ${secrets.join(', ') || 'nothing'} in ` +
+            `reports-count, not ${REPORTS_COUNT_SECRETS.join(', ')}`,
+        );
+      return findings;
+    });
+    expect(
+      searched(strays, {
+        of: jobs.filter(({ job }) => job.environment === 'reports-count'),
+        what: 'jobs in reports-count',
+      }),
+    ).toEqual([]);
+  });
+
   // A prod job is any job in a workflow that changes what prod serves, and any
   // job in a prod environment. A secret meant for dev is named `DEV_*`, and
@@ -2357,2 +2406,84 @@ describe('wrangler comes from the lockfile (#97)', () => {
   });
 });
+
+// ---- the waiting-reports count (#349, spec 15.3) -------------------------
+//
+// The job holds a production read token, so what it may run is pinned whole:
+// two steps of Node, after checkout and setup-node. Read PARSED
+// (tests/workflow-jobs.ts), so a YAML comment can neither trip nor satisfy it.
+describe('the waiting-reports count (#349)', () => {
+  const FILE = 'waiting-reports.yml';
+  type Step = {
+    uses?: string;
+    run?: string;
+    if?: string;
+    env?: Record<string, string>;
+  };
+  type CountWorkflow = {
+    on?: Record<string, unknown>;
+    concurrency?: unknown;
+    jobs?: Record<
+      string,
+      {
+        permissions?: unknown;
+        env?: Record<string, string>;
+        steps?: Step[];
+      }
+    >;
+  };
+  const parsed = () => parseCleanYaml(workflow(FILE), FILE) as CountWorkflow;
+  const steps = () => parsed().jobs?.count?.steps ?? [];
+  const unwrapped = (condition: string | undefined) =>
+    condition?.replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim();
+
+  it('runs daily at 01:17 UTC and on dispatch, never on a push or a pull request', () => {
+    expect(parsed().on).toEqual({
+      schedule: [{ cron: '17 1 * * *' }],
+      workflow_dispatch: null,
+    });
+    expect(Object.keys(parsed().jobs ?? {})).toEqual(['count']);
+  });
+
+  it('runs one at a time, queued and never cancelled, so two runs cannot both post', () => {
+    expect(parsed().concurrency).toEqual({
+      group: 'waiting-reports',
+      'cancel-in-progress': false,
+    });
+  });
+
+  it('names reports-count, and asks for contents: read and issues: write alone', () => {
+    expect(jobNamed(FILE, 'count').environment).toBe('reports-count');
+    expect(parsed().jobs?.count?.permissions).toEqual({
+      contents: 'read',
+      issues: 'write',
+    });
+  });
+
+  it('runs no npm package code: checkout, setup-node and the script, nothing else', () => {
+    expect(steps().map(({ uses }) => uses?.replace(/@.*/, '') ?? null)).toEqual(
+      ['actions/checkout', 'actions/setup-node', null, null],
+    );
+    expect(jobNamed(FILE, 'count').runs).toEqual([
+      'node scripts/waiting-reports.mjs',
+      'node scripts/waiting-reports.mjs report-failure',
+    ]);
+  });
+
+  it('reports a failure only under if: failure(), and the count runs unconditionally', () => {
+    const [, , counting, reporting] = steps();
+    expect(unwrapped(counting.if)).toBeUndefined();
+    expect(unwrapped(reporting.if)).toBe('failure()');
+  });
+
+  it('gives the Cloudflare secrets to the counting step alone', () => {
+    const [, , counting, reporting] = steps();
+    expect(Object.keys(counting.env ?? {}).sort()).toEqual(
+      REPORTS_COUNT_SECRETS,
+    );
+    expect(reporting.env).toBeUndefined();
+    expect(parsed().jobs?.count?.env).toEqual({
+      NOTICE_ISSUE: '360',
+      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
+    });
+  });
+});
```

- [ ] **Step 2: Run them red**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected, with no `waiting-reports.yml` yet:
- the six workflow tests fail on `ENOENT` for `waiting-reports.yml`;
- _only the waiting-reports count reads secrets in reports-count_ fails, because `searched` refuses an empty population (no job is in `reports-count` yet);
- the renamed #241 rule passes, since no job reads a Cloudflare secret it cannot place.

- [ ] **Step 3: Write the workflow**

`.github/workflows/waiting-reports.yml`. The action SHAs are `ci.yml`'s, and `supply-chain.test.ts` holds them.

```yaml
# The waiting-reports count (#349). Once a day, count the translation reports
# waiting in production and, when there are any, say how many in one comment
# on the notice issue, assigned to the operator. The comment carries the count
# and nothing else: this repository, its issues and its logs are public.
#
# It reads its two secrets in `reports-count`, which accepts `develop` alone
# and holds nothing else: a D1 Read token and the account id. It runs no npm
# package code, so no `npm ci`: the script uses Node's own `fetch`, and imports
# only this repository's own modules. Runbook:
# docs/runbooks/translation-reports.md.
name: Waiting reports

on:
  # 01:17 UTC, 08:17 in WIB: off the hour, where GitHub's scheduler queues most.
  schedule:
    - cron: '17 1 * * *'
  workflow_dispatch:

permissions:
  contents: read

# One run at a time. Two at once, a dispatch during the scheduled run, could
# each find no count posted today and each post one. Queued, never cancelled,
# so no run is cut off mid-count.
concurrency:
  group: waiting-reports
  cancel-in-progress: false

jobs:
  count:
    runs-on: ubuntu-26.04
    timeout-minutes: 5
    environment: reports-count
    # checkout needs the first, the comment the second.
    permissions:
      contents: read
      issues: write
    env:
      NOTICE_ISSUE: '360'
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
      - name: Count the waiting reports, and post the count if there are any
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_D1_READ_TOKEN: ${{ secrets.CLOUDFLARE_D1_READ_TOKEN }}
        run: node scripts/waiting-reports.mjs
      # A job that keeps failing must be seen, not quietly stop notifying.
      - name: Say the count could not be read
        if: failure()
        run: node scripts/waiting-reports.mjs report-failure
```

- [ ] **Step 4: Run green**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts tests/unit/supply-chain.test.ts tests/unit/node-contract.test.ts`
Expected: all pass.

- [ ] **Step 5: The runbook**

Append to `docs/runbooks/translation-reports.md`:

```md
## The daily count (#349)

Once a day at 01:17 UTC (08:17 WIB), `.github/workflows/waiting-reports.yml`
counts the rows in `shyden-reports`. When there are any, it comments the count
on #360, _Waiting translation reports_, which is assigned to the operator, so
every comment arrives as a GitHub notification. `3 translation reports are
waiting.` means exactly that: start from the review script above. Nothing is
posted on a day with none, and at most one count per UTC day, so a re-run or a
dispatch cannot post a second. The comment carries the count and nothing else,
because the repository and its Actions logs are public.

`The waiting-reports count could not be read.`, followed by a run's link, means
the job failed, and its log says why. The likely causes are an expired or
revoked token, a renamed database, or Cloudflare's API being down.

**No comment for days while reports wait?** In a public repository, GitHub
disables a scheduled workflow after 60 days without repository activity. A
workflow that does not run posts nothing, not even the failure notice. Under
Actions, select _Waiting reports_, and _Enable workflow_ turns it back on.

The job reads two secrets from the `reports-count` environment, which accepts
`develop` alone and holds nothing else:

- `CLOUDFLARE_ACCOUNT_ID`;
- `CLOUDFLARE_D1_READ_TOKEN`, an API token with one permission,
  `Account › D1 › Read`, on this account. The first token was shown to be
  refused a write against `shyden-reports-dev` before the job first ran
  (#349). A replacement carries that one permission and nothing more.

The job installs no npm packages: the script uses Node's own `fetch`.

To rotate the token:

1. In Cloudflare, go to My Profile → API Tokens → Create Token → Custom token,
   with the permission `Account › D1 › Read` and this account only.
2. In GitHub, go to Settings → Environments → `reports-count`, and replace
   `CLOUDFLARE_D1_READ_TOKEN`.
3. Go to Actions → _Waiting reports_ → Run workflow, on `develop`. The log
   shows `Waiting reports: <n>`.
4. Delete the old token in Cloudflare.

A run from any branch other than `develop` is refused by the environment before
a secret is read.
```

- [ ] **Step 6: Commit**

```bash
npx prettier --write .github/workflows/waiting-reports.yml tests/unit/pipeline-wiring.test.ts docs/runbooks/translation-reports.md
git add .github/workflows/waiting-reports.yml tests/unit/pipeline-wiring.test.ts docs/runbooks/translation-reports.md
git commit -m "Count the waiting reports daily in reports-count, and hold the job to it (Refs #349)"
```

---

### Task 5: Prove it, then merge

**Files:** none new. Evidence goes on the PR.

- [ ] **Step 1: The local gates, whole**

Run: `npx astro check`, then `npm run test:unit`, then `npx prettier --check .`
Expected:
- three summary lines, `- 0 errors`, `- 0 warnings` and `- 0 hints`;
- every unit test passing (the prototype counted 2724);
- `All matched files use Prettier code style!`

Nothing here changes a page, so no e2e spec visits changed markup. Still run `command grep -rn "waiting-reports\|is-record\|isMapping" tests/dev tests/prod tests/device`, which should find nothing.

- [ ] **Step 2: Mutations, whole suite each**

The tree is committed first, and the harness refuses a dirty one. Each row changes one thing, runs the **whole** unit suite, then restores the file from `HEAD`. A row is proved only when it goes RED, the named tests are among the failures, and the test count equals the baseline's.

| Row | File | Change | Predicted RED (among the failures) | Observed |
| --- | --- | --- | --- | --- |
| M1 | `src/lib/waiting-reports.ts` | `export const REPORTS_DATABASE = 'shyden-reports';` → `export const REPORTS_DATABASE = 'shyden-reports-dev';` | _counts every row of the production reports table_ | RED, 11 failed of 2724 -> as predicted |
| M2 | `src/lib/waiting-reports.ts` | `database.name === REPORTS_DATABASE` → `String(database.name).startsWith(REPORTS_DATABASE)` | _picks the exact name out of a list_; _shyden-reports-dev, which sends no query_ | RED, 9 failed of 2724 -> as predicted |
| M3 | `src/lib/waiting-reports.ts` | `\|\| count < 0)` → `)` | _throws on a negative_ | RED, 1 failed of 2724 -> as predicted |
| M4 | `src/lib/waiting-reports.ts` | `const count = rows[0]['count(*)'];` → `const count = Number(rows[0]['count(*)']);` | _throws on a string_; _throws on null_ | RED, 2 failed of 2724 -> as predicted |
| M5 | `src/lib/waiting-reports.ts` | `return count === 1` → `return count === -1` | _says nothing at zero, the singular at one_ | RED, 2 failed of 2724 -> as predicted |
| M6 | `src/lib/waiting-reports.ts` | `isCountNotice(comment.body) &&` → (removed) | _does not count a failure notice_; _today's failure notice does not stop_ | RED, 3 failed of 2724 -> as predicted |
| M7 | `src/lib/waiting-reports.ts` | `comment.user.login === NOTICE_AUTHOR &&` → (removed) | _does not count a count posted by anyone else_ | RED, 1 failed of 2724 -> as predicted |
| M8 | `src/lib/waiting-reports.ts` | `utcDayOf(comment.created_at) === today` → `utcDayOf(comment.created_at)?.slice(0, 7) === today.slice(0, 7)` | _does not count yesterday's count_ | RED, 1 failed of 2724 -> as predicted |
| M9 | `scripts/waiting-reports.mjs` | `const waiting = await readCount();` → `await issue.listToday(new Date());⏎  const waiting = await readCount();` | _a D1 port with nothing listening_; _success: false_; _only shyden-reports-dev_ | RED, 8 failed of 2724 -> as predicted |
| M10 | `scripts/waiting-reports.mjs` | `signal: AbortSignal.timeout(timeoutMs()),` → (removed) | _never answers times out_ | RED, 1 failed of 2724 -> as predicted |
| M11 | `scripts/waiting-reports.mjs` | `?since=${startOfUtcDay(now)}&per_page=100` → `?per_page=100` | _lists only today's comments_ | RED, 1 failed of 2724 -> as predicted |
| M12 | `scripts/waiting-reports.mjs` | `await noticeIssue().post(` → `await readCount();⏎  await noticeIssue().post(` | _posts the fixed sentence with the run's URL_ | RED, 1 failed of 2724 -> as predicted |
| M13 | `scripts/waiting-reports.mjs` | `if (notice === null) return;` → (removed) | _0 waiting exits 0 and sends GitHub nothing_ | RED, 1 failed of 2724 -> as predicted |
| M14 | `.github/workflows/waiting-reports.yml` | `if: failure()` → `if: always()` | _reports a failure only under if: failure()_ | RED, 1 failed of 2724 -> as predicted |
| M15 | `.github/workflows/waiting-reports.yml` | `node-version-file: .nvmrc` → `node-version-file: .nvmrc⏎      - run: npm ci` | _runs no npm package code_ | RED, 3 failed of 2724 -> as predicted |
| M16 | `.github/workflows/waiting-reports.yml` | `environment: reports-count` → (removed) | _a Cloudflare secret is read only in the environment of what its job does_; _names reports-count_ | RED, 4 failed of 2724 -> as predicted |
| M17 | `.github/workflows/waiting-reports.yml` | `workflow_dispatch:` → `workflow_dispatch:⏎  pull_request:` | _never on a push or a pull request_ | RED, 1 failed of 2724 -> as predicted |
| M18 | `.github/workflows/waiting-reports.yml` | `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` → `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}⏎      CLOUDFLARE_D1_READ_TOKEN: ${{ secrets.CLOUDFLARE_D1_READ_TOKEN }}` | _gives the Cloudflare secrets to the counting step alone_ | RED, 1 failed of 2724 -> as predicted |
| M19 | `.github/workflows/deploy-dev.yml` | `deploy-dev:⏎    name: Deploy to Dev` → `deploy-dev:⏎    name: Deploy to Dev⏎    env:⏎      X: ${{ secrets.CLOUDFLARE_D1_READ_TOKEN }}` | _only the waiting-reports count reads secrets in reports-count_ | RED, 1 failed of 2724 -> as predicted |
| M20 | `.github/workflows/waiting-reports.yml` | `run: node scripts/waiting-reports.mjs` → `run: \|⏎          # node scripts/waiting-reports.mjs⏎          true` | _a Cloudflare secret is read only in the environment of what its job does_; _only the waiting-reports count reads secrets in reports-count_ | RED, 3 failed of 2724 -> as predicted |
| M21 | `.github/workflows/waiting-reports.yml` | `issues: write` → `issues: write⏎      pull-requests: write` | _asks for contents: read and issues: write alone_ | RED, 1 failed of 2724 -> as predicted |
| M23 | `.github/workflows/waiting-reports.yml` | `run: node scripts/waiting-reports.mjs` → `run: node scripts/waiting-reports.mjs report-failure` | _a Cloudflare secret is read only in the environment of what its job does_; _only the waiting-reports count reads secrets in reports-count_ | RED, 3 failed of 2724 -> as predicted |
| M24 | `.github/workflows/waiting-reports.yml` | `concurrency:⏎  group: waiting-reports⏎  cancel-in-progress: false` → (removed) | _runs one at a time, queued and never cancelled_ | RED, 1 failed of 2724 -> as predicted |
| M25 | `.github/workflows/waiting-reports.yml` | `cancel-in-progress: false` → `cancel-in-progress: true` | _runs one at a time, queued and never cancelled_ | RED, 1 failed of 2724 -> as predicted |
| M26 | `scripts/waiting-reports.mjs` | `` throw new Error(`${what} answered HTTP ${response.status}, not JSON`); `` → `answer = text;` | _an HTTP 403 whose body is not JSON, named as such_ | RED, 1 failed of 2724 -> as predicted |
| M27 | `src/lib/waiting-reports.ts` | `isRecord(comment.user) &&` → (removed) | _finds today's count beside comments it cannot read_ | RED, 1 failed of 2724 -> as predicted |
| M28 | `src/lib/waiting-reports.ts` | `if (!Array.isArray(comments))` → `if (false)` | _throws on a list it cannot read_ | RED, 1 failed of 2724 -> as predicted |
| M22 | `src/lib/is-record.ts` | `&& !Array.isArray(value)` → (removed) | _refuses an array_ | RED, 3 failed of 2724 -> as predicted |

The harness, written to the scratchpad as `mutate.py`, is run as `python3 mutate.py <checkout>` (optionally with row ids). It asserts each anchor matches exactly once, prints the change, and refuses a dirty tree before and after each row. It restores each file with `git checkout --`, which is safe only because the tree was committed first. The restore sits in a `finally`, and SIGTERM becomes an exit, so a run stopped mid-row restores its file too. The suite runs in its own process group, which a stop takes down with it, since `shell=True` leaves the suite in grandchildren that the harness's own exit would orphan. Writing this plan stopped the harness four times, and each time it left a mutant applied. Only SIGKILL skips the restore: after one, read `git status` before anything else:

```python
#!/usr/bin/env python3
"""Run #349's predicted mutations against the scratch worktree, one at a time.

Each mutation: refuse a dirty tree, assert the anchor matches exactly once,
print the change, run the WHOLE unit suite to JSON, restore the file from
HEAD, and compare the failing tests against the prediction. The denominator
is checked against the baseline so a suite that failed to load cannot read as
a verdict. A stopped run still restores the file it mutated: SIGTERM becomes
an exit, and the restore sits in a `finally`. Only SIGKILL skips it, so after
one, read `git status` before anything else. Usage: mutate.py <worktree> [id ...]
"""
import json, os, signal, subprocess, sys

signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))

WT = sys.argv[1]
ONLY = set(sys.argv[2:])
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'm')
os.makedirs(OUT, exist_ok=True)

L = 'src/lib/waiting-reports.ts'
SC = 'scripts/waiting-reports.mjs'
WF = '.github/workflows/waiting-reports.yml'
DD = '.github/workflows/deploy-dev.yml'
IR = 'src/lib/is-record.ts'

# (id, file, old, new, [substrings a failing test's full name must hold])
M = [
    ('M1', L, "export const REPORTS_DATABASE = 'shyden-reports';",
     "export const REPORTS_DATABASE = 'shyden-reports-dev';",
     ['counts every row of the production reports table']),
    ('M2', L, 'database.name === REPORTS_DATABASE',
     'String(database.name).startsWith(REPORTS_DATABASE)',
     ['picks the exact name out of a list', 'shyden-reports-dev, which sends no query']),
    ('M3', L, '|| count < 0)', ')', ['throws on a negative']),
    ('M4', L, "const count = rows[0]['count(*)'];",
     "const count = Number(rows[0]['count(*)']);",
     ['throws on a string', 'throws on null']),
    ('M5', L, 'return count === 1', 'return count === -1',
     ['says nothing at zero, the singular at one']),
    ('M6', L, 'isCountNotice(comment.body) &&', '',
     ['does not count a failure notice', "today's failure notice does not stop"]),
    ('M7', L, 'comment.user.login === NOTICE_AUTHOR &&', '',
     ['does not count a count posted by anyone else']),
    ('M8', L, 'utcDayOf(comment.created_at) === today',
     'utcDayOf(comment.created_at)?.slice(0, 7) === today.slice(0, 7)',
     ["does not count yesterday's count"]),
    ('M9', SC, 'const waiting = await readCount();',
     'await issue.listToday(new Date());\n  const waiting = await readCount();',
     ['a D1 port with nothing listening', 'success: false', 'only shyden-reports-dev']),
    ('M10', SC, 'signal: AbortSignal.timeout(timeoutMs()),', '',
     ['never answers times out']),
    ('M11', SC, '?since=${startOfUtcDay(now)}&per_page=100', '?per_page=100',
     ["lists only today's comments"]),
    ('M12', SC, 'await noticeIssue().post(',
     'await readCount();\n  await noticeIssue().post(',
     ["posts the fixed sentence with the run's URL"]),
    ('M13', SC, 'if (notice === null) return;', '',
     ['0 waiting exits 0 and sends GitHub nothing']),
    ('M14', WF, 'if: failure()', 'if: always()',
     ['reports a failure only under if: failure()']),
    ('M15', WF, '          node-version-file: .nvmrc\n',
     '          node-version-file: .nvmrc\n      - run: npm ci\n',
     ['runs no npm package code']),
    ('M16', WF, '    environment: reports-count\n', '',
     ['a Cloudflare secret is read only in the environment of what its job does',
      'names reports-count']),
    ('M17', WF, '  workflow_dispatch:\n', '  workflow_dispatch:\n  pull_request:\n',
     ['never on a push or a pull request']),
    ('M18', WF, "      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n",
     "      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n"
     "      CLOUDFLARE_D1_READ_TOKEN: ${{ secrets.CLOUDFLARE_D1_READ_TOKEN }}\n",
     ['gives the Cloudflare secrets to the counting step alone']),
    ('M19', DD, "  deploy-dev:\n    name: Deploy to Dev\n",
     "  deploy-dev:\n    name: Deploy to Dev\n    env:\n"
     "      X: ${{ secrets.CLOUDFLARE_D1_READ_TOKEN }}\n",
     ['only the waiting-reports count reads secrets in reports-count']),
    ('M20', WF, '        run: node scripts/waiting-reports.mjs\n',
     "        run: |\n          # node scripts/waiting-reports.mjs\n          true\n",
     ['a Cloudflare secret is read only in the environment of what its job does',
      'only the waiting-reports count reads secrets in reports-count']),
    ('M21', WF, '      issues: write\n', '      issues: write\n      pull-requests: write\n',
     ['asks for contents: read and issues: write alone']),
    ('M23', WF, '        run: node scripts/waiting-reports.mjs\n',
     '        run: node scripts/waiting-reports.mjs report-failure\n',
     ['a Cloudflare secret is read only in the environment of what its job does',
      'only the waiting-reports count reads secrets in reports-count']),
    ('M24', WF, 'concurrency:\n  group: waiting-reports\n  cancel-in-progress: false\n', '',
     ['runs one at a time, queued and never cancelled']),
    ('M25', WF, 'cancel-in-progress: false', 'cancel-in-progress: true',
     ['runs one at a time, queued and never cancelled']),
    ('M26', SC, 'throw new Error(`${what} answered HTTP ${response.status}, not JSON`);',
     'answer = text;', ['an HTTP 403 whose body is not JSON, named as such']),
    ('M27', L, 'isRecord(comment.user) &&', '',
     ["finds today's count beside comments it cannot read"]),
    ('M28', L, 'if (!Array.isArray(comments))', 'if (false)',
     ['throws on a list it cannot read']),
    ('M22', IR, " && !Array.isArray(value)", '', ['refuses an array']),
]


def sh(cmd):
    """Run `cmd` in its own process group, and take the whole group down with
    it if the harness is stopped: `shell=True` puts the suite in grandchildren
    that the harness's own exit would leave running."""
    child = subprocess.Popen(cmd, cwd=WT, shell=True, text=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             start_new_session=True)
    try:
        out, err = child.communicate()
    except BaseException:
        os.killpg(child.pid, signal.SIGTERM)
        child.wait()
        raise
    return subprocess.CompletedProcess(cmd, child.returncode, out, err)


def run_suite(tag):
    path = os.path.join(OUT, f'{tag}.json')
    if os.path.exists(path):
        os.remove(path)
    sh(f'npx vitest run --reporter=json --outputFile={path} > /dev/null 2>&1')
    if not os.path.exists(path):
        return None
    data = json.load(open(path))
    failed = [a['fullName'] for r in data['testResults'] for a in r['assertionResults']
              if a['status'] == 'failed']
    broken = [r['name'] for r in data['testResults']
              if r['status'] == 'failed' and not r['assertionResults']]
    return data['numTotalTests'], failed, broken


base = run_suite('baseline')
assert base and not base[1] and not base[2], f'baseline not green: {base}'
print(f'baseline: {base[0]} tests, all green', flush=True)

for mid, f, old, new, expect in M:
    if ONLY and mid not in ONLY:
        continue
    assert sh('git status --porcelain').stdout == '', 'tree dirty before ' + mid
    p = os.path.join(WT, f)
    s = open(p).read()
    n = s.count(old)
    assert n == 1, f'{mid}: anchor matched {n} times'
    try:
        open(p, 'w').write(s.replace(old, new))
        print(f'--- {mid} {f}\n  - {old.strip()[:90]!r}\n  + {new.strip()[:90]!r}', flush=True)
        res = run_suite(mid)
    finally:
        sh(f'git checkout -- {f}')
    assert sh('git status --porcelain').stdout == '', 'tree dirty after ' + mid
    if res is None:
        print(f'  {mid}: NO VERDICT (the suite wrote no report)')
        continue
    total, failed, broken = res
    missed = [e for e in expect if not any(e in name for name in failed)]
    verdict = 'RED' if failed else 'GREEN'
    ok = verdict == 'RED' and not missed and total == base[0] and not broken
    print(f'  {mid}: {verdict}, {len(failed)} failed of {total}'
          f'{" (DENOMINATOR MOVED)" if total != base[0] else ""}'
          f'{" BROKEN FILES " + str(broken) if broken else ""}'
          f' -> {"as predicted" if ok else "NOT AS PREDICTED, missed " + str(missed)}')
    for name in failed:
        print('     x', name[:150])
```

- [ ] **Step 3: Push and open the PR**

Write the body to a file, and check it with `node scripts/closing-keywords.mjs <file> "this pull request body"` before `gh pr create --base develop --body-file <file>`. The body lists the seven refinements above, the mutation table, and the operator's setup as a merge precondition.

- [ ] **Step 4: CI, read by name**

Wait for `build-and-test` on the PR's `headRefOid`, read with `gh pr view --json headRefOid,statusCheckRollup`, and read every check by name. The new workflow does not run on a pull request, by design.

- [ ] **Step 5: The operator's setup, read back (spec 15.6)**

- `gh api repos/Shyden-Ltd/shyden.co.uk/environments/reports-count --jq .deployment_branch_policy` must show `custom_branch_policies: true`.
- `…/environments/reports-count/deployment-branch-policies --jq '.branch_policies[].name'` must print `develop` and nothing else.
- `…/environments/reports-count/secrets --jq '.secrets[].name'` must print `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_READ_TOKEN`, and nothing else.

A 404 means the environment does not exist yet. Then **the merge waits**: ask the operator with `AskUserQuestion`, after a `PushNotification`.

- [ ] **Step 6: The token's write is refused (spec 15.5)**

The token is only in GitHub and with the operator, so the operator runs the probe. Write this to the scratchpad as `probe-write.mjs`, and ask the operator to run it **in their own terminal**. The token is typed at a silent prompt, so it never enters this conversation:

```js
// Is the D1 Read token refused a write? (#349, spec 15.5). Run by the
// operator, with the token typed at a silent prompt. Sends two statements to
// shyden-reports-dev ONLY, never production:
//   1. SELECT count(*) FROM reports -- must SUCCEED, or the token is the wrong
//      one and a refusal below would prove nothing;
//   2. DELETE FROM reports WHERE 0  -- matches no row even if allowed, and
//      must be refused with 401 or 403.
// Prints statuses and Cloudflare's error codes and messages, never the token.
const token = process.env.CF_TOKEN ?? '';
const account = process.env.CF_ACCOUNT ?? '';
if (token === '' || !/^[0-9a-f]{32}$/.test(account)) {
  console.error('set CF_TOKEN (silently) and CF_ACCOUNT (32 hex)');
  process.exit(2);
}
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
const headers = { authorization: `Bearer ${token}` };
const answer = async (url, init) => {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  const errors = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ');
  return { status: response.status, ok: response.ok && body.success === true, body, errors };
};
const list = await answer(`${base}?name=shyden-reports-dev`, { headers });
const dev = (list.body.result ?? []).filter((d) => d.name === 'shyden-reports-dev');
if (!list.ok || dev.length !== 1) {
  console.log(`list: HTTP ${list.status}, ${dev.length} named shyden-reports-dev ${list.errors}`);
  console.log('write refused: UNPROVEN (shyden-reports-dev was not found)');
  process.exit(1);
}
const query = (sql) =>
  answer(`${base}/${dev[0].uuid}/query`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
const read = await query('SELECT count(*) FROM reports');
console.log(`control read: HTTP ${read.status}, ok: ${read.ok} ${read.errors}`);
if (!read.ok) {
  console.log('write refused: UNPROVEN (the token cannot read either)');
  process.exit(1);
}
const write = await query('DELETE FROM reports WHERE 0');
console.log(`write: HTTP ${write.status}, ok: ${write.ok} ${write.errors}`);
const refused = write.status === 401 || write.status === 403;
console.log(`write refused: ${refused ? 'yes' : write.ok ? 'NO' : 'UNCLEAR (not an authorisation error)'}`);
process.exit(refused ? 0 : 1);
```

Their command, in zsh: `printf 'D1 read token: '; read -rs CF_TOKEN; echo; export CF_TOKEN; CF_ACCOUNT=<account id> node <path>/probe-write.mjs; unset CF_TOKEN`.

- Expected: `control read: HTTP 200, ok: true`, then `write refused: yes`.
- On `write refused: NO`, the token can write: **stop, nothing merges**, and put it to the operator (spec 15.5).
- On `UNPROVEN` (`shyden-reports-dev` was not found; or it was, and the token could not even read it, so it is the wrong token) or `UNCLEAR` (refused, but not with 401 or 403), nothing is proved either way. Put the printed lines to the operator, and do not merge.

- [ ] **Step 7: Merge, with a merge commit**

The self-review is complete: CI green on this head, the diff read whole, the mutations proved, and Steps 5 and 6 passed. Merge with `gh pr merge <n> --merge`. Then read `deploy-dev.yml`'s run for the merge commit by `headSha`, each job by name, and `dev-verified` off the commit.

- [ ] **Step 8: The real count**

Write develop's head to a file (`git ls-remote origin refs/heads/develop | cut -f1 > <scratchpad>/develop.sha`), dispatch with `gh workflow run waiting-reports.yml --ref develop`, find the `workflow_dispatch` run whose `headSha` equals that file, and poll until it is `completed`. Then:

- read the `count` job's log for `Waiting reports: <n>`;
- if `<n>` is above zero, #360 now carries one comment from `github-actions[bot]` reading exactly `noticeFor(<n>)`, and a second dispatch posts nothing (the log says `already posted today`);
- while a wrangler login is live, compare `<n>` with `npx wrangler d1 execute shyden-reports --remote --command "SELECT count(*) FROM reports"`. Without a login, the comparison goes on the operator's end-of-board list.

- [ ] **Step 9: Retire the ticket**

Board card to **Done** (assert the board title first), then `gh issue close 349` with a comment naming the run, the count and the probe's result.

---

## Review log

Each pass assembles this plan's code into a scratch worktree at `a995c1a`, with its own `npm ci`, and **runs** it. That covers `astro check`, the whole unit suite, `prettier --check .`, each task's red step against the stub it names, and every mutation in Task 5 Step 2 against the whole suite. Then the whole document is read. The plan's code blocks are generated from that worktree's commit, so they cannot differ from what ran.

- **Pass 1** (2026-09-26). The code was written and run before the plan text existed. Seven findings, all fixed:
  - `one-home.test.ts` read the script's URL check (`https?:\/\/…`) as a comment stripper. `endpoint()` now uses `URL.canParse`.
  - `duplication.test.ts` found `isRecord` identical to `tests/workflow-jobs.ts`'s `isMapping`, and `scripts/e2e-shards.mjs` held a third copy. Task 1 gives it one home.
  - `absence-liveness.test.ts` refused seven `toEqual([])`. Six were stand-in records, which now go through `expectNothingReceived()`: `searched` over the record with its sentinel. The seventh was a filtered key list, now an exact `toEqual` of the job's whole `env`.
  - `isRecord` had no test of its own, so a mutation of the new home might go unseen. `tests/unit/is-record.test.ts` was added. M22 goes red on it, and on two `workflow-jobs` tests.
  - Refinement 1 said "a few months" where Review Focus 1 said "about 30 days". GitHub's default page is 30 comments, so it is 30 days.
  - **M20 came back GREEN where RED was predicted.** It commented out the count step's command, and the #241 rule stayed green: the job's other step, `… report-failure`, also matched `countsWaitingReports`, so the job still read as a counter. The mutation was legal, and the guard was weak: `report-failure` never reads Cloudflare, so it is not the act the environment is for. The detector now matches the count mode alone, as a whole line. M20 re-ran RED on both rules, and **M23** was added (the count step running `report-failure` instead), RED on both.
  - **Two runs at once could each post a count.** A dispatch during the scheduled run would have both runs list nothing posted today. The workflow gained a `concurrency` group that queues the second run and never cancels the first (refinement 7), with a test and two mutations: M24 removes the group, and M25 turns on cancel-in-progress.
  - Confirmed as predicted, not changed:
    - each task's red step: Task 1, 6 of 6 failed; Task 2, the 3 constant tests passed and 28 failed; Task 3, 14 of 14 failed; Task 4, six `ENOENT` plus `searched` refusing an empty `reports-count` population;
    - the typecheck: 0 errors, 0 warnings and 0 hints.
- **Pass 2** (2026-09-26). The plan was assembled and read whole. Mechanical checks:
  - every name in each Interfaces block is defined once in the stub and once in the implementation;
  - every path the plan runs or reads exists;
  - `test:unit` is `vitest run`, the runner the harness baselined at 2723;
  - there are 38 fences, balanced, and no placeholder;
  - the mutation table was filled from one run of all 25 rows on the prototype's commit: all RED, as predicted, with the denominator steady at 2723.

  Five findings, all in the prose, all fixed:
  - The Global Constraints credited the `.ts`-extension import rule to spec 15.3, but it comes from refinement 3.
  - Refinement 1 and Review Focus 1 gave a page size the script does not use. It asks for `per_page=100`, so the risk starts at 30 to 100 days, depending on page size.
  - The probe command had no prompt text before a silent `read`.
  - The probe's other outcomes, `UNPROVEN` and `UNCLEAR`, had no stated action. Now neither proves anything, and neither merges.
  - Step 8 found the dispatched run by "the merge commit", which is wrong if anything else has merged since. It now reads develop's head into a file and matches that.
- **Pass 3** (2026-09-26). The gates and red steps were re-run on the pass-2 code, and all were as predicted. Then the whole assembled plan was read, code blocks included. Eight findings, all fixed, so the pass's mutation run was stopped as superseded:
  - **`postedToday` threw on any comment it could not read.** #360 is public, so one stranger's comment whose author was deleted (`user: null`) would have failed the job, and posted a failure notice, every day from then on. An unreadable comment is now just not the bot's count. Only an unreadable list throws. Review Focus 5 names it, and M27 and M28 hold both halves.
  - **_An HTTP 403 whose body is not JSON_ sent JSON.** The stand-in stringified every body, so `'<html>'` went out as `"<html>"`, and the not-JSON branch never ran. A string body now goes out raw, and the test asserts the diagnosis. M26 removes the branch.
  - `countFrom`'s last `it.each` matched every row against `/no statement|exactly one row/`, so it could not tell its own rows apart. Each row now names its message.
  - `is-record.ts` said "the duplication guard found three copies". The guard found one pair, and the third copy came from a grep.
  - **The runbook missed the silent stop.** GitHub disables a public repository's scheduled workflow after 60 days without activity, and nothing then runs to post even the failure notice. The runbook now says how to see that and undo it.
  - The runbook said the token "is refused writes". That was proved for the first token only. A rotated token is now held to the same single permission, and the text says what was proved.
  - The probe's database-not-found path printed no verdict line. It now prints `UNPROVEN`.
  - The `since=` test would flake on a run straddling midnight UTC. It now accepts either side.
- **Pass 4** (2026-09-26). The whole run, on the pass-3 code (`471d282`):
  - `astro check`: 0 errors, 0 warnings, 0 hints;
  - prettier clean;
  - the red steps as predicted, with Task 2 now 3 passed and 29 failed;
  - **all 28 mutations RED as predicted**, the denominator steady at 2724.

  Mechanical checks:
  - every export defined once in the stub and once in the implementation;
  - 38 fences, balanced;
  - no placeholder, and no closing keyword;
  - 28 table rows.

  `git diff 17754ac 471d282` named the five files changed since pass 3 read the whole plan. Every changed block and all the prose were read, and the other blocks are byte-identical to pass 3's. One finding, fixed: Review Focus 4 said a URL-reshaping database id is refused "before any request". It is refused after the list request, before the query. Only a missing secret stops before any request.
- **Pass 5** (2026-09-26). The whole run again on `471d282`:
  - `astro check` 0/0/0, and prettier clean;
  - the red steps as predicted;
  - all 28 mutations RED as predicted, the denominator 2724.

  The mechanical checks were repeated, and all the prose was read. One finding, fixed: Step 6 described `UNPROVEN` only as a token that cannot read. Since pass 3, the probe also prints it when `shyden-reports-dev` is not found.
- **Pass 6** (2026-09-26). The whole run again on `471d282`:
  - `astro check` 0/0/0, and prettier clean;
  - the red steps as predicted;
  - all 28 mutations RED as predicted, the denominator 2724.

  Mechanical checks, repeated:
  - prettier clean on the plan;
  - 38 fences;
  - no placeholder, and no closing keyword;
  - 28 table rows.

  All the prose was read, the review log included. The code blocks are byte-identical to those passes 3 and 4 read, since `471d282` has not moved. One finding, fixed: Step 6's `UNPROVEN` parenthetical ended "so it is the wrong token", which attached to both of its causes. A missing `shyden-reports-dev` says nothing about the token.
- **Pass 7** (2026-09-26). The whole run again on `471d282`:
  - `astro check` 0/0/0, and prettier clean;
  - the red steps as predicted;
  - all 28 mutations RED as predicted, the denominator 2724.

  The mechanical checks were repeated, with the same counts. All the prose was read, the review log's finding counts included (pass 1 lists 7, and pass 3 lists 8). One finding, fixed: the Architecture line said `reports-count` "holds a D1 Read token and nothing else". It also holds the account id, as the workflow's header and the runbook already said.
- **Pass 8** (2026-09-26). The run on `471d282` was stopped as superseded, since two findings changed code comments. The prose was read whole, and so were the code blocks' comments, each factual claim checked:
  - that GitHub lists an issue's comments oldest first, 30 a page by default and 100 at most;
  - that `since` filters on `updated_at`;
  - that a public repository's schedule is disabled after 60 days;
  - that a timed-out job is cancelled, so `failure()` steps do not run (pass 9 found this one was not in fact checked);
  - the which-workflow-uses-which-action claim, against the tree.

  Three findings, all fixed:
  - The Goal said "once a day, the operator gets one comment". On a day with nothing waiting, nothing is posted.
  - The workflow's header said the script "imports one pure module". It imports `errors.mjs` and `waiting-reports.ts`, which imports `is-record.ts`. It now says "only this repository's own modules".
  - The workflow `describe`'s comment called checkout and setup-node "the two actions every workflow here uses". `release-tag.yml` has no setup-node, and `rollback.yml` uses neither.
- **Pass 9** (2026-09-26). The run on `d8fdd0e` was stopped as superseded, since one finding changed a code comment. The prose read found the rest of the body byte-identical to pass 7's, which had been read whole, and the changed lines and the log were read. GitHub's own documentation was then fetched for the claims pass 8 had recorded as checked:
  - "Issue comments are ordered by ascending ID";
  - `since`: "Only show results that were last updated after the given time";
  - `per_page`: 30 by default, 100 at most;
  - scheduled workflows in public repositories are disabled when "no repository activity has occurred in 60 days";
  - `failure()`: "Returns `true` when any previous step of a job fails".

  Nothing documented says a `failure()` step runs, or does not run, in a job ended by `timeout-minutes` or by cancellation. Two findings, both fixed:
  - Refinement 2, and the workflow's concurrency comment, each stated that undocumented behaviour as fact. Both now rest only on what is documented: a hang fails its own step within 30 s, and a queued run is never cut off. Pass 8's log line is marked as not in fact checked.
  - Refinement 4 said every added export "is used by the script". `NOTICE_AUTHOR` is used by `postedToday` and the tests, never by the script.
- **Pass 10** (2026-09-26). The run on `2a15b91` was stopped as superseded. The prose was compared with pass 9's, and every changed line was read. The two behaviour claims not yet held against documentation were fetched:
  - the concurrency group's queued run "will be `pending`", and a newer one replaces a *pending* run, never the running one, so Refinement 7 stands;
  - the docs describe enabling a workflow as Actions, the workflow, then **Enable workflow**.

  One finding, fixed: the runbook said the workflow's page "says when it is disabled". The docs do not say so. It now gives the documented steps alone. `report-endpoint.test.ts` reads the runbook, so the fix is re-run whole in pass 11.
- **Pass 11** (2026-09-26). The run on `ce10bfe` was stopped as superseded. Every comment line in the new and changed code was read, each claim held against the code itself: the module, the script, the workflow, both test files, `is-record.ts`, and the guard diff. Four findings, all fixed:
  - The module's header said "one comment a day". That was the Goal's overstatement again: the comment comes only on days a count is above zero.
  - `answerOf`'s doc said a failure names "the status, never the body". It also carries `errorsIn`'s Cloudflare codes and messages, which come from the body.
  - `setting`'s doc said every value "goes into a URL or a header". The timeout goes into neither, and the run id goes into the comment.
  - The script's header said "Prints the count alone". It prints status lines too. What holds is that the count is the only figure it prints.
- **Pass 12** (2026-09-26). The run on `0a48b6b` was stopped as superseded. The prose was read:
  - the opening, whole;
  - the task body, byte-identical to pass 7's whole read;
  - the log, and every comment pass 11 rewrote, as the plan shows it.

  Three findings, all fixed. **Each was introduced by pass 11's own rewrites.** A reworded claim is a new claim, and it was checked in pass 12 against the code before it was written:
  - "at most one comment a day" is false on a day with a failure, which adds failure notices. The invariant is at most one *count* a day.
  - "the count is the only figure it prints" is false, since error lines print HTTP statuses and codes. What holds is that it never fetches a report, so nothing it prints can come from one.
  - `answerOf`'s and `errorsIn`'s docs spoke of Cloudflare's errors alone, but `errorsIn` reads any answer's `errors` list, GitHub's included.
- **Pass 13** (2026-09-26). The run on `251a9f3` was stopped as superseded. **The whole document was read**, every line of prose, code, table and log, not only the lines changed since pass 12. Five findings, all fixed:
  - The module's header said every function "takes a parsed answer". `noticeFor` takes a count, and `startOfUtcDay` a date. It now says each works from its arguments alone. This was there from pass 1, and passes that read diffs could not see it.
  - Task 3's commit message said "at most one comment a day". The invariant is one *count*.
  - The script's header listed the variables it reads without `GITHUB_SERVER_URL` and `GITHUB_RUN_ID`, which `report-failure` reads. It now lists each mode's.
  - The M26 row's change holds backticks, which broke the table cell's code span. The assembler now uses a double-backtick span for such a cell.
  - The probe's header said it prints Cloudflare's "error codes". It prints their messages too.
- **Pass 14** (2026-09-26). The whole run on `8382f38`:
  - `astro check` 0/0/0, and prettier clean;
  - the red steps as predicted;
  - all 28 mutations RED as predicted, the denominator 2724.

  The whole document was read again, every line, and the one behaviour claim not yet held against documentation was fetched: the schedule event "can be delayed during periods of high loads … High load times include the start of every hour", which is why the cron sits at 01:17. One finding, from this session's own record: **the harness left a mutant applied each time it was stopped mid-row**, four times while this plan was written (M5, M1, M2, M2), with nothing printed. It now restores in a `finally` and turns SIGTERM into an exit. It was then proved by stopping it on M3 with the mutant on disk: exit 143, a clean tree. That proof found a second gap, fixed and proved the same way: two orphaned suite processes. The suite now runs in its own process group, which a stop kills: three processes while it ran, none after. Recorded in memory (`a-mutation-harness-refuses-a-dirty-target`).
- **Pass 15** (2026-09-26). The whole run on `8382f38`, with the pass-14 harness:
  - `astro check` 0/0/0, and prettier clean;
  - the red steps as predicted;
  - all 28 mutations RED as predicted, the denominator 2724;
  - the tree clean after the run, and no suite process left running.

  Mechanical checks:
  - prettier clean on the plan;
  - 38 fences;
  - no placeholder, and no closing keyword;
  - 28 table rows.

  **The whole document was read**, every line of its 2134. **No findings.** The plan is approved under the operator's standing rule of 2026-09-24. The mutation table above is this pass's run.
