# Report daily limits Implementation Plan (#872)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The translation-report endpoint refuses a report once the day's total (50) or one connection's share (5) is reached, counting connections by a day-scoped keyed hash and never storing an IP, with the limits switched and sized per environment by Cloudflare variables.

**Architecture:** Two pure modules (`src/lib/report-limits.ts`: settings, connection, counter key; `src/lib/report-store.ts`: the SQL and the one D1 `batch` that prunes, conditionally inserts and counts in a single transaction) wired into `handleReport` and `reportHealth` in `src/lib/report.ts`. A new table `report_counts` (migration `0002`) holds `(day, counter, count)`: `counter` is `'all'` or HMAC-SHA-256(secret, `day connection`). Two new outcomes, `form-full` and `connection-full` (429 in JSON mode, a `#…-form-full` / `#…-connection-full` fragment in form mode), each with its own status copy in every beta locale.

**Tech Stack:** Astro 5 site, Cloudflare Pages Functions on workerd, D1 (SQLite), Web Crypto (`crypto.subtle`), Vitest (unit, logs, guards suites), Playwright (e2e, functions-runtime suite), OpenAPI 3.1 contract tests.

**Spec:** issue #872 body and its two ruling comments (6258875590, 6258941748). The ACs are quoted where a task implements them.

## Global Constraints

- Caps: 50 a day in total, 5 a day per connection, when the variables are unset (`DEFAULT_LIMITS`).
- Variables (AC9): `REPORT_LIMITS` (`on`/`off`), `REPORT_LIMIT_TOTAL`, `REPORT_LIMIT_CONNECTION` (whole numbers ≥ 1), `REPORT_COUNTER_SECRET` (≥ 32 characters). Every non-production host: off unless `on`. Production (`isProdHostname`): always on, the switch ignored, only the numbers apply. Any other value fails closed as `failed` with kind `limits-invalid`.
- Counting (AC10): IPv4 by address; IPv6 by its /64 block. The raw IP is never bound to a statement, stored or logged (AC3).
- A day is the UTC date (`YYYY-MM-DD`); every report deletes every count row whose day is not today (AC4).
- English copy, exactly (AC1, AC2):
  - `formFull`: `Thank you for your help. The form has received as many reports as it can take for now, so this one was not sent. Please try again later.`
  - `connectionFull`: `Thank you for your help. To keep this form reliable, each internet connection can send a limited number of reports, and yours has reached that limit. Reports from other people on a shared connection count towards it too. Please try again later.`
- No copy, in any locale's Google reading, names a day, an hour, tomorrow or a reset time (AC6).
- Every unit test: under 1 s, ≤ 0.1 s own CPU, no socket, no process, no real database. Real D1 runs only in the functions suite (CI). The laptop runs unit, format, lint and typecheck only.
- One test per case (`it.each`/generated tests, never a loop of cases inside one test).
- No new npm package. No closing keyword beside an issue number; `Refs #872`.
- Every commit green on its own; floors recorded in CI (`record-floors.yml`), never by hand.

## Review Focus

1. **Two reports arriving together at the 50th or 5th slot** must store exactly one. The single-batch transaction makes that true; Task 6 posts 8 reports at once against a connection limit of 5 on real D1 and expects exactly 5 stored.
2. **A visitor sending their own `CF-Connecting-IP`**: locally it overrides (measured 2026-10-19: `wrangler pages dev` 4.141.0 handed a Function `127.0.0.1`, and `2001:db8::7` when the client sent that header). On Cloudflare the edge sets the header, but no single Cloudflare page settles that it always replaces a client's value (searched 2026-10-19). Task 7 makes it a dev measurement: with dev's limits on at connection limit 1, a second post carrying a different spoofed header must be refused.
3. **The zone's Pseudo IPv4 setting**: with "Overwrite Headers" on, Cloudflare puts a pseudo IPv4 in `CF-Connecting-IP` (developers.cloudflare.com/network/pseudo-ipv4/), which would undo the /64 rule. The runbook (Task 7) says to keep it Off or "Add header", and to read it before enabling the limits on production.
4. **Midnight UTC between two statements**: the day is computed once per request and bound into every statement, so one report never counts against two days. Task 4 asserts every statement of the batch carries the same day.
5. **A missing or unreadable `CF-Connecting-IP`** (an IPv6 zone id, a garbled value): `connectionOf` returns null and the report fails closed as `failed` with kind `address-missing`, never counted under a shared fallback key. Task 2 and Task 4 pin it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `migrations/0002_report_counts.sql` (create) | The `report_counts` table. |
| `src/lib/report-limits.ts` (create) | `DEFAULT_LIMITS`, `limitsSetting`, `connectionOf`, `counterKey`, `utcDay`. Pure, site-safe. |
| `src/lib/report-store.ts` (create) | The SQL strings, `ReportsDatabase`/`ReportsStatement` types, `storeReport`. |
| `src/lib/report.ts` (modify) | `Outcome` gains two members; `ReportEnv` gains four variables; `handleReport` and `reportHealth` use the two modules; health checks both tables. |
| `src/lib/i18n/site.ts` (modify) | `report.formFull`, `report.connectionFull` in five locales. |
| `src/components/ReportForm.astro`, `src/scripts/report-form.ts` (modify) | Two more status paragraphs; two more outcomes accepted. |
| `openapi/report.yaml`, `openapi/report-health.yaml` (modify) | 429 and the new fragments; health's wider meaning. |
| `tests/report-fakes.ts` (modify) | `scriptedDatabase`, and `tableWith`/`failingWith` taught `batch`. |
| `tests/unit/report-limits.test.ts`, `tests/unit/report-store.test.ts` (create) | Pure logic and the batch's shape. |
| `tests/logs/report-counts.test.ts` (create) | AC3 with a planted IP. |
| `tests/functions/*` (modify) | Both migrations, the variables, a count reset per test, the real-D1 cap tests. |
| `docs/runbooks/translation-reports.md` (modify) | AC7. |

**Before Task 1:** #830 merged into `develop` at `93f39097` (2026-10-19). Merge `origin/develop` into this branch first. Its `recordingTable` in `tests/report-fakes.ts` (used by `tests/logs/report-row.test.ts` and the unit stand-in in `report-endpoint.test.ts`) is converted to `batch` in Task 4 Step 1: `rows` becomes the bound values of each batch statement whose query starts `INSERT INTO reports`, and `batch` answers `STORED_OFF` for a two-statement batch and `storedOn(1, 1)` for a five-statement one.

---

### Task 1: The `report_counts` table, and a health check that sees both tables

**Files:**
- Create: `migrations/0002_report_counts.sql`
- Modify: `src/lib/report.ts` (exports near `REPORT_COLUMNS`, `HEALTH_QUERY`, `schemaMatches`, `reportHealth`)
- Modify: `tests/report-fakes.ts` (`tableWith`)
- Test: `tests/unit/report-endpoint.test.ts`, `tests/logs/reports-table.test.ts`, `tests/logs/report-log.test.ts`

**Interfaces:**
- Produces: `COUNT_COLUMNS = ['day', 'counter', 'count'] as const`; `schemaMatches(columns: readonly string[], expected: readonly string[] = REPORT_COLUMNS): boolean`; `tableWith(reports: readonly string[], counts: readonly string[] = COUNT_COLUMNS): ReportsDatabase`.

- [ ] **Step 1: Write the failing tests**

In `tests/logs/reports-table.test.ts`, inside `describe('the migration', …)`, add a second reader and test:

```ts
  const countsSql = () =>
    withoutSqlComments(
      readFileSync('migrations/0002_report_counts.sql', 'utf8'),
    );

  it('creates exactly the count columns the endpoint writes, keyed by day and counter (#872)', () => {
    const body = /CREATE TABLE report_counts \(([\s\S]*)\);/.exec(
      countsSql(),
    )?.[1];
    expect(body, 'a CREATE TABLE report_counts statement').toBeDefined();
    const lines = body!
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter(Boolean);
    expect(lines).toEqual([
      'day     TEXT NOT NULL',
      'counter TEXT NOT NULL',
      'count   INTEGER NOT NULL CHECK (count >= 1)',
      'PRIMARY KEY (day, counter)',
    ]);
    expect(COUNT_COLUMNS).toEqual(['day', 'counter', 'count']);
  });
```

(import `COUNT_COLUMNS` from `../../src/lib/report`).

In `tests/unit/report-endpoint.test.ts`, beside the existing `schemaMatches` tests, add:

```ts
describe('the health check reads both tables (#872)', () => {
  it('pins the count columns', () => {
    expect(COUNT_COLUMNS).toEqual(['day', 'counter', 'count']);
  });
  it('answers 503 when report_counts is missing', async () => {
    const lines: string[] = [];
    const response = await reportHealth(
      new Request(HEALTH),
      { REPORTS: tableWith(REPORT_COLUMNS, []) },
      (line) => lines.push(line),
    );
    expect(response.status).toBe(503);
    expect(lines).toEqual([
      'report health: the report_counts table does not match the migration',
    ]);
  });
  it('answers 200 when both tables match', async () => {
    const response = await reportHealth(
      new Request(HEALTH),
      { REPORTS: tableWith(REPORT_COLUMNS) },
      () => {
        throw new Error('a healthy check logs nothing');
      },
    );
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit -- tests/unit/report-endpoint.test.ts`
Expected: FAIL, `COUNT_COLUMNS` is not exported. (The logs-suite test runs in CI.)

- [ ] **Step 3: Implement**

`migrations/0002_report_counts.sql`:

```sql
-- migrations/0002_report_counts.sql (#872)
-- One row per UTC day per counter. Every report deletes the rows of any
-- other day, so nothing here outlives the day it counts.
CREATE TABLE report_counts (
  day     TEXT NOT NULL,                     -- UTC date, YYYY-MM-DD
  counter TEXT NOT NULL,                     -- 'all', or HMAC-SHA-256(secret, day + ' ' + connection), 64 hex: never an IP
  count   INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (day, counter)
);
```

In `src/lib/report.ts`, after `REPORT_COLUMNS` (Task 4 moves both to `report-store.ts` and re-exports them):

```ts
/** The `report_counts` table's columns, as `migrations/0002_report_counts.sql` creates them (#872). */
export const COUNT_COLUMNS = ['day', 'counter', 'count'] as const;
```

Replace `HEALTH_QUERY` and `schemaMatches`, and the schema part of `reportHealth`:

```ts
const HEALTH_QUERY =
  "SELECT 'reports' AS tbl, name FROM pragma_table_info('reports') UNION ALL SELECT 'report_counts' AS tbl, name FROM pragma_table_info('report_counts')";

export const schemaMatches = (
  columns: readonly string[],
  expected: readonly string[] = REPORT_COLUMNS,
): boolean =>
  columns.length === expected.length &&
  expected.every((column) => columns.includes(column));
```

