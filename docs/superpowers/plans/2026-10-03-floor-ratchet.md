# Plan: liveness floors are ratcheted (#468)

Refs #468, under the #446 guard audit. Operator decision 2026-10-03, asked
interactively: ratchet the floors. Operator addition the same evening: the
recorder prints how much each floor moved, so a raise is read rather than
rubber-stamped (AC10).

**Built from commits.** Each task below is `git show` of its commit on
`468-floor-ratchet`, fenced with `~~~~`. A review pass applies every task's
diff to `develop` at `4d07565` and refuses unless the result equals the branch
tree, then runs every gate and the matrix on that tree (see Review passes).

## Why

A floor written `toBeGreaterThan(measured - 1)` is tight only on the day it is
measured, because growth never fails it. Measured at `4d07565` by wrapping
`toBeGreaterThan(OrEqual)` across the whole unit suite (446 floor sites, no
test edited): `absence-liveness` was set to `> 420` against a real 421 in #467
and read 424 an hour after it merged; `git-env` 6 slack, `duplicate-imports`
7, `one-test-per-case` and `spec-scan` 1 each, all set tight within two days.
20 of the 58 first-parent commits on `develop` that week changed the number of
files under `tests/`.

## Design

- `tests/floors.json`: id to measured figure. Ids name what is counted
  (`absence-liveness/plain-files`). Its path and the record variable have one
  home, `scripts/record-floors.mjs`, which `tests/floors.ts` imports.
- `tests/floors.ts`, runner-neutral: `floorBreach(id, actual, options?)`
  returns nothing on equality and otherwise the breach as text, so a caller
  writes `expect(floorBreach(id, n)).toBeUndefined()` after its verdict. Below
  the figure: lost units or a real shrink, lowered by hand. Above: grown, run
  the recorder. Not a whole non-negative number: refused in both modes. In
  record mode (`FLOORS_RECORD` set) it appends `{ id, actual, site }`. Judging
  is an explicit `record: null`, because an explicit `undefined` takes the
  environment default (found by running the recorder for real).
- `scripts/record-floors.mjs` (`npm run floors:record`): runs the unit suite
  in record mode, then `decideRecord` checks everything before writing
  anything: never lowers, refuses a stale id, an id from two places or with
  two values, and a failing run. Refuses under `CI`. `describeMoves` prints
  every move with its delta, largest first (AC10).
- `tests/literal-floors.ts`: classifies every `toBeGreaterThan(OrEqual)` under
  `tests/`, every comparison with a literal inside an `expect` argument, and
  every `toBeLessThan(OrEqual)` whose subject is a literal (a floor written
  backwards, added at review pass 1) as presence, counted, forwarded,
  compared, threshold or ceiling, and refuses anything else by line.
- `tests/unit/literal-floors.test.ts`: a counted or forwarded floor is
  refused unless it is a product value with its reason, or one of the seven
  Playwright floors #446 Group 5 ratchets (that list may only shrink).
  Controls: (a) the sites inside the verdict; (b) its own count ratcheted;
  (c) per file, the matcher counted in comment-stripped text, less what
  string and regex literals spell, equals what the reader returned; (d)
  refusals; (e) every form planted by hand. Every recorded id is spelled
  exactly once under `tests/`.

## Acceptance criteria to evidence