```ts
  try {
    const { results } = await env.REPORTS.prepare(HEALTH_QUERY).all<{
      tbl: string;
      name: string;
    }>();
    const of = (table: string) =>
      results.filter(({ tbl }) => tbl === table).map(({ name }) => name);
    const reports = schemaMatches(of('reports'));
    const counts = schemaMatches(of('report_counts'), COUNT_COLUMNS);
    if (!reports)
      log('report health: the reports table does not match the migration');
    if (!counts)
      log(
        'report health: the report_counts table does not match the migration',
      );
    ok = reports && counts;
  } catch {
```

`tests/report-fakes.ts`, `tableWith`:

```ts
export const tableWith = (
  reports: readonly string[],
  counts: readonly string[] = COUNT_COLUMNS,
): ReportsDatabase => ({
  prepare: () => ({
    bind() {
      throw new Error('health binds nothing');
    },
    run() {
      throw new Error('health writes nothing');
    },
    all: async <T>() => ({
      results: [
        ...reports.map((name) => ({ tbl: 'reports', name })),
        ...counts.map((name) => ({ tbl: 'report_counts', name })),
      ] as T[],
    }),
  }),
});
```

(Task 4 replaces `run` with a `batch` that throws the same message, when the types change.)

- [ ] **Step 4: Run unit, typecheck**

Run: `npm run test:unit -- tests/unit/report-endpoint.test.ts tests/unit/report-contract.test.ts` then `npm run typecheck`
Expected: PASS; 0 errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/0002_report_counts.sql src/lib/report.ts tests/report-fakes.ts tests/unit/report-endpoint.test.ts tests/logs/reports-table.test.ts
git commit -m "The health check reads a report_counts table beside reports (Refs #872)"
```

---

### Task 2: Settings, connection and counter key (pure)

**Files:**
- Create: `src/lib/report-limits.ts`
- Test: `tests/unit/report-limits.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_LIMITS: { readonly total: 50; readonly connection: 5 }`
  - `SECRET_MIN_LENGTH = 32`
  - `interface ReportLimits { readonly total: number; readonly connection: number }`
  - `type LimitsSetting = { readonly kind: 'off' } | { readonly kind: 'on'; readonly limits: ReportLimits } | { readonly kind: 'invalid' }`
  - `interface LimitsEnv { REPORT_LIMITS?: string; REPORT_LIMIT_TOTAL?: string; REPORT_LIMIT_CONNECTION?: string }`
  - `limitsSetting(env: LimitsEnv, hostname: string): LimitsSetting`
  - `connectionOf(address: string | null): string | null`
  - `counterKey(secret: string, day: string, connection: string): Promise<string>` (64 lowercase hex)
  - `utcDay(at: Date): string`

- [ ] **Step 1: Write the failing tests**

`tests/unit/report-limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  SECRET_MIN_LENGTH,
  connectionOf,
  counterKey,
  limitsSetting,
  utcDay,
} from '../../src/lib/report-limits';

const DEV = 'dev.shyden.co.uk';
const PROD = 'shyden.co.uk';
const on = (total: number, connection: number) => ({
  kind: 'on',
  limits: { total, connection },
});

describe('the defaults are the ruled figures (#872)', () => {
  it('50 in total and 5 per connection', () => {
    expect(DEFAULT_LIMITS).toEqual({ total: 50, connection: 5 });
  });
  it('a secret is at least 32 characters', () => {
    expect(SECRET_MIN_LENGTH).toBe(32);
  });
});

describe('limitsSetting off production (AC9)', () => {
  it.each([
    ['nothing set', {}, { kind: 'off' }],
    ['off', { REPORT_LIMITS: 'off' }, { kind: 'off' }],
    ['an empty switch', { REPORT_LIMITS: '' }, { kind: 'off' }],
    ['on', { REPORT_LIMITS: 'on' }, on(50, 5)],
    ['" On " (trimmed, any case)', { REPORT_LIMITS: ' On ' }, on(50, 5)],
    [
      'on with both numbers',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '10', REPORT_LIMIT_CONNECTION: '2' },
      on(10, 2),
    ],
    ['a switch of "yes"', { REPORT_LIMITS: 'yes' }, { kind: 'invalid' }],
    ['a total of 0', { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '0' }, { kind: 'invalid' }],
    ['a total of -1', { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '-1' }, { kind: 'invalid' }],
    ['a total of 1.5', { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '1.5' }, { kind: 'invalid' }],
    ['a total of 1e3', { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '1e3' }, { kind: 'invalid' }],
    ['a total of 05', { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '05' }, { kind: 'invalid' }],
    ['a total of ten', { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: 'ten' }, { kind: 'invalid' }],
    ['a total over 1000000', { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '1000001' }, { kind: 'invalid' }],
    ['off with a bad number', { REPORT_LIMITS: 'off', REPORT_LIMIT_CONNECTION: 'x' }, { kind: 'invalid' }],
    ['an empty number is unset', { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '' }, on(50, 5)],
  ])('%s', (_name, env, expected) => {
    expect(limitsSetting(env, DEV)).toEqual(expected);
  });
});

describe('limitsSetting on production: always on (AC9)', () => {
  it.each([
    ['nothing set', {}, on(50, 5)],
    ['switched off', { REPORT_LIMITS: 'off' }, on(50, 5)],
    ['a switch of "banana"', { REPORT_LIMITS: 'banana' }, on(50, 5)],
    ['a total of 100', { REPORT_LIMIT_TOTAL: '100' }, on(100, 5)],
    ['a bad number', { REPORT_LIMIT_TOTAL: 'x' }, { kind: 'invalid' }],
  ])('%s', (_name, env, expected) => {
    expect(limitsSetting(env, PROD)).toEqual(expected);
  });
  it('reads the host in any case', () => {
    expect(limitsSetting({ REPORT_LIMITS: 'off' }, 'SHYDEN.CO.UK')).toEqual(on(50, 5));
  });
});

describe('connectionOf: IPv4 by address, IPv6 by /64 (AC10)', () => {
  it.each([
    ['IPv4', '203.0.113.9', '203.0.113.9'],
    ['IPv6 in full', '2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::/64'],
    ['IPv6 compressed, same /64', '2001:db8:1:2:ffff::1', '2001:0db8:0001:0002::/64'],
    ['IPv6 upper case, trailing ::', '2001:DB8:1:2::', '2001:0db8:0001:0002::/64'],
    ['the next /64', '2001:db8:1:3::1', '2001:0db8:0001:0003::/64'],
    ['loopback', '::1', '0000:0000:0000:0000::/64'],
    ['IPv4-mapped IPv6 counts as the IPv4', '::ffff:203.0.113.9', '203.0.113.9'],
  ])('%s', (_name, address, expected) => {
    expect(connectionOf(address)).toBe(expected);
  });
  it.each([
    ['no header', null],
    ['empty', ''],
    ['a word', 'localhost'],
    ['an octet over 255', '203.0.113.256'],
    ['three octets', '203.0.113'],
    ['two ::', '1::2::3'],
    ['nine groups', '1:2:3:4:5:6:7:8:9'],
    ['a non-hex group', '2001:db8::g'],
    ['a zone id', 'fe80::1%eth0'],
    ['a five-digit group', '2001:db8:10000::1'],
    ['eight groups and ::', '1:2:3:4:5:6:7:8::'],
  ])('%s is no connection', (_name, address) => {
    expect(connectionOf(address)).toBeNull();
  });
});

describe('counterKey: HMAC-SHA-256 of day and connection (AC3)', () => {
  const SECRET = 'unit-test-secret-0123456789abcdef';
  // Literals from node:crypto createHmac('sha256', SECRET), 2026-10-19.
  it.each([
    ['2026-10-19', '203.0.113.9', '245a1b83ed3a0c41bb3ba3f6beb7fef1811168275c045a8af6a8ac0452dc803b'],
    ['2026-10-20', '203.0.113.9', '759212e4c404d5521d3e53242aa9583576b01f84d452f57e42b5adececf0abac'],
    ['2026-10-19', '2001:0db8:0001:0002::/64', '314a3b541e2cf3c62d6af6c2c44671ab471b44098a11e991b63e30e6c493f733'],
  ])('%s %s', async (day, connection, expected) => {
    expect(await counterKey(SECRET, day, connection)).toBe(expected);
  });
});

describe('utcDay', () => {
  it.each([
    ['2026-10-19T23:59:59.999Z', '2026-10-19'],
    ['2026-10-20T00:00:00.000Z', '2026-10-20'],
  ])('%s is %s', (at, day) => {
    expect(utcDay(new Date(at))).toBe(day);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run test:unit -- tests/unit/report-limits.test.ts`
Expected: FAIL, cannot find module `report-limits`.

- [ ] **Step 3: Implement `src/lib/report-limits.ts`**

```ts
/**
 * The report form's daily limits (#872): whether they apply, how big they
 * are, and the counter a report is counted under. Pure and site-safe: no
 * Node API, so workerd and the unit suite run the same code.
 *
 * Shyden ruled 2026-10-19: Cloudflare variables per environment, off on
 * every non-production host unless switched on, always on in production;
 * IPv6 counted by its /64, because one line is usually given a whole /64.
 */
import { isProdHostname } from '../../functions/_lib/lockdown.js';

export const DEFAULT_LIMITS = { total: 50, connection: 5 } as const;
export const SECRET_MIN_LENGTH = 32;
const MAX_LIMIT = 1_000_000;

export interface ReportLimits {
  readonly total: number;
  readonly connection: number;
}

export type LimitsSetting =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly limits: ReportLimits }
  | { readonly kind: 'invalid' };

export interface LimitsEnv {
  readonly REPORT_LIMITS?: string;
  readonly REPORT_LIMIT_TOTAL?: string;
  readonly REPORT_LIMIT_CONNECTION?: string;
}

/** A whole number from 1 to MAX_LIMIT, the default when unset or empty, or null. */
function limit(value: string | undefined, fallback: number): number | null {
  const text = (value ?? '').trim();
  if (text === '') return fallback;
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return parsed <= MAX_LIMIT ? parsed : null;
}

export function limitsSetting(env: LimitsEnv, hostname: string): LimitsSetting {
  const total = limit(env.REPORT_LIMIT_TOTAL, DEFAULT_LIMITS.total);
  const connection = limit(
    env.REPORT_LIMIT_CONNECTION,
    DEFAULT_LIMITS.connection,
  );
  if (total === null || connection === null) return { kind: 'invalid' };
  const on = { kind: 'on', limits: { total, connection } } as const;
  if (isProdHostname(hostname)) return on;
  const switched = (env.REPORT_LIMITS ?? '').trim().toLowerCase();
  if (switched === '' || switched === 'off') return { kind: 'off' };
  return switched === 'on' ? on : { kind: 'invalid' };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const GROUP = /^[0-9a-f]{1,4}$/;

/**
 * What one connection holds (AC10): an IPv4 address whole, an IPv6
 * address's /64 block. Null for anything that is not an address, so a
 * garbled header is refused rather than counted under a shared key.
 */
export function connectionOf(address: string | null): string | null {
  if (address === null) return null;
  const four = IPV4.exec(address);
  if (four) {
    const octets = four.slice(1).map(Number);
    return octets.every((octet) => octet <= 255) ? octets.join('.') : null;
  }
  const mapped = MAPPED.exec(address);
  if (mapped) return connectionOf(mapped[1]!);
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const groups = (text: string) => (text === '' ? [] : text.split(':'));
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const full = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ];
  if (!full.every((group) => GROUP.test(group))) return null;
  return `${full
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')}::/64`;
}

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/**
 * HMAC-SHA-256(secret, `day connection`) as hex (AC3). The day is inside the
 * message, so one connection's key differs every day and two days cannot be
 * linked; without the secret no key leads back to an address.
 */
export async function counterKey(
  secret: string,
  day: string,
  connection: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${day} ${connection}`)),
  );
}

export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);
```

If `astro check` refuses the `.js` import's types, add a JSDoc `@returns {boolean}` in `lockdown.js` (it already carries `@param {string} hostname`); never a suppression.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm run test:unit -- tests/unit/report-limits.test.ts`, `npm run typecheck`, `npm run lint:tests`
Expected: all PASS / 0 errors. Read the CPU reporter's line for the new file: each test ≤ 0.07 s own CPU.

- [ ] **Step 5: Mutations (watch each go RED, then restore)**

1. `DEFAULT_LIMITS.connection: 6` → defaults test RED.
2. Drop `isProdHostname(hostname)` branch → three production cases RED.
3. `slice(0, 4)` → `slice(0, 8)` → `IPv6 compressed, same /64` RED.
4. Message `${day}${connection}` (no space) → all three key literals RED.
5. `missing < 1` → `missing < 0` → `eight groups and ::` RED.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report-limits.ts tests/unit/report-limits.test.ts
git commit -m "The report limits' setting, connection and counter key, pure and pinned (Refs #872)"
```

---

### Task 3: The two outcomes and their messages, in every beta locale, read back by Google

Runs before Task 4 (see Task 4's **Order**).

**Files:**
- Modify: `src/lib/report.ts` (`Outcome`, `JSON_STATUS` only)
- Modify: `src/scripts/report-form.ts` (`EVERY_OUTCOME`), `tests/unit/report-form.test.ts` (outcome table, line 13)
- Modify: `tests/e2e/report-presence.spec.ts:70-81` (`OUTCOMES`, `COPY`)
- Modify: `src/lib/i18n/site.ts` (`report` in `siteEn`, `siteId`, `siteZh`, `siteVi`, `siteTh`)
- Modify: `src/components/ReportForm.astro` (`statuses`)
- Modify: `tests/unit/report-copy.test.ts`, `src/lib/i18n/.read-back.json` (by script), `src/lib/i18n/.translations.json` (by script)
- Modify: `tests/e2e/not-found-report.spec.ts:141` (`BETA.length * 4` → `* 6`)
- Test: `tests/unit/report-limit-copy.test.ts` (create)

- [ ] **Step 1: Failing tests**

`tests/unit/report-copy.test.ts`: add to the pinned object, after `failed`:

```ts
      formFull:
        // #872, Shyden 2026-10-19: polite, names no period and no reset time.
        'Thank you for your help. The form has received as many reports as it can take for now, so this one was not sent. Please try again later.',
      connectionFull:
        'Thank you for your help. To keep this form reliable, each internet connection can send a limited number of reports, and yours has reached that limit. Reports from other people on a shared connection count towards it too. Please try again later.',
```

`tests/unit/report-limit-copy.test.ts`:

```ts
/**
 * No limit message says when the limit resets (#872 AC6; Shyden 2026-10-19:
 * "just don't mention the length before reset, keep it generic"). English is
 * read as written; every other locale through Google's saved reading of its
 * exact current text, so a translation that adds "tomorrow" is caught.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  getSiteStrings,
  isBetaLocale,
} from '../../src/lib/i18n';

const BETA = LOCALES.filter(isBetaLocale);

const TIME = /\b(day|days|daily|today|tonight|tomorrow|hour|hours|minute|minutes|midnight|o'clock|morning|evening|week|reset|UTC|24)\b|\d{1,2}[:.]\d{2}/i;
const store = JSON.parse(readFileSync('src/lib/i18n/.read-back.json', 'utf8')) as {
  readings: Record<string, Record<string, { english: string }>>;
};
const KEYS = ['formFull', 'connectionFull'] as const;

describe('the English names no period', () => {
  it.each(KEYS)('%s', (key) => {
    expect(getSiteStrings(DEFAULT_LOCALE).report[key]).not.toMatch(TIME);
  });
});

describe("Google's reading names no period", () => {
  it.each(BETA.flatMap((locale) => KEYS.map((key) => [locale, key] as const)))(
    '%s %s',
    (locale, key) => {
      const reading = store.readings[locale]?.[getSiteStrings(locale).report[key]]?.english;
      expect(reading, 'a saved Google reading of the current text').toBeDefined();
      expect(reading).not.toMatch(TIME);
    },
  );
});
```

`LOCALES.filter(isBetaLocale)` is the beta list, as `tests/e2e/not-found-report.spec.ts:29` builds it.

Run: `npm run test:unit -- tests/unit/report-copy.test.ts tests/unit/report-limit-copy.test.ts` → FAIL.

- [ ] **Step 2: English, then DeepL drafts (operator rule: always DeepL first)**

Add `formFull` and `connectionFull` to `siteEn.report` (text above). Then, per locale, dry run then send:

```bash
npm run i18n:translate -- zh
npm run i18n:translate -- zh --send
```

for `zh`, `vi`, `th` and `id` (`TRANSLATABLE_LOCALES`). The DeepL key is the main checkout's: `set -a && source ../shyden.co.uk/.env.local && set +a` in the same command (never copy the file). Copy each draft from `src/lib/i18n/.translations.json` into that locale's `report` block in `site.ts`. Read every draft against the English; correct only a meaning error, and list each correction with its reason for the PR body.

**Indonesian is hand-written** (`tests/unit/locale-fallbacks.test.ts:43`): the `id` send also caches about 122 unrelated drafts, which credit DeepL with every hand-written line they match and void those lines' DeepL second readings (review pass 3: 27 lines, `read-back-coverage` red). After the send, keep only the two new `id` drafts: drop every `id` entry that `git show HEAD:src/lib/i18n/.translations.json` lacks, except the two English sentences above, and check that the cache differs from HEAD by exactly 8 entries.

The drafts pass 3 produced, read and corrected (reuse them; a re-send is cached and costs nothing):

| locale | key | line | writer |
| --- | --- | --- | --- |
| id | formFull | Terima kasih atas bantuannya. Formulir ini telah menerima laporan sebanyak yang dapat ditampung untuk saat ini, sehingga laporan ini tidak terkirim. Silakan coba lagi nanti. | DeepL |
| id | connectionFull | Terima kasih atas bantuannya. Untuk menjaga keandalan formulir ini, setiap koneksi internet hanya dapat mengirimkan sejumlah laporan tertentu, dan koneksi Anda telah mencapai batas tersebut. Laporan dari pengguna lain yang menggunakan koneksi yang sama juga dihitung dalam batas tersebut. Silakan coba lagi nanti. | DeepL |
| zh | formFull | 感谢您的帮助。该表单目前已接收了其能处理的最大数量的报告，因此此条报告未被发送。请稍后再试。 | DeepL |
| zh | connectionFull | 感谢您的帮助。为了确保本表单的可靠性，每个互联网连接发送的报告数量有限，而您的连接已达到该上限。使用同一网络连接的其他用户发送的报告也会计入该上限。请稍后再试。 | edited after DeepL: "您的报告数量" (your number of reports) became "您的连接" (your connection), the English's subject |
| vi | formFull | Cảm ơn bạn đã giúp đỡ. Hiện tại, biểu mẫu này đã nhận đủ số lượng báo cáo tối đa, do đó báo cáo này chưa được gửi đi. Vui lòng thử lại sau. | DeepL |
| vi | connectionFull | Cảm ơn bạn đã giúp đỡ. Để đảm bảo tính đáng tin cậy của biểu mẫu này, mỗi kết nối internet chỉ có thể gửi một số lượng báo cáo giới hạn, và kết nối của bạn đã đạt đến giới hạn đó. Các báo cáo từ những người khác sử dụng chung kết nối này cũng được tính vào giới hạn đó. Vui lòng thử lại sau. | DeepL |
| th | formFull | ขอบคุณสำหรับความช่วยเหลือของคุณ แบบฟอร์มนี้ได้รับรายงานครบตามจำนวนที่รับได้ชั่วคราวแล้ว ดังนั้นรายงานนี้จึงไม่ถูกส่งไป โปรดลองอีกครั้งในภายหลัง | DeepL |
| th | connectionFull | ขอบคุณสำหรับความช่วยเหลือของคุณ เพื่อรักษาความน่าเชื่อถือของแบบฟอร์มนี้ แต่ละการเชื่อมต่ออินเทอร์เน็ตสามารถส่งรายงานได้เพียงจำนวนจำกัด และการเชื่อมต่อของคุณได้ถึงขีดจำกัดแล้ว รายงานจากผู้ใช้อื่น ๆ ที่ใช้การเชื่อมต่อเดียวกันก็ถูกนับรวมในขีดจำกัดนี้ด้วย โปรดลองอีกครั้งในภายหลัง | edited after DeepL: the two ครับ (a male speaker's particle; no Thai copy on the site uses one) removed, the opening made formFull's, "แต่ละครั้ง" (each time) became "แต่ละการเชื่อมต่อ" (each connection) |

- [ ] **Step 3: Google reads every new line back, and each reading is judged**

```bash
npm run i18n:google-read-back
npm run i18n:read-back-verdicts > .superpowers/sdd/872/verdicts.tsv
```

Fill the verdict and note columns (agrees / ambiguous / wrong) beside the English, then apply:

```bash
READ_BACK_VERDICTS=.superpowers/sdd/872/verdicts.tsv npm run i18n:read-back-verdicts
READ_BACK_REVIEW=.superpowers/sdd/872/review.md npm run i18n:read-back-verdicts
```

Pass 3's eight Google readings (2026-10-19) each carry the English meaning and none names a period: all `agrees`; the two edited lines are marked for Shyden's reads (#844). If `.read-back.json` shows changes to readings other than the eight new ones, a cache problem rewrote their writers: restore it with `git show HEAD:src/lib/i18n/.read-back.json > src/lib/i18n/.read-back.json` and read again, so the repo's own writer formats the file (expected diff: 48 added lines).

A `wrong` blocks: correct the line, read it again. Build the per-line writer/reader table (locale, key, line, writer from `writers`, reader Google, verdict) for the PR body. A line edited after DeepL goes to Shyden's reads (#844), never judged by its editor alone.

- [ ] **Step 4: The outcomes, and the statuses**

`src/lib/report.ts`:

```ts
export type Outcome =
  | 'sent'
  | 'not-found'
  | 'rejected'
  | 'failed'
  | 'form-full'
  | 'connection-full';

const JSON_STATUS: Record<Outcome, number> = {
  sent: 200,
  'not-found': 422,
  rejected: 400,
  failed: 503,
  'form-full': 429,
  'connection-full': 429,
};
```

`src/scripts/report-form.ts`: `EVERY_OUTCOME` gains `'form-full': true, 'connection-full': true` (`outcomeOf` reads the body whatever the status, so a 429 body is read as its outcome). `tests/unit/report-form.test.ts`: add `['form-full', 429]` and `['connection-full', 429]` to the outcome table.

`tests/e2e/report-presence.spec.ts`: the list becomes the Record's keys, so an outcome without copy cannot compile, and the existing per-locale test `#report-<outcome> shows, takes focus, and hides the rest` then covers both new statuses in form mode in all four locales:

```ts
// A Record, so an outcome added to the union without its copy fails to
// compile; the list is the Record's keys.
const COPY: Record<
  Outcome,
  'sent' | 'notFound' | 'rejected' | 'failed' | 'formFull' | 'connectionFull'
> = {
  sent: 'sent',
  'not-found': 'notFound',
  rejected: 'rejected',
  failed: 'failed',
  'form-full': 'formFull',
  'connection-full': 'connectionFull',
};
const OUTCOMES = Object.keys(COPY) as Outcome[];
```

`src/components/ReportForm.astro`:

```ts
const statuses: ReadonlyArray<[Outcome, string]> = [
  ['sent', t.sent],
  ['not-found', t.notFound],
  ['rejected', t.rejected],
  ['failed', t.failed],
  ['form-full', t.formFull],
  ['connection-full', t.connectionFull],
];
```

`tests/e2e/not-found-report.spec.ts:141`: `toHaveCount(BETA.length * 4)` becomes `toHaveCount(BETA.length * 6)`, with a comment naming the six (review pass 4: left at 4, it failed 40 times, 4 locales x 5 engines in e2e and again in capture). Then sweep for every other list of four outcomes: `git grep -nE "'rejected'" -- src tests` and `git grep -nE "\* 4\b" -- tests/e2e`; update each, and say in the commit which were found.

- [ ] **Step 5: Run unit, typecheck, format, lint**

Run: `npm run test:unit`, `npm run typecheck`, `npx prettier --write <changed files>`, `npm run lint:tests`
Expected: PASS; `locale-fallbacks`, `message-parity`, `dead-copy`, `read-back-coverage` and `label-check` green.

- [ ] **Step 6: Mutation**

Change one locale's `connectionFull` to append its word for "tomorrow" without re-reading: `read-back-coverage` RED (no reading of the current text). Re-read it with Google on a scratch branch only if the ledger allows; otherwise the coverage RED is the proof. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/lib/report.ts src/scripts/report-form.ts src/lib/i18n/site.ts src/lib/i18n/.translations.json src/lib/i18n/.read-back.json src/components/ReportForm.astro tests/unit/report-copy.test.ts tests/unit/report-limit-copy.test.ts tests/unit/report-form.test.ts tests/e2e/not-found-report.spec.ts tests/e2e/report-presence.spec.ts
git commit -m "Each daily limit has its own outcome and polite message in every locale, read back by Google (Refs #872)"
```

---

### Task 4: One batch stores and counts; the endpoint answers the two new outcomes

**Files:**
- Create: `src/lib/report-store.ts`, `tests/unit/report-store.test.ts`
- Modify: `src/lib/report.ts` (types move out; `Outcome`; `ReportEnv`; `FailureKind`; `JSON_STATUS`; `handleReport`; `reportHealth`)
- Modify: `tests/report-fakes.ts` (`scriptedDatabase`; `failingWith` and `tableWith` gain `batch`, lose `run`; `recordingTable` if #830 merged)
- Modify: `tests/unit/report-endpoint.test.ts`
- Test: `tests/logs/report-counts.test.ts` (create)

**Order:** this task follows Task 3 (the outcomes and their copy). `tests/e2e/report-presence.spec.ts` maps every `Outcome` to its copy key in a `Record`, so the union cannot grow in a commit that has no copy (measured in review pass 1: `astro check` error ts(2739) at report-presence.spec.ts:76).

**Interfaces:**
- Consumes: Task 2's `LimitsSetting`, `ReportLimits`, `connectionOf`, `counterKey`, `utcDay`, `limitsSetting`, `SECRET_MIN_LENGTH`; Task 1's `COUNT_COLUMNS`.
- Produces:
  - `interface ReportsStatement { bind(...values: unknown[]): ReportsStatement; all<T>(): Promise<{ results: T[] }> }`
  - `interface ReportsDatabase { prepare(query: string): ReportsStatement; batch<T = Record<string, unknown>>(statements: ReportsStatement[]): Promise<{ results: T[] }[]> }`
  - `type Stored = 'sent' | 'form-full' | 'connection-full'`
  - `storeReport(db: ReportsDatabase, row: readonly unknown[], day: string, count: { counter: string; limits: ReportLimits } | null): Promise<Stored>`
  - `handleReport(request, env, log = console.error, now = () => new Date())`
  - `scriptedDatabase(answers: readonly { results: unknown[] }[][]): { db: ReportsDatabase; batches: { query: string; values: unknown[] }[][] }`

- [ ] **Step 1: The fakes**

In `tests/report-fakes.ts` add:

```ts
/**
 * A database that answers each `batch` with the next scripted list of
 * results and records every statement it was given, query and bound values
 * (#872), so a test can read exactly what reached D1.
 */
export function scriptedDatabase(
  answers: readonly (readonly { results: unknown[] }[])[],
): {
  db: ReportsDatabase;
  batches: { query: string; values: unknown[] }[][];
} {
  const batches: { query: string; values: unknown[] }[][] = [];
  let next = 0;
  const statement = (query: string, values: unknown[] = []) => ({
    query,
    values,
    bind: (...bound: unknown[]) => statement(query, bound),
    all: async () => {
      throw new Error('a report runs its statements in one batch');
    },
  });
  return {
    batches,
    db: {
      prepare: (query) => statement(query),
      batch: async <T>(statements: unknown[]) => {
        batches.push(
          (statements as { query: string; values: unknown[] }[]).map(
            ({ query, values }) => ({ query, values }),
          ),
        );
        const answer = answers[next++];
        if (!answer) throw new Error(`no scripted answer for batch ${next}`);
        return answer as { results: T[] }[];
      },
    },
  };
}

/** The batch answers a report meets: stored, or refused with the day's total at `all`. */
export const STORED_OFF = [{ results: [] }, { results: [] }];
export const storedOn = (all: number, connection: number) => [
  { results: [] },
  { results: [{ id: 'stored' }] },
  { results: [] },
  { results: [] },
  { results: [{ counter: 'all', count: all }, { counter: 'x', count: connection }] },
];
export const refusedOn = (all: number, connection: number) => [
  { results: [] },
  { results: [] },
  { results: [] },
  { results: [] },
  { results: [{ counter: 'all', count: all }, { counter: 'x', count: connection }] },
];
```

`failingWith`: drop `run`, add `batch: async () => { throw new Error(message); }` on the database object. `tableWith`: drop `run`, add the `batch` that throws (shown in Task 1). `recordingTable` (#830, on develop since `93f39097`) becomes, importing `type ReportsStatement` beside `ReportsDatabase`:

```ts
export function recordingTable(): {
  db: ReportsDatabase;
  rows: unknown[][];
} {
  const rows: unknown[][] = [];
  interface Recorded extends ReportsStatement {
    readonly query: string;
    readonly values: unknown[];
  }
  const statement = (query: string, values: unknown[] = []): Recorded => ({
    query,
    values,
    bind: (...bound: unknown[]) => statement(query, bound),
    all: async () => {
      throw new Error('a report reads nothing back');
    },
  });
  return {
    rows,
    db: {
      prepare: (query) => statement(query),
      // A report's one batch (#872): the row is what its `INSERT INTO
      // reports` bound, and the answer is a stored report's, limits off
      // (two statements) or on (five).
      batch: async <T>(statements: ReportsStatement[]) => {
        const recorded = statements as Recorded[];
        for (const { query, values } of recorded)
          if (query.startsWith('INSERT INTO reports')) rows.push(values);
        return (recorded.length === 2 ? STORED_OFF : storedOn(1, 1)) as {
          results: T[];
        }[];
      },
    },
  };
}
```

- [ ] **Step 2: Write the failing store tests**

`tests/unit/report-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { storeReport } from '../../src/lib/report-store';
import { refusedOn, scriptedDatabase, storedOn, STORED_OFF } from '../report-fakes';

const ROW = ['id-1', '2026-10-19T08:00:00.000Z', 'vi', 'home', 'q', '[]', '', ''];
const DAY = '2026-10-19';
const COUNT = { counter: 'k'.repeat(64), limits: { total: 50, connection: 5 } };

describe('storeReport with the limits off', () => {
  it('prunes other days, then inserts the row, in one batch', async () => {
    const { db, batches } = scriptedDatabase([STORED_OFF]);
    expect(await storeReport(db, ROW, DAY, null)).toBe('sent');
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map(({ query }) => query.split(' ').slice(0, 3).join(' '))).toEqual([
      'DELETE FROM report_counts',
      'INSERT INTO reports',
    ]);
    expect(batches[0]![0]!.values).toEqual([DAY]);
    expect(batches[0]![1]!.values).toEqual(ROW);
  });
});

describe('storeReport with the limits on', () => {
  it('binds the day, the limits and the counter, never anything else', async () => {
    const { db, batches } = scriptedDatabase([storedOn(1, 1)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('sent');
    const [prune, insert, all, connection, read] = batches[0]!;
    expect(prune!.values).toEqual([DAY]);
    expect(insert!.values).toEqual([...ROW, DAY, 50, COUNT.counter, 5]);
    expect(all!.values).toEqual([DAY, 'all', 'id-1']);
    expect(connection!.values).toEqual([DAY, COUNT.counter, 'id-1']);
    expect(read!.values).toEqual([DAY, COUNT.counter]);
  });
  it('answers form-full when the day has taken its total', async () => {
    const { db } = scriptedDatabase([refusedOn(50, 2)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('form-full');
  });
  it('answers connection-full when only the connection is at its limit', async () => {
    const { db } = scriptedDatabase([refusedOn(12, 5)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('connection-full');
  });
  it('answers form-full when both are full: the total refuses everyone', async () => {
    const { db } = scriptedDatabase([refusedOn(50, 5)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('form-full');
  });
  it('answers connection-full when no total row exists yet', async () => {
    const { db } = scriptedDatabase([
      [{ results: [] }, { results: [] }, { results: [] }, { results: [] }, { results: [] }],
    ]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('connection-full');
  });
});
```

- [ ] **Step 3: Implement `src/lib/report-store.ts`**

```ts
/**
 * Where a report is written (#872): one D1 batch, which D1 runs as one
 * transaction, so two reports arriving together at the last slot cannot both
 * be stored. Probed on SQLite 2026-10-19 (node:sqlite): the 6th from one
 * counter and the 51st in all are refused, another counter is not, and the
 * next day's first report deletes the day before.
 */
import type { ReportLimits } from './report-limits';

/**
 * The `reports` table's columns, as `migrations/0001_reports.sql` creates
 * them, and `report_counts`', as `0002` does. They live here, not in
 * report.ts, because report.ts imports this module: a constant read at load
 * time across that cycle would be read before it exists.
 */
export const REPORT_COLUMNS = [
  'id',
  'received_at',
  'locale',
  'page',
  'quote',
  'keys',
  'suggestion',
  'note',
] as const;
export const COUNT_COLUMNS = ['day', 'counter', 'count'] as const;

/** The slice of D1's prepared statement this module uses. */
export interface ReportsStatement {
  bind(...values: unknown[]): ReportsStatement;
  all<T>(): Promise<{ results: T[] }>;
}

/** The slice of a D1 binding the endpoint uses. */
export interface ReportsDatabase {
  prepare(query: string): ReportsStatement;
  batch<T = Record<string, unknown>>(
    statements: ReportsStatement[],
  ): Promise<{ results: T[] }[]>;
}

export type Stored = 'sent' | 'form-full' | 'connection-full';

const COLUMNS = REPORT_COLUMNS.join(', ');
const VALUES = REPORT_COLUMNS.map((_, at) => `?${at + 1}`).join(', ');
const PRUNE = 'DELETE FROM report_counts WHERE day <> ?1';
const INSERT = `INSERT INTO reports (${COLUMNS}) VALUES (${VALUES})`;
const INSERT_WITHIN = `INSERT INTO reports (${COLUMNS}) SELECT ${VALUES}
 WHERE COALESCE((SELECT count FROM report_counts WHERE day = ?9 AND counter = 'all'), 0) < ?10
   AND COALESCE((SELECT count FROM report_counts WHERE day = ?9 AND counter = ?11), 0) < ?12
 RETURNING id`;
const COUNT = `INSERT INTO report_counts (day, counter, count)
 SELECT ?1, ?2, 1 WHERE EXISTS (SELECT 1 FROM reports WHERE id = ?3)
 ON CONFLICT (day, counter) DO UPDATE SET count = count + 1`;
const READ =
  "SELECT counter, count FROM report_counts WHERE day = ?1 AND counter IN ('all', ?2)";

export async function storeReport(
  db: ReportsDatabase,
  row: readonly unknown[],
  day: string,
  count: { counter: string; limits: ReportLimits } | null,
): Promise<Stored> {
  const prune = db.prepare(PRUNE).bind(day);
  if (!count) {
    await db.batch([prune, db.prepare(INSERT).bind(...row)]);
    return 'sent';
  }
  const id = row[0];
  const { counter, limits } = count;
  const results = await db.batch<{ counter?: string; count?: number }>([
    prune,
    db.prepare(INSERT_WITHIN).bind(...row, day, limits.total, counter, limits.connection),
    db.prepare(COUNT).bind(day, 'all', id),
    db.prepare(COUNT).bind(day, counter, id),
    db.prepare(READ).bind(day, counter),
  ]);
  if ((results[1]?.results.length ?? 0) === 1) return 'sent';
  const all =
    results[4]?.results.find((result) => result.counter === 'all')?.count ?? 0;
  return all >= limits.total ? 'form-full' : 'connection-full';
}
```

Move `ReportsStatement`, `ReportsDatabase`, `REPORT_COLUMNS` and `COUNT_COLUMNS` out of `report.ts` and re-export them there (`export { COUNT_COLUMNS, REPORT_COLUMNS } from './report-store';` and `export type { ReportsDatabase, ReportsStatement } from './report-store';`), so every existing import keeps working. Delete `report.ts`'s own `INSERT`. `report-store.ts` imports nothing from `report.ts`: check with `git grep -n "from './report'" src/lib/report-store.ts` (expect no line).

- [ ] **Step 4: Write the failing endpoint tests**

In `tests/unit/report-endpoint.test.ts` add (the existing `failed` tests keep `NO_DB`):

```ts
const SECRET = 'unit-test-secret-0123456789abcdef';
const ON = { REPORT_LIMITS: 'on', REPORT_COUNTER_SECRET: SECRET };
const NOW = () => new Date('2026-10-19T08:00:00.000Z');
const from = (ip: string) => ({ json: true, headers: { 'CF-Connecting-IP': ip } });

describe('the daily limits (#872)', () => {
  it('stores and answers sent while within both limits', async () => {
    const { db, batches } = scriptedDatabase([storedOn(1, 1)]);
    const response = await handleReport(post(valid(), from('203.0.113.9')), { REPORTS: db, ...ON }, () => {}, NOW);
    expect(response.status).toBe(200);
    expect(await outcomeOf(response)).toBe('sent');
    expect(batches[0]![3]!.values).toEqual([
      '2026-10-19',
      '245a1b83ed3a0c41bb3ba3f6beb7fef1811168275c045a8af6a8ac0452dc803b',
      expect.any(String),
    ]);
  });
  it.each([
    ['form-full', refusedOn(50, 1)],
    ['connection-full', refusedOn(7, 5)],
  ])('answers %s with 429 in JSON mode', async (outcome, answer) => {
    const { db } = scriptedDatabase([answer]);
    const response = await handleReport(post(valid(), from('203.0.113.9')), { REPORTS: db, ...ON }, () => {}, NOW);
    expect(response.status).toBe(429);
    expect(await outcomeOf(response)).toBe(outcome);
  });
  it.each([
    ['form-full', refusedOn(50, 1)],
    ['connection-full', refusedOn(7, 5)],
  ])('redirects to the %s status in form mode', async (outcome, answer) => {
    const { db } = scriptedDatabase([answer]);
    const response = await handleReport(post(valid(), { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), { REPORTS: db, ...ON }, () => {}, NOW);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(`/vi/#report-${outcome}`);
  });
  it('counts nothing with the limits off, and needs no secret', async () => {
    const { db, batches } = scriptedDatabase([STORED_OFF]);
    const response = await handleReport(post(valid(), { json: true }), { REPORTS: db }, () => {}, NOW);
    expect(await outcomeOf(response)).toBe('sent');
    expect(batches[0]).toHaveLength(2);
  });
  it.each([
    ['limits-invalid', { REPORT_LIMITS: 'yes' }, '203.0.113.9'],
    ['secret-missing', { REPORT_LIMITS: 'on' }, '203.0.113.9'],
    ['secret-missing', { REPORT_LIMITS: 'on', REPORT_COUNTER_SECRET: 'x'.repeat(31) }, '203.0.113.9'],
    ['address-missing', ON, 'not-an-address'],
  ])('fails closed as failed, logging %s', async (kind, env, ip) => {
    const lines: string[] = [];
    const { db } = scriptedDatabase([]);
    const response = await handleReport(post(valid(), from(ip)), { REPORTS: db, ...env }, (line) => lines.push(line), NOW);
    // scriptedDatabase([]) throws on any batch, so a count reached here
    // would log `database`, never the kind.
    expect(response.status).toBe(503);
    expect(lines).toEqual([`report failed: ${kind}`]);
  });
  it('counts an IPv6 address under its /64 block (AC10)', async () => {
    const { db, batches } = scriptedDatabase([storedOn(1, 1)]);
    await handleReport(post(valid(), from('2001:db8:1:2::9')), { REPORTS: db, ...ON }, () => {}, NOW);
    // HMAC-SHA-256(SECRET, '2026-10-19 2001:0db8:0001:0002::/64'), node:crypto 2026-10-19.
    expect(batches[0]![3]!.values[1]).toBe(
      '314a3b541e2cf3c62d6af6c2c44671ab471b44098a11e991b63e30e6c493f733',
    );
  });
  it('applies the limits on production whatever the switch says (AC9)', async () => {
    const lines: string[] = [];
    const { db } = scriptedDatabase([]);
    const response = await handleReport(
      new Request('https://shyden.co.uk/api/report', {
        method: 'POST',
        headers: {
          Origin: 'https://shyden.co.uk',
          'Content-Type': FORM,
          Accept: 'application/json',
          'CF-Connecting-IP': '203.0.113.9',
        },
        body: new URLSearchParams(valid()).toString(),
      }),
      { REPORTS: db, REPORT_LIMITS: 'off' },
      (line) => lines.push(line),
      NOW,
    );
    expect(response.status).toBe(503);
    expect(lines).toEqual(['report failed: secret-missing']);
  });
  // scriptedDatabase([]) throws on any batch: a count reached here would
  // answer `failed`, never these outcomes.
  it.each([
    ['the honeypot', { website: 'x' }, 200, 'sent'],
    ['a quote not on the page', { quote: 'zzz nowhere' }, 422, 'not-found'],
    ['an empty quote', { quote: '' }, 400, 'rejected'],
  ])('answers %s before any count', async (_what, fields, status, result) => {
    const { db } = scriptedDatabase([]);
    const response = await handleReport(
      post(valid(fields), from('203.0.113.9')),
      { REPORTS: db, ...ON },
      () => {
        throw new Error('nothing before a count logs');
      },
      NOW,
    );
    expect(response.status).toBe(status);
    expect(await outcomeOf(response)).toBe(result);
  });
});
```

And health:

```ts
describe('the health check sees the limits (#872 AC8)', () => {
  it.each([
    ['limits-invalid', { REPORT_LIMITS: 'yes' }],
    ['secret-missing', { REPORT_LIMITS: 'on' }],
  ])('answers 503 and logs %s', async (kind, env) => {
    const lines: string[] = [];
    const response = await reportHealth(new Request(HEALTH), { REPORTS: tableWith(REPORT_COLUMNS), ...env }, (line) => lines.push(line));
    expect(response.status).toBe(503);
    expect(lines).toEqual([`report health: ${kind}`]);
  });
  it('answers 200 with the limits on and a secret', async () => {
    const response = await reportHealth(new Request(HEALTH), { REPORTS: tableWith(REPORT_COLUMNS), ...ON }, () => {
      throw new Error('a healthy check logs nothing');
    });
    expect(response.status).toBe(200);
  });
  it('needs a secret on production even with the switch off', async () => {
    const lines: string[] = [];
    const response = await reportHealth(new Request('https://shyden.co.uk/api/report/health'), { REPORTS: tableWith(REPORT_COLUMNS), REPORT_LIMITS: 'off' }, (line) => lines.push(line));
    expect(response.status).toBe(503);
    expect(lines).toEqual(['report health: secret-missing']);
  });
});
```

The production health case reaches `reportHealth` directly; the middleware's Access check (#782) is not in its path.

Run: `npm run test:unit -- tests/unit/report-store.test.ts tests/unit/report-endpoint.test.ts`
Expected: FAIL (module missing; 429 unknown).

- [ ] **Step 5: Implement in `src/lib/report.ts`**

```ts
export interface ReportEnv extends LimitsEnv {
  readonly REPORTS?: ReportsDatabase;
  readonly REPORT_COUNTER_SECRET?: string;
}

type FailureKind =
  | 'binding-missing'
  | 'database'
  | 'limits-invalid'
  | 'secret-missing'
  | 'address-missing';

/** Whether the limits can run here, or the kind of failure that stops them (AC8, AC9). */
function limitsProblem(env: ReportEnv, setting: LimitsSetting): FailureKind | null {
  if (setting.kind === 'invalid') return 'limits-invalid';
  if (setting.kind === 'on' && (env.REPORT_COUNTER_SECRET ?? '').length < SECRET_MIN_LENGTH)
    return 'secret-missing';
  return null;
}
```

`handleReport` gains `now: () => Date = () => new Date()` as its fourth parameter; the store step becomes:

```ts
  if (!env.REPORTS) {
    log(`report failed: ${'binding-missing' satisfies FailureKind}`);
    return outcome('failed', request, locale, page);
  }
  const setting = limitsSetting(env, new URL(request.url).hostname);
  const problem = limitsProblem(env, setting);
  if (problem) {
    log(`report failed: ${problem}`);
    return outcome('failed', request, locale, page);
  }
  const at = now();
  const day = utcDay(at);
  let count: { counter: string; limits: ReportLimits } | null = null;
  if (setting.kind === 'on') {
    const connection = connectionOf(request.headers.get('CF-Connecting-IP'));
    if (!connection) {
      log(`report failed: ${'address-missing' satisfies FailureKind}`);
      return outcome('failed', request, locale, page);
    }
    count = {
      counter: await counterKey(env.REPORT_COUNTER_SECRET!, day, connection),
      limits: setting.limits,
    };
  }
  let stored: Stored;
  try {
    stored = await storeReport(
      env.REPORTS,
      [crypto.randomUUID(), at.toISOString(), locale, page, quote, JSON.stringify(keys), suggestion, note],
      day,
      count,
    );
  } catch {
    log(`report failed: ${'database' satisfies FailureKind}`);
    return outcome('failed', request, locale, page);
  }
  return outcome(stored, request, locale, page);
```

`reportHealth`, after the binding check and before the query:

```ts
  const problem = limitsProblem(env, limitsSetting(env, new URL(request.url).hostname));
  if (problem) {
    log(`report health: ${problem}`);
    return json({ ok }, 503);
  }
```

(`address-missing` cannot arise in health: `limitsProblem` never returns it.)


- [ ] **Step 6: The logs suite holds AC3**

`tests/logs/report-counts.test.ts`:

```ts
/**
 * The daily limits never keep an IP (#872 AC3). Every value bound to every
 * statement a counted report sends is read WHOLE against the exact list it
 * must be, with an address planted in the CF-Connecting-IP header, so the
 * address cannot be among them in any spelling. The unit suite keeps the
 * stand-in (report-endpoint.test.ts: one fixed address's counter).
 */
import { describe, expect, it } from 'vitest';
import { handleReport, matchingKeys } from '../../src/lib/report';
import { counterKey } from '../../src/lib/report-limits';
import { scriptedDatabase, storedOn } from '../report-fakes';
import { post, quote, valid } from '../report-endpoint-shared';

const SECRET = 'logs-suite-secret-0123456789abcdef';
const DAY = '2026-10-19';
const NOW = () => new Date(`${DAY}T08:00:00.000Z`);
const ID = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

describe('a counted report binds exactly its own values, never the address (AC3)', () => {
  it.each([
    ['an IPv4 address', '198.51.100.77', '198.51.100.77'],
    ['an IPv6 address', '2001:db8:aa:bb:1:2:3:4', '2001:0db8:00aa:00bb::/64'],
  ])('%s', async (_what, ip, connection) => {
    const { db, batches } = scriptedDatabase([storedOn(1, 1)]);
    await handleReport(
      post(valid(), { json: true, headers: { 'CF-Connecting-IP': ip } }),
      { REPORTS: db, REPORT_LIMITS: 'on', REPORT_COUNTER_SECRET: SECRET },
      () => {
        throw new Error('a stored report logs nothing');
      },
      NOW,
    );
    const key = await counterKey(SECRET, DAY, connection);
    expect(batches.flat().flatMap(({ values }) => values)).toEqual([
      DAY,
      ID,
      `${DAY}T08:00:00.000Z`,
      'vi',
      'home',
      quote,
      JSON.stringify(matchingKeys(quote, 'home', 'vi')),
      '',
      '',
      DAY,
      50,
      key,
      5,
      DAY,
      'all',
      ID,
      DAY,
      key,
      ID,
      DAY,
      key,
    ]);
  });

  it('one address keys differently on two days', async () => {
    expect(await counterKey(SECRET, DAY, '198.51.100.77')).not.toBe(
      await counterKey(SECRET, '2026-10-20', '198.51.100.77'),
    );
  });
});
```

The list is the batch's 21 bound values (prune 1, insert 12, two counts 3 each, read 2), asserted exactly, so the address cannot hide among them; the log callback throws, so a stored report logging anything fails. (An absence over a filtered list was refused by `lint:tests`' absence-liveness rule in review pass 3.)

- [ ] **Step 7: Run unit, typecheck, lint**

Run: `npm run test:unit`, `npm run typecheck`, `npm run lint:tests`
Expected: PASS, 0 errors. Every test touching `NO_DB` still passes unchanged (`failed` before any count).

- [ ] **Step 8: Mutations (each RED, then restore)**

1. `INSERT_WITHIN`'s `< ?12` → `<= ?12`: unit stays green (fakes cannot see SQL semantics); it must go RED in Task 6's functions test. Note it for Task 6's mutation list.
2. `all >= limits.total` → `all > limits.total`: `form-full when the day has taken its total` RED.
3. Bind `ip` instead of `connection` into `counterKey`: the logs test RED (needle found).
4. Remove the prune from the off path: `prunes other days` RED.
5. `limitsProblem` without the length check: `secret-missing` cases RED.

- [ ] **Step 9: Commit**

```bash
git add src/lib/report-store.ts src/lib/report.ts tests/report-fakes.ts tests/unit/report-store.test.ts tests/unit/report-endpoint.test.ts tests/logs/report-counts.test.ts
git commit -m "A report is stored and counted in one batch, and refused at either daily limit (Refs #872)"
```

(Probe expectation, review pass 1: with the copy in place, the unit run's only other reds are floor growths, recorded in CI: 21 tests across `one-person-voice`, `report`, `source-files`, `translate` and `i18n`, 19 floor ids.)

---

### Task 5: The contract says 429, and the browser shows both messages

**Files:**
- Modify: `openapi/report.yaml`, `openapi/report-health.yaml`, `tests/unit/report-contract.test.ts`
- Modify: `tests/e2e/report-form.spec.ts`

- [ ] **Step 1: Failing contract cases**

In `tests/unit/report-contract.test.ts`, widen `CASES` rows to an optional fourth element. The row type must be a MUTABLE tuple, or `it.each` falls to an overload that cannot spread it (review pass 3: ts2345/ts2349/ts2722 at the call):

The existing docblock above `CASES` absorbs the row's description (two docblocks in a row are refused by `stranded-docblocks`, review pass 4):

```ts
/**
 * One row per documented case; each row is its own test: its name, its
 * request, the status the spec documents, and the env when it needs one.
 */
type Case = [string, () => Request, string, (() => ReportEnv)?];

const CASES: readonly Case[] = [
```

and run each as `it.each(CASES)('%s', async (name, request, status, env = () => ({})) => { const response = await handleReport(request(), env(), () => {}); …`. Import `type ReportEnv` from `../../src/lib/report` and `refusedOn, scriptedDatabase` from `../report-fakes`. Add:

```ts
  [
    '429 form-full when the day has taken its total (JSON mode)',
    () => post(form(), { ...JSON_MODE, 'CF-Connecting-IP': '203.0.113.9' }),
    '429',
    () => ({ REPORTS: scriptedDatabase([refusedOn(50, 1)]).db, REPORT_LIMITS: 'on', REPORT_COUNTER_SECRET: 's'.repeat(32) }),
  ],
  [
    '429 connection-full when the connection has taken its share (JSON mode)',
    () => post(form(), { ...JSON_MODE, 'CF-Connecting-IP': '203.0.113.9' }),
    '429',
    () => ({ REPORTS: scriptedDatabase([refusedOn(7, 5)]).db, REPORT_LIMITS: 'on', REPORT_COUNTER_SECRET: 's'.repeat(32) }),
  ],
```

and their `FLOOR_OF` ids `report-contract/429-form-full-when-the-day-has-taken-its-total-json-mode` and `report-contract/429-connection-full-when-the-connection-has-taken-its-share-json-mode`. Run → FAIL (429 not in the spec).

- [ ] **Step 2: The spec**

`openapi/report.yaml` responses, after `'422'`:

```yaml
        '429':
          description: >-
            JSON mode, a daily limit is reached and nothing was stored:
            `form-full` when the form has taken its total for the day,
            `connection-full` when this internet connection has taken its
            share. Production always applies the limits; other environments
            only while switched on.
          headers:
            Cache-Control:
              required: true
              schema:
                type: string
                const: no-store
            X-Content-Type-Options:
              required: true
              schema:
                type: string
                const: nosniff
          content:
            application/json:
              schema:
                type: object
                additionalProperties: false
                required:
                  - outcome
                properties:
                  outcome:
                    type: string
                    enum:
                      - form-full
                      - connection-full
```

The `'303'` description lists `-form-full` and `-connection-full` beside the four. `openapi/report-health.yaml`, the 503 description becomes: "The binding is missing or fails, a table does not match its migration, or the daily limits cannot run (a variable is not a valid value, or the secret is missing where they are on). The reason goes to the log, never the answer."

- [ ] **Step 3: e2e, the in-place 429**

Form mode is already covered per locale by `report-presence.spec.ts` (Task 3). In `tests/e2e/report-form.spec.ts`, beside the existing route-mocked `failed` test (line ~195), add one test per outcome (`form-full`, `connection-full`), in place on `/vi/classroom-groups`: the route answers `{ status: 429, contentType: 'application/json', body: JSON.stringify({ outcome }) }`; then `#report-<outcome>` is `toBeVisible()` and `toHaveText(vi.report.<key>)`, and exactly one `[data-report-status]:visible`. Each test takes its picture with `shoot` (every review case has one), appended to the file:

```ts
// #872: a daily limit's 429 shows its own message in place, and no other.
// Form mode is report-presence.spec.ts's, per locale.
for (const [outcome, key] of [
  ['form-full', 'formFull'],
  ['connection-full', 'connectionFull'],
] as const)
  test(`/vi/classroom-groups: a 429 ${outcome} shows its message in place`, async ({
    page,
  }) => {
    const t = getSiteStrings('vi').report;
    await page.route('**/api/report', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ outcome }),
      }),
    );
    await page.goto(pagePath('classroom-groups', 'vi'));
    await page.locator('[data-report] summary').click();
    await page.getByLabel(t.quoteLabel, { exact: true }).fill(t.open);
    await page.getByRole('button', { name: t.send }).click();
    const shown = page.locator(`#report-${outcome}`);
    await expect(shown).toBeVisible();
    await expect(shown).toHaveText(t[key]);
    await expect(page.locator('[data-report-status]:visible')).toHaveCount(1);
    await shoot(page, `The ${outcome} message, in place`, shown);
  });
``` Follow the file's existing viewport tags and helpers (memory: a new e2e test meets the viewport-tag, capture-order and recorded meta-guards).

- [ ] **Step 4: Run unit, typecheck, lint; commit**

Run: `npm run test:unit -- tests/unit/report-contract.test.ts`, `npm run typecheck`, `npm run lint:tests` → PASS. The e2e runs in CI.

```bash
git add openapi/report.yaml openapi/report-health.yaml tests/unit/report-contract.test.ts tests/e2e/report-form.spec.ts
git commit -m "The report contract documents 429 for both daily limits, and the browser shows each (Refs #872)"
```

---

### Task 6: Real D1: the limits hold under the functions runtime

**Files:**
- Modify: `tests/functions/local.mjs` (`SECRET`, `MIGRATIONS`), `tests/functions/serve.mjs`, `tests/functions/report.spec.ts`

- [ ] **Step 1: The server applies every migration and switches the limits on**

`local.mjs`:

```js
/** The counter secret the local server is given (#872): 64 hex, a test value only. */
export const SECRET = '6b1f0e0c5d4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';
```

`serve.mjs`: replace the single `d1(['--file', 'migrations/0001_reports.sql'])` with every file in `migrations/`, sorted, derived from the filesystem:

```js
import { nonEmpty } from '../../scripts/errors.mjs';
// …
// Every migration, in order, read from the directory: a new one is applied
// the day it is added (#872). nonEmpty fails the run on an empty read.
for (const file of nonEmpty(
  readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort(),
  'migrations',
))
  d1(['--file', `migrations/${file}`]);
```

The bare `readdirSync` form is refused by `tests/guards/one-home.test.ts` (*a directory read cannot reach a guard unproved*); `nonEmpty` at the point of reading is its accepted idiom (review pass 4).

and add to the `wrangler pages dev` arguments `'--binding', 'REPORT_LIMITS=on', '--binding', `REPORT_COUNTER_SECRET=${SECRET}``. Defaults 50/5 apply.

- [ ] **Step 2: Every test starts with no counts**

`report.spec.ts`, top level:

```ts
// Each test starts the day with no counts (#872): the limits are on here,
// so every report below also runs the counting batch on real D1.
test.beforeEach(async () => {
  await query('DELETE FROM report_counts');
});
```

- [ ] **Step 3: The cap tests (JSON mode through `request`, each its own address)**

```ts
const today = () => new Date().toISOString().slice(0, 10);
const send = (request: APIRequestContext, ip: string, note: string) =>
  request.post('/api/report', {
    headers: { Origin: BASE_URL, Accept: 'application/json', 'CF-Connecting-IP': ip },
    form: { locale: 'vi', page: 'home', quote: vi.open, suggestion: '', note, website: '' },
  });

test.describe('the daily limits on real D1 (#872)', () => {
  test('a 6th report from one address is refused; another address is not', async ({ request }) => {
    const note = noteFor('connection-limit');
    const five: number[] = [];
    for (let at = 1; at <= 5; at++)
      five.push((await send(request, '203.0.113.9', note)).status());
    expect(five).toEqual([200, 200, 200, 200, 200]);
    const sixth = await send(request, '203.0.113.9', note);
    expect(sixth.status()).toBe(429);
    expect(await sixth.json()).toEqual({ outcome: 'connection-full' });
    expect((await send(request, '203.0.113.10', note)).status()).toBe(200);
    expect(await reportsWithNote(note)).toHaveLength(6);
  });
  test('two addresses in one IPv6 /64 share one count', async ({ request }) => {
    const note = noteFor('ipv6-block');
    const five: number[] = [];
    for (let at = 1; at <= 5; at++)
      five.push((await send(request, `2001:db8:1:2::${at}`, note)).status());
    expect(five).toEqual([200, 200, 200, 200, 200]);
    expect((await send(request, '2001:db8:1:2:ffff::9', note)).status()).toBe(429);
    expect((await send(request, '2001:db8:1:3::1', note)).status()).toBe(200);
  });
  test('the 50th report is stored and the 51st refused', async ({ request }) => {
    await query("INSERT INTO report_counts (day, counter, count) VALUES (?1, 'all', 49)", [today()]);
    const note = noteFor('total-limit');
    expect((await send(request, '198.51.100.1', note)).status()).toBe(200);
    const last = await send(request, '198.51.100.2', note);
    expect(last.status()).toBe(429);
    expect(await last.json()).toEqual({ outcome: 'form-full' });
    expect(await reportsWithNote(note)).toHaveLength(1);
  });
  test("yesterday's counts are gone after today's first report", async ({ request }) => {
    await query("INSERT INTO report_counts (day, counter, count) VALUES ('2000-01-01', 'all', 3)");
    expect((await send(request, '198.51.100.3', noteFor('prune'))).status()).toBe(200);
    // The whole table, read exactly: today's two rows, and so not the planted one.
    expect(
      await query(
        "SELECT day, counter FROM report_counts ORDER BY counter = 'all' DESC",
      ),
    ).toEqual([
      { day: today(), counter: 'all' },
      { day: today(), counter: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });
  test('8 reports at once from one address store exactly 5', async ({ request }) => {
    const note = noteFor('concurrent');
    const statuses = (await Promise.all(
      Array.from({ length: 8 }, () => send(request, '203.0.113.50', note)),
    )).map((response) => response.status());
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
    expect(await reportsWithNote(note)).toHaveLength(5);
  });
  test('no count row holds an address', async ({ request }) => {
    await send(request, '203.0.113.77', noteFor('no-address'));
    const rows = await query('SELECT day, counter, count FROM report_counts');
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('203.0.113');
    const counters = rows.map(({ counter }) => counter);
    expect(counters).toContain('all');
    expect(counters.filter((counter) => counter !== 'all')).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
  });
});
```

The `for` loops post the five reports a limit needs (one case's setup, sequential so their order is known) and assert nothing inside; say so in a comment. `noteFor`, `reportsWithNote`, `vi` and `BASE_URL` are the spec's existing helpers; read their imports at the top of the file. A test that starts at 23:59:59 UTC may cross the day between its insert and its post: `today()` is read once per test and the window is one second a day, so name it in a comment rather than guard it.

- [ ] **Step 4: Typecheck, lint; the suite runs in CI**

Run: `npm run typecheck`, `npm run lint:tests`. Do not run `test:functions` on the laptop.

- [ ] **Step 5: Mutations, on a mutant branch in CI**

Push a `872-mut-sql` branch with `< ?12` → `<= ?12` in `INSERT_WITHIN`, and a `872-mut-batch` branch replacing the batch with five sequential `all()` calls (no transaction); dispatch the functions job on each. Expected: the first RED at "a 6th report…"; the second RED at "8 reports at once…" or, if SQLite serialises them anyway, GREEN, which is then reported as "the transaction is not what the concurrency test proves" and the test's claim narrowed in its comment.

- [ ] **Step 6: Commit**

```bash
git add tests/functions/local.mjs tests/functions/serve.mjs tests/functions/report.spec.ts
git commit -m "The daily limits hold on real D1, at once and across days (Refs #872)"
```

---

### Task 7: The runbook, then the PR, floors and Shyden's environment steps

**Files:**
- Modify: `docs/runbooks/translation-reports.md`
- Test: `tests/logs/reports-table.test.ts` (runbook section)

- [ ] **Step 1: Failing runbook test**

In `describe('the runbook', …)`:

```ts
  // #872 AC7: one test per line the runbook must hold, each matcher
  // anchored to a whole table row.
  it('names the switch (#872 AC7)', () => {
    expect(runbook()).toMatch(/^\| `REPORT_LIMITS` \| `on` or `off`/m);
  });
  it('names the total and its default (#872 AC7)', () => {
    expect(runbook()).toMatch(/^\| `REPORT_LIMIT_TOTAL` \| .*\| 50 \|$/m);
  });
  it('names the connection share and its default (#872 AC7)', () => {
    expect(runbook()).toMatch(/^\| `REPORT_LIMIT_CONNECTION` \| .*\| 5 \|$/m);
  });
  it('names the secret (#872 AC7)', () => {
    expect(runbook()).toMatch(/^\| `REPORT_COUNTER_SECRET` \|/m);
  });
  it('names limits-invalid (#872 AC7)', () => {
    expect(runbook()).toMatch(/^\| `report failed: limits-invalid` \|/m);
  });
  it('names secret-missing (#872 AC7)', () => {
    expect(runbook()).toMatch(/^\| `report failed: secret-missing` \|/m);
  });
  it('names address-missing (#872 AC7)', () => {
    expect(runbook()).toMatch(/^\| `report failed: address-missing` \|/m);
  });

```

- [ ] **Step 2: The runbook section**

Insert before `## The daily count (#349)` (keep the file's first `SELECT` line first: the runbook test reads the first one):

````markdown
## The daily limits (#872)

One person, or a bot, can put only so many reports in front of the operator
in a day. A report is refused, and nothing is stored, once the form has taken
its total for the UTC day, or once one internet connection has taken its
share. The visitor is told which, politely, with no time of reset: the day
turns at 00:00 UTC (07:00 in Jakarta and Bangkok).

| Variable | Values | Default |
| --- | --- | --- |
| `REPORT_LIMITS` | `on` or `off`; read only off production | off |
| `REPORT_LIMIT_TOTAL` | a whole number from 1 to 1000000: reports a day, from everyone | 50 |
| `REPORT_LIMIT_CONNECTION` | a whole number from 1 to 1000000: reports a day, from one connection | 5 |
| `REPORT_COUNTER_SECRET` | at least 32 characters, an encrypted variable | none |

**Production always applies the limits**, whatever `REPORT_LIMITS` says; only
the two numbers can change there. Every other host (dev, a Pages preview) has
them off unless `REPORT_LIMITS` is `on`, so dev's automated check, which sends
one real report per deploy, never meets them. A value that is not one of the
above fails closed: every report is refused as `failed`, and the health check
answers 503.

To change one: Cloudflare dashboard → Workers & Pages → the project →
Settings → Variables and Secrets, edit it, then re-run the deploy (Actions →
the deploy workflow → Run workflow), because Pages applies a variable at the
next deployment. To test the limits on dev, set `REPORT_LIMITS` to `on` and
small numbers (`REPORT_LIMIT_CONNECTION` = `1` makes the second report the
refused one), redeploy, test, then set it back to `off` and redeploy.

The secret: `openssl rand -hex 32`, pasted as an encrypted variable on each
environment, never written anywhere else. Production needs it always, and
dev only while its limits are on. Changing it starts that day's
per-connection counts again; nothing else is lost.

**What is kept:** the `report_counts` table (`migrations/0002_report_counts.sql`),
one row per counter per UTC day: the day, `all` or a 64-character
HMAC-SHA-256 of the day and the connection under the secret, and a count.
Never an IP address, and nothing that links a count to a report. Someone
holding the secret and a guessed address could confirm that the address
reported that day, so the rows are pseudonymous rather than anonymous; every
report deletes the rows of any other day, so none outlives its day. An IPv4
address is counted whole; an IPv6 address by its /64 block, the part one line
is usually given (Shyden 2026-10-19), so moving within it does not reset the
count.

The connection is read from `CF-Connecting-IP`, which Cloudflare sets. Keep
the zone's Network → Pseudo IPv4 setting Off or "Add header": "Overwrite
Headers" would put a made-up IPv4 address there and undo the /64 rule. Read it
before the first production release with the limits.

Before the code reaches an environment, run the migration in that database's
D1 console (`shyden-reports-dev` before the merge into `develop`,
`shyden-reports` before the release), pasting the `CREATE TABLE` from
`migrations/0002_report_counts.sql`. Until it runs, the health check answers
503 and every report fails.
````

and add these rows to the failure table, after its `report health: the reports table …` row:

```markdown
| `report failed: limits-invalid` | A limit variable holds a value that is not `on`, `off` or a whole number from 1 to 1000000 (see _The daily limits_). |
| `report failed: secret-missing` | The limits are on (always, on production) and `REPORT_COUNTER_SECRET` is missing or under 32 characters. |
| `report failed: address-missing` | The limits are on and the request carried no readable `CF-Connecting-IP`. |
| `report health: limits-invalid` | The health check found a limit variable it cannot read. |
| `report health: secret-missing` | The health check found the limits on and no usable secret. |
| `report health: the report_counts table does not match the migration` | The counts table is missing, or its columns differ from `migrations/0002_report_counts.sql`. |
```

- [ ] **Step 3: Unit, typecheck, format; commit; open the PR**

```bash
git add docs/runbooks/translation-reports.md tests/logs/reports-table.test.ts
git commit -m "The runbook says how the daily limits are set, tested and what they keep (Refs #872)"
```

Merge `origin/develop` in if it moved; push; open the PR into `develop` with `Refs #872`, the writer/reader table, every corrected line, and both mutation branches' verdicts. Then `gh workflow run record-floors.yml --ref develop -f branch=872-report-daily-caps` and wait for CI by `~/.claude/scripts/pr-verdict.sh <pr>` in the background.

- [ ] **Step 4: Shyden's steps, asked before the develop merge**

Dev needs, before the merge (or its health check fails and `dev-verified` with it): migration `0002` run in `shyden-reports-dev`'s D1 console. The secret on dev is needed only when he switches dev's limits on. Prod needs migration `0002` in `shyden-reports` and `REPORT_COUNTER_SECRET` before the release (prod-sanity's health check fails without them, by AC8). Ask with `AskUserQuestion`, giving the exact SQL and the steps.

- [ ] **Step 5: Dev measurement (Review Focus 2)**

With Shyden's dev variables set to `REPORT_LIMITS=on`, `REPORT_LIMIT_CONNECTION=1` and redeployed: post twice from one machine, the second with a different `CF-Connecting-IP` header. Expected: the second is `connection-full` (the edge set the header). Record the result on #872, then he switches dev off again.

---

## Review log

- **Pass 1 (2026-10-19)**, scratch worktree `../shyden.co.uk-872-plan` off `develop` `d4471b84`, with Tasks 1-4's code applied from this file and English stand-ins in the four beta locales. `npm run typecheck`: 1 error, then 0/0/0 after the fix below. `npm run test:unit`: 3,971 passed, 35 failed of 4,006, every failure read: 13 copy guards predicted red by the stand-ins (`i18n` 5, `report-limit-copy` 8), 21 floor growths (19 floor ids, recorded in CI), 1 plan defect. Findings, all fixed in this file: (F1) the `Outcome` union cannot grow in a commit without its copy, because `report-presence.spec.ts:76` maps it in a `Record` (ts2739), so the outcomes-and-copy task now comes before the store task; (F2) `report-presence.spec.ts` already tests every `#report-<outcome>` per locale, so Task 5's form-mode e2e test was a duplicate and is gone, and that spec's list now derives from its `Record`; (F3) the "limits off" endpoint test posted in form mode and read JSON. Also fixed while writing: an import cycle (`report-store.ts` imported `REPORT_COLUMNS` from `report.ts`, which imports it back), and loops of assertions changed to one test per case.
- **Pass 2 (2026-10-19)**, same probe with F3 fixed: the five report unit files 141 of 141 green. The plan's 8 predicted unit mutations (Task 2: 1-5; Task 4: 2, 4, 5) each went RED, plus 3 extra mutants of my own: health skipping the limits went RED; keying the counter on the raw address, and `handleReport` ignoring the host, both stayed GREEN. Findings, fixed here: (F4) the endpoint's counter test used IPv4, where address and connection are the same text, so an IPv6 case now pins the /64 counter; (F5) no endpoint test posted to the production host, so a production-with-switch-off case is added. With both, each mutant goes RED (61 of 61 green unmutated, then 1 red each). Still to run: the guards, logs, functions and e2e suites, which run in CI only. The unit suite must be green first (guards follow unit in `ci.yml`'s `checks` job), so the probe needs the real translations: pass 3.
- **Pass 3 (2026-10-19)**, the probe with every task's code, the real DeepL drafts and Google's readings. Unit: 3,968 passed, 40 failed of 4,008, every failure a floor GROWTH (37 ids, none a fall), recorded in CI. Typecheck 0/0/0; `lint:tests` 0 findings in 13 changed test files after the fixes. Findings, fixed here: (F6, my slip) a whole-locale `id` DeepL send credited DeepL with 27 hand-written Indonesian lines and voided their second readings (`read-back-coverage` red): Task 3 now keeps only the new `id` drafts, and the eight read lines are in Task 3; (F7) the contract's optional fourth tuple element does not type through `it.each` unless the row type is mutable; (F8) `lint:tests` refused 7 assertions: 6 absences with no population (now exact whole-result assertions, or a fake that throws when called) and 1 `toMatch` through a variable (now one literal anchored matcher per test). Also added: the in-place 429 e2e tests take their `shoot` picture. Probe branch `872-plan-probe` pushed; its floor record and CI (guards, logs, functions, e2e) are pass 4.
- **Pass 4 (2026-10-19)**, CI on the probe. Floor record 39198294479 refused 2 guards: (F9) `serve.mjs` read `migrations/` with a bare `readdirSync` (`one-home.test.ts`), now `nonEmpty(...)` at the point of reading; (F10) two docblocks stacked on the contract rows (`stranded-docblocks`), now one. Record 39200135755 green; CI 39205037914 at `3566355`: `checks` (unit + guards), `functions` (the real-D1 cap, /64, total, prune, 8-at-once and no-address tests), `sanity-on-build` and `visual` green; logs run 39205435684 green, 70 of 70, the three AC3 tests and ten migration/runbook tests among them. Red: one test, `not-found-report.spec.ts:129`, 40 times (4 locales x 5 engines, e2e and capture): `BETA.length * 4` statuses. The plan already listed the change; the probe had missed it. Task 3 now spells it out. Then develop (#830, `93f39097`) was merged into the probe: two conflicts (`tests/floors.json`, three-way by `floors-three-way.py`, re-recorded; one import line), and #830's `recordingTable` converted to `batch` (code now in Task 4 Step 1). Laptop after the merge: typecheck 0/0/0, unit 4,013 of 4,016 (3 floor growths), `lint:tests` 0 findings in 15 files. Pass 5: record 39217956162, then CI.
- **Pass 5 (2026-10-19)**, the probe with develop merged in. Record 39217956162 green (`Record the floors`, `Fold the figures…`, `Start CI on the new head`), which folded the floors into `54d77c13`. CI 39224644386 on `54d77c13`, all 20 jobs read by name and green: `checks` (format, build, typecheck, unit, guards, simulation, integration), `functions`, `sanity-on-build`, `visual`, e2e shards 1-8, capture shards 1-4, `scope`, `image` and `build-and-test`. `logs` is skipped in `ci.yml` and runs in its own workflow: logs run 39225181113 on `54d77c13`, green. The 15 skipped steps are all of four kinds, each keeping traces, a diff or a report from a failing run. Findings: none. **Clean pass: plan approved 2026-10-19 (self-approved under the review-to-zero rule).**