| AC | Evidence |
| --- | --- |
| 1 ids and figures in `tests/floors.json` | Task 1, Task 2; narrowed to the number only (comment on #468) |
| 2 runner-neutral check, two messages | Task 1: `floors.test.ts` pins each message whole; Task 9 gives its constants one home |
| 3 recorder, everything checked before any write, CI never records | Task 1 (`decideRecord`, `script-entry` probe), Task 3 (no workflow runs it), Task 11 (a run that did not start or failed); matrix R8-R12, R16, R17, R30, R31; each pass runs the recorder on the applied tree |
| 4 every unit liveness floor converted, after its verdict | Task 2: 52 ids, from 41 floors written in place, `spec-scan`'s helper (5 callers), `back-translate` (4 locales) and `evidence-recording`'s two comparisons; 16 moved below their verdict |
| 5 meta-guard refusing a literal floor in every form | Task 2, Task 7; matrix R18-R25, R29 |
| 6 every id used by exactly one site | Task 2 ('spells every recorded id exactly once'); `decideRecord` refuses an id from two places at record time; matrix R10, R28 |
| 7 matrix on both trees | below |
| 8 ledger and CLAUDE.md | Task 4; the global rule's control (b) is edited outside the repo |
| 9 plan reviewed by running it | Review passes, Pass log |
| 10 every move printed with its delta | Task 1 (`describeMoves`); matrix R12 |

## Task 1: The check, the recorder, and absence-liveness's three floors

TDD: 20 tests run RED against throwing stubs, none passed; then green. Running the recorder for real found two defects its unit tests could not: an explicit `undefined` meant "not recording" and took the environment default, and the stack-frame regex spelled `\/\/`, which one-home reads as a comment stripper. AC10 (printed moves) was added here at the operator's word, RED first (3 as predicted). First record: 424 -> 426, 262 -> 264, 113 -> 114, each equal to what the commit added.

~~~~diff
diff --git a/package.json b/package.json
index 9be518b..01e0435 100644
--- a/package.json
+++ b/package.json
@@ -12,6 +12,7 @@
     "preview": "ASTRO_PREVIEW_BACKGROUND=1 astro preview",
     "typecheck": "astro check",
     "test:unit": "vitest run",
+    "floors:record": "node scripts/record-floors.mjs",
     "test:e2e": "node scripts/test-e2e.mjs",
     "test:functions": "playwright test --config=playwright.functions.config.ts",
     "test:sanity": "SANITY_ON_BUILD=1 playwright test -c playwright.dev.config.ts && SANITY_ON_BUILD=1 playwright test -c playwright.prod.config.ts",
diff --git a/scripts/record-floors.mjs b/scripts/record-floors.mjs
new file mode 100644
index 0000000..b1febe3
--- /dev/null
+++ b/scripts/record-floors.mjs
@@ -0,0 +1,191 @@
+/**
+ * Record the guards' liveness floors (#468): `npm run floors:record`.
+ *
+ * Runs the unit suite with `FLOORS_RECORD` set, so every `floorBreach` call
+ * writes the count it saw instead of judging it (`tests/floors.ts`), then
+ * raises `tests/floors.json` to match. It checks EVERYTHING before writing
+ * anything, and refuses the whole record when:
+ *
+ * - a figure would FALL. A falling count is what a blind reader looks like,
+ *   and so is a corpus that really shrank; only a person can tell the two
+ *   apart, so a fall is a hand edit with the reason in the commit;
+ * - a recorded id was asserted by no test, so the file names a floor that no
+ *   longer exists (or a run that did not reach it);
+ * - one id was asserted from two places, or read two values: two guards
+ *   sharing a figure would let either go blind behind the other;
+ * - the run itself failed.
+ *
+ * CI never records, for the reason CI never passes `--update-snapshots`: a
+ * run that can rewrite the figure it checks against asserts nothing.
+ */
+import { spawnSync } from 'node:child_process';
+import {
+  existsSync,
+  mkdtempSync,
+  readFileSync,
+  rmSync,
+  writeFileSync,
+} from 'node:fs';
+import { tmpdir } from 'node:os';
+import { join } from 'node:path';
+import { env } from 'node:process';
+
+import { die } from './errors.mjs';
+
+const FLOORS_FILE = 'tests/floors.json';
+
+/**
+ * @typedef {{ id: string, actual: number, site: string }} Observation
+ */
+
+/**
+ * The next figures, and every reason not to write them. The caller writes
+ * `next` only when `refusals` is empty.
+ *
+ * @param {Readonly<Record<string, number>>} recorded
+ * @param {readonly Observation[]} seen
+ * @returns {{ next: Record<string, number>, refusals: string[] }}
+ */
+export const decideRecord = (recorded, seen) => {
+  /** @type {Map<string, Observation[]>} */
+  const byId = new Map();
+  for (const observation of seen)
+    byId.set(observation.id, [
+      ...(byId.get(observation.id) ?? []),
+      observation,
+    ]);
+
+  /** @type {Record<string, number>} */
+  const next = { ...recorded };
+  /** @type {string[]} */
+  const refusals = [];
+  for (const [id, observations] of byId) {
+    const sites = [...new Set(observations.map(({ site }) => site))];
+    const values = [...new Set(observations.map(({ actual }) => actual))];
+    if (sites.length > 1) {
+      refusals.push(`${id} is asserted from two places: ${sites.join(', ')}`);
+      continue;
+    }
+    if (values.length > 1) {
+      refusals.push(`${id} read two different values: ${values.join(', ')}`);
+      continue;
+    }
+    const [actual] = values;
+    const measured = recorded[id];
+    if (measured !== undefined && actual < measured) {
+      refusals.push(
+        `${id} would fall from ${measured} to ${actual}: a blind reader looks ` +
+          `like this. If the corpus really shrank, lower it in ${FLOORS_FILE} ` +
+          `by hand and say why in the commit.`,
+      );
+      continue;
+    }
+    next[id] = actual;
+  }
+  for (const id of Object.keys(recorded))
+    if (!byId.has(id))
+      refusals.push(
+        `${id} is recorded but no test asserted it: remove it from ` +
+          `${FLOORS_FILE} with the floor that used it, or run the whole suite`,
+      );
+  return { next, refusals };
+};
+
+/**
+ * One line per figure that moved, largest move first: `id: 100 -> 125 (+25)`,
+ * or `id: new, 3`.
+ *
+ * Printed because a raise is accepted on its direction alone. A change that
+ * adds five units and quietly makes the reader miss three records +2, and
+ * nothing goes red; only a person reading each delta against the diff that
+ * caused it can see that (operator, 2026-10-03). A guard with an independent
+ * cross-check (#469) catches it mechanically; until every guard has one, the
+ * delta is what gets read.
+ *
+ * @param {Readonly<Record<string, number>>} recorded
+ * @param {Readonly<Record<string, number>>} next
+ * @returns {string[]}
+ */
+export const describeMoves = (recorded, next) =>
+  Object.keys(next)
+    .filter((id) => next[id] !== recorded[id])
+    .map((id) => ({ id, delta: next[id] - (recorded[id] ?? 0) }))
+    .sort((a, b) => b.delta - a.delta || (a.id < b.id ? -1 : 1))
+    .map(({ id }) =>
+      recorded[id] === undefined
+        ? `${id}: new, ${next[id]}`
+        : `${id}: ${recorded[id]} -> ${next[id]} (+${next[id] - recorded[id]})`,
+    );
+
+/**
+ * The file's text: ids sorted, two-space indented, a final newline, which is
+ * also what prettier writes, so a record never leaves the tree unformatted.
+ *
+ * @param {Readonly<Record<string, number>>} floors
+ * @returns {string}
+ */
+export const floorsText = (floors) =>
+  JSON.stringify(
+    Object.fromEntries(
+      Object.entries(floors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
+    ),
+    null,
+    2,
+  ) + '\n';
+
+/**
+ * @returns {void}
+ */
+const main = () => {
+  if (env.CI) die('CI never records floors: run npm run floors:record locally');
+
+  /** @type {Readonly<Record<string, number>>} */
+  const recorded = existsSync(FLOORS_FILE)
+    ? JSON.parse(readFileSync(FLOORS_FILE, 'utf8'))
+    : {};
+
+  // Collected inside the try and judged after it: `die` exits at once, which
+  // skips any `finally` still pending, and the scratch directory would leak.
+  const dir = mkdtempSync(join(tmpdir(), 'floors-record-'));
+  /** @type {number | null} */
+  let status;
+  /** @type {Observation[]} */
+  let seen = [];
+  try {
+    const record = join(dir, 'seen.jsonl');
+    status = spawnSync('npx', ['vitest', 'run'], {
+      stdio: 'inherit',
+      env: { ...env, FLOORS_RECORD: record },
+    }).status;
+    if (existsSync(record))
+      seen = readFileSync(record, 'utf8')
+        .split('\n')
+        .filter((line) => line !== '')
+        .map((line) => JSON.parse(line));
+  } finally {
+    rmSync(dir, { recursive: true, force: true });
+  }
+
+  if (status !== 0)
+    die(
+      `the unit suite failed in record mode (exit ${status}): nothing recorded`,
+    );
+  const { next, refusals } = decideRecord(recorded, seen);
+  if (refusals.length > 0) die(`nothing recorded:\n  ${refusals.join('\n  ')}`);
+
+  const moves = describeMoves(recorded, next);
+  writeFileSync(FLOORS_FILE, floorsText(next));
+  console.log(
+    moves.length === 0
+      ? `${FLOORS_FILE}: every floor already matches (${seen.length} read)`
+      : [
+          `${FLOORS_FILE}: ${moves.length} floor(s) moved:`,
+          ...moves.map((move) => `  ${move}`),
+          'Read each one against your diff: a raise smaller than the units you',
+          'added is a reader that lost some. Put these lines in the commit.',
+        ].join('\n'),
+  );
+};
+
+// Only when run, never when imported: the unit suite imports the decision.
+if (import.meta.main) main();
diff --git a/tests/floors.json b/tests/floors.json
new file mode 100644
index 0000000..981c8ea
--- /dev/null
+++ b/tests/floors.json
@@ -0,0 +1,5 @@
+{
+  "absence-liveness/plain-files": 114,
+  "absence-liveness/sites": 426,
+  "absence-liveness/ts-files": 264
+}
diff --git a/tests/floors.ts b/tests/floors.ts
new file mode 100644
index 0000000..46c38aa
--- /dev/null
+++ b/tests/floors.ts
@@ -0,0 +1,117 @@
+/**
+ * The ratchet on guard liveness floors (#468).
+ *
+ * A liveness floor proves a guard read its population: `absence-liveness`
+ * judging nothing because its reader went blind must not look like a clean
+ * suite. Written as `toBeGreaterThan(measured - 1)`, a floor is tight only on
+ * the day it is measured, because growth never fails it: `absence-liveness`
+ * was set to `> 420` against a real 421 in #467 and read 424 an hour after
+ * it merged, so its reader could have lost three assertions in silence.
+ *
+ * So each floor is a figure recorded in `tests/floors.json` and checked for
+ * EQUALITY. Fewer than recorded is a reader that lost units, or a corpus that
+ * really shrank, which only a person can tell apart, so the figure is lowered
+ * by hand with the reason in the commit. More than recorded is a population
+ * that grew, and `npm run floors:record` raises it. Neither direction moves
+ * on its own, so every floor is exact on every commit.
+ *
+ * Runner-neutral: vitest and Playwright both call it, so it imports neither
+ * and returns the breach as text for the caller's own `expect`:
+ *
+ *     expect(floorBreach('absence-liveness/sites', sites.length)).toBeUndefined();
+ *
+ * placed AFTER the guard's verdict, so a population that grew never hides a
+ * finding. The id is a string literal in exactly one place under `tests/`
+ * (`literal-floors.test.ts` holds that).
+ */
+import { appendFileSync, readFileSync } from 'node:fs';
+import { relative } from 'node:path';
+import { fileURLToPath } from 'node:url';
+
+export const FLOORS_FILE = 'tests/floors.json';
+
+/**
+ * Set by `scripts/record-floors.mjs` to a file it reads back: while set,
+ * every check appends what it saw instead of judging it.
+ */
+export const RECORD_ENV = 'FLOORS_RECORD';
+
+export type Floors = Readonly<Record<string, number>>;
+
+export const readFloors = (file: string = FLOORS_FILE): Floors =>
+  JSON.parse(readFileSync(file, 'utf8')) as Floors;
+
+const THIS_FILE = relative(process.cwd(), fileURLToPath(import.meta.url));
+
+/**
+ * The repository-relative `file:line` that called the check: the first stack
+ * frame outside this file and outside node_modules.
+ */
+const callSite = (stack: string): string => {
+  for (const line of stack.split('\n').slice(1)) {
+    // V8 writes `at name (where:line:column)` or `at where:line:column`, and
+    // `where` is a path or a file URL.
+    const frame =
+      /\((.+):(\d+):\d+\)$/.exec(line) ?? /^\s*at (.+):(\d+):\d+$/.exec(line);
+    if (!frame) continue;
+    const path = frame[1].startsWith('file:')
+      ? fileURLToPath(frame[1])
+      : frame[1];
+    const file = relative(process.cwd(), path);
+    if (file !== THIS_FILE && !file.includes('node_modules'))
+      return `${file}:${frame[2]}`;
+  }
+  // Refused, never guessed: the recorder tells two call sites apart by this.
+  throw new Error(`cannot tell which file called floorBreach:\n${stack}`);
+};
+
+export interface FloorOptions {
+  /** The recorded figures; read from `FLOORS_FILE` when judging, if absent. */
+  readonly floors?: Floors;
+  /**
+   * Where to record, `null` to judge. Absent means the environment decides
+   * (`RECORD_ENV`): a test of this module passes `null`, so a record run
+   * never mistakes its fixtures for real floors.
+   */
+  readonly record?: string | null;
+}
+
+/**
+ * Nothing when `actual` equals the figure recorded for `id`; otherwise the
+ * breach, naming the id, both numbers and what to do. In record mode it
+ * writes `{ id, actual, site }` and says nothing, so one run sees every floor.
+ * Something that is not a count is refused in both modes.
+ */
+export function floorBreach(
+  id: string,
+  actual: number,
+  options: FloorOptions = {},
+): string | undefined {
+  if (!Number.isInteger(actual) || actual < 0)
+    return `${id}: ${actual} is not a count`;
+  const record =
+    options.record === undefined
+      ? (process.env[RECORD_ENV] ?? null)
+      : options.record;
+  if (record !== null) {
+    const site = callSite(new Error().stack ?? '');
+    appendFileSync(record, JSON.stringify({ id, actual, site }) + '\n');
+    return undefined;
+  }
+  const measured = (options.floors ?? readFloors())[id];
+  if (measured === undefined)
+    return `${id} is not recorded in ${FLOORS_FILE}: run npm run floors:record`;
+  if (actual < measured)
+    return (
+      `${id}: read ${actual}, recorded ${measured}. The reader lost ` +
+      `${measured - actual}, or the corpus shrank: if it shrank, lower the ` +
+      `figure in ${FLOORS_FILE} by hand and say why in the commit.`
+    );
+  if (actual > measured)
+    return (
+      `${id}: read ${actual}, recorded ${measured}. The population grew by ` +
+      `${actual - measured}: run npm run floors:record, read what it moved, ` +
+      `and commit ${FLOORS_FILE}.`
+    );
+  return undefined;
+}
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index 875f402..8d86a47 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -1,6 +1,7 @@
 import { describe, it, expect } from 'vitest';
 import ts from 'typescript';
 import { readFileSync } from 'node:fs';
+import { floorBreach } from '../floors';
 import { filesUnder, searched } from '../source-files';
 import { withoutTsComments } from './source-text';
 import { bindFiles, callGraph, derivationOf, where } from './ast';
@@ -273,10 +274,12 @@ describe('absence assertions prove the population they searched', () => {
   // matching would report zero findings over zero absences -- and only one of
   // those is good news. This is the shape `event-collectors.test.ts` settled.
   it('finds the absence assertions it is meant to be judging', () => {
-    // Measured 262 TypeScript files under tests/ on 2026-10-03 (#446). Stated
-    // tight, so a reader that comes back one short fails.
-    expect(tsFiles.length).toBeGreaterThan(261);
-    // 394 today. The floor is stated against a measured figure rather
+    // Ratcheted (#468): exact against tests/floors.json, so one file short
+    // fails, and so does one more until it is recorded.
+    expect(
+      floorBreach('absence-liveness/ts-files', tsFiles.length),
+    ).toBeUndefined();
+    // The floor is stated against a measured figure rather
     // than left comfortably low, for the reason `anchored-presence`
     // records: a control with slack in it is most of the way back to
     // no control at all. #184 found it at 100 over a real 154, and showed
@@ -286,8 +289,11 @@ describe('absence assertions prove the population they searched', () => {
     // the same test green; F159's spellings brought the figure to 394,
     // and #446 measured 399 on 2026-10-03. Groups 2a and 2b added 22 the
     // same day and left it 22 slack, which is how a floor drifts: growth
-    // never fails it. Re-measured 421 at Group 3 (#446).
-    expect(result.sites.length).toBeGreaterThan(420);
+    // never fails it. Re-measured 421 at Group 3 (#446), and 424 an hour
+    // after that merged: so it is ratcheted now (#468), exact both ways.
+    expect(
+      floorBreach('absence-liveness/sites', result.sites.length),
+    ).toBeUndefined();
     expect(result.proved).toBeGreaterThan(0);
   });
 
@@ -409,10 +415,12 @@ describe('absence assertions prove the population they searched', () => {
     const plain = tsFiles.filter((file) =>
       PLAIN_ABSENCE.test(withoutTsComments(readFileSync(file, 'utf8'))),
     );
-    // Measured 113 files on 2026-10-03 (#446). Stated tight.
-    expect(plain.length).toBeGreaterThan(112);
     const unread = plain.filter((file) => !result.perFile.has(file));
     expect(searched(unread, { of: plain, what: 'files' })).toEqual([]);
+    // Ratcheted after the verdict (#468), so growth never hides a finding.
+    expect(
+      floorBreach('absence-liveness/plain-files', plain.length),
+    ).toBeUndefined();
   });
 
   it('finds none whose population could be empty without saying so', () => {
diff --git a/tests/unit/floors.test.ts b/tests/unit/floors.test.ts
new file mode 100644
index 0000000..7f4208d
--- /dev/null
+++ b/tests/unit/floors.test.ts
@@ -0,0 +1,212 @@
+import { describe, it, expect } from 'vitest';
+import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
+import { tmpdir } from 'node:os';
+import { join } from 'node:path';
+import { floorBreach, readFloors, FLOORS_FILE } from '../floors';
+import { searched } from '../source-files';
+import {
+  decideRecord,
+  describeMoves,
+  floorsText,
+} from '../../scripts/record-floors.mjs';
+
+/**
+ * The ratchet on guard liveness floors (#468): a floor is a recorded figure,
+ * checked for equality, so a reader that loses one unit fails AND a
+ * population that grew fails until the figure is recorded. Growth used to
+ * pass in silence: `absence-liveness` was set to `> 420` against a real 421
+ * in #467 and read 424 an hour after it merged.
+ */
+describe('floorBreach', () => {
+  const judging = { floors: { 'guard/units': 10 }, record: null };
+
+  it('says nothing when the reader saw exactly the recorded figure', () => {
+    expect(floorBreach('guard/units', 10, judging)).toBeUndefined();
+  });
+
+  it('names a reader that came back one short, and the hand edit a shrink needs', () => {
+    expect(floorBreach('guard/units', 9, judging)).toBe(
+      'guard/units: read 9, recorded 10. The reader lost 1, or the corpus ' +
+        'shrank: if it shrank, lower the figure in tests/floors.json by hand ' +
+        'and say why in the commit.',
+    );
+  });
+
+  it('names a population that grew, and the command that records it', () => {
+    expect(floorBreach('guard/units', 11, judging)).toBe(
+      'guard/units: read 11, recorded 10. The population grew by 1: run ' +
+        'npm run floors:record, read what it moved, and commit tests/floors.json.',
+    );
+  });
+
+  it('refuses an id nobody recorded', () => {
+    expect(floorBreach('guard/other', 10, judging)).toBe(
+      'guard/other is not recorded in tests/floors.json: run npm run floors:record',
+    );
+  });
+
+  it('names the file it reads the figures from', () => {
+    expect(FLOORS_FILE).toBe('tests/floors.json');
+  });
+
+  it.each([
+    ['a fraction', 9.5],
+    ['a negative', -1],
+    ['NaN', Number.NaN],
+    ['infinity', Number.POSITIVE_INFINITY],
+  ])('refuses %s as a count, recording or not', (_, actual) => {
+    const dir = mkdtempSync(join(tmpdir(), 'floors-'));
+    try {
+      const record = join(dir, 'seen.jsonl');
+      for (const mode of [null, record])
+        expect(
+          floorBreach('guard/units', actual, { ...judging, record: mode }),
+        ).toBe(`guard/units: ${actual} is not a count`);
+    } finally {
+      rmSync(dir, { recursive: true, force: true });
+    }
+  });
+
+  it('in record mode, writes what it saw and where, and lets the run go on', () => {
+    const dir = mkdtempSync(join(tmpdir(), 'floors-'));
+    try {
+      const record = join(dir, 'seen.jsonl');
+      expect(
+        floorBreach('guard/units', 12, { ...judging, record }),
+      ).toBeUndefined();
+      expect(
+        floorBreach('guard/new', 3, { ...judging, record }),
+      ).toBeUndefined();
+      const lines = readFileSync(record, 'utf8')
+        .trimEnd()
+        .split('\n')
+        .map((line) => JSON.parse(line) as Record<string, unknown>);
+      expect(lines.map(({ id, actual }) => [id, actual])).toEqual([
+        ['guard/units', 12],
+        ['guard/new', 3],
+      ]);
+      for (const { site } of lines)
+        expect(site).toMatch(/^tests\/unit\/floors\.test\.ts:\d+$/);
+    } finally {
+      rmSync(dir, { recursive: true, force: true });
+    }
+  });
+
+  it('reads the recorded figures as whole numbers keyed by id', () => {
+    const recorded = Object.entries(readFloors());
+    const malformed = recorded
+      .filter(
+        ([id, measured]) =>
+          !/^[a-z0-9-]+(\/[a-z0-9-]+)+$/.test(id) ||
+          !Number.isInteger(measured) ||
+          measured < 0,
+      )
+      .map(([id]) => id);
+    expect(
+      searched(malformed, {
+        of: recorded.map(([id]) => id),
+        what: `ids in ${FLOORS_FILE}`,
+      }),
+    ).toEqual([]);
+  });
+});
+
+describe('decideRecord', () => {
+  const at = (id: string, actual: number, site = 'tests/unit/a.test.ts:1') => ({
+    id,
+    actual,
+    site,
+  });
+
+  it('keeps every figure the run saw unchanged', () => {
+    expect(decideRecord({ 'a/b': 4 }, [at('a/b', 4)])).toEqual({
+      next: { 'a/b': 4 },
+      refusals: [],
+    });
+  });
+
+  it('raises a figure that grew and adds an id seen for the first time', () => {
+    expect(
+      decideRecord({ 'a/b': 4 }, [at('a/b', 6), at('c/d', 2, 'x.ts:9')]),
+    ).toEqual({ next: { 'a/b': 6, 'c/d': 2 }, refusals: [] });
+  });
+
+  it('never lowers a figure: a fall is a blind reader until a person says otherwise', () => {
+    const { refusals } = decideRecord({ 'a/b': 4, 'c/d': 1 }, [
+      at('a/b', 3),
+      at('c/d', 2, 'x.ts:9'),
+    ]);
+    expect(refusals).toHaveLength(1);
+    expect(refusals[0]).toContain('a/b');
+    expect(refusals[0]).toContain('would fall from 4 to 3');
+  });
+
+  it('refuses a recorded id the run never asserted', () => {
+    const { refusals } = decideRecord({ 'a/b': 4, 'gone/x': 7 }, [
+      at('a/b', 4),
+    ]);
+    expect(refusals).toHaveLength(1);
+    expect(refusals[0]).toContain('gone/x');
+    expect(refusals[0]).toContain('no test asserted it');
+  });
+
+  it('refuses an id asserted from two places', () => {
+    const { refusals } = decideRecord({}, [
+      at('a/b', 4, 'tests/unit/a.test.ts:1'),
+      at('a/b', 4, 'tests/unit/b.test.ts:2'),
+    ]);
+    expect(refusals).toHaveLength(1);
+    expect(refusals[0]).toContain('a/b');
+    expect(refusals[0]).toContain('tests/unit/a.test.ts:1');
+    expect(refusals[0]).toContain('tests/unit/b.test.ts:2');
+  });
+
+  it('refuses an id that read two different values', () => {
+    const { refusals } = decideRecord({}, [at('a/b', 4), at('a/b', 5)]);
+    expect(refusals).toHaveLength(1);
+    expect(refusals[0]).toContain('a/b');
+    expect(refusals[0]).toContain('4, 5');
+  });
+
+  it('accepts one id read twice from one place with one value', () => {
+    expect(decideRecord({}, [at('a/b', 4), at('a/b', 4)])).toEqual({
+      next: { 'a/b': 4 },
+      refusals: [],
+    });
+  });
+
+  it('reports every refusal at once, not the first', () => {
+    const { refusals } = decideRecord({ 'a/b': 4, 'gone/x': 1 }, [
+      at('a/b', 3),
+      at('c/d', 1),
+      at('c/d', 2),
+    ]);
+    expect(refusals).toHaveLength(3);
+  });
+});
+
+describe('describeMoves', () => {
+  it('says nothing when no figure moved', () => {
+    expect(describeMoves({ 'a/b': 4 }, { 'a/b': 4 })).toEqual([]);
+  });
+
+  it('prints every figure that moved, its delta, largest first, so a raise is read', () => {
+    // A change that adds five units and quietly loses three records +2 and
+    // nothing goes red; only a person reading the delta against the diff
+    // can see it, so the recorder shows each one (operator, 2026-10-03).
+    expect(
+      describeMoves(
+        { 'a/b': 4, 'c/d': 100, 'e/f': 7 },
+        { 'a/b': 6, 'c/d': 125, 'e/f': 7, 'g/h': 3 },
+      ),
+    ).toEqual(['c/d: 100 -> 125 (+25)', 'g/h: new, 3', 'a/b: 4 -> 6 (+2)']);
+  });
+});
+
+describe('floorsText', () => {
+  it('writes ids sorted, two-space indented, with a final newline', () => {
+    expect(floorsText({ 'z/a': 2, 'a/z': 1 })).toBe(
+      '{\n  "a/z": 1,\n  "z/a": 2\n}\n',
+    );
+  });
+});
diff --git a/tests/unit/script-entry.test.ts b/tests/unit/script-entry.test.ts
index 1559a83..c894f86 100644
--- a/tests/unit/script-entry.test.ts
+++ b/tests/unit/script-entry.test.ts
@@ -709,6 +709,14 @@ const PROBES: Readonly<Record<string, Probe>> = {
     status: 2,
     says: 'usage: build-release-content.mjs',
   },
+  // CI never records the guards' floors, so under CI it refuses before it
+  // runs anything (#468).
+  'record-floors.mjs': {
+    args: [],
+    env: { CI: 'true' },
+    status: 1,
+    says: 'CI never records floors',
+  },
 };
 
 const runAsScript = (script: string, probe: Probe) => {
~~~~

## Task 2: Every unit liveness floor ratcheted, and the literal-floor meta-guard

The reader was written test-first (20 RED against a stub), then run over `tests/` to derive the population: 78 floors demanding two or more, 59 in the unit suite (43 to ratchet, 16 product values), 19 outside it (12 product values, 7 for Group 5). Converted by an AST script that asserted every edit applied; 16 moved below their verdict. Comparison floors were planted RED (5) after the stale-comment sweep found `evidence-recording`'s. New files were `git add -N`ed before recording, so the tracked-file guards saw them. Every first figure was read against the census at `4d07565`.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 981c8ea..da48692 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,5 +1,58 @@
 {
-  "absence-liveness/plain-files": 114,
-  "absence-liveness/sites": 426,
-  "absence-liveness/ts-files": 264
+  "absence-liveness/plain-files": 115,
+  "absence-liveness/sites": 433,
+  "absence-liveness/ts-files": 266,
+  "anchored-presence/scanned": 76,
+  "anchored-presence/ts-files": 266,
+  "back-translate/translated-id": 262,
+  "back-translate/translated-th": 261,
+  "back-translate/translated-vi": 261,
+  "back-translate/translated-zh": 261,
+  "capture-after-assertion/captures": 143,
+  "deprecated-css/declarations": 1170,
+  "device-tool-homes/files": 299,
+  "download-readers/byte-reads": 8,
+  "duplicate-imports/imports": 1573,
+  "duplication/declarations": 5342,
+  "duplication/files": 343,
+  "event-collectors/locator-loops": 8,
+  "event-collectors/specs": 65,
+  "evidence-recording/acting-specs": 26,
+  "evidence-recording/declaring-specs": 26,
+  "evidence-recording/specs": 43,
+  "evidence-recording/still-specs": 17,
+  "excluded-by-design/built-patterns": 2,
+  "git-env/child-tests-passed": 24,
+  "install-scripts/packages": 3,
+  "isolated-context-tagging/tests": 639,
+  "literal-floors/sites": 198,
+  "no-dated-render/views": 46,
+  "one-home/files": 299,
+  "one-test-per-case/tests": 639,
+  "parked-tests/declarations": 772,
+  "pipeline-wiring/dev-sanity-tests": 15,
+  "pipeline-wiring/e2e-shards": 8,
+  "pipeline-wiring/launched-configs": 2,
+  "pipeline-wiring/prod-sanity-tests": 8,
+  "pipeline-wiring/sanity-import-walk": 17,
+  "pipeline-wiring/visual-summary-writes": 2,
+  "pipeline-wiring/workflow-file-refs": 19,
+  "pipeline-wiring/workflows-read-for-an-image": 10,
+  "pipeline-wiring/workflows-read-for-an-install": 10,
+  "release-inventory/capture-lines": 79,
+  "release-inventory/helper-modules": 60,
+  "route-coverage/gate-specs": 3,
+  "script-entry/argv-reads": 10,
+  "script-entry/load-time-statements": 319,
+  "shytalk-brand/files": 333,
+  "site-pages/pages": 3,
+  "sitemap-config/locales": 5,
+  "source-files/specs": 48,
+  "source-files/specs-through-empty-dirs": 48,
+  "spec-dirs/dirs": 5,
+  "supply-chain/external-uses": 38,
+  "tokens/dark-blocks": 2,
+  "typecheck-scope/scripts": 30,
+  "viewport-tagging/declarations": 772,
+  "wcag/files": 344
 }
diff --git a/tests/literal-floors.ts b/tests/literal-floors.ts
new file mode 100644
index 0000000..0ea443e
--- /dev/null
+++ b/tests/literal-floors.ts
@@ -0,0 +1,265 @@
+import ts from 'typescript';
+
+/**
+ * How a `toBeGreaterThan(OrEqual)` bound is written (#468).
+ *
+ * A liveness floor written as a literal is tight only on the day it is
+ * measured: growth never fails it, so `absence-liveness` sat 22 under its real
+ * count within a day, and 3 under it an hour after it was re-measured. Every
+ * floor that demands two or more therefore goes through the ratchet in
+ * `tests/floors.ts`, or is a product value with its reason written down
+ * (`literal-floors.test.ts`). This reader finds them however they are written:
+ *
+ * - `presence`: the bound demands at most one (`> 0`, `>= 1`), which is what
+ *   `searched()` already demands of every population;
+ * - `counted`: a whole-number literal demanding two or more, the shape every
+ *   drifted floor had;
+ * - `forwarded`: the bound is a parameter of an enclosing function, or a
+ *   property of one, so the number lives at the call site (`spec-scan.ts`'s
+ *   `liveness.moreThan` was this, and no literal search could see it);
+ * - `compared`: a value computed in place (`prod > dev`, an index order);
+ * - `threshold`: a fractional literal, a bound on a measure (a contrast of
+ *   4.5), which is never a count;
+ * - `ceiling`: negated, so it bounds from above and is no floor.
+ */
+export type FloorKind =
+  'presence' | 'counted' | 'forwarded' | 'compared' | 'threshold' | 'ceiling';
+
+export interface FloorSite {
+  /** 1-based line of the `expect`, for a human to open. */
+  readonly line: number;
+  readonly kind: FloorKind;
+  /** The least value a `counted` or `presence` floor accepts. */
+  readonly demands?: number;
+  /** The `expect(...)` argument, whitespace collapsed. */
+  readonly subject: string;
+  /**
+   * Set when the floor is a comparison written inside the `expect(...)`
+   * argument (`expect(n > 25).toBe(true)`) rather than a matcher.
+   */
+  readonly form?: 'comparison';
+}
+
+export interface FloorReading {
+  readonly sites: readonly FloorSite[];
+  /** Every matcher the reader could not classify, by line and why. */
+  readonly refused: readonly string[];
+}
+
+const MATCHERS = new Set(['toBeGreaterThan', 'toBeGreaterThanOrEqual']);
+
+/** `expect`, `expect.soft` and `expect.poll`: the roots this repo asserts from. */
+const isExpectRoot = (callee: ts.Expression): boolean =>
+  (ts.isIdentifier(callee) && callee.text === 'expect') ||
+  (ts.isPropertyAccessExpression(callee) &&
+    ts.isIdentifier(callee.expression) &&
+    callee.expression.text === 'expect' &&
+    (callee.name.text === 'soft' || callee.name.text === 'poll'));
+
+const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
+
+/**
+ * The `expect(...)` call a matcher hangs from, through `.not`, `.resolves`
+ * and `.rejects`, and whether an odd number of `.not`s negate it. `root` is
+ * the call that is not an expect root, when the chain ends somewhere else.
+ */
+function chainOf(target: ts.Expression): {
+  readonly expectCall?: ts.CallExpression;
+  readonly negated: boolean;
+  readonly root: string;
+} {
+  let node = target;
+  let negated = false;
+  for (;;) {
+    if (ts.isPropertyAccessExpression(node)) {
+      if (node.name.text === 'not') negated = !negated;
+      node = node.expression;
+    } else if (
+      ts.isParenthesizedExpression(node) ||
+      ts.isAwaitExpression(node)
+    ) {
+      node = node.expression;
+    } else if (ts.isCallExpression(node) && isExpectRoot(node.expression)) {
+      return { expectCall: node, negated, root: node.expression.getText() };
+    } else {
+      const root = ts.isCallExpression(node) ? node.expression : node;
+      return { negated, root: collapse(root.getText()) };
+    }
+  }
+}
+
+/** The names a parameter binds, through destructuring. */
+function boundNames(name: ts.BindingName): string[] {
+  if (ts.isIdentifier(name)) return [name.text];
+  return name.elements.flatMap((element) =>
+    ts.isOmittedExpression(element) ? [] : boundNames(element.name),
+  );
+}
+
+/** The identifier a bound is read from: `liveness` in `liveness.moreThan`. */
+function rootIdentifier(node: ts.Expression): ts.Identifier | undefined {
+  let current = node;
+  while (
+    ts.isPropertyAccessExpression(current) ||
+    ts.isElementAccessExpression(current) ||
+    ts.isParenthesizedExpression(current)
+  )
+    current = current.expression;
+  return ts.isIdentifier(current) ? current : undefined;
+}
+
+/** True when `name` is a parameter of a function enclosing `node`. */
+function isParameter(node: ts.Node, name: string): boolean {
+  for (let scope = node.parent; scope; scope = scope.parent)
+    if (
+      ts.isFunctionLike(scope) &&
+      scope.parameters.some((parameter) =>
+        boundNames(parameter.name).includes(name),
+      )
+    )
+      return true;
+  return false;
+}
+
+/** The number a literal bound spells, signed, or undefined if it is none. */
+function literalValue(bound: ts.Expression): number | undefined {
+  if (ts.isParenthesizedExpression(bound))
+    return literalValue(bound.expression);
+  if (ts.isNumericLiteral(bound)) return Number(bound.text.replace(/_/g, ''));
+  if (
+    ts.isPrefixUnaryExpression(bound) &&
+    bound.operator === ts.SyntaxKind.MinusToken
+  ) {
+    const value = literalValue(bound.operand);
+    return value === undefined ? undefined : -value;
+  }
+  return undefined;
+}
+
+const COMPARISONS = new Map([
+  [ts.SyntaxKind.GreaterThanToken, '>'],
+  [ts.SyntaxKind.GreaterThanEqualsToken, '>='],
+  [ts.SyntaxKind.LessThanToken, '<'],
+  [ts.SyntaxKind.LessThanEqualsToken, '<='],
+]);
+
+/** The same comparison read from the other side: `25 < n` is `n > 25`. */
+const FLIPPED: Readonly<Record<string, string>> = {
+  '>': '<',
+  '>=': '<=',
+  '<': '>',
+  '<=': '>=',
+};
+
+/**
+ * The floors written as a comparison with a literal inside an `expect(...)`
+ * argument, `n > 25` or `25 < n`, outside any callback the argument holds:
+ * a `filter((r) => r.length > 3)` is a predicate, not a floor.
+ */
+function comparisonsIn(
+  sf: ts.SourceFile,
+  argument: ts.Expression,
+): FloorSite[] {
+  const found: FloorSite[] = [];
+  const visit = (node: ts.Node): void => {
+    if (ts.isFunctionLike(node)) return;
+    const operator = ts.isBinaryExpression(node)
+      ? COMPARISONS.get(node.operatorToken.kind)
+      : undefined;
+    if (operator && ts.isBinaryExpression(node)) {
+      const right = literalValue(node.right);
+      const left = literalValue(node.left);
+      // Normalised to `subject op bound`: `25 < n` is `n > 25`.
+      const [subject, bound, op] =
+        right !== undefined
+          ? [node.left, right, operator]
+          : left !== undefined
+            ? [node.right, left, FLIPPED[operator]]
+            : [undefined, undefined, operator];
+      if (subject && bound !== undefined) {
+        const line =
+          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
+        const text = collapse(subject.getText(sf));
+        if (op.startsWith('<'))
+          found.push({
+            line,
+            kind: 'ceiling',
+            subject: text,
+            form: 'comparison',
+          });
+        else if (!Number.isInteger(bound))
+          found.push({
+            line,
+            kind: 'threshold',
+            subject: text,
+            form: 'comparison',
+          });
+        else {
+          const demands = op === '>' ? bound + 1 : bound;
+          found.push({
+            line,
+            kind: demands >= 2 ? 'counted' : 'presence',
+            demands,
+            subject: text,
+            form: 'comparison',
+          });
+        }
+      }
+    }
+    ts.forEachChild(node, visit);
+  };
+  visit(argument);
+  return found;
+}
+
+export function floorSitesIn(sf: ts.SourceFile): FloorReading {
+  const sites: FloorSite[] = [];
+  const refused: string[] = [];
+  const visit = (node: ts.Node): void => {
+    if (ts.isCallExpression(node) && isExpectRoot(node.expression))
+      for (const argument of node.arguments)
+        sites.push(...comparisonsIn(sf, argument));
+    if (
+      ts.isCallExpression(node) &&
+      ts.isPropertyAccessExpression(node.expression) &&
+      MATCHERS.has(node.expression.name.text)
+    ) {
+      const matcher = node.expression.name.text;
+      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
+      const at = `${sf.fileName}:${line}`;
+      const chain = chainOf(node.expression.expression);
+      const [bound, ...rest] = node.arguments;
+      if (!chain.expectCall)
+        refused.push(
+          `${at}: ${matcher} on ${chain.root}, a root it cannot read`,
+        );
+      else if (!bound || rest.length > 0 || ts.isSpreadElement(bound))
+        refused.push(
+          `${at}: ${matcher} takes one bound, not ${node.arguments.length}`,
+        );
+      else {
+        const [first] = chain.expectCall.arguments;
+        const subject = first ? collapse(first.getText(sf)) : '';
+        const value = literalValue(bound);
+        const root = rootIdentifier(bound);
+        if (chain.negated) sites.push({ line, kind: 'ceiling', subject });
+        else if (value !== undefined && !Number.isInteger(value))
+          sites.push({ line, kind: 'threshold', subject });
+        else if (value !== undefined) {
+          const demands = matcher === 'toBeGreaterThan' ? value + 1 : value;
+          sites.push({
+            line,
+            kind: demands >= 2 ? 'counted' : 'presence',
+            demands,
+            subject,
+          });
+        } else if (root && isParameter(node, root.text))
+          sites.push({ line, kind: 'forwarded', subject });
+        else sites.push({ line, kind: 'compared', subject });
+      }
+    }
+    ts.forEachChild(node, visit);
+  };
+  visit(sf);
+  return { sites, refused };
+}
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index 8d86a47..265cad2 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -279,10 +279,9 @@ describe('absence assertions prove the population they searched', () => {
     expect(
       floorBreach('absence-liveness/ts-files', tsFiles.length),
     ).toBeUndefined();
-    // The floor is stated against a measured figure rather
-    // than left comfortably low, for the reason `anchored-presence`
-    // records: a control with slack in it is most of the way back to
-    // no control at all. #184 found it at 100 over a real 154, and showed
+    // The figure is recorded exactly rather than left comfortably low, for
+    // the reason `anchored-presence` records: a control with slack in it is
+    // most of the way back to no control at all. #184 found it at 100 over a real 154, and showed
     // what that slack costs: with the `toHaveLength(0)` branch of
     // `absenceSubject` dead, this test stayed green. #390 F161 found it
     // there again, at 153 over a real 391, with the same branch dead and
diff --git a/tests/unit/anchored-presence.test.ts b/tests/unit/anchored-presence.test.ts
index 3c746a5..5808cdb 100644
--- a/tests/unit/anchored-presence.test.ts
+++ b/tests/unit/anchored-presence.test.ts
@@ -2,6 +2,7 @@ import { describe, it, expect } from 'vitest';
 import { filesUnder, searched } from '../source-files';
 import { bind, bindFiles, callGraph, type Closure } from './ast';
 import { scanPresence, type PresenceClosures } from './presence-detector';
+import { floorBreach } from '../floors';
 /**
  * A presence assertion over source text must be STRIPPED or ANCHORED.
  *
@@ -281,25 +282,26 @@ describe('presence assertions over source text are stripped or anchored', () =>
   // stopped matching would report zero findings and zero scanned, and only
   // one of those is good news. `event-collectors.test.ts` settled this shape.
   it('scans the presence assertions that actually read source text', () => {
-    // 76 today, and the figure is worth stating: the floor sat at 20 while
-    // the truth was 27, so a control with that much slack in it is most of
-    // the way back to no control at all. #118 moved the number twice --
-    // UP as the derivation learned to follow local bindings to a fixed
-    // point, then back DOWN as it stopped reading object-literal keys and
-    // parameter names as references. Both were corrections, not drift.
-    // #184 found this comment still saying 28 over a real 42, and moved the
-    // figure to 45: resolving names by scope brought in three assertions a
-    // file-wide map had been sending to another test's declaration. #225
-    // measured 46 (the suite had grown by one under a floor of 44) and moved
-    // it to 48: two `evidence-page` assertions a helper's `JSON.stringify`
-    // had been exempting as parsed. #390 found 77 under that floor of 47,
-    // the suite having grown with nobody moving it, and set it to the 77.
-    // #454 took one away on purpose: a text check on visual.mjs's import
-    // became a check of the image it uses, so 76.
-    expect(result.scanned).toBeGreaterThan(75);
-    // Measured 262 TypeScript files under tests/ on 2026-10-03 (#446). Stated
-    // tight, so a reader that comes back one short fails.
-    expect(tsFiles.length).toBeGreaterThan(261);
+    // 76 today, and the figure is worth stating: the floor sat at 20 while the
+    // truth was 27, so a control with that much slack in it is most of the way
+    // back to no control at all. #118 moved the number twice -- UP as the
+    // derivation learned to follow local bindings to a fixed point, then back
+    // DOWN as it stopped reading object-literal keys and parameter names as
+    // references. Both were corrections, not drift. #184 found this comment
+    // still saying 28 over a real 42, and moved the figure to 45: resolving
+    // names by scope brought in three assertions a file-wide map had been
+    // sending to another test's declaration. #225 measured 46 (the suite had
+    // grown by one under a floor of 44) and moved it to 48: two `evidence-page`
+    // assertions a helper's `JSON.stringify` had been exempting as parsed. #390
+    // found 77 under that floor of 47, the suite having grown with nobody
+    // moving it, and set it to the 77. #454 took one away on purpose: a text
+    // check on visual.mjs's import became a check of the image it uses, so 76.
+    expect(
+      floorBreach('anchored-presence/scanned', result.scanned),
+    ).toBeUndefined();
+    expect(
+      floorBreach('anchored-presence/ts-files', tsFiles.length),
+    ).toBeUndefined();
   });
 
   it('finds none reading raw source with an unanchored matcher', () => {
diff --git a/tests/unit/back-translate.test.ts b/tests/unit/back-translate.test.ts
index 2cb049e..4a9ba3e 100644
--- a/tests/unit/back-translate.test.ts
+++ b/tests/unit/back-translate.test.ts
@@ -34,6 +34,7 @@ import {
   type Comparison,
   type EngineLanguage,
 } from '../../src/lib/i18n/back-translate';
+import { floorBreach } from '../floors';
 
 /**
  * #95. The back-translation gate, minus the engine.
@@ -239,6 +240,17 @@ const CATALOGUES = { id, zh, vi, th } satisfies Record<
 >;
 const TRANSLATED = Object.keys(CATALOGUES) as Array<keyof typeof CATALOGUES>;
 
+/**
+ * Each locale's count of translated entries, ratcheted (#468). Keyed by the
+ * catalogue, so a locale added without a floor fails to compile.
+ */
+const TRANSLATED_FLOOR: Readonly<Record<keyof typeof CATALOGUES, string>> = {
+  id: 'back-translate/translated-id',
+  zh: 'back-translate/translated-zh',
+  vi: 'back-translate/translated-vi',
+  th: 'back-translate/translated-th',
+};
+
 /** The CSV vocabulary without its `sex` letters, which the roster rows read back. */
 const csvCopy = (locale: Locale) =>
   Object.fromEntries(
@@ -299,13 +311,12 @@ describe('backTranslationUnits: every catalogue the site ships', () => {
           key.replace(/ \[[^\]]*\]$/, ''),
         ),
       );
-      // Measured 261 translated entries in zh, vi and th, the fewest of the
-      // four (id has 262) on 2026-10-03 (#446). Stated tight, so a reader that
-      // comes back one short fails.
-      expect(expected.size, `${locale} translated nothing`).toBeGreaterThan(
-        260,
-      );
       expect([...read].sort(), locale).toEqual([...expected].sort());
+      // After the verdict, so a population that grew never hides a finding.
+      expect(
+        floorBreach(TRANSLATED_FLOOR[locale], expected.size),
+        `${locale}: not the recorded count of translated entries`,
+      ).toBeUndefined();
     }
   });
 
diff --git a/tests/unit/capture-after-assertion.test.ts b/tests/unit/capture-after-assertion.test.ts
index 5377a7b..02e1b62 100644
--- a/tests/unit/capture-after-assertion.test.ts
+++ b/tests/unit/capture-after-assertion.test.ts
@@ -170,11 +170,9 @@ describe('capturesBeforeAssertion -- the scan proven on synthetic input', () =>
 
 describe('an evidence capture documents an assertion that already passed', () => {
   it('never runs before the assertion it claims to document', () => {
-    // Measured 143 captures on 2026-10-03 (#446). Stated tight, so a reader
-    // that comes back one short fails.
     expectNothingFound(capturesBeforeAssertion, {
       what: 'evidence captures',
-      moreThan: 142,
+      floor: 'capture-after-assertion/captures',
       carries: callsShoot,
     });
   });
diff --git a/tests/unit/deprecated-css.test.ts b/tests/unit/deprecated-css.test.ts
index 08acbac..1612cd2 100644
--- a/tests/unit/deprecated-css.test.ts
+++ b/tests/unit/deprecated-css.test.ts
@@ -2,6 +2,7 @@ import { readFileSync } from 'node:fs';
 import { describe, expect, it } from 'vitest';
 import { filesUnder, searched } from '../source-files';
 import { stylesheetCss } from './source-text';
+import { floorBreach } from '../floors';
 
 /**
  * CSS Masking deprecates `clip` in favour of `clip-path`, and a deprecated
@@ -110,12 +111,7 @@ describe('no stylesheet declares the deprecated clip property (#200)', () => {
   });
 
   it('reads every declaration the stylesheets hold, and as many as there are', () => {
-    // Measured 1170 declarations on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
     const sheets = stylesheetsUnder('src');
-    expect(
-      sheets.flatMap(({ css }) => declarationsIn(css)).length,
-    ).toBeGreaterThan(1169);
     // Read as text, independently of either reader: a file holding a
     // `<style>` tag or a stylesheet's rule that yields no declaration is a
     // form one of them has gone blind to.
@@ -134,6 +130,13 @@ describe('no stylesheet declares the deprecated clip property (#200)', () => {
         what: 'stylesheets and components under src/',
       }),
     ).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach(
+        'deprecated-css/declarations',
+        sheets.flatMap(({ css }) => declarationsIn(css)).length,
+      ),
+    ).toBeUndefined();
   });
 
   it.each([
diff --git a/tests/unit/device-tool-homes.test.ts b/tests/unit/device-tool-homes.test.ts
index 7c74ce5..71bb6ad 100644
--- a/tests/unit/device-tool-homes.test.ts
+++ b/tests/unit/device-tool-homes.test.ts
@@ -2,6 +2,7 @@ import { readFileSync } from 'node:fs';
 import { describe, expect, it } from 'vitest';
 import { filesUnder, searched } from '../source-files';
 import { withoutTsComments } from './source-text';
+import { floorBreach } from '../floors';
 
 /**
  * Each command-line tool the device leg drives is spawned from one home, which
@@ -73,10 +74,9 @@ describe.each(HOMES)('no file spawns $tool but $home', ({ tool, home }) => {
   });
 
   it('reads every file under tests/ and scripts/, and as many as there are', () => {
-    // Measured 294 files on 2026-10-03 (#446). Stated tight, so a walk that
-    // comes back one short fails, and the home is among them, so a walk that
-    // loses scripts/ fails too.
-    expect(files.length).toBeGreaterThan(293);
+    expect(
+      floorBreach('device-tool-homes/files', files.length),
+    ).toBeUndefined();
     expect(files).toContain(home);
   });
 
diff --git a/tests/unit/download-readers.test.ts b/tests/unit/download-readers.test.ts
index 71c9156..a2be3eb 100644
--- a/tests/unit/download-readers.test.ts
+++ b/tests/unit/download-readers.test.ts
@@ -83,11 +83,10 @@ describe('a download’s bytes are read only through downloadText', () => {
     // Guards the guard: a scan that found no reads at all -- because the
     // helper was renamed, or `tests/e2e` moved -- would otherwise report a
     // clean sweep it never performed. Counted in reads, not in the files that
-    // hold them: measured 8 on 2026-10-03 (#446), and stated tight, so a
-    // reader that comes back one short fails.
+    // hold them, and ratcheted (#468).
     expectNothingFound(read, {
       what: 'download byte reads',
-      moreThan: 7,
+      floor: 'download-readers/byte-reads',
       carries: (_file, source) => BYTE_READ.test(withoutTsComments(source)),
     });
   });
diff --git a/tests/unit/duplicate-imports.test.ts b/tests/unit/duplicate-imports.test.ts
index a84860f..52b8db3 100644
--- a/tests/unit/duplicate-imports.test.ts
+++ b/tests/unit/duplicate-imports.test.ts
@@ -4,6 +4,7 @@ import { describe, expect, it } from 'vitest';
 import { filesUnder, searched } from '../source-files';
 import { parseSource } from './ast';
 import { astroCodeViews, withoutTsComments } from './source-text';
+import { floorBreach } from '../floors';
 
 /**
  * No module imports the same specifier twice (#390 F59).
@@ -192,10 +193,7 @@ describe('no source imports one module twice (#390 F59)', () => {
   });
 
   it('reads every import the sources declare, and as many as there are', () => {
-    // Measured 1512 imports on 2026-10-03 (#446). Stated tight, so a reader
-    // that comes back one short fails.
     const sources = scan();
-    expect(sources.flatMap(({ read }) => read).length).toBeGreaterThan(1511);
     const unread = sources
       .filter(
         ({ path, text, read }) =>
@@ -206,5 +204,12 @@ describe('no source imports one module twice (#390 F59)', () => {
       )
       .map(({ path }) => path);
     expect(searched(unread, { of: sources, what: 'source files' })).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach(
+        'duplicate-imports/imports',
+        sources.flatMap(({ read }) => read).length,
+      ),
+    ).toBeUndefined();
   });
 });
diff --git a/tests/unit/duplication.test.ts b/tests/unit/duplication.test.ts
index e0487d2..71729da 100644
--- a/tests/unit/duplication.test.ts
+++ b/tests/unit/duplication.test.ts
@@ -9,6 +9,7 @@ import {
   type DuplicatePair,
 } from './duplication';
 import { searched, trackedFiles } from '../source-files';
+import { floorBreach } from '../floors';
 
 /**
  * Every file a duplicate could live in, from git rather than a list.
@@ -107,14 +108,12 @@ const SEPARATE: ReadonlyMap<string, string> = new Map([
 describe('a function body has one home across files', () => {
   it('scans the whole tracked tree, not a list', () => {
     // Anti-vacuity: an empty scan satisfies every assertion below.
-    // Measured 338 files scanned on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(SCANNED.length).toBeGreaterThan(337);
+    expect(floorBreach('duplication/files', SCANNED.length)).toBeUndefined();
     expect(SCANNED).toContain('src/lib/grouping.ts');
     expect(SCANNED).toContain('scripts/test-devices.mjs');
-    // Measured 5198 declarations compared on 2026-10-03 (#446). Stated tight,
-    // so a reader that comes back one short fails.
-    expect(DECLARATIONS.length).toBeGreaterThan(5197);
+    expect(
+      floorBreach('duplication/declarations', DECLARATIONS.length),
+    ).toBeUndefined();
   });
 
   it('finds no cross-file duplicate that has not been given a verdict', () => {
diff --git a/tests/unit/event-collectors.test.ts b/tests/unit/event-collectors.test.ts
index 9644c8b..23ac411 100644
--- a/tests/unit/event-collectors.test.ts
+++ b/tests/unit/event-collectors.test.ts
@@ -11,6 +11,7 @@ import { specDirs } from '../spec-dirs';
 import { searched, tsFilesUnder } from '../source-files';
 import { parseSource } from './ast';
 import { withoutTsComments } from './source-text';
+import { floorBreach } from '../floors';
 
 /**
  * Browser events that exist only to be COLLECTED and asserted on later, as
@@ -59,9 +60,9 @@ describe('browser-event collectors have exactly one home', () => {
   it('scans every spec directory', () => {
     // Anti-vacuity: an empty scan satisfies the assertion below, which is the
     // very failure mode this ticket is about.
-    // Measured 65 e2e specs scanned on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(SCANNED.length).toBeGreaterThan(64);
+    expect(
+      floorBreach('event-collectors/specs', SCANNED.length),
+    ).toBeUndefined();
     expect(SCANNED).toContain('tests/e2e/classroom-groups.spec.ts');
     expect(SCANNED).toContain(RECORDERS);
   });
@@ -297,13 +298,13 @@ describe('a locator list cannot be looped unproved', () => {
   it('sees the loops it is scanning for', () => {
     // The detector's own liveness. Zero unproved loops means nothing if the
     // reader found zero loops.
-    // Measured 8 locator loops found on 2026-10-03 (#446), 7 before the
-    // spread form was read. Stated tight, so a reader that comes back one
-    // short fails.
     expect(
-      SCANNED.flatMap((path) => locatorLoops(readFileSync(path, 'utf8')))
-        .length,
-    ).toBeGreaterThan(7);
+      floorBreach(
+        'event-collectors/locator-loops',
+        SCANNED.flatMap((path) => locatorLoops(readFileSync(path, 'utf8')))
+          .length,
+      ),
+    ).toBeUndefined();
   });
 
   it('follows every .all() list it meets into a loop it can judge', () => {
diff --git a/tests/unit/evidence-recording.test.ts b/tests/unit/evidence-recording.test.ts
index d44241e..6bb806e 100644
--- a/tests/unit/evidence-recording.test.ts
+++ b/tests/unit/evidence-recording.test.ts
@@ -26,6 +26,7 @@ import {
   enclosingDeclaration,
   useCallsIn,
 } from '../playwright-declarations';
+import { floorBreach } from '../floors';
 
 const E2E = 'tests/e2e';
 const HOME = 'tests/e2e/evidence.ts';
@@ -294,12 +295,7 @@ describe('evidence recording is opt-in, and the opt-in is derived', () => {
   });
 
   it('reads every spec, and as many declarations as there are', () => {
-    // Measured 43 e2e specs on 2026-10-03 (#446), 26 of them declaring
-    // recorded. Stated tight, so a walk or a reader that comes back one short
-    // fails.
-    expect(SPECS.length).toBeGreaterThan(42);
     const declaring = SPECS.filter((path) => declaresRecorded(sourceOf(path)));
-    expect(declaring.length).toBeGreaterThan(25);
     // Cross-checked against the parse tree: a spec the compiler reads as
     // passing `recorded` to `test.use` is one the text scan reads as
     // declaring it, and the other way round, so neither reading has a form
@@ -314,6 +310,13 @@ describe('evidence recording is opt-in, and the opt-in is derived', () => {
         what: 'specs checked for a declaration',
       }),
     ).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach('evidence-recording/declaring-specs', declaring.length),
+    ).toBeUndefined();
+    expect(
+      floorBreach('evidence-recording/specs', SPECS.length),
+    ).toBeUndefined();
   });
 
   it.each([
@@ -360,14 +363,14 @@ describe('evidence recording is opt-in, and the opt-in is derived', () => {
   it('some specs really do act, and some really do not', () => {
     // The population control for the two direction guards above: if every
     // spec landed on one side, both would pass while asserting nothing.
-    // Measured 26 acting and 17 still on 2026-10-03 (#446). Stated tight, so
-    // a reader that moves one spec across fails.
+    // Both sides ratcheted in one expectation (#468), so a reader that moves
+    // one spec across reports both, and so does a side that grew.
     const acting = SPECS.filter((p) => actionsIn(sourceOf(p)).length > 0);
     const still = SPECS.filter((p) => actionsIn(sourceOf(p)).length === 0);
-    expect({ acting: acting.length > 25, still: still.length > 16 }).toEqual({
-      acting: true,
-      still: true,
-    });
+    expect({
+      acting: floorBreach('evidence-recording/acting-specs', acting.length),
+      still: floorBreach('evidence-recording/still-specs', still.length),
+    }).toEqual({ acting: undefined, still: undefined });
   });
 
   it('no journey in a recording spec records blank frames (#292)', () => {
diff --git a/tests/unit/excluded-by-design.test.ts b/tests/unit/excluded-by-design.test.ts
index e3c7860..018b451 100644
--- a/tests/unit/excluded-by-design.test.ts
+++ b/tests/unit/excluded-by-design.test.ts
@@ -4,6 +4,7 @@ import { resolve } from 'node:path';
 import ts from 'typescript';
 import { parseSource } from './ast';
 import { searched } from '../source-files';
+import { floorBreach } from '../floors';
 
 /**
  * The device gauntlet reports how many tests `android-chrome` excludes by design, by LISTING the
@@ -97,8 +98,8 @@ describe('the gauntlet’s by-design count selects exactly what android-chrome e
               span.expression.text === CONSTANT,
           ),
       );
-    // Measured 2 built --grep patterns on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(built.length).toBeGreaterThan(1);
+    expect(
+      floorBreach('excluded-by-design/built-patterns', built.length),
+    ).toBeUndefined();
   });
 });
diff --git a/tests/unit/git-env.test.ts b/tests/unit/git-env.test.ts
index 7dc909d..eb96b73 100644
--- a/tests/unit/git-env.test.ts
+++ b/tests/unit/git-env.test.ts
@@ -6,6 +6,7 @@ import { join, relative, sep } from 'node:path';
 import { describe, expect, it } from 'vitest';
 import { localGitVars, scratchGit, withoutLocalGit } from '../git-env';
 import { filesUnder, searched } from '../source-files';
+import { floorBreach } from '../floors';
 
 /**
  * A unit run cannot act on the repository git hands it (#377).
@@ -181,10 +182,9 @@ describe('a repository named by a hostile GIT_DIR (#377)', () => {
         join(sentinel, 'child-run.json'),
       );
       expect(report.numFailedTests, stderr).toBe(0);
-      // Measured 18 tests in release-inventory.test.ts, the file the child run
-      // executes on 2026-10-03 (#446). Stated tight, so a reader that comes
-      // back one short fails.
-      expect(report.numPassedTests).toBeGreaterThan(17);
+      expect(
+        floorBreach('git-env/child-tests-passed', report.numPassedTests),
+      ).toBeUndefined();
       expect(fingerprint(sentinel)).toEqual(before);
     } finally {
       rmSync(sentinel, { recursive: true, force: true });
diff --git a/tests/unit/install-scripts.test.ts b/tests/unit/install-scripts.test.ts
index 4c2ce50..3430e2d 100644
--- a/tests/unit/install-scripts.test.ts
+++ b/tests/unit/install-scripts.test.ts
@@ -1,6 +1,7 @@
 import { describe, it, expect } from 'vitest';
 import { readFileSync } from 'node:fs';
 import { searched } from '../source-files';
+import { floorBreach } from '../floors';
 
 /**
  * Which dependencies are allowed to EXECUTE CODE when they install.
@@ -81,22 +82,22 @@ const allowScripts = (): Record<string, boolean> =>
 
 describe('the install-script allowlist', () => {
   it('has something to protect', () => {
-    // Without this, the equality below is VACUOUS in the one case that
-    // matters: if the lockfile stopped reporting install scripts, the derived
-    // set and an empty `allowScripts` would agree, and a suite asserting
-    // nothing would go green. This repo has shipped two guards that passed
-    // because both sides were empty or both were satisfied by prose.
-    //
-    // If a dependency change genuinely leaves NO package running install
-    // scripts, this failure is the prompt to confirm that and delete the
-    // suite deliberately — not to weaken the assertion.
-    // Measured 3 installed packages with an install script on 2026-10-03
-    // (#446). Stated tight, so a reader that comes back one short fails.
+    // Without this, the equality below is VACUOUS in the one case that matters:
+    // if the lockfile stopped reporting install scripts, the derived set and an
+    // empty `allowScripts` would agree, and a suite asserting nothing would go
+    // green. This repo has shipped two guards that passed because both sides
+    // were empty or both were satisfied by prose. If a dependency change
+    // genuinely leaves NO package running install scripts, this failure is the
+    // prompt to confirm that and delete the suite deliberately — not to weaken
+    // the assertion.
     expect(
-      packagesWithInstallScripts().length,
+      floorBreach(
+        'install-scripts/packages',
+        packagesWithInstallScripts().length,
+      ),
       'no package in package-lock.json declares an install script — either ' +
         'the lockfile is not v3, or this control is no longer needed',
-    ).toBeGreaterThan(2);
+    ).toBeUndefined();
   });
 
   it('approves exactly the packages that run install scripts, and no others', () => {
diff --git a/tests/unit/isolated-context-tagging.test.ts b/tests/unit/isolated-context-tagging.test.ts
index 6be297f..c533c63 100644
--- a/tests/unit/isolated-context-tagging.test.ts
+++ b/tests/unit/isolated-context-tagging.test.ts
@@ -189,9 +189,10 @@ const analyze = (file: string, text: string): readonly string[] =>
 
 describe('a real device has one browser context', () => {
   it('every test run without JavaScript, or calling newContext(), is tagged @requires-isolated-context, and no tag is stale', () => {
-    // Measured 638 tests read on 2026-10-03, the same 638 one-test-per-case
-    // reads (#446). Stated tight, so a reader that comes back one short fails.
-    expectNothingFound(read, declarationsRead('tests read', 637));
+    expectNothingFound(
+      read,
+      declarationsRead('tests read', 'isolated-context-tagging/tests'),
+    );
   });
 });
 
diff --git a/tests/unit/literal-floors.test.ts b/tests/unit/literal-floors.test.ts
new file mode 100644
index 0000000..22c794f
--- /dev/null
+++ b/tests/unit/literal-floors.test.ts
@@ -0,0 +1,357 @@
+import { describe, it, expect } from 'vitest';
+import { readFileSync } from 'node:fs';
+import ts from 'typescript';
+import { floorBreach, readFloors } from '../floors';
+import { floorSitesIn } from '../literal-floors';
+import { searched, tsFilesUnder } from '../source-files';
+import { parseFile, parseSource, stringTextsIn } from './ast';
+import { withoutTsComments } from './source-text';
+
+/**
+ * A liveness floor written as a literal is tight only on the day it is
+ * measured (#468), so every floor demanding two or more goes through the
+ * ratchet in `tests/floors.ts`, or carries a reason it is a product value.
+ * This reader finds them, however they are written.
+ */
+const read = (source: string) =>
+  floorSitesIn(parseSource(source, 'fixture.test.ts'));
+
+describe('floorSitesIn', () => {
+  // Planted by hand, one per way this repository writes a floor. Generated
+  // from the reader's own list, a dropped form would vanish from both sides
+  // (#446 Group 2b, PW6).
+  it.each([
+    ['a literal', 'expect(a.length).toBeGreaterThan(41);', 'a.length', 42],
+    ['or equal', 'expect(c).toBeGreaterThanOrEqual(2);', 'c', 2],
+    ['a floor of one', 'expect(d).toBeGreaterThan(1);', 'd', 2],
+    ['a numeric separator', 'expect(f).toBeGreaterThan(5_197);', 'f', 5198],
+    [
+      'expect.soft',
+      'expect.soft(g.length).toBeGreaterThan(9);',
+      'g.length',
+      10,
+    ],
+    [
+      'expect.poll',
+      'await expect.poll(() => rows.length).toBeGreaterThan(4);',
+      '() => rows.length',
+      5,
+    ],
+    [
+      'a message and the bound on lines of their own',
+      "expect(\n  b.length,\n  'the walk found nothing',\n).toBeGreaterThan(\n  7,\n);",
+      'b.length',
+      8,
+    ],
+  ])('reads %s as a counted floor', (_, source, subject, demands) => {
+    expect(read(source)).toEqual({
+      sites: [{ line: 1, kind: 'counted', demands, subject }],
+      refused: [],
+    });
+  });
+
+  it.each([
+    ['greater than zero', 'expect(e).toBeGreaterThan(0);', 1],
+    ['at least one', 'expect(e).toBeGreaterThanOrEqual(1);', 1],
+    ['a negative bound', 'expect(e).toBeGreaterThan(-1);', 0],
+  ])(
+    'reads %s as presence, which searched() already demands',
+    (_, source, demands) => {
+      expect(read(source)).toEqual({
+        sites: [{ line: 1, kind: 'presence', demands, subject: 'e' }],
+        refused: [],
+      });
+    },
+  );
+
+  // A floor needs no matcher: evidence-recording.test.ts wrote two as
+  // `expect({ acting: acting.length > 25, … }).toEqual({ acting: true, … })`,
+  // which a reader of matchers alone never saw (#468).
+  it.each([
+    [
+      'inside the value',
+      'expect({ acting: acting.length > 25 }).toEqual({ acting: true });',
+      'acting.length',
+      26,
+    ],
+    [
+      'with the bound first',
+      'expect(2 < files.length).toBe(true);',
+      'files.length',
+      3,
+    ],
+    ['at least', 'expect(n >= 5).toBe(true);', 'n', 5],
+    ['with the bound first, at least', 'expect(7 <= n).toBe(true);', 'n', 7],
+  ])(
+    'reads a comparison %s as a counted floor',
+    (_, source, subject, demands) => {
+      expect(read(source)).toEqual({
+        sites: [
+          { line: 1, kind: 'counted', demands, subject, form: 'comparison' },
+        ],
+        refused: [],
+      });
+    },
+  );
+
+  it('reads a comparison bounding from above as a ceiling', () => {
+    expect(read('expect(x.length < 3).toBe(true);').sites).toEqual([
+      { line: 1, kind: 'ceiling', subject: 'x.length', form: 'comparison' },
+    ]);
+  });
+
+  it("reads no floor in a callback's own comparison", () => {
+    expect(
+      read('expect(rows.filter((r) => r.length > 3)).toEqual([]);').sites,
+    ).toEqual([]);
+  });
+
+  it('reads a bound computed in place as a comparison', () => {
+    expect(read('expect(prod).toBeGreaterThan(dev);').sites).toEqual([
+      { line: 1, kind: 'compared', subject: 'prod' },
+    ]);
+  });
+
+  it('reads a fractional bound as a threshold on a measure, never a count', () => {
+    expect(read('expect(contrast).toBeGreaterThanOrEqual(4.5);').sites).toEqual(
+      [{ line: 1, kind: 'threshold', subject: 'contrast' }],
+    );
+  });
+
+  it('reads a negated floor as a ceiling', () => {
+    expect(read('expect(h).not.toBeGreaterThan(3);').sites).toEqual([
+      { line: 1, kind: 'ceiling', subject: 'h' },
+    ]);
+  });
+
+  it.each([
+    [
+      'a parameter',
+      'const at = (n: number, moreThan: number) =>\n  expect(n).toBeGreaterThan(moreThan);',
+    ],
+    [
+      "a parameter's property",
+      'function expectRead(n: number, liveness: { moreThan: number }) {\n  expect(n).toBeGreaterThan(liveness.moreThan);\n}',
+    ],
+    [
+      'a destructured parameter',
+      'const at = (n: number, { moreThan }: { moreThan: number }) =>\n  expect(n).toBeGreaterThan(moreThan);',
+    ],
+  ])('reads a bound handed in through %s as forwarded', (_, source) => {
+    expect(read(source)).toEqual({
+      sites: [{ line: 2, kind: 'forwarded', subject: 'n' }],
+      refused: [],
+    });
+  });
+
+  it('reads a local bound as a comparison, not forwarded', () => {
+    expect(
+      read(
+        'const f = (n: number) => {\n  const moreThan = 3;\n  expect(n).toBeGreaterThan(moreThan);\n};',
+      ).sites,
+    ).toEqual([{ line: 3, kind: 'compared', subject: 'n' }]);
+  });
+
+  it.each([
+    [
+      'a root it cannot read',
+      'assertThat(k).toBeGreaterThan(3);',
+      'assertThat',
+    ],
+    ['no bound', 'expect(k).toBeGreaterThan();', 'one bound'],
+    ['a spread bound', 'expect(k).toBeGreaterThan(...bounds);', 'one bound'],
+  ])('refuses %s by line, never skips it', (_, source, why) => {
+    const { sites, refused } = read(source);
+    expect(sites).toEqual([]);
+    expect(refused).toHaveLength(1);
+    expect(refused[0]).toMatch(/^fixture\.test\.ts:1: /);
+    expect(refused[0]).toContain(why);
+  });
+
+  it('reads nothing a comment or a string spells', () => {
+    expect(
+      read(
+        "// expect(a).toBeGreaterThan(41);\nconst s = 'expect(a).toBeGreaterThan(41)';",
+      ),
+    ).toEqual({ sites: [], refused: [] });
+  });
+});
+
+/** The source of every regex literal in `sf`: text, but never a matcher call. */
+const regexTextsIn = (sf: ts.SourceFile): string[] => {
+  const texts: string[] = [];
+  const visit = (node: ts.Node): void => {
+    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral)
+      texts.push(node.getText(sf));
+    ts.forEachChild(node, visit);
+  };
+  visit(sf);
+  return texts;
+};
+
+/** Every TypeScript file either runner reads: unit tests, specs and helpers. */
+const FILES = tsFilesUnder('tests');
+const READINGS = FILES.map((file) => ({
+  file,
+  ...floorSitesIn(parseFile(file)),
+}));
+const SITES = READINGS.flatMap(({ file, sites }) =>
+  sites.map((site) => ({ file, ...site })),
+);
+const keyOf = ({ file, subject }: { file: string; subject: string }) =>
+  `${file}: ${subject}`;
+
+/**
+ * Literal floors that bound a product value, not a population a guard reads:
+ * keyed `file: subject`, each with its reason.
+ */
+const PRODUCT_VALUES: Readonly<Record<string, string>> = {
+  'tests/unit/browser-matrix.test.ts: all':
+    'more than one engine is configured, or scoping a spec to one is trivially satisfied: a fact about the config',
+  'tests/unit/deploy-gate.test.ts: r.reason.trim().length':
+    'a refusal reason long enough to say something: a property of the text',
+  'tests/unit/grouping.test.ts: arrangements.size':
+    'shuffling gives more than one arrangement: the algorithm behaving randomly',
+  'tests/unit/grouping.test.ts: attempts':
+    'how many searches the grouping ran: a statistic of the algorithm',
+  'tests/unit/grouping.test.ts: g.length':
+    'every group holds at least the size asked for: the grouping rule itself',
+  'tests/unit/grouping.test.ts: partitions.size':
+    'how many distinct partitions the grouping produces: a statistic of the algorithm',
+  'tests/unit/grouping.test.ts: successes':
+    'how many searches succeeded: a statistic of the algorithm',
+  'tests/unit/report-review.test.ts: body.length':
+    "the lines a fixture's report block renders, fixed by the fixture",
+  'tests/unit/report.test.ts: entry!.forms.length':
+    'a select message offers more than one form: the language, not a population',
+  'tests/unit/sfx.test.ts: distinct.size':
+    'five draws of the PRNG are not all one value',
+  'tests/unit/sfx.test.ts: interval':
+    'two notes at least two semitones apart: sound design',
+  'tests/unit/sfx.test.ts: lo.length': 'a chord has more than one voice',
+  'tests/device/ios/journeys.journey.ts: Math.round(rect.width)':
+    'the 44px touch target',
+  'tests/device/ios/journeys.journey.ts: Math.round(rect.height)':
+    'the 44px touch target',
+  'tests/e2e/classroom-groups-controls.spec.ts: box':
+    'the # input leaves room to draw a number',
+  'tests/e2e/classroom-groups-controls.spec.ts: box!.width':
+    'an avatar is a face, not a dot',
+  'tests/e2e/classroom-groups-controls.spec.ts: g.markerGap':
+    'a gap the eye can see between marker and label',
+  'tests/e2e/classroom-groups-controls.spec.ts: g.stateGap':
+    'a gap the eye can see between label and state',
+  'tests/e2e/classroom-groups-roster.spec.ts: Math.round(number.height)':
+    'the 44px touch target',
+  'tests/e2e/homepage.spec.ts: Math.round(box!.width)': 'the 44px touch target',
+  'tests/e2e/homepage.spec.ts: Math.round(box!.height)':
+    'the 44px touch target',
+  'tests/prod/prod-smoke.spec.ts: page.body.length':
+    'a served page is a page, not an error stub',
+  'tests/viewport.ts: Math.round(rect.width)': 'the 44px touch target',
+  'tests/viewport.ts: Math.round(rect.height)': 'the 44px touch target',
+};
+
+/**
+ * Playwright liveness floors, which #446 Group 5 ratchets once they are
+ * measured in the container CI renders in. May only shrink.
+ */
+const GROUP_5: Readonly<Record<string, string>> = {
+  'tests/e2e/classroom-groups-controls.spec.ts: appearances.length':
+    'number fields measured for spinners',
+  'tests/e2e/classroom-groups-controls.spec.ts: gaps.length':
+    'disclosure labels measured for gaps',
+  'tests/e2e/classroom-groups-controls.spec.ts: ids.length':
+    'disclosures opened one at a time',
+  'tests/e2e/classroom-groups-controls.spec.ts: seen':
+    'controls measured for the touch target',
+  'tests/e2e/classroom-groups-print.spec.ts: hairs.length':
+    'hairlines measured on paper',
+  'tests/e2e/copy-reaches-a-page.spec.ts: pages.length': 'built pages scanned',
+  'tests/e2e/feature-words.spec.ts: problems.length':
+    'planted problems the scan must find',
+};
+
+describe('every floor demanding two or more is ratcheted (#468)', () => {
+  it('finds none written as a literal or handed in by a parameter', () => {
+    const findings = SITES.filter(
+      (site) =>
+        (site.kind === 'counted' || site.kind === 'forwarded') &&
+        !(keyOf(site) in PRODUCT_VALUES) &&
+        !(keyOf(site) in GROUP_5),
+    ).map(
+      ({ file, line, kind, demands, subject }) =>
+        `${file}:${line} ${kind}${demands === undefined ? '' : ` ${demands}`} expect(${subject})`,
+    );
+    expect(
+      searched(findings, { of: SITES, what: 'floors read under tests/' }),
+      findings.join('\n'),
+    ).toEqual([]);
+  });
+});
+
+describe('the floor reader proves what it read (#468)', () => {
+  it('counts every floor matcher the code writes, file by file', () => {
+    // Independent of the reader's walk (control c): the matcher counted in
+    // each file's comment-stripped text, less the ones a string or a regex
+    // literal spells (this file's own MATCHER is one), against what the reader returned for that file, sites and
+    // refusals both. Per file, with no number to drift.
+    const MATCHER = /\.toBeGreaterThan(?:OrEqual)?\(/g;
+    const count = (text: string) => text.match(MATCHER)?.length ?? 0;
+    const misread = READINGS.filter(({ file, sites, refused }) => {
+      const code = withoutTsComments(readFileSync(file, 'utf8'));
+      const sf = parseFile(file);
+      const spelled = [...stringTextsIn(sf), ...regexTextsIn(sf)].reduce(
+        (sum, text) => sum + count(text),
+        0,
+      );
+      const matchers = sites.filter(({ form }) => form === undefined);
+      return count(code) - spelled !== matchers.length + refused.length;
+    }).map(({ file }) => file);
+    expect(
+      searched(misread, { of: FILES, what: 'TypeScript files under tests/' }),
+    ).toEqual([]);
+  });
+
+  it('refuses nothing it could not classify', () => {
+    const refused = READINGS.flatMap(({ refused }) => refused);
+    expect(
+      searched(refused, { of: SITES, what: 'floors read under tests/' }),
+      refused.join('\n'),
+    ).toEqual([]);
+    expect(floorBreach('literal-floors/sites', SITES.length)).toBeUndefined();
+  });
+
+  it('lists no product value or Group 5 floor that is gone', () => {
+    const live = new Set(
+      SITES.filter(
+        ({ kind }) => kind === 'counted' || kind === 'forwarded',
+      ).map(keyOf),
+    );
+    const listed = [...Object.keys(PRODUCT_VALUES), ...Object.keys(GROUP_5)];
+    const stale = listed.filter((key) => !live.has(key));
+    expect(searched(stale, { of: listed, what: 'listed floors' })).toEqual([]);
+  });
+
+  it('only shrinks the Group 5 list', () => {
+    // Seven Playwright liveness floors wait for #446 Group 5; a new one is
+    // ratcheted from the start, never added here.
+    expect(Object.keys(GROUP_5).length).toBeLessThanOrEqual(7);
+  });
+
+  it('spells every recorded id exactly once under tests/', () => {
+    const ids = Object.keys(readFloors());
+    const spelled = FILES.flatMap((file) => stringTextsIn(parseFile(file)));
+    const wrong = ids
+      .map((id) => ({
+        id,
+        times: spelled.filter((text) => text === id).length,
+      }))
+      .filter(({ times }) => times !== 1)
+      .map(({ id, times }) => `${id}: spelled ${times} times`);
+    expect(
+      searched(wrong, { of: ids, what: 'recorded floor ids' }),
+      wrong.join('\n'),
+    ).toEqual([]);
+  });
+});
diff --git a/tests/unit/no-dated-render.test.ts b/tests/unit/no-dated-render.test.ts
index 1a7a45a..ae2124d 100644
--- a/tests/unit/no-dated-render.test.ts
+++ b/tests/unit/no-dated-render.test.ts
@@ -6,6 +6,7 @@ import {
   astroTemplate,
   withoutTsComments,
 } from './source-text';
+import { floorBreach } from '../floors';
 
 /**
  * No `.astro` source reads the clock, so no built page carries a date and no
@@ -75,10 +76,7 @@ describe('no page is rendered from the clock (#370)', () => {
   });
 
   it('reads every view the sources hold, and as many as there are', () => {
-    // Measured 46 views on 2026-10-03 (#446). Stated tight, so a reader
-    // that comes back one short fails.
     const sources = read();
-    expect(sources.flatMap(({ views }) => views).length).toBeGreaterThan(45);
     const codeUnread = sources
       .filter(({ text, code }) => HOLDS_CODE.test(text) && code.length === 0)
       .map(({ path }) => path);
@@ -91,6 +89,13 @@ describe('no page is rendered from the clock (#370)', () => {
     expect(
       searched(markupUnread, { of: sources, what: '.astro sources' }),
     ).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach(
+        'no-dated-render/views',
+        sources.flatMap(({ views }) => views).length,
+      ),
+    ).toBeUndefined();
   });
 
   it.each([
diff --git a/tests/unit/one-home.test.ts b/tests/unit/one-home.test.ts
index ad51cd4..3db23bd 100644
--- a/tests/unit/one-home.test.ts
+++ b/tests/unit/one-home.test.ts
@@ -4,6 +4,7 @@ import { describe, expect, it } from 'vitest';
 import { declaredName, parseSource } from './ast';
 import { withoutTsComments } from './source-text';
 import { filesUnder } from '../source-files';
+import { floorBreach } from '../floors';
 
 /**
  * Comment stripping lives in one place. Seven private copies had accumulated
@@ -66,9 +67,7 @@ export function definesACommentStripper(source: string): boolean {
 describe('comment stripping has exactly one home', () => {
   it('scans the whole test and script tree', () => {
     // Anti-vacuity: an empty scan would satisfy the assertion below.
-    // Measured 294 files scanned on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(SCANNED.length).toBeGreaterThan(293);
+    expect(floorBreach('one-home/files', SCANNED.length)).toBeUndefined();
     expect(SCANNED).toContain('tests/unit/source-text.ts');
   });
 
diff --git a/tests/unit/one-test-per-case.test.ts b/tests/unit/one-test-per-case.test.ts
index 22e512b..05a8140 100644
--- a/tests/unit/one-test-per-case.test.ts
+++ b/tests/unit/one-test-per-case.test.ts
@@ -10,6 +10,7 @@ import {
   type LoopedCase,
 } from '../one-test-per-case';
 import { declaresTests } from '../playwright-declarations';
+import { floorBreach } from '../floors';
 
 /**
  * One test per case (operator, 2026-10-02; #417).
@@ -276,20 +277,23 @@ describe('the suite', () => {
   });
 
   it('reads the tests every spec declares, and as many as there are', () => {
-    // Liveness at the level the detector works at. 638 today, measured
-    // against the reader this replaced (both found the same 638 bodies,
-    // #390 F155); stated tight, because a floor with slack is how
+    // Liveness at the level the detector works at, first measured against
+    // the reader this replaced (both found the same 638 bodies, #390 F155),
+    // and ratcheted (#468), because a floor with slack is how
     // absence-liveness sat at 153 under a real 391 (#390 F161). And no spec
     // whose text declares a test may read as none: a reader blind to one
     // form (`test.fail.only` was) is caught by the file it missed.
     const { tests, unread } = scan();
-    expect(tests.length).toBeGreaterThan(637);
     expect(
       searched(unread, {
         of: specDirs().flatMap(tsFilesUnder),
         what: 'files in spec directories',
       }),
     ).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach('one-test-per-case/tests', tests.length),
+    ).toBeUndefined();
   });
 
   it('resolves the shared helpers that navigate', () => {
diff --git a/tests/unit/parked-tests.test.ts b/tests/unit/parked-tests.test.ts
index 2e0569e..60c2c4d 100644
--- a/tests/unit/parked-tests.test.ts
+++ b/tests/unit/parked-tests.test.ts
@@ -253,11 +253,9 @@ describe('parked tests must name an issue', () => {
   });
 
   it('the e2e corpus parks nothing without naming an issue', () => {
-    // Measured 771 tests and groups read on 2026-10-03 (#446). Stated tight,
-    // so a reader that comes back one short fails.
     expectNothingFound(
       readParkedTests,
-      declarationsRead('tests and groups read', 770),
+      declarationsRead('tests and groups read', 'parked-tests/declarations'),
     );
   });
 });
diff --git a/tests/unit/pipeline-wiring.test.ts b/tests/unit/pipeline-wiring.test.ts
index e5b505c..fa4d7e3 100644
--- a/tests/unit/pipeline-wiring.test.ts
+++ b/tests/unit/pipeline-wiring.test.ts
@@ -39,6 +39,7 @@ import { declarationsIn } from '../playwright-declarations';
 import { REQUIRED_CHECKS } from '../../scripts/deploy-gate.mjs';
 import { localImage } from '../../scripts/playwright-image.mjs';
 import { stringLeaves } from '../../src/lib/catalogue-leaves';
+import { floorBreach } from '../floors';
 
 /**
  * The plain `test(...)` declarations `spec` makes, read by the parser. A test
@@ -242,11 +243,12 @@ describe('the deploy pipeline runs what it claims to', () => {
   it('the dev sanity suite exists and is more than a stub', () => {
     // A guard that only checked the workflow REFERENCES the config would pass
     // against an emptied suite.
-    // Measured 15 plain tests in dev-sanity.spec.ts on 2026-10-03 (#446).
-    // Stated tight, so a reader that comes back one short fails.
-    expect(plainTestsIn('tests/dev/dev-sanity.spec.ts').length).toBeGreaterThan(
-      14,
-    );
+    expect(
+      floorBreach(
+        'pipeline-wiring/dev-sanity-tests',
+        plainTestsIn('tests/dev/dev-sanity.spec.ts').length,
+      ),
+    ).toBeUndefined();
   });
 
   it('the dev deploy is gated on a gate that SUCCEEDED, never on one that skipped', () => {
@@ -1069,14 +1071,11 @@ describe('the deploy pipeline runs what it claims to', () => {
   });
 
   it('reads every workflow file reference, and as many as there are', () => {
-    // Measured 19 references on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
     const files = workflowYamlNames();
     const read = files.map((file) => ({
       file,
       refs: workflowRefs(readFileSync(join(WORKFLOWS, file), 'utf8')),
     }));
-    expect(read.flatMap(({ refs }) => refs).length).toBeGreaterThan(18);
     // Cross-checked against the parsed document: every workflow file a
     // value names once YAML has unquoted, unescaped and unfolded it must be
     // among what the raw scan read, or the raw text spells it in a way the
@@ -1088,6 +1087,13 @@ describe('the deploy pipeline runs what it claims to', () => {
         .map((ref) => `${file} → ${ref}`),
     );
     expect(searched(missed, { of: files, what: 'workflow files' })).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach(
+        'pipeline-wiring/workflow-file-refs',
+        read.flatMap(({ refs }) => refs).length,
+      ),
+    ).toBeUndefined();
   });
 
   it.each([
@@ -1166,11 +1172,12 @@ describe('the deploy pipeline runs what it claims to', () => {
   });
 
   it('the prod sanity suite exists and is more than a stub', () => {
-    // Measured 8 plain tests in prod-sanity.spec.ts on 2026-10-03 (#446).
-    // Stated tight, so a reader that comes back one short fails.
     expect(
-      plainTestsIn('tests/prod/prod-sanity.spec.ts').length,
-    ).toBeGreaterThan(7);
+      floorBreach(
+        'pipeline-wiring/prod-sanity-tests',
+        plainTestsIn('tests/prod/prod-sanity.spec.ts').length,
+      ),
+    ).toBeUndefined();
   });
 });
 
@@ -1311,11 +1318,10 @@ describe('the visual-regression job cannot rewrite what it checks', () => {
   });
 
   it('reads every workflow for an image, and as many as there are', () => {
-    // Measured 10 workflow files on 2026-10-03 (#446), two of them #459's
-    // probes (probe-459.yml, probe-459-relay.yml): lower this when they go.
-    // Stated tight, so a walk that comes back one short fails.
+    // Two of the workflows read are #459's probes (probe-459.yml,
+    // probe-459-relay.yml): when they go, lower this floor's figure in
+    // tests/floors.json by hand, which is what a real shrink takes (#468).
     const workflows = workflowYamlNames();
-    expect(workflows.length).toBeGreaterThan(9);
     // Cross-checked against the parsed document: every value naming the
     // image once YAML has unquoted and unfolded it must be one the text scan
     // reports. No workflow names it today, so the planted forms below are
@@ -1329,6 +1335,13 @@ describe('the visual-regression job cannot rewrite what it checks', () => {
     expect(searched(missed, { of: workflows, what: 'workflow files' })).toEqual(
       [],
     );
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach(
+        'pipeline-wiring/workflows-read-for-an-image',
+        workflows.length,
+      ),
+    ).toBeUndefined();
   });
 
   it.each([
@@ -1866,9 +1879,9 @@ describe('build-and-test stands for the whole suite, run as shards (#163)', () =
     expect(Array.isArray(shards)).toBe(true);
     const list = shards as unknown[];
     // More than one, or it is not a split at all.
-    // Measured 8 shards scheduled on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(list.length).toBeGreaterThan(7);
+    expect(
+      floorBreach('pipeline-wiring/e2e-shards', list.length),
+    ).toBeUndefined();
     expect(list).toEqual(list.map((_, i) => i + 1));
     // A failing shard would otherwise CANCEL its siblings, and every test they
     // had not reached would go unreported: one red run would show one shard's
@@ -2173,8 +2186,6 @@ describe('the drift measurement reports, and never gates (#224)', () => {
     const writes = visualSteps()
       .flatMap((s) => (typeof s.run === 'string' ? s.run.split('\n') : []))
       .filter(writesTheSummary);
-    // Measured 2 on 2026-10-03 (#446). Stated tight.
-    expect(writes.length).toBeGreaterThan(1);
     // Independent of the YAML parse (#446, control c): the visual job's own
     // text, YAML comments aside, names the summary on exactly as many lines.
     // The job is every line after its key, up to the next line at a job's
@@ -2197,6 +2208,10 @@ describe('the drift measurement reports, and never gates (#224)', () => {
       }),
       'a summary written with >> cannot be read back from the job log',
     ).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach('pipeline-wiring/visual-summary-writes', writes.length),
+    ).toBeUndefined();
   });
 
   it('runs even when the gate went red, which is when it is worth having', () => {
@@ -2348,7 +2363,9 @@ describe('no two concurrently launched groups share an output folder (#230)', ()
   };
 
   it('launches more than one config, or the rest of this asserts nothing', () => {
-    expect(launchedConfigs().length).toBeGreaterThan(1);
+    expect(
+      floorBreach('pipeline-wiring/launched-configs', launchedConfigs().length),
+    ).toBeUndefined();
   });
 
   it('gives each launched config a folder of its own', async () => {
@@ -2609,10 +2626,6 @@ describe('the back-translation review', () => {
       'docker/libretranslate/Dockerfile',
       `.github/workflows/${FILE}`,
     ];
-    // The closure is followed, not listed: this is its floor, not its size.
-    // Measured 17 modules the import walk found on 2026-10-03 (#446). Stated
-    // tight, so a reader that comes back one short fails.
-    expect(inputs.length, 'the import walk found nothing').toBeGreaterThan(16);
     const unwatched = inputs.filter(
       (file) => !paths.some((glob) => globToRegExp(glob).test(file)),
     );
@@ -2620,6 +2633,12 @@ describe('the back-translation review', () => {
       searched(unwatched, { of: inputs, what: 'files the review reads' }),
       'a change to one of these would not start the review',
     ).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    // The closure is followed, not listed: this is its floor, not its size.
+    expect(
+      floorBreach('pipeline-wiring/sanity-import-walk', inputs.length),
+      'the import walk found nothing',
+    ).toBeUndefined();
   });
 });
 
@@ -2706,11 +2725,10 @@ describe('wrangler comes from the lockfile (#97)', () => {
   });
 
   it('reads every workflow for an install, and as many as there are', () => {
-    // Measured 10 workflow files on 2026-10-03 (#446), two of them #459's
-    // probes (probe-459.yml, probe-459-relay.yml): lower this when they go.
-    // Stated tight, so a walk that comes back one short fails.
+    // Two of the workflows read are #459's probes (probe-459.yml,
+    // probe-459-relay.yml): when they go, lower this floor's figure in
+    // tests/floors.json by hand, which is what a real shrink takes (#468).
     const workflows = allWorkflows();
-    expect(workflows.length).toBeGreaterThan(9);
     // Cross-checked against a coarser reading: any line naming wrangler
     // beside a global flag must hold a command the parser reports, or the
     // parser has a blind spot. No workflow holds one today, so the planted
@@ -2726,6 +2744,13 @@ describe('wrangler comes from the lockfile (#97)', () => {
         what: 'workflow texts',
       }),
     ).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach(
+        'pipeline-wiring/workflows-read-for-an-install',
+        workflows.length,
+      ),
+    ).toBeUndefined();
   });
 
   it.each([
diff --git a/tests/unit/release-inventory.test.ts b/tests/unit/release-inventory.test.ts
index 24b1974..eaebd84 100644
--- a/tests/unit/release-inventory.test.ts
+++ b/tests/unit/release-inventory.test.ts
@@ -22,6 +22,7 @@ import { searched, trackedFiles } from '../source-files';
 import { withoutTsComments } from './source-text';
 import { parseSource } from './ast';
 import { callsIn } from '../playwright-declarations';
+import { floorBreach } from '../floors';
 
 /** A throwaway repository, driven by the real git. */
 const repository = () => {
@@ -309,9 +310,9 @@ describe('release-inventory.mjs as a command (#362)', () => {
     });
     expect(run.status, run.stderr).toBe(0);
     const lines = run.stdout.trim().split('\n');
-    // Measured 79 lines of capture selection on 2026-10-03 (#446). Stated
-    // tight, so a reader that comes back one short fails.
-    expect(lines.length).toBeGreaterThan(78);
+    expect(
+      floorBreach('release-inventory/capture-lines', lines.length),
+    ).toBeUndefined();
     expect(
       lines.every((l) => /^tests\/e2e\/[\w.-]+\.spec\.ts:\d+$/.test(l)),
     ).toBe(true);
@@ -408,10 +409,7 @@ describe('release-inventory.mjs as a command (#362)', () => {
   });
 
   it('reads every helper module, and as many as there are', () => {
-    // Measured 58 helper modules on 2026-10-03 (#446). Stated tight, so a
-    // walk that comes back one short fails.
     const modules = helperModules();
-    expect(modules.length).toBeGreaterThan(57);
     expect(modules).toContain('tests/e2e/evidence.ts');
     // Cross-checked against the parse tree: every module whose code calls
     // `shoot` must be one the text scan flags. None does today, so the
@@ -423,6 +421,10 @@ describe('release-inventory.mjs as a command (#362)', () => {
     expect(
       searched(missed, { of: modules, what: 'test helper modules' }),
     ).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach('release-inventory/helper-modules', modules.length),
+    ).toBeUndefined();
   });
 
   it.each([
diff --git a/tests/unit/route-coverage.test.ts b/tests/unit/route-coverage.test.ts
index 0ece168..f3d2dcf 100644
--- a/tests/unit/route-coverage.test.ts
+++ b/tests/unit/route-coverage.test.ts
@@ -6,6 +6,7 @@ import { LOCALES, PREFIXED_LOCALES } from '../../src/lib/i18n';
 import { withoutTsComments, withoutMarkupComments } from './source-text';
 import { nonEmpty, searched } from '../source-files';
 import { parseFile, parseSource, stringTextsIn } from './ast';
+import { floorBreach } from '../floors';
 
 /**
  * #21 Stage 4. Adding a locale must not mean writing routes by hand.
@@ -140,9 +141,9 @@ describe('the post-deploy gates derive their routes', () => {
   it('has gate specs to check', () => {
     // Without this the loop below is vacuous if the directories are ever
     // renamed: no files, no matches, green.
-    // Measured 3 deploy-gate specs on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(gateSpecs().length).toBeGreaterThan(2);
+    expect(
+      floorBreach('route-coverage/gate-specs', gateSpecs().length),
+    ).toBeUndefined();
   });
 
   it('hardcodes no locale-prefixed route in any deploy gate', () => {
diff --git a/tests/unit/script-entry.test.ts b/tests/unit/script-entry.test.ts
index c894f86..fa2f34b 100644
--- a/tests/unit/script-entry.test.ts
+++ b/tests/unit/script-entry.test.ts
@@ -8,6 +8,7 @@ import { filesUnder, searched } from '../source-files';
 import { parseFile, parseSource, where } from './ast';
 import { scriptCheckout, type ScriptCheckout } from './script-checkout';
 import { withoutTsComments } from './source-text';
+import { floorBreach } from '../floors';
 
 /**
  * A script asks "was I run directly?" with `import.meta.main`, and with
@@ -754,17 +755,12 @@ describe('a script asks whether it was run directly with import.meta.main alone
   });
 
   it('judges every read of process.argv the scripts make, and as many as there are', () => {
-    // Measured 10 reads on 2026-10-03 (#446). Stated tight, so a reader that
-    // comes back one short fails.
     const readings = modules.map((file) => ({
       file,
       judged: readArgv(parseFile(file)).judged.length,
       written:
         withoutTsComments(readFileSync(file, 'utf8')).match(ARGV)?.length ?? 0,
     }));
-    expect(
-      readings.reduce((sum, { judged }) => sum + judged, 0),
-    ).toBeGreaterThan(9);
     // Two readers, the parse tree and the text: a script where they disagree
     // holds a form the tree reader is blind to.
     const disagree = readings
@@ -774,6 +770,13 @@ describe('a script asks whether it was run directly with import.meta.main alone
           `${file}: ${judged} judged, ${written} written`,
       );
     expect(searched(disagree, { of: modules, what: 'scripts' })).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach(
+        'script-entry/argv-reads',
+        readings.reduce((sum, { judged }) => sum + judged, 0),
+      ),
+    ).toBeUndefined();
   });
 
   it('decides on import.meta.main alone', () => {
@@ -914,8 +917,6 @@ describe('a script does no work while it loads (#276)', () => {
   });
 
   it('judges every load-time statement the scripts hold, and as many as there are', () => {
-    // Measured 313 statements on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
     const readings = modules.map((file) => {
       const sf = parseFile(file);
       return {
@@ -928,12 +929,16 @@ describe('a script does no work while it loads (#276)', () => {
         ).length,
       };
     });
-    expect(
-      readings.reduce((sum, { judged }) => sum + judged, 0),
-    ).toBeGreaterThan(312);
     const skipped = readings
       .filter(({ judged, held }) => judged !== held)
       .map(({ file, judged, held }) => `${file}: ${judged} of ${held} judged`);
     expect(searched(skipped, { of: modules, what: 'scripts' })).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(
+      floorBreach(
+        'script-entry/load-time-statements',
+        readings.reduce((sum, { judged }) => sum + judged, 0),
+      ),
+    ).toBeUndefined();
   });
 });
diff --git a/tests/unit/shytalk-brand.test.ts b/tests/unit/shytalk-brand.test.ts
index 4e5d55d..8e30c3b 100644
--- a/tests/unit/shytalk-brand.test.ts
+++ b/tests/unit/shytalk-brand.test.ts
@@ -7,6 +7,7 @@ import {
   asComputedRgb,
   asRgba,
 } from '../../src/lib/shytalk-brand';
+import { floorBreach } from '../floors';
 
 /**
  * ShyTalk's brand mark has exactly one home (#17).
@@ -165,10 +166,7 @@ describe("ShyTalk's brand mark has one home", () => {
   });
 
   it('reads every source file, and as many as there are', () => {
-    // Measured 329 source files on 2026-10-03 (#446). Stated tight, so a walk
-    // that comes back one short fails.
     const files = scannedFiles();
-    expect(files.length).toBeGreaterThan(328);
     // Cross-checked on the files that do spell the mark, by the same reading
     // the verdict makes: the home spells every hex, and the token home spells
     // its one token exactly once, so a reader gone blind to a script or to a
@@ -184,6 +182,8 @@ describe("ShyTalk's brand mark has one home", () => {
       }),
     ).toEqual([]);
     expect(readCode(TOKEN_HOME).split(TOKEN_FORM).length - 1).toBe(1);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(floorBreach('shytalk-brand/files', files.length)).toBeUndefined();
   });
 
   it.each([
diff --git a/tests/unit/site-pages.test.ts b/tests/unit/site-pages.test.ts
index 0b1c196..e71480a 100644
--- a/tests/unit/site-pages.test.ts
+++ b/tests/unit/site-pages.test.ts
@@ -9,11 +9,12 @@ import {
 } from '../site-pages';
 import { LOCALES } from '../../src/lib/i18n';
 import { scratchDir } from '../scratch-dir';
+import { floorBreach } from '../floors';
 
 describe('the site page list is derived from src/pages', () => {
   it('reads real pages off disk', () => {
     // Anti-vacuity: an empty derivation would satisfy every assertion below.
-    expect(pageNames().length).toBeGreaterThan(2);
+    expect(floorBreach('site-pages/pages', pageNames().length)).toBeUndefined();
     expect(pageNames()).toContain('index');
   });
 
diff --git a/tests/unit/sitemap-config.test.ts b/tests/unit/sitemap-config.test.ts
index dab605d..42f580d 100644
--- a/tests/unit/sitemap-config.test.ts
+++ b/tests/unit/sitemap-config.test.ts
@@ -3,6 +3,7 @@ import { readFileSync } from 'node:fs';
 import { withoutTsComments } from './source-text';
 import { LOCALES } from '../../src/lib/i18n/index';
 import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
+import { floorBreach } from '../floors';
 
 /**
  * The sitemap's locale map, which cannot import the table it must agree with.
@@ -68,8 +69,11 @@ describe('the sitemap declares every locale the site serves', () => {
     // A regex that stopped matching would hand every assertion above an empty
     // object, and `{} === {}` is a pass for a check phrased as "no extras".
     // #84: a guard handed an empty list asserts nothing at all.
-    // Measured 5 sitemap locales on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(Object.keys(sitemapLocales()).length).toBeGreaterThan(4);
+    expect(
+      floorBreach(
+        'sitemap-config/locales',
+        Object.keys(sitemapLocales()).length,
+      ),
+    ).toBeUndefined();
   });
 });
diff --git a/tests/unit/source-files.test.ts b/tests/unit/source-files.test.ts
index 2302efa..5897b7f 100644
--- a/tests/unit/source-files.test.ts
+++ b/tests/unit/source-files.test.ts
@@ -1,5 +1,6 @@
 import { describe, expect, it } from 'vitest';
 import { filesUnder, nonEmpty, searched } from '../source-files';
+import { floorBreach } from '../floors';
 
 /**
  * The shared directory walk (#80). Nine private copies had grown, in three
@@ -12,9 +13,7 @@ describe('filesUnder', () => {
     const specs = filesUnder('tests', (path) => path.endsWith('.spec.ts'));
     // Anti-vacuity: an empty walk would satisfy every "no offenders" guard in
     // the suite at once — the exact failure #79 found in the e2e collectors.
-    // Measured 48 spec files on 2026-10-03 (#446). Stated tight, so a reader
-    // that comes back one short fails.
-    expect(specs.length).toBeGreaterThan(47);
+    expect(floorBreach('source-files/specs', specs.length)).toBeUndefined();
     // Proof it went DOWN, not just listed the top level.
     expect(specs).toContain('tests/e2e/classroom-groups-print.spec.ts');
   });
@@ -84,11 +83,12 @@ describe('filesUnder refuses to answer blind', () => {
     // The refusal belongs to the TOP-LEVEL call only. `tests/` holds
     // directories with no `.spec.ts` in them, so a recursion that refused an
     // empty sub-result could never complete a walk at all.
-    // Measured 48 spec files on 2026-10-03 (#446). Stated tight, so a reader
-    // that comes back one short fails.
     expect(
-      filesUnder('tests', (path) => path.endsWith('.spec.ts')).length,
-    ).toBeGreaterThan(47);
+      floorBreach(
+        'source-files/specs-through-empty-dirs',
+        filesUnder('tests', (path) => path.endsWith('.spec.ts')).length,
+      ),
+    ).toBeUndefined();
   });
 });
 
diff --git a/tests/unit/spec-dirs.test.ts b/tests/unit/spec-dirs.test.ts
index c7624d9..e335c2a 100644
--- a/tests/unit/spec-dirs.test.ts
+++ b/tests/unit/spec-dirs.test.ts
@@ -1,12 +1,11 @@
 import { describe, expect, it } from 'vitest';
 import { specDirs } from '../spec-dirs';
+import { floorBreach } from '../floors';
 
 describe('the directories guards scan are derived, not listed', () => {
   it('finds every directory under tests/ that holds specs', () => {
     // Anti-vacuity: an empty derivation would make every guard a no-op.
-    // Measured 5 spec directories on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(specDirs().length).toBeGreaterThan(4);
+    expect(floorBreach('spec-dirs/dirs', specDirs().length)).toBeUndefined();
     expect(specDirs()).toContain('tests/e2e');
     expect(specDirs()).toContain('tests/device');
   });
diff --git a/tests/unit/spec-scan.ts b/tests/unit/spec-scan.ts
index a6b4b72..849669d 100644
--- a/tests/unit/spec-scan.ts
+++ b/tests/unit/spec-scan.ts
@@ -2,6 +2,7 @@ import { readFileSync } from 'node:fs';
 import { expect } from 'vitest';
 import { specDirs } from '../spec-dirs';
 import { declaresTests } from '../playwright-declarations';
+import { floorBreach } from '../floors';
 import { searched, tsFilesUnder } from '../source-files';
 
 /**
@@ -52,10 +53,11 @@ export type Liveness = {
   /** The unit `judged` lists, plural: `tests read`, `captures`. */
   readonly what: string;
   /**
-   * The floor, stated as measured − 1 by the caller beside the measured
-   * figure, so a reader that comes back one short fails.
+   * The id of the floor in `tests/floors.json` (#468): `judged` is checked
+   * against it for equality, so a reader that comes back one short fails, and
+   * so does a population that grew, until it is recorded.
    */
-  readonly moreThan: number;
+  readonly floor: string;
   /**
    * An independent reading of the same file: true where its text plainly
    * holds the construct. A file it holds and `analyze` judged nothing in is
@@ -69,9 +71,9 @@ export type Liveness = {
  * a file whose text declares a test, and in which the guard judged none, is
  * a form its reader is blind to. One home, since three guards read that way.
  */
-export const declarationsRead = (what: string, moreThan: number): Liveness => ({
+export const declarationsRead = (what: string, floor: string): Liveness => ({
   what,
-  moreThan,
+  floor,
   carries: (_file, source) => declaresTests(source),
 });
 
@@ -97,10 +99,6 @@ export const expectNothingFound = (
     searched(findings, { of: judged, what: liveness.what }),
     findings.join('\n'),
   ).toEqual([]);
-  expect(
-    judged.length,
-    `${liveness.what}: fewer than measured`,
-  ).toBeGreaterThan(liveness.moreThan);
   const missed = readings
     .filter(
       ({ file, source, judged }) =>
@@ -114,4 +112,9 @@ export const expectNothingFound = (
     }),
     `files holding ${liveness.what} where the reader judged none`,
   ).toEqual([]);
+  // After both verdicts, so a population that grew never hides a finding.
+  expect(
+    floorBreach(liveness.floor, judged.length),
+    `${liveness.what}: not the recorded figure`,
+  ).toBeUndefined();
 };
diff --git a/tests/unit/supply-chain.test.ts b/tests/unit/supply-chain.test.ts
index 0835635..6855f5d 100644
--- a/tests/unit/supply-chain.test.ts
+++ b/tests/unit/supply-chain.test.ts
@@ -4,6 +4,7 @@ import { basename, dirname, join } from 'node:path';
 import { withoutYamlComments, withoutYamlQuotes } from './source-text';
 import { filesUnder, nonEmpty, searched } from '../source-files';
 import { parseCleanYaml } from '../workflow-jobs';
+import { floorBreach } from '../floors';
 
 /**
  * The CI supply chain is pinned, and something keeps it current.
@@ -102,9 +103,9 @@ const subPathRepos = (): [string, Set<string>][] => {
 
 describe('the CI supply chain is pinned', () => {
   it('there is something to check', () => {
-    // Measured 38 external action uses on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(externalUses().length).toBeGreaterThan(37);
+    expect(
+      floorBreach('supply-chain/external-uses', externalUses().length),
+    ).toBeUndefined();
   });
 
   it('every third-party action is pinned to a full commit SHA', () => {
diff --git a/tests/unit/tokens.test.ts b/tests/unit/tokens.test.ts
index aa1c81e..05748e5 100644
--- a/tests/unit/tokens.test.ts
+++ b/tests/unit/tokens.test.ts
@@ -13,6 +13,7 @@ import {
   tokensCss,
 } from '../palette';
 import { SHYTALK_MARK } from '../../src/lib/shytalk-brand';
+import { floorBreach } from '../floors';
 
 /**
  * The structure of tokens.css (#142).
@@ -130,10 +131,12 @@ describe('the two themes (#142)', () => {
     const pad = themeTokens(css, 'light').get('--wordmark-pad');
     expect(pad).toBe('0.12em 0.42em 0.18em');
     const blocks = darkBlocks(css);
-    expect(blocks.length).toBeGreaterThan(1);
     for (const block of blocks) {
       expect(customProperties(block).get('--wordmark-pad') ?? pad).toBe(pad);
     }
+    // Ratcheted after the loop it proves (#468): two today, and a third dark
+    // block must be recorded before its padding is trusted to this loop.
+    expect(floorBreach('tokens/dark-blocks', blocks.length)).toBeUndefined();
   });
 });
 
diff --git a/tests/unit/typecheck-scope.test.ts b/tests/unit/typecheck-scope.test.ts
index 068b5e1..c13c501 100644
--- a/tests/unit/typecheck-scope.test.ts
+++ b/tests/unit/typecheck-scope.test.ts
@@ -21,6 +21,7 @@ import { readFileSync } from 'node:fs';
 import ts from 'typescript';
 import { withoutTsComments } from './source-text';
 import { filesUnder, searched, nonEmpty } from '../source-files';
+import { floorBreach } from '../floors';
 
 /** `tsconfig.json` is JSONC: it carries the reason for every option. */
 const tsconfig = (): Record<string, any> =>
@@ -107,10 +108,7 @@ describe('typecheck reads the scripts that deploy this site (#228)', () => {
   });
 
   it('reads every script, and as many as there are', () => {
-    // Measured 29 scripts on 2026-10-03 (#446). Stated tight, so a walk that
-    // comes back one short fails.
     const read = scripts();
-    expect(read.length).toBeGreaterThan(28);
     // Cross-checked against the compiler: every script TypeScript itself
     // would stop checking must be one the raw scan flags. No script does
     // today, so the planted forms below are what this check runs on.
@@ -119,6 +117,8 @@ describe('typecheck reads the scripts that deploy this site (#228)', () => {
       return silencedByCompiler(path, text) && !optsOut(text);
     });
     expect(searched(missed, { of: read, what: 'scripts read' })).toEqual([]);
+    // After the verdict, so a population that grew never hides a finding.
+    expect(floorBreach('typecheck-scope/scripts', read.length)).toBeUndefined();
   });
 
   it.each([
diff --git a/tests/unit/viewport-tagging.test.ts b/tests/unit/viewport-tagging.test.ts
index a7417df..7eae9dc 100644
--- a/tests/unit/viewport-tagging.test.ts
+++ b/tests/unit/viewport-tagging.test.ts
@@ -237,9 +237,13 @@ const analyze = (file: string, text: string): readonly string[] =>
 
 describe('a real phone cannot resize its own screen', () => {
   it('every test that resizes the viewport is tagged @emulated-viewport, none the phone runs reads it, and no tag is stale', () => {
-    // Measured 771 tests and groups read on 2026-10-03 (#446). Stated tight,
-    // so a reader that comes back one short fails.
-    expectNothingFound(read, declarationsRead('tests and groups read', 770));
+    expectNothingFound(
+      read,
+      declarationsRead(
+        'tests and groups read',
+        'viewport-tagging/declarations',
+      ),
+    );
   });
 });
 
diff --git a/tests/unit/wcag.test.ts b/tests/unit/wcag.test.ts
index 20ff1e3..02cbe55 100644
--- a/tests/unit/wcag.test.ts
+++ b/tests/unit/wcag.test.ts
@@ -11,6 +11,7 @@ import {
   type RGB,
 } from '../wcag';
 import { declaredName, parseSource } from './ast';
+import { floorBreach } from '../floors';
 
 /** The sRGB transfer curve's constants: the linear slope, then the curve's. */
 const CURVE = [12.92, 1.055, 2.4];
@@ -133,9 +134,7 @@ describe('the WCAG formula has one home', () => {
       (path) =>
         /^(src|tests|scripts)\//.test(path) && /\.(ts|mjs|js)$/.test(path),
     );
-    // Measured 339 files scanned on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
-    expect(scanned.length).toBeGreaterThan(338);
+    expect(floorBreach('wcag/files', scanned.length)).toBeUndefined();
     // The home is in the result, so an empty scan cannot pass this.
     expect(
       scanned.flatMap((file) => curvesIn(readFileSync(file, 'utf8'), file)),
~~~~

## Task 3: No workflow runs the recorder

Read from the parsed run steps; its figures (+1 absence, +2 bodies) folded in.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index da48692..5797ca4 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,6 +1,6 @@
 {
   "absence-liveness/plain-files": 115,
-  "absence-liveness/sites": 433,
+  "absence-liveness/sites": 434,
   "absence-liveness/ts-files": 266,
   "anchored-presence/scanned": 76,
   "anchored-presence/ts-files": 266,
@@ -13,7 +13,7 @@
   "device-tool-homes/files": 299,
   "download-readers/byte-reads": 8,
   "duplicate-imports/imports": 1573,
-  "duplication/declarations": 5342,
+  "duplication/declarations": 5344,
   "duplication/files": 343,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/unit/pipeline-wiring.test.ts b/tests/unit/pipeline-wiring.test.ts
index fa4d7e3..7c542ba 100644
--- a/tests/unit/pipeline-wiring.test.ts
+++ b/tests/unit/pipeline-wiring.test.ts
@@ -3009,3 +3009,23 @@ describe('the waiting-reports count (#349)', () => {
     });
   });
 });
+
+describe('CI never records the guards’ floors (#468)', () => {
+  it('runs neither npm run floors:record nor its script', () => {
+    // A run that can raise the figure it checks against asserts nothing, for
+    // the reason CI never passes --update-snapshots. The recorder refuses
+    // under CI itself (script-entry.test.ts probes it); this keeps a workflow
+    // from asking.
+    const runs = workflowYamlNames().flatMap((file) =>
+      workflowJobs(workflow(file), file).flatMap(({ runs }) =>
+        runs.map((run) => ({ file, run })),
+      ),
+    );
+    const recording = runs
+      .filter(({ run }) => /floors:record|record-floors/.test(run))
+      .map(({ file, run }) => `${file}: ${run.trim().split('\n')[0]}`);
+    expect(
+      searched(recording, { of: runs, what: 'run steps in the workflows' }),
+    ).toEqual([]);
+  });
+});
~~~~

## Task 4: The ledger and CLAUDE.md

The global rule's control (b) is edited outside the repo, in `~/.claude/CLAUDE.md`.

~~~~diff
diff --git a/CLAUDE.md b/CLAUDE.md
index 6319904..1e792f9 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -10,6 +10,7 @@
 - **Page-level `scrollWidth` is not containment.** Content can overflow a _card_ by 34.5px and produce zero document scroll — which is exactly how the Remove button shipped hanging out of the Student details border at every laptop width. Assert against the offending element's own container (`nothing in the roster escapes its card`), not just `document.documentElement`.
 - **A hand-written list of things to check will miss the one that breaks.** The no-horizontal-scroll tests opened `#cg-grouping-toggle` and `#cg-sound-toggle` — added one at a time as each section gained content — and never `#cg-io-toggle`, the only section holding a native `<input type="file">`. Its ~344px intrinsic minimum propagated up `#cg-form`'s grid (items default to `min-width: auto`) and pinned the track to 378px at every viewport: 5px of horizontal scroll at 390px, **74px at 320px**. `max-width: 100%` does not fix this — the automatic minimum reads the element's min-content size, which `max-width` does not change; an explicit `width` replaces it. The replacement test _derives_ every disclosure from the DOM, so a section added later is covered the day it appears.
 - **A guard you have not watched fail is not a guard.** This repo has shipped two that asserted nothing, and both read as correct on the page. The supply-chain sub-path check (#23) was satisfied by `dependabot.yml`'s own **comment** describing the group it was meant to require — no group configured, suite green. #21 Stage 4's first replacement for the prod-smoke path list used `prod.includes(path)`, and `/glory-points` is a substring of `/id/glory-points`: the English assertion passed on the **Indonesian** path, and mutating a path to `/id/glory-pointsXX` left it green because that still contains the needle. **Every guard asserting against source text, config, or a workflow file is mutation-verified in BOTH directions before it lands** — break the thing it protects and watch it fail, then restore it and watch it pass. Strip comments before matching, so the file's documentation cannot satisfy its own guard. Prefer an exact set comparison to a substring test, and assert ORDER where order carries meaning (Dependabot stops at the first matching group). Presence is not the assertion; failure is. **And a mutation that comes back GREEN where you predicted RED has three causes, not one** (#250): the guard is weak, the mutation never reached `dist/`, or the medium made the mutation impossible. A RED is self-proving — the test failed BECAUSE of the change — so only a GREEN needs the built-output check, and that check belongs on the OBSERVED verdict rather than the predicted one, since a wrong prediction is exactly when it is needed. Rule out "never landed" by asserting the mutation's shape in the built bytes (for a REMOVAL, assert the absence WITH a liveness probe beside it, or an empty file list satisfies it for free), and rule out "weak guard" by probing the assertion's own liveness. What remains is an illegal mutation: `max-height: 40px !important` can never shrink a control, because CSS resolves a box as `max(min-height, min(max-height, height))` and a 44px `min-height` beats any smaller max-height however important it is.
+- **A liveness floor is a recorded figure, checked for equality (#468).** A floor written `toBeGreaterThan(measured - 1)` is tight only on the day it is measured, because growth never fails it: `absence-liveness` read 424 an hour after it was set to `> 420`. So a guard proves it read its population with `expect(floorBreach('<id>', count)).toBeUndefined()` (`tests/floors.ts`), placed after its verdict, against the figure in `tests/floors.json`: one unit short fails, and so does one more. When a change grows a population, `npm run floors:record` raises the figure and prints every floor that moved; read each delta against your diff, because a raise smaller than the units you added is a reader that lost some, and put the lines in the commit. It never lowers a figure: a real shrink is a hand edit with the reason in the commit. CI never records. `literal-floors.test.ts` refuses a literal floor demanding two or more, however it is written (a matcher, a parameter, `n > 25` inside an `expect`), unless it bounds a product value and says so. A new test file grows several floors at once, and a new file is invisible to the tracked-file guards until `git add -N`, so add it before recording.
 - **No message may put a closing keyword next to an issue number — not even one you mean.** `close`/`fix`/`resolve` and their inflections, beside `#<n>`, are refused in a commit message (`.githooks/commit-msg`) and in a pull request body (`.github/workflows/pr-body.yml`), both through one home: `scripts/closing-keywords.mjs`. GitHub's parser has no model of negation, tense or intent, and it has retired an issue here **twice** — once from a sentence in capitals saying the issue must stay open, once from a body promising to retire it by hand later. There is deliberately **no exception**, because no such keyword appears in the last 300 commit bodies or 40 pull request bodies: the capability an exception would preserve has never been used, and an allowance branch nothing exercises is the vacuity #118 was filed about. Write `Refs #<n>`, and retire an issue with `gh issue close <n>` once the work is verified. Check a body before it reaches GitHub with `node scripts/closing-keywords.mjs <file> "this pull request body"`. The workflow re-runs on `edited` — a body edited after a green run is how such a sentence gets written — and is **not a gate** until `closing-keywords` joins `required_status_checks.contexts`, which is repository administration and so the operator's (#278).
 - **Locale files are a review surface.** Every catalogue is typed `Catalogue`, so `npm run typecheck` (`astro check`, run in CI) fails on a missing key; it cannot read copy, so tests hold the rest. `tests/unit/i18n.test.ts` and `dead-copy.test.ts`: blank values, untranslated copy, copy no page renders. `locale-fallbacks.test.ts`: English left in zh, vi and th. `message-parity.test.ts`: every language fills the slots English fills, offers the choices it offers, and has exactly its own plural forms. `label-check.test.ts` and `verified-labels.test.ts`: a label of three words or fewer is checked against its own locale's copy that uses its English and says more, and one that disagrees, or that a namesake renders in other words, is either pinned or listed as awaiting the operator's read (#161). A label can be translated, non-blank and slot-perfect and still name the wrong thing: `Tình dục` passed every other guard here for a month. Messages are templates (#136) — English decides which entries are messages — and zh/vi/th wording is a DeepL draft until a speaker has reviewed it.
 - **The e2e suite measures `dist/`**, not the dev server (`playwright.config.ts` builds and previews). Anything asserted against `astro dev` is asserting about bytes nobody receives.
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index c2da5d7..9e677c6 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -221,6 +221,48 @@ cross-check alone, with its floor switched off. Removing a `tee` from
 architecture into the job summary') already catches it, so the matrix blinds
 the guard's reader instead.
 
+## The ratchet (#468), done
+
+A floor at measured − 1 is tight only on the day it is measured: growth
+never fails it. `absence-liveness` was set to `> 420` against a real 421 in
+#467 and read 424 an hour after it merged, and a recorder wrapped round
+`toBeGreaterThan(OrEqual)` across the unit suite at `4d07565` found
+`git-env` 6 slack, `duplicate-imports` 7, `one-test-per-case` and
+`spec-scan` 1, all set tight within two days. 20 of the 58 first-parent
+commits on `develop` that week changed the number of files under `tests/`.
+
+So every liveness floor is now a figure in `tests/floors.json`, checked for
+equality by `floorBreach` (`tests/floors.ts`): one unit short fails, and so
+does one more, until `npm run floors:record` raises it. The recorder checks
+everything before writing anything and refuses a figure that would fall
+(lowering is a hand edit with the reason in the commit), an id no test
+asserted, an id asserted from two places or with two values, and a failing
+run; CI never records. It prints every floor that moved, largest first,
+because a raise is accepted on its direction alone: a change that adds five
+units while its reader loses three records +2 (operator, 2026-10-03). #469
+gives each guard the number-free cross-check that catches that mechanically.
+
+`literal-floors.test.ts` keeps it that way. Its reader classifies every
+`toBeGreaterThan(OrEqual)` under `tests/`, and every comparison with a
+literal inside an `expect` argument, as presence, counted, forwarded,
+compared, threshold or ceiling, and refuses anything else by line. A
+counted or forwarded floor must be ratcheted, or listed as a product value
+with its reason (a 44px target, a grouping statistic), or be one of the
+seven Playwright floors Group 5 ratchets (that list may only shrink). Its
+cross-check counts the matcher per file in the comment-stripped text, less
+what string and regex literals spell; no number drifts in it.
+
+Converted: 43 unit floors, `spec-scan`'s helper (whose number was a
+parameter, which no literal search sees) and its five callers,
+`back-translate`'s four locales, and `evidence-recording`'s two floors
+written as `acting.length > 25` inside a `toEqual`, which the reader first
+missed and now plants. Sixteen sat before their verdict in the same test
+and were moved below it, so a population that grew never hides a finding.
+Each first figure was read against the census and the diff that recorded
+it, and every one is accounted for.
+
+MATRIX-RESULTS
+
 ## Group 4: loop-built findings, next
 
 41 `searched` calls build their findings by pushing inside a loop, which
@@ -229,10 +271,12 @@ over the population `of` names.
 
 ## Group 5: rendered-page floors, next
 
-The e2e floors on what a page rendered (`classroom-groups-controls.spec.ts`
-518, 575, 657, 1760; `feature-words.spec.ts:302`) are runtime populations.
+The e2e floors on what a page rendered are runtime populations: the seven
+listed in `literal-floors.test.ts`'s `GROUP_5` (`classroom-groups-controls`
+four, `classroom-groups-print`, `copy-reaches-a-page`, `feature-words`).
 They are measured per page in the container, since a layout count measured
-on macOS is not the one CI reads.
+on macOS is not the one CI reads, and ratcheted with `floorBreach` like the
+unit floors (#468), which needs the recorder to read a Playwright run.
 
 ## Side findings
 
~~~~

## Task 5: From the matrix: a dead replace removed

R22 stayed GREEN: TypeScript normalises a numeric literal's text, so the replace was dead code.

~~~~diff
diff --git a/tests/literal-floors.ts b/tests/literal-floors.ts
index 0ea443e..dcb845c 100644
--- a/tests/literal-floors.ts
+++ b/tests/literal-floors.ts
@@ -125,7 +125,9 @@ function isParameter(node: ts.Node, name: string): boolean {
 function literalValue(bound: ts.Expression): number | undefined {
   if (ts.isParenthesizedExpression(bound))
     return literalValue(bound.expression);
-  if (ts.isNumericLiteral(bound)) return Number(bound.text.replace(/_/g, ''));
+  // `text` is TypeScript's normalised value: `5_197` reads `5197`, and
+  // `0x1F` reads `31`. The source as written (`getText()`) would not parse.
+  if (ts.isNumericLiteral(bound)) return Number(bound.text);
   if (
     ts.isPrefixUnaryExpression(bound) &&
     bound.operator === ts.SyntaxKind.MinusToken
~~~~

## Task 6: The ledger records the matrix

34 rows, all as predicted.

~~~~diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index 9e677c6..1afe549 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -261,7 +261,22 @@ and were moved below it, so a population that grew never hides a finding.
 Each first figure was read against the census and the diff that recorded
 it, and every one is accounted for.
 
-MATRIX-RESULTS
+The matrix ran 34 rows, all as predicted once R22 was corrected. On
+`develop`, 6 stayed GREEN: a reader one short in `absence-liveness`,
+`git-env`, `duplicate-imports` and `spec-scan`'s forwarded floor, and growth
+through `absence-liveness` and `evidence-recording`'s comparison floor. On the
+branch, 28 turned their guard RED: those six again, `back-translate`'s looped
+locale, the recorder's four refusals and its printed moves, both directions
+of the check, record mode's call site, the CI refusal's words, a workflow
+running the recorder, and eleven against the literal reader (a literal floor
+back, a forwarded bound, the comparison form, a callback's predicate, a
+literal read as written, `expect.poll`, the cross-check alone with its floor
+off, a root skipped, a stale product value, a growing Group 5 list, an id
+spelled twice). R22 first came back GREEN: TypeScript already normalises a
+numeric literal's text, so the `replace` it removed was dead code, and is
+gone. The CI refusal is mutated in its words, not removed, because a
+recorder that ran under the probe would run the suite and could rewrite the
+real `tests/floors.json`.
 
 ## Group 4: loop-built findings, next
 
~~~~

## Task 7: From review pass 1: a floor written backwards is read

Pass 1 finding 1, by reading: `expect(5).toBeLessThan(n)` names the count as the bound, which the reader did not see. No file writes one (measured: 0 literal subjects with a less-than matcher, known positive 2 literal subjects). Planted RED first (2), then read. Matrix row R29.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 5797ca4..a96f983 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -13,7 +13,7 @@
   "device-tool-homes/files": 299,
   "download-readers/byte-reads": 8,
   "duplicate-imports/imports": 1573,
-  "duplication/declarations": 5344,
+  "duplication/declarations": 5346,
   "duplication/files": 343,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/literal-floors.ts b/tests/literal-floors.ts
index dcb845c..91b0dc1 100644
--- a/tests/literal-floors.ts
+++ b/tests/literal-floors.ts
@@ -37,7 +37,7 @@ export interface FloorSite {
    * Set when the floor is a comparison written inside the `expect(...)`
    * argument (`expect(n > 25).toBe(true)`) rather than a matcher.
    */
-  readonly form?: 'comparison';
+  readonly form?: 'comparison' | 'reversed';
 }
 
 export interface FloorReading {
@@ -48,6 +48,9 @@ export interface FloorReading {
 
 const MATCHERS = new Set(['toBeGreaterThan', 'toBeGreaterThanOrEqual']);
 
+/** Read only with a literal SUBJECT: `expect(5).toBeLessThan(n)` is `n > 5`. */
+const REVERSED = new Set(['toBeLessThan', 'toBeLessThanOrEqual']);
+
 /** `expect`, `expect.soft` and `expect.poll`: the roots this repo asserts from. */
 const isExpectRoot = (callee: ts.Expression): boolean =>
   (ts.isIdentifier(callee) && callee.text === 'expect') ||
@@ -260,6 +263,34 @@ export function floorSitesIn(sf: ts.SourceFile): FloorReading {
         else sites.push({ line, kind: 'compared', subject });
       }
     }
+    if (
+      ts.isCallExpression(node) &&
+      ts.isPropertyAccessExpression(node.expression) &&
+      REVERSED.has(node.expression.name.text) &&
+      node.arguments.length === 1
+    ) {
+      const chain = chainOf(node.expression.expression);
+      const [first] = chain.expectCall?.arguments ?? [];
+      const value = first ? literalValue(first) : undefined;
+      if (chain.expectCall && !chain.negated && value !== undefined) {
+        const line =
+          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
+        const subject = collapse(node.arguments[0].getText(sf));
+        if (!Number.isInteger(value))
+          sites.push({ line, kind: 'threshold', subject, form: 'reversed' });
+        else {
+          const demands =
+            node.expression.name.text === 'toBeLessThan' ? value + 1 : value;
+          sites.push({
+            line,
+            kind: demands >= 2 ? 'counted' : 'presence',
+            demands,
+            subject,
+            form: 'reversed',
+          });
+        }
+      }
+    }
     ts.forEachChild(node, visit);
   };
   visit(sf);
diff --git a/tests/unit/literal-floors.test.ts b/tests/unit/literal-floors.test.ts
index 22c794f..be804ac 100644
--- a/tests/unit/literal-floors.test.ts
+++ b/tests/unit/literal-floors.test.ts
@@ -94,6 +94,31 @@ describe('floorSitesIn', () => {
     },
   );
 
+  // Written backwards, the literal is the subject and the count the bound.
+  // No file under tests/ writes one today (measured, review pass 1); read
+  // anyway, because a form the reader cannot see is one nothing refuses.
+  it.each([
+    ['less than', 'expect(5).toBeLessThan(files.length);', 'files.length', 6],
+    ['at most', 'expect(2).toBeLessThanOrEqual(n);', 'n', 2],
+  ])(
+    'reads a floor written backwards, %s, as counted',
+    (_, source, subject, demands) => {
+      expect(read(source)).toEqual({
+        sites: [
+          { line: 1, kind: 'counted', demands, subject, form: 'reversed' },
+        ],
+        refused: [],
+      });
+    },
+  );
+
+  it('reads a ceiling on a count as no floor', () => {
+    expect(read('expect(x.length).toBeLessThan(5);')).toEqual({
+      sites: [],
+      refused: [],
+    });
+  });
+
   it('reads a comparison bounding from above as a ceiling', () => {
     expect(read('expect(x.length < 3).toBe(true);').sites).toEqual([
       { line: 1, kind: 'ceiling', subject: 'x.length', form: 'comparison' },
~~~~

## Task 8: The ledger records review pass 1's row

35 rows, 6 + 29.

~~~~diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index 1afe549..acd5ff5 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -261,18 +261,20 @@ and were moved below it, so a population that grew never hides a finding.
 Each first figure was read against the census and the diff that recorded
 it, and every one is accounted for.
 
-The matrix ran 34 rows, all as predicted once R22 was corrected. On
+The matrix ran 35 rows, all as predicted once R22 was corrected. On
 `develop`, 6 stayed GREEN: a reader one short in `absence-liveness`,
 `git-env`, `duplicate-imports` and `spec-scan`'s forwarded floor, and growth
 through `absence-liveness` and `evidence-recording`'s comparison floor. On the
-branch, 28 turned their guard RED: those six again, `back-translate`'s looped
+branch, 29 turned their guard RED: those six again, `back-translate`'s looped
 locale, the recorder's four refusals and its printed moves, both directions
 of the check, record mode's call site, the CI refusal's words, a workflow
-running the recorder, and eleven against the literal reader (a literal floor
+running the recorder, and twelve against the literal reader (a literal floor
 back, a forwarded bound, the comparison form, a callback's predicate, a
 literal read as written, `expect.poll`, the cross-check alone with its floor
 off, a root skipped, a stale product value, a growing Group 5 list, an id
-spelled twice). R22 first came back GREEN: TypeScript already normalises a
+spelled twice, and a floor written backwards, `expect(5).toBeLessThan(n)`,
+which review pass 1 found unread: no file writes one, and none can now pass
+unseen). R22 first came back GREEN: TypeScript already normalises a
 numeric literal's text, so the `replace` it removed was dead code, and is
 gone. The CI refusal is mutated in its words, not removed, because a
 recorder that ran under the probe would run the suite and could rewrite the
~~~~

## Task 9: From review pass 2: one home for the record's path and variable

Pass 2 findings 4-6. Moved: duplicate-imports +1 (the new import), load-time statements +1 (`RECORD_ENV`).

~~~~diff
diff --git a/scripts/record-floors.mjs b/scripts/record-floors.mjs
index b1febe3..7fbb413 100644
--- a/scripts/record-floors.mjs
+++ b/scripts/record-floors.mjs
@@ -30,9 +30,16 @@ import { tmpdir } from 'node:os';
 import { join } from 'node:path';
 import { env } from 'node:process';
 
-import { die } from './errors.mjs';
+import { die, messageOf } from './errors.mjs';
 
-const FLOORS_FILE = 'tests/floors.json';
+/** The recorded figures: one home, which `tests/floors.ts` imports. */
+export const FLOORS_FILE = 'tests/floors.json';
+
+/**
+ * Set to a file for the run's `floorBreach` calls to append what they saw
+ * to, instead of judging it (`tests/floors.ts`).
+ */
+export const RECORD_ENV = 'FLOORS_RECORD';
 
 /**
  * @typedef {{ id: string, actual: number, site: string }} Observation
@@ -149,14 +156,16 @@ const main = () => {
   const dir = mkdtempSync(join(tmpdir(), 'floors-record-'));
   /** @type {number | null} */
   let status;
+  /** @type {Error | undefined} */
+  let error;
   /** @type {Observation[]} */
   let seen = [];
   try {
     const record = join(dir, 'seen.jsonl');
-    status = spawnSync('npx', ['vitest', 'run'], {
+    ({ status, error } = spawnSync('npx', ['vitest', 'run'], {
       stdio: 'inherit',
-      env: { ...env, FLOORS_RECORD: record },
-    }).status;
+      env: { ...env, [RECORD_ENV]: record },
+    }));
     if (existsSync(record))
       seen = readFileSync(record, 'utf8')
         .split('\n')
@@ -166,6 +175,8 @@ const main = () => {
     rmSync(dir, { recursive: true, force: true });
   }
 
+  // A run that never started has no exit status; its error names why.
+  if (error) die(`the unit suite did not start: ${messageOf(error)}`);
   if (status !== 0)
     die(
       `the unit suite failed in record mode (exit ${status}): nothing recorded`,
diff --git a/tests/floors.json b/tests/floors.json
index a96f983..c3a4ff1 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -12,7 +12,7 @@
   "deprecated-css/declarations": 1170,
   "device-tool-homes/files": 299,
   "download-readers/byte-reads": 8,
-  "duplicate-imports/imports": 1573,
+  "duplicate-imports/imports": 1574,
   "duplication/declarations": 5346,
   "duplication/files": 343,
   "event-collectors/locator-loops": 8,
@@ -43,7 +43,7 @@
   "release-inventory/helper-modules": 60,
   "route-coverage/gate-specs": 3,
   "script-entry/argv-reads": 10,
-  "script-entry/load-time-statements": 319,
+  "script-entry/load-time-statements": 320,
   "shytalk-brand/files": 333,
   "site-pages/pages": 3,
   "sitemap-config/locales": 5,
diff --git a/tests/floors.ts b/tests/floors.ts
index 46c38aa..0f35db7 100644
--- a/tests/floors.ts
+++ b/tests/floors.ts
@@ -27,14 +27,11 @@
 import { appendFileSync, readFileSync } from 'node:fs';
 import { relative } from 'node:path';
 import { fileURLToPath } from 'node:url';
+import { FLOORS_FILE, RECORD_ENV } from '../scripts/record-floors.mjs';
 
-export const FLOORS_FILE = 'tests/floors.json';
-
-/**
- * Set by `scripts/record-floors.mjs` to a file it reads back: while set,
- * every check appends what it saw instead of judging it.
- */
-export const RECORD_ENV = 'FLOORS_RECORD';
+// One home for both, in the recorder that writes the file and sets the
+// variable (review pass 2).
+export { FLOORS_FILE, RECORD_ENV };
 
 export type Floors = Readonly<Record<string, number>>;
 
diff --git a/tests/unit/literal-floors.test.ts b/tests/unit/literal-floors.test.ts
index be804ac..2a07291 100644
--- a/tests/unit/literal-floors.test.ts
+++ b/tests/unit/literal-floors.test.ts
@@ -319,8 +319,9 @@ describe('the floor reader proves what it read (#468)', () => {
   it('counts every floor matcher the code writes, file by file', () => {
     // Independent of the reader's walk (control c): the matcher counted in
     // each file's comment-stripped text, less the ones a string or a regex
-    // literal spells (this file's own MATCHER is one), against what the reader returned for that file, sites and
-    // refusals both. Per file, with no number to drift.
+    // literal spells (this file's own MATCHER is one), against what the
+    // reader returned for that file, sites and refusals both. Per file, with
+    // no number to drift.
     const MATCHER = /\.toBeGreaterThan(?:OrEqual)?\(/g;
     const count = (text: string) => text.match(MATCHER)?.length ?? 0;
     const misread = READINGS.filter(({ file, sites, refused }) => {
~~~~

## Task 10: From review pass 3: comments and messages fit a ratchet

Pass 3 findings 7-11, from reading Task 2 line by line. No floor moved.

~~~~diff
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index 265cad2..f663098 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -281,8 +281,8 @@ describe('absence assertions prove the population they searched', () => {
     ).toBeUndefined();
     // The figure is recorded exactly rather than left comfortably low, for
     // the reason `anchored-presence` records: a control with slack in it is
-    // most of the way back to no control at all. #184 found it at 100 over a real 154, and showed
-    // what that slack costs: with the `toHaveLength(0)` branch of
+    // most of the way back to no control at all. #184 found it at 100 over a
+    // real 154, and showed what that slack costs: with the `toHaveLength(0)` branch of
     // `absenceSubject` dead, this test stayed green. #390 F161 found it
     // there again, at 153 over a real 391, with the same branch dead and
     // the same test green; F159's spellings brought the figure to 394,
diff --git a/tests/unit/anchored-presence.test.ts b/tests/unit/anchored-presence.test.ts
index 5808cdb..9e88e66 100644
--- a/tests/unit/anchored-presence.test.ts
+++ b/tests/unit/anchored-presence.test.ts
@@ -282,8 +282,8 @@ describe('presence assertions over source text are stripped or anchored', () =>
   // stopped matching would report zero findings and zero scanned, and only
   // one of those is good news. `event-collectors.test.ts` settled this shape.
   it('scans the presence assertions that actually read source text', () => {
-    // 76 today, and the figure is worth stating: the floor sat at 20 while the
-    // truth was 27, so a control with that much slack in it is most of the way
+    // The figure is recorded exactly (#468), because slack here has cost
+    // before: the floor sat at 20 while the truth was 27, so a control with that much slack in it is most of the way
     // back to no control at all. #118 moved the number twice -- UP as the
     // derivation learned to follow local bindings to a fixed point, then back
     // DOWN as it stopped reading object-literal keys and parameter names as
diff --git a/tests/unit/device-tool-homes.test.ts b/tests/unit/device-tool-homes.test.ts
index 71bb6ad..ba87ac3 100644
--- a/tests/unit/device-tool-homes.test.ts
+++ b/tests/unit/device-tool-homes.test.ts
@@ -77,6 +77,7 @@ describe.each(HOMES)('no file spawns $tool but $home', ({ tool, home }) => {
     expect(
       floorBreach('device-tool-homes/files', files.length),
     ).toBeUndefined();
+    // The home is among them, so a walk that loses scripts/ fails too.
     expect(files).toContain(home);
   });
 
diff --git a/tests/unit/install-scripts.test.ts b/tests/unit/install-scripts.test.ts
index 3430e2d..f83b2f1 100644
--- a/tests/unit/install-scripts.test.ts
+++ b/tests/unit/install-scripts.test.ts
@@ -86,17 +86,18 @@ describe('the install-script allowlist', () => {
     // if the lockfile stopped reporting install scripts, the derived set and an
     // empty `allowScripts` would agree, and a suite asserting nothing would go
     // green. This repo has shipped two guards that passed because both sides
-    // were empty or both were satisfied by prose. If a dependency change
-    // genuinely leaves NO package running install scripts, this failure is the
-    // prompt to confirm that and delete the suite deliberately — not to weaken
-    // the assertion.
+    // were empty or both were satisfied by prose.
+    //
+    // If a dependency change genuinely leaves NO package running install
+    // scripts, this failure is the prompt to confirm that and delete the
+    // suite deliberately — not to weaken the assertion.
     expect(
       floorBreach(
         'install-scripts/packages',
         packagesWithInstallScripts().length,
       ),
-      'no package in package-lock.json declares an install script — either ' +
-        'the lockfile is not v3, or this control is no longer needed',
+      'packages with an install script moved: fewer can mean a lockfile that ' +
+        'is not v3, or a control no longer needed; more, a new one to approve',
     ).toBeUndefined();
   });
 
diff --git a/tests/unit/pipeline-wiring.test.ts b/tests/unit/pipeline-wiring.test.ts
index 7c542ba..e658b73 100644
--- a/tests/unit/pipeline-wiring.test.ts
+++ b/tests/unit/pipeline-wiring.test.ts
@@ -2634,10 +2634,9 @@ describe('the back-translation review', () => {
       'a change to one of these would not start the review',
     ).toEqual([]);
     // After the verdict, so a population that grew never hides a finding.
-    // The closure is followed, not listed: this is its floor, not its size.
+    // The closure is followed, not listed, and its size is ratcheted (#468).
     expect(
       floorBreach('pipeline-wiring/sanity-import-walk', inputs.length),
-      'the import walk found nothing',
     ).toBeUndefined();
   });
 });
~~~~

## Task 11: From review pass 4: the recorder's refusals of the run itself are tested

Pass 4 finding 14. Moved: duplication/declarations +4, duplicate-imports +1.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index c3a4ff1..0a8e757 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -12,8 +12,8 @@
   "deprecated-css/declarations": 1170,
   "device-tool-homes/files": 299,
   "download-readers/byte-reads": 8,
-  "duplicate-imports/imports": 1574,
-  "duplication/declarations": 5346,
+  "duplicate-imports/imports": 1575,
+  "duplication/declarations": 5350,
   "duplication/files": 343,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/unit/floors.test.ts b/tests/unit/floors.test.ts
index 7f4208d..83daa1c 100644
--- a/tests/unit/floors.test.ts
+++ b/tests/unit/floors.test.ts
@@ -1,5 +1,6 @@
 import { describe, it, expect } from 'vitest';
-import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
+import { spawnSync } from 'node:child_process';
+import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import { join } from 'node:path';
 import { floorBreach, readFloors, FLOORS_FILE } from '../floors';
@@ -210,3 +211,45 @@ describe('floorsText', () => {
     );
   });
 });
+
+describe('record-floors.mjs refuses a run it cannot trust, and writes nothing', () => {
+  // Neither runs the suite: an empty PATH leaves no `npx` to start, and a
+  // stand-in `npx` that exits non-zero fails as a broken suite would. The
+  // stand-in is a stub at the process boundary, the one place a failing run
+  // can be had on demand. Both read the real record before and after.
+  const recordWith = (bin: (dir: string) => void) => {
+    const dir = mkdtempSync(join(tmpdir(), 'floors-path-'));
+    const before = readFileSync(FLOORS_FILE);
+    try {
+      bin(dir);
+      const run = spawnSync(process.execPath, ['scripts/record-floors.mjs'], {
+        encoding: 'utf8',
+        env: { ...process.env, CI: '', PATH: dir },
+      });
+      expect(readFileSync(FLOORS_FILE).equals(before), FLOORS_FILE).toBe(true);
+      return run;
+    } finally {
+      rmSync(dir, { recursive: true, force: true });
+    }
+  };
+
+  it('refuses a suite that did not start, naming why', () => {
+    const run = recordWith(() => {});
+    expect(run.status).toBe(1);
+    expect(run.stderr).toBe(
+      '✗ the unit suite did not start: spawnSync npx ENOENT\n',
+    );
+    expect(run.stdout).toBe('');
+  });
+
+  it('refuses a suite that failed, before judging a single figure', () => {
+    const run = recordWith((dir) => {
+      writeFileSync(join(dir, 'npx'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
+    });
+    expect(run.status).toBe(1);
+    expect(run.stderr).toBe(
+      '✗ the unit suite failed in record mode (exit 3): nothing recorded\n',
+    );
+    expect(run.stdout).toBe('');
+  });
+});
~~~~

## Task 12: From review pass 4: the ledger and CLAUDE.md match the code

Pass 4 findings 12 and 13; the ledger counts 37 rows.

~~~~diff
diff --git a/CLAUDE.md b/CLAUDE.md
index 1e792f9..022d927 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -10,7 +10,7 @@
 - **Page-level `scrollWidth` is not containment.** Content can overflow a _card_ by 34.5px and produce zero document scroll — which is exactly how the Remove button shipped hanging out of the Student details border at every laptop width. Assert against the offending element's own container (`nothing in the roster escapes its card`), not just `document.documentElement`.
 - **A hand-written list of things to check will miss the one that breaks.** The no-horizontal-scroll tests opened `#cg-grouping-toggle` and `#cg-sound-toggle` — added one at a time as each section gained content — and never `#cg-io-toggle`, the only section holding a native `<input type="file">`. Its ~344px intrinsic minimum propagated up `#cg-form`'s grid (items default to `min-width: auto`) and pinned the track to 378px at every viewport: 5px of horizontal scroll at 390px, **74px at 320px**. `max-width: 100%` does not fix this — the automatic minimum reads the element's min-content size, which `max-width` does not change; an explicit `width` replaces it. The replacement test _derives_ every disclosure from the DOM, so a section added later is covered the day it appears.
 - **A guard you have not watched fail is not a guard.** This repo has shipped two that asserted nothing, and both read as correct on the page. The supply-chain sub-path check (#23) was satisfied by `dependabot.yml`'s own **comment** describing the group it was meant to require — no group configured, suite green. #21 Stage 4's first replacement for the prod-smoke path list used `prod.includes(path)`, and `/glory-points` is a substring of `/id/glory-points`: the English assertion passed on the **Indonesian** path, and mutating a path to `/id/glory-pointsXX` left it green because that still contains the needle. **Every guard asserting against source text, config, or a workflow file is mutation-verified in BOTH directions before it lands** — break the thing it protects and watch it fail, then restore it and watch it pass. Strip comments before matching, so the file's documentation cannot satisfy its own guard. Prefer an exact set comparison to a substring test, and assert ORDER where order carries meaning (Dependabot stops at the first matching group). Presence is not the assertion; failure is. **And a mutation that comes back GREEN where you predicted RED has three causes, not one** (#250): the guard is weak, the mutation never reached `dist/`, or the medium made the mutation impossible. A RED is self-proving — the test failed BECAUSE of the change — so only a GREEN needs the built-output check, and that check belongs on the OBSERVED verdict rather than the predicted one, since a wrong prediction is exactly when it is needed. Rule out "never landed" by asserting the mutation's shape in the built bytes (for a REMOVAL, assert the absence WITH a liveness probe beside it, or an empty file list satisfies it for free), and rule out "weak guard" by probing the assertion's own liveness. What remains is an illegal mutation: `max-height: 40px !important` can never shrink a control, because CSS resolves a box as `max(min-height, min(max-height, height))` and a 44px `min-height` beats any smaller max-height however important it is.
-- **A liveness floor is a recorded figure, checked for equality (#468).** A floor written `toBeGreaterThan(measured - 1)` is tight only on the day it is measured, because growth never fails it: `absence-liveness` read 424 an hour after it was set to `> 420`. So a guard proves it read its population with `expect(floorBreach('<id>', count)).toBeUndefined()` (`tests/floors.ts`), placed after its verdict, against the figure in `tests/floors.json`: one unit short fails, and so does one more. When a change grows a population, `npm run floors:record` raises the figure and prints every floor that moved; read each delta against your diff, because a raise smaller than the units you added is a reader that lost some, and put the lines in the commit. It never lowers a figure: a real shrink is a hand edit with the reason in the commit. CI never records. `literal-floors.test.ts` refuses a literal floor demanding two or more, however it is written (a matcher, a parameter, `n > 25` inside an `expect`), unless it bounds a product value and says so. A new test file grows several floors at once, and a new file is invisible to the tracked-file guards until `git add -N`, so add it before recording.
+- **A liveness floor is a recorded figure, checked for equality (#468).** A floor written `toBeGreaterThan(measured - 1)` is tight only on the day it is measured, because growth never fails it: `absence-liveness` read 424 an hour after it was set to `> 420`. So a guard proves it read its population with `expect(floorBreach('<id>', count)).toBeUndefined()` (`tests/floors.ts`), placed after its verdict, against the figure in `tests/floors.json`: one unit short fails, and so does one more. When a change grows a population, `npm run floors:record` raises the figure and prints every floor that moved; read each delta against your diff, because a raise smaller than the units you added is a reader that lost some, and put the lines in the commit. It never lowers a figure: a real shrink is a hand edit with the reason in the commit. CI never records. `literal-floors.test.ts` refuses a literal floor demanding two or more, however it is written (a matcher, a parameter, `n > 25` inside an `expect`, or backwards as `expect(5).toBeLessThan(n)`), unless it bounds a product value and says so. A new test file grows several floors at once, and a new file is invisible to the tracked-file guards until `git add -N`, so add it before recording.
 - **No message may put a closing keyword next to an issue number — not even one you mean.** `close`/`fix`/`resolve` and their inflections, beside `#<n>`, are refused in a commit message (`.githooks/commit-msg`) and in a pull request body (`.github/workflows/pr-body.yml`), both through one home: `scripts/closing-keywords.mjs`. GitHub's parser has no model of negation, tense or intent, and it has retired an issue here **twice** — once from a sentence in capitals saying the issue must stay open, once from a body promising to retire it by hand later. There is deliberately **no exception**, because no such keyword appears in the last 300 commit bodies or 40 pull request bodies: the capability an exception would preserve has never been used, and an allowance branch nothing exercises is the vacuity #118 was filed about. Write `Refs #<n>`, and retire an issue with `gh issue close <n>` once the work is verified. Check a body before it reaches GitHub with `node scripts/closing-keywords.mjs <file> "this pull request body"`. The workflow re-runs on `edited` — a body edited after a green run is how such a sentence gets written — and is **not a gate** until `closing-keywords` joins `required_status_checks.contexts`, which is repository administration and so the operator's (#278).
 - **Locale files are a review surface.** Every catalogue is typed `Catalogue`, so `npm run typecheck` (`astro check`, run in CI) fails on a missing key; it cannot read copy, so tests hold the rest. `tests/unit/i18n.test.ts` and `dead-copy.test.ts`: blank values, untranslated copy, copy no page renders. `locale-fallbacks.test.ts`: English left in zh, vi and th. `message-parity.test.ts`: every language fills the slots English fills, offers the choices it offers, and has exactly its own plural forms. `label-check.test.ts` and `verified-labels.test.ts`: a label of three words or fewer is checked against its own locale's copy that uses its English and says more, and one that disagrees, or that a namesake renders in other words, is either pinned or listed as awaiting the operator's read (#161). A label can be translated, non-blank and slot-perfect and still name the wrong thing: `Tình dục` passed every other guard here for a month. Messages are templates (#136) — English decides which entries are messages — and zh/vi/th wording is a DeepL draft until a speaker has reviewed it.
 - **The e2e suite measures `dist/`**, not the dev server (`playwright.config.ts` builds and previews). Anything asserted against `astro dev` is asserting about bytes nobody receives.
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index acd5ff5..34a5391 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -243,8 +243,9 @@ units while its reader loses three records +2 (operator, 2026-10-03). #469
 gives each guard the number-free cross-check that catches that mechanically.
 
 `literal-floors.test.ts` keeps it that way. Its reader classifies every
-`toBeGreaterThan(OrEqual)` under `tests/`, and every comparison with a
-literal inside an `expect` argument, as presence, counted, forwarded,
+`toBeGreaterThan(OrEqual)` under `tests/`, every comparison with a literal
+inside an `expect` argument, and every `toBeLessThan(OrEqual)` whose subject
+is a literal (a floor written backwards), as presence, counted, forwarded,
 compared, threshold or ceiling, and refuses anything else by line. A
 counted or forwarded floor must be ratcheted, or listed as a product value
 with its reason (a 44px target, a grouping statistic), or be one of the
@@ -252,21 +253,24 @@ seven Playwright floors Group 5 ratchets (that list may only shrink). Its
 cross-check counts the matcher per file in the comment-stripped text, less
 what string and regex literals spell; no number drifts in it.
 
-Converted: 43 unit floors, `spec-scan`'s helper (whose number was a
-parameter, which no literal search sees) and its five callers,
-`back-translate`'s four locales, and `evidence-recording`'s two floors
-written as `acting.length > 25` inside a `toEqual`, which the reader first
-missed and now plants. Sixteen sat before their verdict in the same test
+Converted, as 52 recorded ids: 41 floors written in place; `spec-scan`'s
+helper, whose number was a parameter no literal search sees, as one id for
+each of its five callers; `back-translate`'s floor, one id per locale (4);
+and `evidence-recording`'s two floors written as `acting.length > 25` inside
+a `toEqual`, which the reader first missed and now plants. With
+`absence-liveness`'s three and the meta-guard's own count, `floors.json`
+holds 56. Sixteen sat before their verdict in the same test
 and were moved below it, so a population that grew never hides a finding.
 Each first figure was read against the census and the diff that recorded
 it, and every one is accounted for.
 
-The matrix ran 35 rows, all as predicted once R22 was corrected. On
+The matrix ran 37 rows, all as predicted once R22 was corrected. On
 `develop`, 6 stayed GREEN: a reader one short in `absence-liveness`,
 `git-env`, `duplicate-imports` and `spec-scan`'s forwarded floor, and growth
 through `absence-liveness` and `evidence-recording`'s comparison floor. On the
-branch, 29 turned their guard RED: those six again, `back-translate`'s looped
-locale, the recorder's four refusals and its printed moves, both directions
+branch, 31 turned their guard RED: those six again, `back-translate`'s looped
+locale, four of the recorder's refusals (a fall, a stale id, two places,
+two values) and its printed moves, both directions
 of the check, record mode's call site, the CI refusal's words, a workflow
 running the recorder, and twelve against the literal reader (a literal floor
 back, a forwarded bound, the comparison form, a callback's predicate, a
@@ -274,7 +278,10 @@ literal read as written, `expect.poll`, the cross-check alone with its floor
 off, a root skipped, a stale product value, a growing Group 5 list, an id
 spelled twice, and a floor written backwards, `expect(5).toBeLessThan(n)`,
 which review pass 1 found unread: no file writes one, and none can now pass
-unseen). R22 first came back GREEN: TypeScript already normalises a
+unseen), and, from review pass 4, the recorder's refusals of a suite that
+did not start and of one that failed, which no test had reached; each is now
+run with a `PATH` that has no `npx`, or a stand-in that exits 3, and the
+real record read before and after. R22 first came back GREEN: TypeScript already normalises a
 numeric literal's text, so the `replace` it removed was dead code, and is
 gone. The CI refusal is mutated in its words, not removed, because a
 recorder that ran under the probe would run the suite and could rewrite the
~~~~

## Task 13: From review pass 5: one test per case, and a claim made true

Pass 5 findings 15-17. No floor moved; 3601 tests.

~~~~diff
diff --git a/tests/floors.ts b/tests/floors.ts
index 0f35db7..69befae 100644
--- a/tests/floors.ts
+++ b/tests/floors.ts
@@ -15,8 +15,9 @@
  * that grew, and `npm run floors:record` raises it. Neither direction moves
  * on its own, so every floor is exact on every commit.
  *
- * Runner-neutral: vitest and Playwright both call it, so it imports neither
- * and returns the breach as text for the caller's own `expect`:
+ * Runner-neutral: vitest calls it today and Playwright will (#446 Group 5),
+ * so it imports neither and returns the breach as text for the caller's own
+ * `expect`:
  *
  *     expect(floorBreach('absence-liveness/sites', sites.length)).toBeUndefined();
  *
diff --git a/tests/unit/floors.test.ts b/tests/unit/floors.test.ts
index 83daa1c..2a9ae89 100644
--- a/tests/unit/floors.test.ts
+++ b/tests/unit/floors.test.ts
@@ -50,19 +50,27 @@ describe('floorBreach', () => {
     expect(FLOORS_FILE).toBe('tests/floors.json');
   });
 
-  it.each([
-    ['a fraction', 9.5],
-    ['a negative', -1],
-    ['NaN', Number.NaN],
-    ['infinity', Number.POSITIVE_INFINITY],
-  ])('refuses %s as a count, recording or not', (_, actual) => {
+  // One test per value and mode, never a loop inside one (one-test-per-case).
+  it.each(
+    (
+      [
+        ['a fraction', 9.5],
+        ['a negative', -1],
+        ['NaN', Number.NaN],
+        ['infinity', Number.POSITIVE_INFINITY],
+      ] as const
+    ).flatMap(([what, actual]) =>
+      (['judging', 'recording'] as const).map(
+        (mode) => [what, mode, actual] as const,
+      ),
+    ),
+  )('refuses %s as a count while %s', (_, mode, actual) => {
     const dir = mkdtempSync(join(tmpdir(), 'floors-'));
     try {
-      const record = join(dir, 'seen.jsonl');
-      for (const mode of [null, record])
-        expect(
-          floorBreach('guard/units', actual, { ...judging, record: mode }),
-        ).toBe(`guard/units: ${actual} is not a count`);
+      const record = mode === 'recording' ? join(dir, 'seen.jsonl') : null;
+      expect(floorBreach('guard/units', actual, { ...judging, record })).toBe(
+        `guard/units: ${actual} is not a count`,
+      );
     } finally {
       rmSync(dir, { recursive: true, force: true });
     }
@@ -82,12 +90,11 @@ describe('floorBreach', () => {
         .trimEnd()
         .split('\n')
         .map((line) => JSON.parse(line) as Record<string, unknown>);
-      expect(lines.map(({ id, actual }) => [id, actual])).toEqual([
-        ['guard/units', 12],
-        ['guard/new', 3],
+      const here = expect.stringMatching(/^tests\/unit\/floors\.test\.ts:\d+$/);
+      expect(lines).toEqual([
+        { id: 'guard/units', actual: 12, site: here },
+        { id: 'guard/new', actual: 3, site: here },
       ]);
-      for (const { site } of lines)
-        expect(site).toMatch(/^tests\/unit\/floors\.test\.ts:\d+$/);
     } finally {
       rmSync(dir, { recursive: true, force: true });
     }
~~~~

## Mutation matrix

`.superpowers/sdd/floors/m468.py`, copied from #446 Group 3's runner,
vitest only. Every anchor must occur exactly once; a run that cannot start is
NOT-RUN and a target naming no test is ABSENT, never GREEN. The whole file
runs per row. A row is predicted for one tree: develop holds literal floors
where the branch holds `floorBreach`, so each pair is two rows.

| Id | Mutation | `develop` | branch |
| --- | --- | --- | --- |
| D1 / R1 | `absence-liveness` reads one site short | GREEN | RED |
| D2 / R2 | its population grew by one | GREEN | RED |
| D3 / R3 | `git-env`'s child run reads one test short | GREEN | RED |
| D4 / R4 | `duplicate-imports` reads one import short | GREEN | RED |
| D5 / R5 | `spec-scan`'s forwarded floor reads one short | GREEN | RED |
| D6 / R6 | `evidence-recording`'s comparison floor grew by one | GREEN | RED |
| R7 | `back-translate`, a looped locale, reads one short | — | RED |
| R8 | the recorder lets a figure fall | — | RED |
| R9 | it keeps a stale id | — | RED |
| R10 | it accepts an id from two places | — | RED |
| R11 | it accepts an id reading two values | — | RED |
| R12 | its moves leave out a new id | — | RED |
| R13 | growth passes the check | — | RED |
| R14 | a short reader passes the check | — | RED |
| R15 | record mode loses the call site | — | RED |
| R16 | the CI refusal stops naming itself | — | RED |
| R17 | a workflow runs the recorder | — | RED |
| R18 | a literal floor comes back (`spec-dirs`) | — | RED |
| R19 | a forwarded bound reads as compared | — | RED |
| R20 | a comparison floor is unread | — | RED |
| R21 | a callback's predicate reads as a floor | — | RED |
| R22 | a numeric literal is read as written | — | RED |
| R23 | `expect.poll` is not a root | — | RED |
| R24 | the cross-check alone: the reader blind to `OrEqual`, its floor off | — | RED |
| R25 | an unreadable root is skipped | — | RED |
| R26 | a product value outlives its floor | — | RED |
| R27 | the Group 5 list grows | — | RED |
| R28 | a recorded id is spelled twice | — | RED |
| R29 | a floor written backwards is unread (review pass 1) | — | RED |
| R30 | a suite that did not start is judged (review pass 4) | — | RED |
| R31 | a suite that failed is judged (review pass 4) | — | RED |

37 rows: 6 on `develop`, 31 on the branch. R16 mutates the refusal's words,
not the refusal: a recorder that ran under the probe would run the suite and
could rewrite the real `tests/floors.json`.

## Review passes

`.superpowers/sdd/floors/p468-pass.sh <n>` copies the tools into `pass<n>.d/`
and runs from that snapshot. It resets `../shyden.co.uk-468-pass` to
`4d07565`, applies each task's diff from THIS document with `git apply`,
commits each, and refuses unless the applied tree equals the branch tree
(this document aside). Then: `astro check` (three summary lines, all 0),
`prettier --check .`, the whole unit suite, `npm run floors:record` on the
applied tree (it must report that every floor already matches and leave the
tree clean), and the matrix on `develop` and on the applied tree. After the
script, the pass reads the whole document. The loop ends at a pass that finds
nothing.

## Pass log

### Pass 1 (2026-10-03, 20:58Z, tree `bd640c8`)

Mechanical, by `p468-pass.sh 1`: the six task diffs applied to `4d07565`
equal the branch; `astro check` 0/0/0; prettier clean; unit 3592/3592;
`npm run floors:record` on the applied tree: every floor already matches,
tree clean; matrix 6 + 28 as predicted, 0 mismatches. CLEAN.

Reading: the head, every task note, the matrix, review and log sections,
and `tests/literal-floors.ts` in its final form. (Pass 2 corrected this line,
which first claimed the whole document: Task 2's migration diff was not read
line by line.)

1. A floor written backwards, `expect(5).toBeLessThan(files.length)`, puts
   the count in the bound, and the reader saw only `toBeGreaterThan(OrEqual)`
   and comparisons, so it passed the meta-guard unclassified. Measured: no
   file under `tests/` writes one (0 literal subjects with a less-than
   matcher; the probe's known positive, any literal subject, found 2), and
   no file imports `node:assert` or writes chai's `should`/`assert`. Fixed
   (Task 7): read and planted, a ceiling on a count stays no floor; matrix
   row R29; the ledger counts 35 rows (Task 8).

One finding; the loop continues.

### Pass 2 (2026-10-03, 21:03Z, tree `86011d0`)

Mechanical, by `p468-pass.sh 2`: the eight task diffs applied to `4d07565`
equal the branch; `astro check` 0/0/0; prettier clean; unit 3595/3595;
`npm run floors:record` on the applied tree: every floor already matches,
tree clean; matrix 6 + 29 as predicted, 0 mismatches. CLEAN.

Reading: the head, every task note, the matrix, review and log sections,
and in their final form `tests/unit/literal-floors.test.ts` (lists, verdict,
controls) and `scripts/record-floors.mjs` (`main`).

2. Pass 1's log claimed it read the whole document; it read the sections
   above and one module. Corrected in place.
3. The Design bullet for `tests/literal-floors.ts` wrapped raggedly after
   pass 1's edit. Rewrapped.
4. The cross-check's comment in `literal-floors.test.ts` held one line far
   past the margin. Rewrapped (Task 9).
5. `FLOORS_FILE` and `FLOORS_RECORD` were spelled in two homes,
   `tests/floors.ts` and `scripts/record-floors.mjs`: two copies drift. The
   recorder holds both and `floors.ts` imports them (Task 9).
6. A recorder whose `npx` cannot start refused with `exit null`, naming the
   symptom; it now refuses with the spawn error (Task 9).

Five findings; the loop continues.

### Pass 3 (2026-10-03, 21:08Z, tree `80cab13`)

Mechanical, by `p468-pass.sh 3`: the nine task diffs applied to `4d07565`
equal the branch; `astro check` 0/0/0; prettier clean; unit 3595/3595;
`npm run floors:record` on the applied tree: every floor already matches,
tree clean; matrix 6 + 29 as predicted, 0 mismatches. CLEAN.

Reading: Task 2's diff, every changed line outside the new test file (503
lines), then each migrated call's final form, and every comment within
seven lines above a `floorBreach` call scanned for a stated count.

7. `anchored-presence` said "76 today" beside a figure that now lives in
   `floors.json`: a comment that drifts the way the floor used to. Reworded.
8. The stale-comment sweep took a clause that was not stale:
   `device-tool-homes` explained that the home is among the files, which
   its `toContain(home)` still asserts. Restored.
9. `pipeline-wiring` said of the import walk "this is its floor, not its
   size"; ratcheted, the floor is its size. Reworded.
10. Two migrated calls kept messages written for a floor that can only fail
    low: "the import walk found nothing", and install-scripts' "no package
    declares an install script". A ratchet also fails on growth, where those
    headlines would mislead. One dropped (the breach names everything), one
    made two-sided.
11. `install-scripts` lost a paragraph break in the rewrap, and one
    `absence-liveness` line ran past the margin. Both restored.

The scan found no other comment stating a current count; the rest are dated
history. Five findings; the loop continues.

### Pass 4 (2026-10-03, 21:13Z, tree `eb2063a`)

Mechanical, by `p468-pass.sh 4`: the ten task diffs applied to `4d07565`
equal the branch; `astro check` 0/0/0; prettier clean; unit 3595/3595;
`npm run floors:record` on the applied tree: every floor already matches,
tree clean; matrix 6 + 29 as predicted, 0 mismatches. CLEAN.

Reading: the ledger's ratchet section and the CLAUDE.md bullet in full,
each claim checked against `tests/floors.json` (56 ids, counted by guard)
and the code; the matrix rows against `main()`'s branches.

12. The ledger counted "43 unit floors" and then `spec-scan`'s helper and
    `back-translate`'s locales again: the 43 were sites, two of which carry
    nine ids. It now counts 52 converted ids and 56 recorded (Task 12; the
    AC4 row above too).
13. The ledger's reader description and the CLAUDE.md bullet predated pass
    1 and did not name the backwards form (Task 12).
14. `main()` refuses a suite that did not start and one that failed, and no
    test or matrix row reached either branch. Both are now run at the
    process boundary, with no `npx` on `PATH` or a stand-in that exits 3,
    so the suite never runs, and the real record is read before and after;
    matrix rows R30 and R31 (Task 11). Recording that test first failed in
    record mode: `anchored-presence` refused `toContain` on a process's
    stderr, so each refusal is pinned whole.

Three findings; the loop continues.

### Pass 5 (2026-10-03, 21:20Z, tree `84b108b`)

Mechanical, by `p468-pass.sh 5`: the twelve task diffs applied to
`4d07565` equal the branch; `astro check` 0/0/0; prettier clean; unit
3597/3597; `npm run floors:record` on the applied tree: every floor already
matches, tree clean; matrix 6 + 31 as predicted (R30 and R31 RED), 0
mismatches. CLEAN.

Reading: `tests/floors.ts`' header and the CLAUDE.md bullet in full, and
`tests/unit/floors.test.ts` in its final form, the last of the new code no
earlier pass had read whole.

15. `tests/floors.ts` said vitest and Playwright both call it; only vitest
    does until #446 Group 5. Made true (Task 13).
16. `floors.test.ts` looped the two modes, judging and recording, inside
    each refused value: a population known before the run, inside one test,
    which the global one-test-per-case rule forbids. Generated per value and
    mode, eight tests (Task 13).
17. Its record-mode test looped over the lines it wrote to check each site.
    One assertion now holds both (Task 13).

Three findings; the loop continues.

### Pass 6 (2026-10-03, 21:26Z, tree `df95252`)

Mechanical, by `p468-pass.sh 6`: the thirteen task diffs applied to
`4d07565` equal the branch; `astro check` 0/0/0; prettier clean; unit
3601/3601; `npm run floors:record` on the applied tree: every floor already
matches, tree clean; matrix 6 + 31 as predicted, 0 mismatches. CLEAN.

Reading: Task 13's diff, the head and its AC table against the task list,
and the pass log. Nothing found.

**Approved at pass 6**: a pass whose run and reading both found nothing.
17 findings across passes 1-5, all fixed.
