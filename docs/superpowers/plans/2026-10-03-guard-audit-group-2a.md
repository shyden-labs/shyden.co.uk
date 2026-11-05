# Guard Liveness, Group 2a: Nine Construct Guards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every guard that hunts a construct inside files, while proving only that files were opened, proves instead that it judged the construct's own units: counted inside the verdict, held to a tight floor, cross-checked by an independent reader, refusing what it cannot read, and RED on every form the code writes.

**Architecture:** Each guard's reader returns what it judged beside what it found, so the population in `searched(…)` comes from the walk that made the verdict, never from a second walk. The five guards that share `tests/unit/spec-scan.ts` get this through its contract (`Reading`, `Liveness`), and the other eight sites each in place. Every new control is proved by the mutation matrix in Task 9, run on the old tree (the guard stays GREEN, so the gap was real) and on the new one (the guard goes RED).

**Tech Stack:** Vitest, Playwright (`content` project), TypeScript compiler API through `tests/unit/ast.ts`, the repo's own `searched` (`tests/source-files.ts`).

**Spec:** issue #446 (the critical rule, its controls (a)-(e)) and the ledger `docs/reviews/2026-10-03-guard-liveness-ledger.md`, Group 2. Read the ledger's Group 2 section before any task.

## Global Constraints

- The CRITICAL guard rule (operator, 2026-10-02): every guard carries (a) the population at the judged level inside the verdict, (b) a floor at the measured figure minus one with the figure in a comment, (c) an independent cross-check that a unit whose raw text plainly holds the construct was read as at least one, (d) fail-closed parsing that names what it cannot classify, and (e) the construct planted in each form the code writes it, going RED.
- One test per case: a population known before the run is generated as one test each (`it.each`), never looped inside one test.
- A retry is not a fix: none anywhere.
- No new dependency. No closing keyword beside an issue number: write `Refs #446`.
- Merge into `develop` with a merge commit, never a squash.
- When a meta-guard flags new code, change the code, never the meta-guard.

## Review Focus

1. **A reader blind to one form passes a count that a different form fills.** Every floor here is tight, so any drop goes RED. A cross-check sits after its floor in the same test, so a mutation that drops the count fails on the floor and never reaches it: each cross-check is therefore mutated alone, with its floor switched off and one file or one form blinded (Task 9, S3 and X1-X12).
2. **A cross-check that shares the reader's pattern is not independent.** Each pair here reads by different means: the parse tree against a text scan (`event-collectors`, `script-entry` argv, `capture-after-assertion`, `download-readers`, `duplicate-imports`, and the three declaration guards through `declaresTests`), a text scan against a region or rule reader (`no-dated-render`'s `HOLDS_CODE`, `deprecated-css`'s `HOLDS_CSS`), and the statement filter against the rule's own loop (`script-entry` load-time). `pipeline-wiring`'s check is raw text against the parsed YAML: the same pattern over two media, so its pattern is proved by four planted forms instead, and the plan says so.
3. **A form the code writes today that a reader never saw.** Measured: `formTextsUnderAA` (`tests/e2e/helpers.ts:566`) loops a spread `.all()` list that `event-collectors` counted as no loop (7 loops, really 8). `script-entry` could not see `process.argv` destructured, sliced from 1, read `.at(1)` or passed on whole. `capture-after-assertion` had no synthetic test at all.
4. **A file in a judged directory that is not the kind the reader expects.** `pipeline-wiring` skipped a non-YAML file in `.github/workflows/` with a silent `continue`; it is now named. `event-collectors` now names any `.all()` list it cannot follow.
5. **A blank reading counted as a reading.** `searched` content-checks an array, so every population here is passed as the units themselves (texts, views, declarations), never as a count.

## Measured on 2026-10-03, at `6d07d37` (develop after #463)

| Guard | Judged unit | Measured | Floor |
| --- | --- | --- | --- |
| `isolated-context-tagging` | tests read | 638 | > 637 |
| `viewport-tagging` | tests and groups read | 771 | > 770 |
| `parked-tests` | tests and groups read | 771 | > 770 |
| `download-readers` | download byte reads | 8 | > 7 |
| `capture-after-assertion` | evidence captures | 143 | > 142 |
| `no-dated-render` | `.astro` code and markup views | 46 | > 45 |
| `deprecated-css` | declarations under `src/` | 1170 | > 1169 |
| `duplicate-imports` | imports read, namespace imports included | 1512 | > 1511 |
| `event-collectors` | locator loops | 8 (7 before the spread form) | > 7 |
| `pipeline-wiring` dangling refs | workflow file references | 19 | > 18 |
| `script-entry` argv | reads of `process.argv` | 10 | > 9 |
| `script-entry` load-time | load-time statements | 313 | > 312 |
| `copy-reaches-a-page` dissolved | built pages read | 16 | > 15 |

## Files

- Modify `tests/unit/spec-scan.ts`: `Reading`, `Liveness`, `declarationsRead`, and the three assertions in `expectNothingFound` (Task 1).
- Modify `tests/playwright-declarations.ts`: `declaresTests`, the one home for the text cross-check (Task 1).
- Modify `tests/unit/one-test-per-case.test.ts`: use `declaresTests` (Task 1).
- Modify the five `spec-scan` callers (Task 1), `no-dated-render.test.ts` (Task 2), `deprecated-css.test.ts` (Task 3), `event-collectors.test.ts` (Task 4), `pipeline-wiring.test.ts` (Task 5), `script-entry.test.ts` (Task 6), `tests/e2e/copy-reaches-a-page.spec.ts` and `dissolved-company.test.ts` (Task 7), `duplicate-imports.test.ts` (Task 8).
- Modify `docs/reviews/2026-10-03-guard-liveness-ledger.md`: Group 2a's sites marked done (Task 10).

### Where it runs

On a branch `446-guard-audit-2a` from `develop` at `6d07d37`, in a new worktree `../shyden.co.uk-446b` with its own `npm ci` (never a symlinked `node_modules`). The session tools (`g2a_plan.py`, `g2a_mut.py`, `g2a-pass.sh`) live in `../shyden.co.uk-446/.superpowers/sdd/446/`, git-ignored and outside `$TMPDIR`.

### How a review pass runs this plan

Every patch below is the exact diff of the prototype that was run. A pass runs `zsh g2a-pass.sh` from the tools' home: it resets a scratch `develop` worktree (`../shyden.co.uk-446p`), applies every `diff` block in order with `g2a_plan.py --apply` (refusing on the first that does not apply), checks the result equals the prototype, puts this plan in place, and runs the whole unit suite, `npm run typecheck`, `npx prettier --check .` and the closing-keyword check. The pass then runs the `content` project for Task 7 and the matrix `g2a_mut.py` on both trees, and reads every row against its prediction, and then the whole document.

### Why the tests and the code land in one patch

For a liveness control, the corpus is the fixture: the new floor and cross-check pass the day they are written, because the corpus is healthy. Their RED is the mutation that blinds the reader (Task 9), run on both trees. The two tasks that change what a reader can see (Task 4's spread form, Task 6's argv forms) are proved RED first by the same matrix: E1 puts back the old blindness and the new test goes RED, and A1 plants the newly seen form in a script, where the old tree stays GREEN.

---

### Task 1: The spec-scan contract counts the unit each guard judges

Five guards (`isolated-context-tagging`, `viewport-tagging`, `parked-tests`, `download-readers`, `capture-after-assertion`) end with `expectNothingFound(analyze)`, which proved only that files under the spec directories were opened. Each reader now returns a `Reading` (`judged` and `findings`), and `expectNothingFound(read, liveness)` asserts, in order: the findings are empty over `judged`, `judged` is above the measured floor, and no file that the independent reader `liveness.carries` says holds the construct was judged as holding none. The three readers that judge declarations share `declarationsRead(what, moreThan)`, whose cross-check is `declaresTests`, moved out of `one-test-per-case.test.ts` into `tests/playwright-declarations.ts` so there is one home for it. `download-readers` now counts byte reads (the home's own calls included), replacing its file-level floor. `capture-after-assertion` counts captures, with a parse-tree check for `shoot` calls that replaces `capturesSeen`, and gains the synthetic self-tests it never had.

**Files:** `tests/unit/spec-scan.ts`, `tests/playwright-declarations.ts`, `tests/unit/one-test-per-case.test.ts`, `tests/unit/isolated-context-tagging.test.ts`, `tests/unit/viewport-tagging.test.ts`, `tests/unit/parked-tests.test.ts`, `tests/unit/download-readers.test.ts`, `tests/unit/capture-after-assertion.test.ts`

**Interfaces:**
- Produces: `type Reading = { judged: readonly string[]; findings: readonly string[] }`, `type Analyze = (file, source) => Reading`, `type Liveness = { what; moreThan; carries(file, source): boolean }`, `declarationsRead(what: string, moreThan: number): Liveness`, `expectNothingFound(analyze: Analyze, liveness: Liveness): void`, and `declaresTests(text: string): boolean` from `tests/playwright-declarations.ts`.

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/playwright-declarations.ts b/tests/playwright-declarations.ts
index 3b1cf54..6c0c477 100644
--- a/tests/playwright-declarations.ts
+++ b/tests/playwright-declarations.ts
@@ -1,4 +1,5 @@
 import ts from 'typescript';
+import { withoutTsComments } from './unit/source-text';
 
 /**
  * Playwright's declarations, read from the parse tree (#218).
@@ -227,6 +228,18 @@ function declarationOf(
   };
 }
 
+/** `test(`, or a `test.<modifier>(` form, as text. */
+const DECLARES_TESTS = /(?<![\w.])test(?:\.(?:only|skip|fixme|fail))*\s*\(/;
+
+/**
+ * True where `text`, comments stripped, calls `test(` or a `test.<modifier>(`
+ * form. Read as text, independently of the parse tree, so a guard can
+ * cross-check its reader: a file this holds for, and the reader found no test
+ * in, is a form the reader has gone blind to (#390, #446).
+ */
+export const declaresTests = (text: string): boolean =>
+  DECLARES_TESTS.test(withoutTsComments(text));
+
 /** Every test and group `sf` declares, in source order. */
 export function declarationsIn(sf: ts.SourceFile): Declaration[] {
   return callsIn(sf).flatMap((call) => {
diff --git a/tests/unit/capture-after-assertion.test.ts b/tests/unit/capture-after-assertion.test.ts
index 1b9964d..5377a7b 100644
--- a/tests/unit/capture-after-assertion.test.ts
+++ b/tests/unit/capture-after-assertion.test.ts
@@ -1,7 +1,7 @@
-import { readFileSync } from 'node:fs';
+import ts from 'typescript';
 import { describe, it, expect } from 'vitest';
-import { specDirs } from '../spec-dirs';
-import { searched, tsFilesUnder } from '../source-files';
+import { callsIn } from '../playwright-declarations';
+import { parseSource } from './ast';
 import { blankCommentLines } from './source-text';
 import { expectNothingFound, type Analyze } from './spec-scan';
 
@@ -54,6 +54,7 @@ const ASSERTION = /\bexpect(?:[A-Z]\w*)?\s*\(|\btoHaveScreenshot\s*\(/;
 const CAPTURE = /\bshoot\s*\(/;
 
 const capturesBeforeAssertion: Analyze = (file, source) => {
+  const judged: string[] = [];
   const findings: string[] = [];
   let asserted = false;
 
@@ -63,6 +64,7 @@ const capturesBeforeAssertion: Analyze = (file, source) => {
       if (SCOPE.test(line)) asserted = false;
       if (ASSERTION.test(line)) asserted = true;
       if (CAPTURE.test(line)) {
+        judged.push(`${file}:${index + 1}`);
         if (!asserted) {
           findings.push(
             `${file}:${index + 1} — shoot() runs before anything is asserted, ` +
@@ -73,42 +75,107 @@ const capturesBeforeAssertion: Analyze = (file, source) => {
       }
     });
 
-  return findings;
+  return { judged, findings };
 };
 
 /**
- * Every capture site the scan above can see, as `file:line`.
- *
- * The liveness control for this guard, and it is a different question from the
- * one `expectNothingFound` already answers. That control proves FILES were
- * scanned; it cannot notice that `shoot` was renamed, which would leave the
- * scan matching nothing and reporting a clean tree forever. #112 is the
- * precedent: the guard written to remove a vacuity class carried that class
- * itself, because its own control was never mutated.
+ * True where the file calls `shoot`, read from the parse tree: independent of
+ * the line scan above, so a scan gone blind to a capture's spelling is caught
+ * by the file it judged none in (#446).
  */
-const capturesSeen = (): string[] =>
-  specDirs()
-    .flatMap(tsFilesUnder)
-    .flatMap((file) =>
-      blankCommentLines(readFileSync(file, 'utf8'))
-        .split('\n')
-        .flatMap((line, index) =>
-          CAPTURE.test(line) ? [`${file}:${index + 1}`] : [],
-        ),
-    );
+const callsShoot = (file: string, source: string): boolean =>
+  callsIn(parseSource(source, file)).some(({ expression }) =>
+    ts.isIdentifier(expression)
+      ? expression.text === 'shoot'
+      : ts.isPropertyAccessExpression(expression) &&
+        expression.name.text === 'shoot',
+  );
 
-describe('an evidence capture documents an assertion that already passed', () => {
-  it('never runs before the assertion it claims to document', () => {
-    expectNothingFound(capturesBeforeAssertion);
+describe('capturesBeforeAssertion -- the scan proven on synthetic input', () => {
+  const scan = (...lines: string[]) =>
+    capturesBeforeAssertion('synthetic.spec.ts', lines.join('\n'));
+
+  it('judges every capture and passes one after an assertion', () => {
+    expect(
+      scan(
+        "test('x', async () => {",
+        '  await expect(page).toHaveTitle(/x/);',
+        "  await shoot(page, 'x');",
+        '});',
+      ),
+    ).toEqual({ judged: ['synthetic.spec.ts:3'], findings: [] });
+  });
+
+  it('names a capture taken before anything is asserted', () => {
+    expect(
+      scan("test('x', async () => {", "  await shoot(page, 'x');", '});')
+        .findings,
+    ).toEqual([
+      'synthetic.spec.ts:2 — shoot() runs before anything is asserted, so a present image is not the result',
+    ]);
+  });
+
+  it('counts a helper named expectSomething, and a method of that name', () => {
+    expect(
+      scan(
+        "test('x', async () => {",
+        '  await expectNoHorizontalScroll(page);',
+        "  await shoot(page, 'a');",
+        '  await reported.expectNone();',
+        "  await evidence.shoot(page, 'b');",
+        '});',
+      ),
+    ).toEqual({
+      judged: ['synthetic.spec.ts:3', 'synthetic.spec.ts:5'],
+      findings: [],
+    });
   });
 
-  it('is reading real captures, so a clean scan means something', () => {
-    const captures = capturesSeen();
+  it('does not let a second capture lean on the first one’s assertion', () => {
     expect(
-      searched(captures, {
-        of: captures,
-        what: 'evidence captures in the spec directories',
-      }),
-    ).not.toEqual([]);
+      scan(
+        "test('x', async () => {",
+        '  await expect(page).toHaveTitle(/x/);',
+        "  await shoot(page, 'a');",
+        "  await shoot(page, 'b');",
+        '});',
+      ).findings,
+    ).toHaveLength(1);
+  });
+
+  it('does not carry an assertion across into the next test', () => {
+    expect(
+      scan(
+        "test('a', async () => {",
+        '  await expect(page).toHaveTitle(/x/);',
+        '});',
+        "test('b', async () => {",
+        "  await shoot(page, 'b');",
+        '});',
+      ).findings,
+    ).toHaveLength(1);
+  });
+
+  it('is not satisfied by an assertion in a comment', () => {
+    expect(
+      scan(
+        "test('x', async () => {",
+        '  // expect(page).toHaveTitle(/x/);',
+        "  await shoot(page, 'x');",
+        '});',
+      ).findings,
+    ).toHaveLength(1);
+  });
+});
+
+describe('an evidence capture documents an assertion that already passed', () => {
+  it('never runs before the assertion it claims to document', () => {
+    // Measured 143 captures on 2026-10-03 (#446). Stated tight, so a reader
+    // that comes back one short fails.
+    expectNothingFound(capturesBeforeAssertion, {
+      what: 'evidence captures',
+      moreThan: 142,
+      carries: callsShoot,
+    });
   });
 });
diff --git a/tests/unit/download-readers.test.ts b/tests/unit/download-readers.test.ts
index 31255db..71c9156 100644
--- a/tests/unit/download-readers.test.ts
+++ b/tests/unit/download-readers.test.ts
@@ -1,10 +1,9 @@
 import { describe, it, expect } from 'vitest';
-import { expectNothingFound } from './spec-scan';
-import { readFileSync } from 'node:fs';
+import { expectNothingFound, type Reading } from './spec-scan';
 import ts from 'typescript';
 import { parseSource } from './ast';
-import { specFilesUnder } from '../source-files';
 import { callsIn, lineOf } from '../playwright-declarations';
+import { withoutTsComments } from './source-text';
 
 /**
  * A download's bytes are read in ONE place: `downloadText` (tests/e2e/helpers.ts).
@@ -46,36 +45,51 @@ const insideHome = (node: ts.Node): boolean => {
   return false;
 };
 
-/** The whole guard as one pure function of (path, source text) -> finding messages. */
-function analyze(file: string, text: string): string[] {
+/** A read of a download's bytes: the home's own call, or a direct reader's. */
+const readsBytes = (call: ts.CallExpression): boolean =>
+  calleeName(call) === HOME ||
+  (DIRECT_READERS.includes(calleeName(call) ?? '') &&
+    ts.isPropertyAccessExpression(call.expression));
+
+/**
+ * The same reads, as text: a call to the home or to a direct reader, comments
+ * stripped. Independent of the parse tree, so a reader gone blind to a form
+ * is caught by the file it found nothing in (#446).
+ */
+const BYTE_READ = /\bdownloadText\s*\(|\.(?:createReadStream|saveAs)\s*\(/;
+
+/** The whole guard as one pure function of (path, source text): every byte read judged, and the ones outside the home. */
+function read(file: string, text: string): Reading {
   const sf = parseSource(text, file);
-  return callsIn(sf)
-    .filter((call) => DIRECT_READERS.includes(calleeName(call) ?? ''))
-    .filter((call) => ts.isPropertyAccessExpression(call.expression))
+  const reads = callsIn(sf).filter(readsBytes);
+  const findings = reads
+    .filter((call) => calleeName(call) !== HOME)
     .filter((call) => !insideHome(call))
     .map(
       (call) =>
         `${file}:${lineOf(sf, call)} reads a download's bytes with \`${calleeName(call)}\` ` +
         `instead of \`${HOME}\`, the only reader that works on the real phone (#308)`,
     );
+  const judged = reads.map((call) => `${file}:${lineOf(sf, call)}`);
+  return { judged, findings };
 }
 
+/** The findings alone, which is all the synthetic cases below ask about. */
+const analyze = (file: string, text: string): readonly string[] =>
+  read(file, text).findings;
+
 describe('a download’s bytes are read only through downloadText', () => {
   it('no spec reads them any other way', () => {
-    expectNothingFound(analyze);
-  });
-
-  // Guards the guard: a scan that found no reads at all -- because the helper was renamed, or
-  // `tests/e2e` moved -- would otherwise report a clean sweep it never performed.
-  it('is actually looking at specs that read bytes', () => {
-    const readers = specFilesUnder('tests/e2e').filter((file) =>
-      callsIn(parseSource(readFileSync(file, 'utf8'), file)).some(
-        (call) => calleeName(call) === HOME,
-      ),
-    );
-    // Measured 2 specs that read downloaded bytes on 2026-10-03 (#446). Stated
-    // tight, so a reader that comes back one short fails.
-    expect(readers.length).toBeGreaterThan(1);
+    // Guards the guard: a scan that found no reads at all -- because the
+    // helper was renamed, or `tests/e2e` moved -- would otherwise report a
+    // clean sweep it never performed. Counted in reads, not in the files that
+    // hold them: measured 8 on 2026-10-03 (#446), and stated tight, so a
+    // reader that comes back one short fails.
+    expectNothingFound(read, {
+      what: 'download byte reads',
+      moreThan: 7,
+      carries: (_file, source) => BYTE_READ.test(withoutTsComments(source)),
+    });
   });
 });
 
diff --git a/tests/unit/isolated-context-tagging.test.ts b/tests/unit/isolated-context-tagging.test.ts
index f354fc9..6be297f 100644
--- a/tests/unit/isolated-context-tagging.test.ts
+++ b/tests/unit/isolated-context-tagging.test.ts
@@ -1,5 +1,9 @@
 import { describe, it, expect } from 'vitest';
-import { expectNothingFound } from './spec-scan';
+import {
+  declarationsRead,
+  expectNothingFound,
+  type Reading,
+} from './spec-scan';
 import ts from 'typescript';
 import { parseSource } from './ast';
 import {
@@ -134,8 +138,8 @@ function groupsAround(
  * separate from the filesystem walk so the self-test block below can prove every branch red
  * and green on tiny synthetic input, not just trust the real corpus to exercise all of them.
  * The text is the file as it is on disk: a line counted in stripped text is not the line a
- * reader opens. */
-function analyze(file: string, text: string): string[] {
+ * reader opens. Every test it read is judged, so each is named in `judged`. */
+function read(file: string, text: string): Reading {
   const sf = parseSource(text, file);
   const declarations = declarationsIn(sf);
   const findings: string[] = [];
@@ -173,12 +177,21 @@ function analyze(file: string, text: string): string[] {
       findings.push(staleTagMessage(file, decl));
   }
 
-  return findings;
+  const judged = declarations
+    .filter((decl) => decl.kind === 'test')
+    .map((decl) => `${file}:${decl.line}`);
+  return { judged, findings };
 }
 
+/** The findings alone, which is all the synthetic cases below ask about. */
+const analyze = (file: string, text: string): readonly string[] =>
+  read(file, text).findings;
+
 describe('a real device has one browser context', () => {
   it('every test run without JavaScript, or calling newContext(), is tagged @requires-isolated-context, and no tag is stale', () => {
-    expectNothingFound(analyze);
+    // Measured 638 tests read on 2026-10-03, the same 638 one-test-per-case
+    // reads (#446). Stated tight, so a reader that comes back one short fails.
+    expectNothingFound(read, declarationsRead('tests read', 637));
   });
 });
 
diff --git a/tests/unit/one-test-per-case.test.ts b/tests/unit/one-test-per-case.test.ts
index 5c2ffb9..22e512b 100644
--- a/tests/unit/one-test-per-case.test.ts
+++ b/tests/unit/one-test-per-case.test.ts
@@ -9,7 +9,7 @@ import {
   testsRead,
   type LoopedCase,
 } from '../one-test-per-case';
-import { withoutTsComments } from './source-text';
+import { declaresTests } from '../playwright-declarations';
 
 /**
  * One test per case (operator, 2026-10-02; #417).
@@ -238,13 +238,6 @@ const sharedStateful = () =>
     ).map(parsed),
   );
 
-/**
- * A spec whose code, comments stripped, calls `test(` or a `test.<modifier>(`
- * form: read independently of the parse tree, as text, so a reader that went
- * blind to a form is caught by a file it found nothing in.
- */
-const DECLARES_TESTS = /(?<![\w.])test(?:\.(?:only|skip|fixme|fail))*\s*\(/;
-
 const scan = (): {
   specs: string[];
   tests: string[];
@@ -267,7 +260,7 @@ const scan = (): {
   );
   const unread = specs.filter(
     (file) =>
-      DECLARES_TESTS.test(withoutTsComments(readFileSync(file, 'utf8'))) &&
+      declaresTests(readFileSync(file, 'utf8')) &&
       testsRead(parsed(file)).length === 0,
   );
   return { specs, tests, sites, unread };
diff --git a/tests/unit/parked-tests.test.ts b/tests/unit/parked-tests.test.ts
index 1d4aef1..2e0569e 100644
--- a/tests/unit/parked-tests.test.ts
+++ b/tests/unit/parked-tests.test.ts
@@ -1,5 +1,9 @@
 import { describe, it, expect } from 'vitest';
-import { expectNothingFound } from './spec-scan';
+import {
+  declarationsRead,
+  expectNothingFound,
+  type Reading,
+} from './spec-scan';
 import ts from 'typescript';
 import { parseSource } from './ast';
 import { declarationsIn, type Declaration } from '../playwright-declarations';
@@ -77,12 +81,11 @@ function commentBlockAbove(sf: ts.SourceFile, decl: Declaration): string[] {
 const headerOf = (sf: ts.SourceFile, decl: Declaration): string =>
   sf.text.slice(decl.call.getStart(sf), decl.body.getStart(sf));
 
-export function findUnreferencedParkedTests(
-  file: string,
-  source: string,
-): string[] {
+/** Every test and group read, each judged parked or not, and the parked ones naming no issue. */
+function readParkedTests(file: string, source: string): Reading {
   const sf = parseSource(source, file);
-  return declarationsIn(sf)
+  const declarations = declarationsIn(sf);
+  const findings = declarations
     .filter(({ modifier }) => modifier === 'fixme' || modifier === 'skip')
     .filter(
       (decl) =>
@@ -98,8 +101,15 @@ export function findUnreferencedParkedTests(
         'because a comment claimed "tracked, not hidden" and no such ticket ' +
         'existed, while the product really did overflow the fold.',
     );
+  const judged = declarations.map((decl) => `${file}:${decl.line}`);
+  return { judged, findings };
 }
 
+export const findUnreferencedParkedTests = (
+  file: string,
+  source: string,
+): readonly string[] => readParkedTests(file, source).findings;
+
 describe('parked tests must name an issue', () => {
   const scan = (source: string) =>
     findUnreferencedParkedTests('synthetic.spec.ts', source);
@@ -243,6 +253,11 @@ describe('parked tests must name an issue', () => {
   });
 
   it('the e2e corpus parks nothing without naming an issue', () => {
-    expectNothingFound(findUnreferencedParkedTests);
+    // Measured 771 tests and groups read on 2026-10-03 (#446). Stated tight,
+    // so a reader that comes back one short fails.
+    expectNothingFound(
+      readParkedTests,
+      declarationsRead('tests and groups read', 770),
+    );
   });
 });
diff --git a/tests/unit/spec-scan.ts b/tests/unit/spec-scan.ts
index 1ba8d74..a6b4b72 100644
--- a/tests/unit/spec-scan.ts
+++ b/tests/unit/spec-scan.ts
@@ -1,6 +1,7 @@
 import { readFileSync } from 'node:fs';
 import { expect } from 'vitest';
 import { specDirs } from '../spec-dirs';
+import { declaresTests } from '../playwright-declarations';
 import { searched, tsFilesUnder } from '../source-files';
 
 /**
@@ -29,20 +30,88 @@ import { searched, tsFilesUnder } from '../source-files';
  * of a default that drifts in silence.
  */
 
-/** A guard's own reading of one file: the problems it found, as messages. */
-export type Analyze = (file: string, source: string) => readonly string[];
+/**
+ * A guard's own reading of one file: every unit it judged, named so a
+ * failure can point at it, and the problems it found among them.
+ *
+ * `judged` is the liveness control at the level the guard judges (#446).
+ * Proving FILES were opened says nothing about a reader that went blind to
+ * every test, call or capture inside them: it opens every file, finds
+ * nothing, and passes.
+ */
+export type Reading = {
+  readonly judged: readonly string[];
+  readonly findings: readonly string[];
+};
+
+/** A guard's reading of one file, as a pure function of its path and text. */
+export type Analyze = (file: string, source: string) => Reading;
+
+/** What the scan must see before its silence means anything. */
+export type Liveness = {
+  /** The unit `judged` lists, plural: `tests read`, `captures`. */
+  readonly what: string;
+  /**
+   * The floor, stated as measured − 1 by the caller beside the measured
+   * figure, so a reader that comes back one short fails.
+   */
+  readonly moreThan: number;
+  /**
+   * An independent reading of the same file: true where its text plainly
+   * holds the construct. A file it holds and `analyze` judged nothing in is
+   * a form the reader is blind to.
+   */
+  readonly carries: (file: string, source: string) => boolean;
+};
+
+/**
+ * The liveness of a guard whose unit is a test or group the specs declare:
+ * a file whose text declares a test, and in which the guard judged none, is
+ * a form its reader is blind to. One home, since three guards read that way.
+ */
+export const declarationsRead = (what: string, moreThan: number): Liveness => ({
+  what,
+  moreThan,
+  carries: (_file, source) => declaresTests(source),
+});
 
 /**
  * Run `analyze` over every file in the spec directories and assert it found
- * nothing. The failure message is every finding, one per line.
+ * nothing, over a population of the units it judged, at least as many as
+ * measured, with none missed in a file that plainly holds one. The failure
+ * message is every finding, one per line.
  */
-export const expectNothingFound = (analyze: Analyze): void => {
-  const files = specDirs().flatMap(tsFilesUnder);
-  const findings = files.flatMap((file) =>
-    analyze(file, readFileSync(file, 'utf8')),
-  );
+export const expectNothingFound = (
+  analyze: Analyze,
+  liveness: Liveness,
+): void => {
+  const readings = specDirs()
+    .flatMap(tsFilesUnder)
+    .map((file) => {
+      const source = readFileSync(file, 'utf8');
+      return { file, source, ...analyze(file, source) };
+    });
+  const findings = readings.flatMap(({ findings }) => findings);
+  const judged = readings.flatMap(({ judged }) => judged);
   expect(
-    searched(findings, { of: files, what: 'files under the spec directories' }),
+    searched(findings, { of: judged, what: liveness.what }),
     findings.join('\n'),
   ).toEqual([]);
+  expect(
+    judged.length,
+    `${liveness.what}: fewer than measured`,
+  ).toBeGreaterThan(liveness.moreThan);
+  const missed = readings
+    .filter(
+      ({ file, source, judged }) =>
+        judged.length === 0 && liveness.carries(file, source),
+    )
+    .map(({ file }) => file);
+  expect(
+    searched(missed, {
+      of: readings,
+      what: 'files under the spec directories',
+    }),
+    `files holding ${liveness.what} where the reader judged none`,
+  ).toEqual([]);
 };
diff --git a/tests/unit/viewport-tagging.test.ts b/tests/unit/viewport-tagging.test.ts
index 5637911..a7417df 100644
--- a/tests/unit/viewport-tagging.test.ts
+++ b/tests/unit/viewport-tagging.test.ts
@@ -1,5 +1,9 @@
 import { describe, it, expect } from 'vitest';
-import { expectNothingFound } from './spec-scan';
+import {
+  declarationsRead,
+  expectNothingFound,
+  type Reading,
+} from './spec-scan';
 import ts from 'typescript';
 import { parseSource } from './ast';
 import {
@@ -177,8 +181,10 @@ function staleTagMessage(file: string, decl: Declaration): string {
  * describe block can prove every branch of it red and green on tiny synthetic
  * input, not just trust the real corpus to happen to exercise all of them. The
  * text is the file as it is on disk: the parser skips comments itself, and a
- * line counted in stripped text is not the line a reader opens. */
-function analyze(file: string, text: string): string[] {
+ * line counted in stripped text is not the line a reader opens. Every test
+ * and group it read is judged, for a tag it lacks or one gone stale, so each
+ * is named in `judged`. */
+function read(file: string, text: string): Reading {
   const sf = parseSource(text, file);
   const declarations = declarationsIn(sf);
 
@@ -221,12 +227,19 @@ function analyze(file: string, text: string): string[] {
       findings.push(staleTagMessage(file, decl));
   }
 
-  return findings;
+  const judged = declarations.map((decl) => `${file}:${decl.line}`);
+  return { judged, findings };
 }
 
+/** The findings alone, which is all the synthetic cases below ask about. */
+const analyze = (file: string, text: string): readonly string[] =>
+  read(file, text).findings;
+
 describe('a real phone cannot resize its own screen', () => {
   it('every test that resizes the viewport is tagged @emulated-viewport, none the phone runs reads it, and no tag is stale', () => {
-    expectNothingFound(analyze);
+    // Measured 771 tests and groups read on 2026-10-03 (#446). Stated tight,
+    // so a reader that comes back one short fails.
+    expectNothingFound(read, declarationsRead('tests and groups read', 770));
   });
 });
 
```


- [ ] **Step 2: Run the six files**

Run: `npx vitest run tests/unit/isolated-context-tagging.test.ts tests/unit/viewport-tagging.test.ts tests/unit/parked-tests.test.ts tests/unit/download-readers.test.ts tests/unit/capture-after-assertion.test.ts tests/unit/one-test-per-case.test.ts`
Expected: all pass. A floor that fails names its measured unit ("tests read: fewer than measured").

- [ ] **Step 3: Commit**

```bash
git add tests/unit/spec-scan.ts tests/playwright-declarations.ts tests/unit/one-test-per-case.test.ts tests/unit/isolated-context-tagging.test.ts tests/unit/viewport-tagging.test.ts tests/unit/parked-tests.test.ts tests/unit/download-readers.test.ts tests/unit/capture-after-assertion.test.ts
git commit -m "The spec-scan guards count the units they judge (Refs #446)"
```

### Task 2: `no-dated-render` judges views, not files

The verdict's population becomes the code and markup views read (46), with a floor, a text cross-check over those same views (`HOLDS_CODE`: frontmatter or a `<script` tag must yield a code view; every source must yield markup), and the date read planted in frontmatter, a script, markup, and through any `.getFullYear()`, plus a comment that must not trip it.

**Files:** `tests/unit/no-dated-render.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/no-dated-render.test.ts b/tests/unit/no-dated-render.test.ts
index 9d575dc..1a7a45a 100644
--- a/tests/unit/no-dated-render.test.ts
+++ b/tests/unit/no-dated-render.test.ts
@@ -21,18 +21,104 @@ import {
  */
 const CLOCK = /\bnew Date\(|\bDate\.now\(|\.getFullYear\(/;
 
+/** A view with its comments stripped, or nothing when it read nothing. */
+const readView = (view: string): string[] => {
+  const code = withoutTsComments(view);
+  return code.trim() === '' ? [] : [code];
+};
+
+/**
+ * What a date could be read in, in each `.astro` source: its code (the
+ * frontmatter, then each `<script>`) and its markup, comments stripped. A
+ * view is the whole file with the rest blanked, so one that is all blank
+ * read nothing. Kept apart so the cross-check below asks about the views the
+ * verdict judged, not about a second reading.
+ */
+const readSource = (text: string) => {
+  const code = astroCodeViews(text).flatMap(readView);
+  const markup = readView(astroTemplate(text));
+  return { code, markup, views: [...code, ...markup] };
+};
+
+/** Every view of `text` a date could be read in. */
+const viewsOf = (text: string): string[] => readSource(text).views;
+
+/**
+ * A file that plainly holds code, read as text: frontmatter opening the
+ * file, or a `<script` tag. Independent of `astroCodeViews`, so a reader
+ * gone blind to one region is caught by the file it read no code in (#446).
+ */
+const HOLDS_CODE = /^---|<script\b/;
+
+const read = () =>
+  filesUnder('src', (path) => path.endsWith('.astro')).map((path) => {
+    const text = readFileSync(path, 'utf8');
+    return { path, text, ...readSource(text) };
+  });
+
 describe('no page is rendered from the clock (#370)', () => {
   it('no .astro source reads the date, in its code or its markup', () => {
-    const sources = filesUnder('src', (path) => path.endsWith('.astro'));
-    const dated = sources.filter((path) => {
-      const text = readFileSync(path, 'utf8');
-      const code = astroCodeViews(text).map(withoutTsComments);
-      return [...code, withoutTsComments(astroTemplate(text))].some((view) =>
-        CLOCK.test(view),
-      );
-    });
-    expect(searched(dated, { of: sources, what: '.astro sources' })).toEqual(
-      [],
+    // The population is the views read, not the files opened: a reader blind
+    // to every region would open each file, find no date, and pass (#446).
+    const views = read().flatMap(({ path, views }) =>
+      views.map((view) => ({ path, view })),
     );
+    const dated = views
+      .filter(({ view }) => CLOCK.test(view))
+      .map(({ path }) => path);
+    expect(
+      searched(dated, {
+        of: views.map(({ view }) => view),
+        what: '.astro code and markup views',
+      }),
+    ).toEqual([]);
+  });
+
+  it('reads every view the sources hold, and as many as there are', () => {
+    // Measured 46 views on 2026-10-03 (#446). Stated tight, so a reader
+    // that comes back one short fails.
+    const sources = read();
+    expect(sources.flatMap(({ views }) => views).length).toBeGreaterThan(45);
+    const codeUnread = sources
+      .filter(({ text, code }) => HOLDS_CODE.test(text) && code.length === 0)
+      .map(({ path }) => path);
+    expect(
+      searched(codeUnread, { of: sources, what: '.astro sources' }),
+    ).toEqual([]);
+    const markupUnread = sources
+      .filter(({ markup }) => markup.length === 0)
+      .map(({ path }) => path);
+    expect(
+      searched(markupUnread, { of: sources, what: '.astro sources' }),
+    ).toEqual([]);
+  });
+
+  it.each([
+    [
+      'its frontmatter',
+      '---\nconst year = new Date().getFullYear();\n---\n<p>x</p>',
+    ],
+    ['a script', '<p>x</p>\n<script>\n  const at = Date.now();\n</script>'],
+    ['its markup', '<footer>{new Date().getFullYear()}</footer>'],
+    [
+      'a year read off any date',
+      '---\nconst y = built.getFullYear();\n---\n<p>x</p>',
+    ],
+  ])('finds a date read in %s', (_where, source) => {
+    expect(viewsOf(source).filter((view) => CLOCK.test(view))).toHaveLength(1);
+  });
+
+  it('is not tripped by a date named in a comment', () => {
+    const source =
+      '---\n// was: new Date().getFullYear()\n---\n<p>{/* Date.now() */}x</p>';
+    // The markup is still read once the comment is gone, so the empty
+    // verdict is over a view, not over nothing.
+    const views = viewsOf(source);
+    expect(
+      searched(
+        views.filter((view) => CLOCK.test(view)),
+        { of: views, what: 'views of the fixture' },
+      ),
+    ).toEqual([]);
   });
 });
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/no-dated-render.test.ts`
Expected: 7 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/no-dated-render.test.ts
git commit -m "no-dated-render counts the views it reads (Refs #446)"
```

### Task 3: `deprecated-css` judges declarations, not stylesheets

The `clip` hunt now runs over declarations (`declarationsIn`, 1170), and a declaration that ends a block without a `;` is one. The cross-check `HOLDS_CSS` reads each file as text: a `.css` file with a rule holding a colon, or a component with a `<style` tag, must yield a declaration. The `clip` declaration is planted in a stylesheet, a component style, a global style, an inline style, and as a block's last declaration.

**Files:** `tests/unit/deprecated-css.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/deprecated-css.test.ts b/tests/unit/deprecated-css.test.ts
index 4d62366..08acbac 100644
--- a/tests/unit/deprecated-css.test.ts
+++ b/tests/unit/deprecated-css.test.ts
@@ -17,17 +17,26 @@ import { stylesheetCss } from './source-text';
  */
 
 /**
- * A `clip` declaration: the property where a declaration starts, in any case.
- * `clip-path`, a custom property such as `--clip`, and the `clip` keyword of
- * `overflow` are not one.
+ * A declaration: a property, a colon and a value, starting a block or
+ * following a `;`, and ended by a `;` or a `}`. A selector such as `a:hover`
+ * is ended by a `{`, so it is not one.
  */
-const CLIP_DECLARATION = /(?:^|[{;])\s*(clip\s*:[^;}]*)/gi;
+const DECLARATION = /(?:^|[{;])\s*(-{0,2}[a-z][\w-]*\s*:[^;{}]*)(?=[;}])/gi;
 
-/** Every `clip` declaration in `css`, which reaches here comment-free. */
+/** Every declaration in `css`, which reaches here comment-free. */
+const declarationsIn = (css: string): string[] =>
+  [...css.matchAll(DECLARATION)].map(([, declaration]) => declaration.trim());
+
+/**
+ * A `clip` declaration: the property itself, in any case. `clip-path`, a
+ * custom property such as `--clip`, and the `clip` keyword of `overflow` are
+ * not one.
+ */
+const CLIP = /^clip\s*:/i;
+
+/** Every `clip` declaration in `css`. */
 const clipDeclarations = (css: string): string[] =>
-  [...css.matchAll(CLIP_DECLARATION)].map(([, declaration]) =>
-    declaration.trim(),
-  );
+  declarationsIn(css).filter((declaration) => CLIP.test(declaration));
 
 /**
  * A name standing for the dialect a fixture is written in.
@@ -47,6 +56,15 @@ const stylesheetsUnder = (dir: string): Array<{ file: string; css: string }> =>
     })),
   );
 
+/**
+ * A file that plainly holds CSS, read as text: a stylesheet with a rule
+ * holding a colon, or a component with a `<style` tag. Independent of both
+ * readers, so one gone blind to a form is caught by the file it read no
+ * declaration in (#446).
+ */
+const HOLDS_CSS = (file: string): RegExp =>
+  file.endsWith('.css') ? /\{[^}]*:/ : /<style\b/;
+
 describe('no stylesheet declares the deprecated clip property (#200)', () => {
   it('reads a clip declaration however it is spelled', () => {
     const css = [
@@ -75,15 +93,74 @@ describe('no stylesheet declares the deprecated clip property (#200)', () => {
   });
 
   it('finds none in any stylesheet under src/', () => {
-    const sheets = stylesheetsUnder('src');
-    const findings = sheets.flatMap(({ file, css }) =>
-      clipDeclarations(css).map((declaration) => `${file}: ${declaration}`),
+    // The population is the declarations judged, not the sheets opened: a
+    // reader blind to every declaration would open each sheet and pass (#446).
+    const declarations = stylesheetsUnder('src').flatMap(({ file, css }) =>
+      declarationsIn(css).map((declaration) => ({ file, declaration })),
     );
+    const findings = declarations
+      .filter(({ declaration }) => CLIP.test(declaration))
+      .map(({ file, declaration }) => `${file}: ${declaration}`);
     expect(
       searched(findings, {
-        of: sheets.map(({ css }) => css),
-        what: 'stylesheets under src/',
+        of: declarations.map(({ declaration }) => declaration),
+        what: 'declarations under src/',
+      }),
+    ).toEqual([]);
+  });
+
+  it('reads every declaration the stylesheets hold, and as many as there are', () => {
+    // Measured 1170 declarations on 2026-10-03 (#446). Stated tight, so a
+    // reader that comes back one short fails.
+    const sheets = stylesheetsUnder('src');
+    expect(
+      sheets.flatMap(({ css }) => declarationsIn(css)).length,
+    ).toBeGreaterThan(1169);
+    // Read as text, independently of either reader: a file holding a
+    // `<style>` tag or a stylesheet's rule that yields no declaration is a
+    // form one of them has gone blind to.
+    const files = filesUnder('src', (path) => /\.(astro|css)$/.test(path));
+    const unread = files.filter(
+      (file) =>
+        HOLDS_CSS(file).test(readFileSync(file, 'utf8')) &&
+        !sheets.some(
+          (sheet) =>
+            sheet.file === file && declarationsIn(sheet.css).length > 0,
+        ),
+    );
+    expect(
+      searched(unread, {
+        of: files,
+        what: 'stylesheets and components under src/',
       }),
     ).toEqual([]);
   });
+
+  it.each([
+    ['a stylesheet', 'case.css', '.a { clip: auto; }'],
+    [
+      'a component style',
+      'case.astro',
+      '<p>x</p>\n<style>\n  .a { clip: auto; }\n</style>',
+    ],
+    [
+      'a global style',
+      'case.astro',
+      '<p>x</p>\n<style is:global>\n  .a { clip: auto; }\n</style>',
+    ],
+    [
+      'an inline style',
+      'case.astro',
+      '<p>x</p>\n<style is:inline>\n  .a { clip: auto; }\n</style>',
+    ],
+    [
+      'the last declaration of a block',
+      'case.css',
+      '.a { color: red; clip: auto }',
+    ],
+  ])('finds one in %s', (_where, file, text) => {
+    expect(stylesheetCss(file, text).flatMap(clipDeclarations)).toEqual([
+      'clip: auto',
+    ]);
+  });
 });
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/deprecated-css.test.ts`
Expected: 9 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/deprecated-css.test.ts
git commit -m "deprecated-css counts the declarations it judges (Refs #446)"
```

### Task 4: `event-collectors` reads the spread form and refuses a list it cannot follow

`loopOver` reads a `.all()` list spread into the array a `for … of` walks (the form `formTextsUnderAA` uses), and the loop count rises from 7 to 8. `unfollowedLists` names every `.all()` list that no recognised loop walks, so a new form fails by name instead of being skipped. The verdict's population is the loops judged. A cross-check compares the parse tree's `.all()` count with the text's, file by file.

**Files:** `tests/unit/event-collectors.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/event-collectors.test.ts b/tests/unit/event-collectors.test.ts
index d6623a2..9644c8b 100644
--- a/tests/unit/event-collectors.test.ts
+++ b/tests/unit/event-collectors.test.ts
@@ -133,24 +133,52 @@ const PROVES_NOT_EMPTY = new Set(['toHaveCount', 'toBeVisible']);
 /** Calls that pick one element, so a visible one proves the list has one. */
 const PICKS_ONE = new Set(['first', 'last', 'nth']);
 
-/** A `for (… of await <locator>.all())` loop, when `call` is its `.all()`. */
+/** An argument-free `<locator>.all()`: a locator's whole list. */
+const isAllCall = (
+  call: ts.CallExpression,
+): call is ts.CallExpression & { expression: ts.PropertyAccessExpression } =>
+  ts.isPropertyAccessExpression(call.expression) &&
+  call.expression.name.text === 'all' &&
+  call.arguments.length === 0;
+
+/**
+ * The `for (… of …)` loop over `call`'s list, when it is one: `of await
+ * x.all()`, or the list spread into an array the loop walks, `of [a,
+ * ...(await x.all()), b]` (#446: `formTextsUnderAA` loops that way, and a
+ * reader that knew only the first form counted it as no loop at all).
+ */
 function loopOver(
   call: ts.CallExpression,
 ): { loop: ts.ForOfStatement; locator: ts.Expression } | undefined {
-  const { expression: callee, parent: awaited } = call;
+  if (!isAllCall(call) || !ts.isAwaitExpression(call.parent)) return undefined;
+  let iterable: ts.Node = call.parent;
+  while (ts.isParenthesizedExpression(iterable.parent))
+    iterable = iterable.parent;
   if (
-    !ts.isPropertyAccessExpression(callee) ||
-    callee.name.text !== 'all' ||
-    call.arguments.length > 0 ||
-    !ts.isAwaitExpression(awaited)
+    ts.isSpreadElement(iterable.parent) &&
+    ts.isArrayLiteralExpression(iterable.parent.parent)
   )
-    return undefined;
-  const loop = awaited.parent;
-  return ts.isForOfStatement(loop)
-    ? { loop, locator: callee.expression }
+    iterable = iterable.parent.parent;
+  const loop = iterable.parent;
+  return ts.isForOfStatement(loop) && loop.expression === iterable
+    ? { loop, locator: call.expression.expression }
     : undefined;
 }
 
+/**
+ * Every `.all()` list `source` takes that is not walked by a loop
+ * `loopOver` reads, by its locator. Refused by name, never skipped: a list
+ * this reader cannot follow is a loop it cannot judge (#446).
+ */
+export const unfollowedLists = (source: string): string[] =>
+  callsIn(parseSource(source))
+    .filter(isAllCall)
+    .filter((call) => loopOver(call) === undefined)
+    .map((call) => subjectOf(call.expression.expression));
+
+/** `.all()`, as text: independent of the parse tree. */
+const ALL_CALL = /\.all\(\s*\)/g;
+
 /**
  * The locator `call` proves is not empty -- `expect(x).toHaveCount(n)`, or
  * `expect(x.first()).toBeVisible()` -- or undefined when it proves no such
@@ -268,13 +296,45 @@ const spec = (...lines: string[]): string => lines.join('\n');
 describe('a locator list cannot be looped unproved', () => {
   it('sees the loops it is scanning for', () => {
     // The detector's own liveness. Zero unproved loops means nothing if the
-    // regex found zero loops.
-    // Measured 7 locator loops found on 2026-10-03 (#446). Stated tight, so a
-    // reader that comes back one short fails.
+    // reader found zero loops.
+    // Measured 8 locator loops found on 2026-10-03 (#446), 7 before the
+    // spread form was read. Stated tight, so a reader that comes back one
+    // short fails.
     expect(
       SCANNED.flatMap((path) => locatorLoops(readFileSync(path, 'utf8')))
         .length,
-    ).toBeGreaterThanOrEqual(7);
+    ).toBeGreaterThan(7);
+  });
+
+  it('follows every .all() list it meets into a loop it can judge', () => {
+    // Fail-closed: a list taken any other way is named, never skipped.
+    const calls = SCANNED.flatMap((path) =>
+      (withoutTsComments(readFileSync(path, 'utf8')).match(ALL_CALL) ?? []).map(
+        (call) => `${path}: ${call}`,
+      ),
+    );
+    const unfollowed = SCANNED.flatMap((path) =>
+      unfollowedLists(readFileSync(path, 'utf8')).map(
+        (subject) => `${path}: ${subject}`,
+      ),
+    );
+    expect(searched(unfollowed, { of: calls, what: '.all() calls' })).toEqual(
+      [],
+    );
+  });
+
+  it('reads as many .all() calls as the text holds, file by file', () => {
+    // Two readers, one parse tree and one text scan: a file where they
+    // disagree holds a form the tree reader is blind to (#446).
+    const disagree = SCANNED.filter((path) => {
+      const source = readFileSync(path, 'utf8');
+      const text = withoutTsComments(source).match(ALL_CALL)?.length ?? 0;
+      const tree = callsIn(parseSource(source)).filter(isAllCall).length;
+      return text !== tree;
+    });
+    expect(
+      searched(disagree, { of: SCANNED, what: 'scanned e2e specs' }),
+    ).toEqual([]);
   });
 
   it('catches a loop with nothing proving the list is not empty', () => {
@@ -490,14 +550,36 @@ describe('a locator list cannot be looped unproved', () => {
   });
 
   it('every .all() loop proves its locator is not empty first', () => {
-    const unproved = SCANNED.flatMap((path) =>
-      locatorLoops(readFileSync(path, 'utf8'))
-        .filter((loop) => !loop.proved)
-        .map((loop) => `${path}: ${loop.subject}`),
+    // The population is the loops judged, not the files opened: a reader
+    // blind to every loop would open each file and pass (#446).
+    const loops = SCANNED.flatMap((path) =>
+      locatorLoops(readFileSync(path, 'utf8')).map((loop) => ({ path, loop })),
     );
+    const unproved = loops
+      .filter(({ loop }) => !loop.proved)
+      .map(({ path, loop }) => `${path}: ${loop.subject}`);
     expect(
-      searched(unproved, { of: SCANNED, what: 'scanned e2e specs' }),
+      searched(unproved, {
+        of: loops.map(({ path, loop }) => `${path}: ${loop.subject}`),
+        what: 'locator loops',
+      }),
       unproved.join('\n'),
     ).toEqual([]);
   });
+
+  it('reads a list spread into the array a loop walks', () => {
+    expect(
+      locatorLoops(
+        "test('x', async () => {\n  for (const a of [first, ...(await links.all()), last]) f(a);\n});",
+      ),
+    ).toEqual([{ subject: 'links', proved: false }]);
+  });
+
+  it('names a list it cannot follow into a loop', () => {
+    expect(
+      unfollowedLists(
+        "test('x', async () => {\n  const items = await links.all();\n  for (const a of items) f(a);\n  (await btns.all()).forEach(f);\n});",
+      ),
+    ).toEqual(['links', 'btns']);
+  });
 });
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/event-collectors.test.ts`
Expected: 27 passed. The RED for the new form is Task 9's E1, which puts back the old blindness: the floor (7 is not above 7), the spread fixture and the fail-closed test all go RED.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/event-collectors.test.ts
git commit -m "event-collectors reads a spread list and names one it cannot follow (Refs #446)"
```

### Task 5: The dangling-workflow guard judges references, and names a file that is not YAML

The population is the workflow file references read (19). A file in `.github/workflows/` that is not YAML is a finding ("not a workflow") instead of a silent `continue`. The raw scan is checked against every string value of the parsed document (`stringLeaves`, the one walk), and the pattern is planted in a comment, a reusable-workflow `uses:`, a quoted `.yaml` value and a script.

**Files:** `tests/unit/pipeline-wiring.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/pipeline-wiring.test.ts b/tests/unit/pipeline-wiring.test.ts
index 996e398..fbee2f7 100644
--- a/tests/unit/pipeline-wiring.test.ts
+++ b/tests/unit/pipeline-wiring.test.ts
@@ -38,6 +38,7 @@ import { parseFile } from './ast';
 import { declarationsIn } from '../playwright-declarations';
 import { REQUIRED_CHECKS } from '../../scripts/deploy-gate.mjs';
 import { localImage } from '../../scripts/playwright-image.mjs';
+import { stringLeaves } from '../../src/lib/catalogue-leaves';
 
 /**
  * The plain `test(...)` declarations `spec` makes, read by the parser. A test
@@ -107,8 +108,18 @@ const onBlock = (name: string) =>
 const workflowFileNames = (): string[] =>
   nonEmpty(readdirSync(WORKFLOWS), `workflow files in ${WORKFLOWS}`);
 
-const workflowYamlNames = (): string[] =>
-  workflowFileNames().filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
+const isYaml = (file: string): boolean =>
+  file.endsWith('.yml') || file.endsWith('.yaml');
+
+const workflowYamlNames = (): string[] => workflowFileNames().filter(isYaml);
+
+/**
+ * Every workflow file `raw` names, comments included: in a workflow a
+ * comment explaining the pipeline is part of what is checked (`ci.yml` once
+ * explained itself in terms of a deleted `deploy.yml`).
+ */
+const workflowRefs = (raw: string): string[] =>
+  [...raw.matchAll(/\b([\w.-]+\.ya?ml)\b/g)].map(([, ref]) => ref);
 
 /** What a workflow calls itself: the Actions UI, and `github.workflow`. */
 const workflowName = (file: string): string => {
@@ -1027,24 +1038,76 @@ describe('the deploy pipeline runs what it claims to', () => {
       join('.github', name),
       name,
     ];
-    const dangling: string[] = [];
-
-    const workflows = workflowFileNames();
-    for (const file of workflows) {
-      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
-      const raw = readFileSync(join(WORKFLOWS, file), 'utf8');
-      for (const [, ref] of raw.matchAll(/\b([\w.-]+\.ya?ml)\b/g)) {
-        if (!candidates(ref).some((p) => existsSync(p))) {
-          dangling.push(`${file} → ${ref}`);
-        }
-      }
-    }
-
+    // The population is the references judged, not the files opened: a
+    // reader blind to every reference would open each workflow and pass
+    // (#446). And a file that is not YAML is refused by name, never skipped:
+    // its `ref` is undefined.
+    const refs = workflowFileNames().flatMap(
+      (file): Array<{ file: string; ref: string | undefined }> =>
+        isYaml(file)
+          ? workflowRefs(readFileSync(join(WORKFLOWS, file), 'utf8')).map(
+              (ref) => ({ file, ref }),
+            )
+          : [{ file, ref: undefined }],
+    );
+    const dangling = refs
+      .filter(
+        ({ ref }) =>
+          ref === undefined || !candidates(ref).some((p) => existsSync(p)),
+      )
+      .map(({ file, ref }) =>
+        ref === undefined ? `${file}: not a workflow` : `${file} → ${ref}`,
+      );
     expect(
-      searched(dangling, { of: workflows, what: 'workflow files' }),
+      searched(dangling, {
+        of: refs.map(({ file, ref }) =>
+          ref === undefined ? file : `${file} → ${ref}`,
+        ),
+        what: 'workflow file references',
+      }),
     ).toEqual([]);
   });
 
+  it('reads every workflow file reference, and as many as there are', () => {
+    // Measured 19 references on 2026-10-03 (#446). Stated tight, so a
+    // reader that comes back one short fails.
+    const files = workflowYamlNames();
+    const read = files.map((file) => ({
+      file,
+      refs: workflowRefs(readFileSync(join(WORKFLOWS, file), 'utf8')),
+    }));
+    expect(read.flatMap(({ refs }) => refs).length).toBeGreaterThan(18);
+    // Cross-checked against the parsed document: every workflow file a
+    // value names once YAML has unquoted, unescaped and unfolded it must be
+    // among what the raw scan read, or the raw text spells it in a way the
+    // scan cannot see. The pattern's own forms are planted below.
+    const missed = read.flatMap(({ file, refs }) =>
+      stringLeaves(parseCleanYaml(workflow(file), file))
+        .flatMap(([, value]) => workflowRefs(value))
+        .filter((ref) => !refs.includes(ref))
+        .map((ref) => `${file} → ${ref}`),
+    );
+    expect(searched(missed, { of: files, what: 'workflow files' })).toEqual([]);
+  });
+
+  it.each([
+    ['a comment', '# was deploy.yml\non: push\n'],
+    [
+      'a reusable workflow',
+      'jobs:\n  a:\n    uses: ./.github/workflows/deploy.yml\n',
+    ],
+    [
+      'a quoted value',
+      "on:\n  workflow_run:\n    workflows: ['deploy.yaml']\n",
+    ],
+    [
+      'a script',
+      'jobs:\n  a:\n    steps:\n      - run: gh workflow run deploy.yml\n',
+    ],
+  ])('reads a workflow file named in %s', (_where, raw) => {
+    expect(workflowRefs(raw)).toHaveLength(1);
+  });
+
   // Production was verified by `curl`: status codes and grepping fetched HTML.
   // That is a TEXT assertion, and this repo has already shipped a bug for a
   // full release that no text assertion can see — `display: flex` ate authored
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts`
Expected: 106 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/pipeline-wiring.test.ts
git commit -m "The dangling-workflow guard counts references and refuses a non-workflow (Refs #446)"
```

### Task 6: `script-entry` judges every read of `process.argv`, and every load-time statement

`readArgv` classifies every `process.argv` read: `[1]`, `?.[1]`, `.slice(n ≤ 1)`, `.at(1)` and a destructuring that reaches index 1 read the entry; any read it cannot classify is named as unjudged. The verdict's population is the reads (10), cross-checked against the text count per script. `loadTimeWork` now returns the statements it judged (313), and the verdict counts them, cross-checked against the statement filter per script.

**Files:** `tests/unit/script-entry.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/script-entry.test.ts b/tests/unit/script-entry.test.ts
index be59146..1559a83 100644
--- a/tests/unit/script-entry.test.ts
+++ b/tests/unit/script-entry.test.ts
@@ -1,11 +1,13 @@
 import { describe, it, expect, beforeAll, afterAll } from 'vitest';
 import { spawnSync } from 'node:child_process';
+import { readFileSync } from 'node:fs';
 import { join, relative } from 'node:path';
 import { pathToFileURL } from 'node:url';
 import ts from 'typescript';
 import { filesUnder, searched } from '../source-files';
 import { parseFile, parseSource, where } from './ast';
 import { scriptCheckout, type ScriptCheckout } from './script-checkout';
+import { withoutTsComments } from './source-text';
 
 /**
  * A script asks "was I run directly?" with `import.meta.main`, and with
@@ -31,27 +33,92 @@ import { scriptCheckout, type ScriptCheckout } from './script-checkout';
  * one.
  */
 
-/** `process.argv[1]`, with or without `?.`. */
-const isArgvEntry = (node: ts.Node): boolean =>
-  ts.isElementAccessExpression(node) &&
-  ts.isNumericLiteral(node.argumentExpression) &&
-  node.argumentExpression.text === '1' &&
-  ts.isPropertyAccessExpression(node.expression) &&
-  node.expression.name.text === 'argv' &&
-  ts.isIdentifier(node.expression.expression) &&
-  node.expression.expression.text === 'process';
-
-/** Where a file reads `process.argv[1]`. */
-const argvEntryReads = (sf: ts.SourceFile): string[] => {
-  const found: string[] = [];
+/** `process.argv` itself. */
+const isArgv = (node: ts.Node): node is ts.PropertyAccessExpression =>
+  ts.isPropertyAccessExpression(node) &&
+  node.name.text === 'argv' &&
+  ts.isIdentifier(node.expression) &&
+  node.expression.text === 'process';
+
+/** A numeric literal's value, or undefined for anything else. */
+const literalIndex = (node: ts.Node | undefined): number | undefined =>
+  node !== undefined && ts.isNumericLiteral(node)
+    ? Number(node.text)
+    : undefined;
+
+/**
+ * Whether a read of `argv` reaches the entry, `process.argv[1]`, and how:
+ * undefined when it does not, else what it reads. Every read is classified,
+ * and one this cannot classify is reported as unjudged, never passed: a
+ * guard that skips a form it cannot read is blind to it (#446).
+ */
+function entryRead(argv: ts.PropertyAccessExpression): string | undefined {
+  const { parent } = argv;
+  if (ts.isElementAccessExpression(parent) && parent.expression === argv) {
+    const index = literalIndex(parent.argumentExpression);
+    return index === undefined
+      ? 'process.argv[<not a literal>], unjudged'
+      : index === 1
+        ? 'process.argv[1]'
+        : undefined;
+  }
+  if (ts.isPropertyAccessExpression(parent) && parent.expression === argv) {
+    const method = parent.name.text;
+    if (method === 'length') return undefined;
+    const call = parent.parent;
+    if (ts.isCallExpression(call) && call.expression === parent) {
+      const from = literalIndex(call.arguments[0]);
+      if (method === 'slice' && from !== undefined)
+        return from <= 1 ? `process.argv.slice(${from})` : undefined;
+      if (method === 'at' && from !== undefined)
+        return from === 1 ? 'process.argv.at(1)' : undefined;
+    }
+    return `process.argv.${method}, unjudged`;
+  }
+  if (
+    ts.isVariableDeclaration(parent) &&
+    parent.initializer === argv &&
+    ts.isArrayBindingPattern(parent.name)
+  ) {
+    // The entry is reached by a binding at index 1, or by a rest element
+    // before it that gathers it.
+    const [first, second] = parent.name.elements;
+    const gathers =
+      first !== undefined &&
+      ts.isBindingElement(first) &&
+      first.dotDotDotToken !== undefined;
+    const binds = second !== undefined && !ts.isOmittedExpression(second);
+    return gathers || binds
+      ? 'process.argv destructured to its entry'
+      : undefined;
+  }
+  return 'process.argv passed on whole, unjudged';
+}
+
+/** Every read of `process.argv` a file makes, each judged, and where one reaches the entry. */
+const readArgv = (
+  sf: ts.SourceFile,
+): { judged: string[]; findings: string[] } => {
+  const judged: string[] = [];
+  const findings: string[] = [];
   const visit = (node: ts.Node): void => {
-    if (isArgvEntry(node)) found.push(where(sf, node));
+    if (isArgv(node)) {
+      judged.push(where(sf, node));
+      const read = entryRead(node);
+      if (read !== undefined) findings.push(`${where(sf, node)} ${read}`);
+    }
     ts.forEachChild(node, visit);
   };
   visit(sf);
-  return found;
+  return { judged, findings };
 };
 
+/** Where a file reads `process.argv[1]`, in any form. */
+const argvEntryReads = (sf: ts.SourceFile): string[] => readArgv(sf).findings;
+
+/** `process.argv`, as text: independent of the parse tree. */
+const ARGV = /\bprocess\.argv\b/g;
+
 /** `import.meta.main`, spelled exactly. */
 const isImportMetaMain = (node: ts.Node): boolean =>
   ts.isPropertyAccessExpression(node) &&
@@ -210,6 +277,17 @@ describe('the entry-check rules read the parse tree (#221)', () => {
     ['other.argv[1];', 0],
     ['process.env[1];', 0],
     ['// process.argv[1]', 0],
+    ['const [, entry] = process.argv;', 1],
+    ['const [node] = process.argv;', 0],
+    ['const [, , first] = process.argv;', 0],
+    ['const [...all] = process.argv;', 1],
+    ['process.argv.slice(1);', 1],
+    ['process.argv.at(1);', 1],
+    ['process.argv.at(2);', 0],
+    ['process.argv.length > 2;', 0],
+    ['run(process.argv);', 1],
+    ['process.argv.includes(flag);', 1],
+    ['process.argv[i];', 1],
   ])('counts the reads of process.argv[1] in: %s', (body, reads) => {
     expect(argvEntryReads(fixture(body))).toHaveLength(reads);
   });
@@ -338,13 +416,17 @@ const isDeclarationOnly = (st: ts.Statement): boolean =>
  * no decision and a script with no `main()` at all produces nothing to look
  * at: both were invisible to every rule meant to govern them (#276).
  */
-const loadTimeWork = (sf: ts.SourceFile): LoadTimeWork[] => {
+const loadTimeWork = (
+  sf: ts.SourceFile,
+): { judged: string[]; found: LoadTimeWork[] } => {
   const io = ioBindings(sf);
+  const judged: string[] = [];
   const found: LoadTimeWork[] = [];
 
   for (const st of sf.statements) {
     const declaresOnly = isDeclarationOnly(st);
     if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) continue;
+    judged.push(where(sf, st));
 
     let reported = false;
     const visit = (node: ts.Node): void => {
@@ -364,7 +446,7 @@ const loadTimeWork = (sf: ts.SourceFile): LoadTimeWork[] => {
     };
     visit(st);
   }
-  return found;
+  return { judged, found };
 };
 
 /**
@@ -374,12 +456,10 @@ const loadTimeWork = (sf: ts.SourceFile): LoadTimeWork[] => {
  * an assertion that cannot tell them apart is the vacuity #118 was filed
  * about.
  */
-const judgeSource = (sf: ts.SourceFile) => ({
-  examined: sf.statements.filter(
-    (st) => !ts.isImportDeclaration(st) && !ts.isExportDeclaration(st),
-  ).length,
-  work: loadTimeWork(sf).map(({ what }) => what),
-});
+const judgeSource = (sf: ts.SourceFile) => {
+  const { judged, found } = loadTimeWork(sf);
+  return { examined: judged.length, work: found.map(({ what }) => what) };
+};
 
 /** What the load-time rule makes of a fixture body. */
 const judgeWork = (body: string) => judgeSource(fixture(body));
@@ -652,8 +732,40 @@ describe('a script asks whether it was run directly with import.meta.main alone
   });
 
   it('never reads process.argv[1]', () => {
-    const reads = modules.flatMap((file) => argvEntryReads(parseFile(file)));
-    expect(searched(reads, { of: modules, what: 'scripts' })).toEqual([]);
+    // The population is the reads of process.argv judged, not the scripts
+    // opened: a reader blind to every read would open each script and pass
+    // (#446).
+    const readings = modules.map((file) => readArgv(parseFile(file)));
+    const reads = readings.flatMap(({ findings }) => findings);
+    expect(
+      searched(reads, {
+        of: readings.flatMap(({ judged }) => judged),
+        what: 'reads of process.argv',
+      }),
+    ).toEqual([]);
+  });
+
+  it('judges every read of process.argv the scripts make, and as many as there are', () => {
+    // Measured 10 reads on 2026-10-03 (#446). Stated tight, so a reader that
+    // comes back one short fails.
+    const readings = modules.map((file) => ({
+      file,
+      judged: readArgv(parseFile(file)).judged.length,
+      written:
+        withoutTsComments(readFileSync(file, 'utf8')).match(ARGV)?.length ?? 0,
+    }));
+    expect(
+      readings.reduce((sum, { judged }) => sum + judged, 0),
+    ).toBeGreaterThan(9);
+    // Two readers, the parse tree and the text: a script where they disagree
+    // holds a form the tree reader is blind to.
+    const disagree = readings
+      .filter(({ judged, written }) => judged !== written)
+      .map(
+        ({ file, judged, written }) =>
+          `${file}: ${judged} judged, ${written} written`,
+      );
+    expect(searched(disagree, { of: modules, what: 'scripts' })).toEqual([]);
   });
 
   it('decides on import.meta.main alone', () => {
@@ -777,12 +889,43 @@ describe('a guarded script can be imported without running (#227)', () => {
  */
 describe('a script does no work while it loads (#276)', () => {
   it('leaves every effect to an import.meta.main decision', () => {
-    const work = modules.flatMap((file) =>
-      loadTimeWork(parseFile(file)).map(({ at, what }) => `${at} ${what}`),
+    // The population is the statements judged, not the scripts opened: a
+    // reader that skipped every statement would open each script and pass
+    // (#446).
+    const readings = modules.map((file) => loadTimeWork(parseFile(file)));
+    const work = readings.flatMap(({ found }) =>
+      found.map(({ at, what }) => `${at} ${what}`),
     );
     expect(
-      searched(work, { of: modules, what: 'scripts' }),
+      searched(work, {
+        of: readings.flatMap(({ judged }) => judged),
+        what: 'load-time statements',
+      }),
       'a module that works while it loads runs its program on import',
     ).toEqual([]);
   });
+
+  it('judges every load-time statement the scripts hold, and as many as there are', () => {
+    // Measured 313 statements on 2026-10-03 (#446). Stated tight, so a
+    // reader that comes back one short fails.
+    const readings = modules.map((file) => {
+      const sf = parseFile(file);
+      return {
+        file,
+        judged: loadTimeWork(sf).judged.length,
+        // Counted apart from the rule's own loop: every top-level statement
+        // but an import or an export, which build the module's interface.
+        held: sf.statements.filter(
+          (st) => !ts.isImportDeclaration(st) && !ts.isExportDeclaration(st),
+        ).length,
+      };
+    });
+    expect(
+      readings.reduce((sum, { judged }) => sum + judged, 0),
+    ).toBeGreaterThan(312);
+    const skipped = readings
+      .filter(({ judged, held }) => judged !== held)
+      .map(({ file, judged, held }) => `${file}: ${judged} of ${held} judged`);
+    expect(searched(skipped, { of: modules, what: 'scripts' })).toEqual([]);
+  });
 });
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/script-entry.test.ts`
Expected: 129 passed. The old `isArgvEntry` saw only `[1]` and `?.[1]`: Task 9's A1 plants a destructured entry in a script, and the old tree stays GREEN while the new one goes RED.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/script-entry.test.ts
git commit -m "script-entry judges every argv read and load-time statement (Refs #446)"
```

### Task 7: The dissolved-company scan judges page texts

The verdict's population is each built page's text (`renderedText`), so a reader that returns nothing fails. A separate test holds the page count above 15 (16 measured: five locales of three pages, and the 404), and names any page with a body that read as blank. `dissolved-company.test.ts` plants the name in a title, a meta tag, visible text and escaped text.

**Files:** `tests/e2e/copy-reaches-a-page.spec.ts`, `tests/unit/dissolved-company.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/e2e/copy-reaches-a-page.spec.ts b/tests/e2e/copy-reaches-a-page.spec.ts
index a727132..10c540e 100644
--- a/tests/e2e/copy-reaches-a-page.spec.ts
+++ b/tests/e2e/copy-reaches-a-page.spec.ts
@@ -319,14 +319,42 @@ test.describe('every site string reaches a built page', () => {
  * than listed, so a page added later is covered the day it is built.
  */
 test.describe('no built page names the dissolved company (#370)', () => {
+  // Decoded first: raw HTML serves the old registration line as
+  // `England &amp; Wales`, and the forms are written as a reader sees them.
+  const read = () =>
+    filesUnder('dist', (path) => /\.html$/.test(path)).map((path) => {
+      const html = readFileSync(path, 'utf8');
+      return { path, html, text: renderedText(html) };
+    });
+
   test('every page in every locale', () => {
-    const pages = filesUnder('dist', (path) => /\.html$/.test(path));
-    // Decoded first: raw HTML serves the old registration line as
-    // `England &amp; Wales`, and the forms are written as a reader sees them.
-    const naming = pages.flatMap((path) => {
-      const found = dissolvedIn(renderedText(readFileSync(path, 'utf8')));
+    // The population is the text each page was read as, not the paths
+    // opened: a reader that returned nothing would open every page and pass
+    // (#446).
+    const pages = read();
+    const naming = pages.flatMap(({ path, text }) => {
+      const found = dissolvedIn(text);
       return found.length > 0 ? [`${path}: ${found.join(', ')}`] : [];
     });
-    expect(searched(naming, { of: pages, what: 'built pages' })).toEqual([]);
+    expect(
+      searched(naming, {
+        of: pages.map(({ text }) => text),
+        what: 'built pages read',
+      }),
+    ).toEqual([]);
+  });
+
+  test('reads every built page, and as many as there are', () => {
+    // Measured 16 built pages on 2026-10-03 (#446): five locales of three
+    // pages, and the 404. Stated tight, so a build or a walk that comes back
+    // one short fails.
+    const pages = read();
+    expect(pages.length).toBeGreaterThan(15);
+    // A page whose HTML has a body and whose text read as nothing is a page
+    // the reader is blind to.
+    const blank = pages
+      .filter(({ html, text }) => /<body\b/i.test(html) && text.trim() === '')
+      .map(({ path }) => path);
+    expect(searched(blank, { of: pages, what: 'built pages' })).toEqual([]);
   });
 });
diff --git a/tests/unit/dissolved-company.test.ts b/tests/unit/dissolved-company.test.ts
index 0b8df99..5191f36 100644
--- a/tests/unit/dissolved-company.test.ts
+++ b/tests/unit/dissolved-company.test.ts
@@ -66,6 +66,20 @@ describe('dissolvedIn: every form the dissolved company was printed in', () => {
     expect(dissolvedIn(renderedText(served))).not.toEqual([]);
   });
 
+  it.each([
+    ['a title', '<head><title>Shyden Ltd</title></head>'],
+    ['a meta tag', '<meta name="description" content="Company No. 17110487">'],
+    [
+      'visible text',
+      '<footer><p>Registered office: Shelton Street</p></footer>',
+    ],
+    ['text served escaped', '<p>England &amp; Wales</p>'],
+  ])('catches a form in %s of a built page', (_where, html) => {
+    // The all-pages scan reads the whole served HTML, so a name in the head is
+    // read like one in the body (#446).
+    expect(dissolvedIn(renderedText(html))).not.toEqual([]);
+  });
+
   it('reads Ltd as a word, not as letters inside one', () => {
     expect(dissolvedIn('Altdorf and Ltda.')).toEqual([]);
     expect(dissolvedIn('Shyden Ltd.')).toEqual(['Ltd']);
```


- [ ] **Step 2: Run both**

Run: `npx vitest run tests/unit/dissolved-company.test.ts && npx playwright test --project=content tests/e2e/copy-reaches-a-page.spec.ts -g dissolved`
Expected: both pass; the e2e run reports 2 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/copy-reaches-a-page.spec.ts tests/unit/dissolved-company.test.ts
git commit -m "The dissolved-company scan counts the page texts it reads (Refs #446)"
```

### Task 8: `duplicate-imports` judges imports, not files

This task comes after Tasks 5 and 6 on purpose: its floor counts every import under `src/`, `scripts/` and `tests/`, and those two tasks add three, so committed earlier its own commit would be red (1509, measured, against a floor of 1511). `readImports` returns every import it judged beside the repeats. The verdict's population is the imports read (1512, namespace imports included), with a floor and a text cross-check (`IMPORTS`: a program whose stripped text opens a line with `import` and a binding must yield an import).

**Files:** `tests/unit/duplicate-imports.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/duplicate-imports.test.ts b/tests/unit/duplicate-imports.test.ts
index 5ebffc6..a84860f 100644
--- a/tests/unit/duplicate-imports.test.ts
+++ b/tests/unit/duplicate-imports.test.ts
@@ -3,7 +3,7 @@ import ts from 'typescript';
 import { describe, expect, it } from 'vitest';
 import { filesUnder, searched } from '../source-files';
 import { parseSource } from './ast';
-import { astroCodeViews } from './source-text';
+import { astroCodeViews, withoutTsComments } from './source-text';
 
 /**
  * No module imports the same specifier twice (#390 F59).
@@ -23,22 +23,31 @@ import { astroCodeViews } from './source-text';
  * Read from the AST, never the text: an import spelled inside a fixture string
  * is not an import, and a multi-line import is one declaration.
  */
-function repeatedImports(sf: ts.SourceFile): string[] {
+function readImports(sf: ts.SourceFile): {
+  read: string[];
+  repeated: string[];
+} {
+  const read: string[] = [];
   const seen = new Map<string, number>();
   for (const statement of sf.statements) {
     if (!ts.isImportDeclaration(statement)) continue;
     const clause = statement.importClause;
     if (clause === undefined) continue;
-    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
-      continue;
     const specifier = moduleOf(
       (statement.moduleSpecifier as ts.StringLiteral).text,
     );
+    // Read, and judged allowed: see the namespace form above.
+    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
+      read.push(`* as ${specifier}`);
+      continue;
+    }
     const typeOnly = clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
     const key = `${typeOnly ? 'type ' : ''}${specifier}`;
+    read.push(key);
     seen.set(key, (seen.get(key) ?? 0) + 1);
   }
-  return [...seen].filter(([, n]) => n > 1).map(([key]) => key);
+  const repeated = [...seen].filter(([, n]) => n > 1).map(([key]) => key);
+  return { read, repeated };
 }
 
 /**
@@ -50,19 +59,38 @@ function moduleOf(specifier: string): string {
 }
 
 const repeatsIn = (text: string, file = 'case.ts'): string[] =>
-  repeatedImports(parseSource(text, file));
+  readImports(parseSource(text, file)).repeated;
 
 /** Each module the file holds: an `.astro` file's frontmatter and scripts are separate programs. */
 function programsOf(path: string, text: string): string[] {
   return path.endsWith('.astro') ? astroCodeViews(text) : [text];
 }
 
-const fileRepeats = (path: string, text: string): string[] =>
-  programsOf(path, text).flatMap((program) =>
-    repeatedImports(parseSource(program, path)),
+/** Every import a file's programs declare with bindings, each judged, and the modules among them named twice. */
+const fileImports = (
+  path: string,
+  text: string,
+): { read: string[]; repeated: string[] } => {
+  const readings = programsOf(path, text).map((program) =>
+    readImports(parseSource(program, path)),
   );
+  return {
+    read: readings.flatMap(({ read }) => read),
+    repeated: readings.flatMap(({ repeated }) => repeated),
+  };
+};
+
+const fileRepeats = (path: string, text: string): string[] =>
+  fileImports(path, text).repeated;
+
+/**
+ * An import with bindings, read as text with comments stripped: independent
+ * of the parse tree, so a reader gone blind to a form is caught by the file
+ * it read no import in (#446).
+ */
+const IMPORTS = /^\s*import\s+(?!['"])/m;
 
-describe('repeatedImports reads declarations, not text', () => {
+describe('readImports reads declarations, not text', () => {
   it('names a module imported twice by name', () => {
     expect(
       repeatsIn("import { a } from './m';\nimport { b } from './m';\n"),
@@ -138,17 +166,45 @@ describe('repeatedImports reads declarations, not text', () => {
 });
 
 describe('no source imports one module twice (#390 F59)', () => {
+  const scan = () =>
+    ['src', 'scripts', 'tests']
+      .flatMap((dir) =>
+        filesUnder(dir, (path) => /\.(astro|ts|mjs|js)$/.test(path)),
+      )
+      .map((path) => {
+        const text = readFileSync(path, 'utf8');
+        return { path, text, ...fileImports(path, text) };
+      });
+
   it('src, scripts and tests each import a module once', () => {
-    const sources = ['src', 'scripts', 'tests'].flatMap((dir) =>
-      filesUnder(dir, (path) => /\.(astro|ts|mjs|js)$/.test(path)),
-    );
-    const repeated = sources.flatMap((path) =>
-      fileRepeats(path, readFileSync(path, 'utf8')).map(
-        (specifier) => `${path}: ${specifier}`,
-      ),
-    );
-    expect(searched(repeated, { of: sources, what: 'source files' })).toEqual(
-      [],
+    // The population is the imports judged, not the files opened: a reader
+    // blind to every declaration would open each file and pass (#446).
+    const sources = scan();
+    const repeated = sources.flatMap(({ path, repeated }) =>
+      repeated.map((specifier) => `${path}: ${specifier}`),
     );
+    expect(
+      searched(repeated, {
+        of: sources.flatMap(({ read }) => read),
+        what: 'imports read',
+      }),
+    ).toEqual([]);
+  });
+
+  it('reads every import the sources declare, and as many as there are', () => {
+    // Measured 1512 imports on 2026-10-03 (#446). Stated tight, so a reader
+    // that comes back one short fails.
+    const sources = scan();
+    expect(sources.flatMap(({ read }) => read).length).toBeGreaterThan(1511);
+    const unread = sources
+      .filter(
+        ({ path, text, read }) =>
+          read.length === 0 &&
+          programsOf(path, text).some((program) =>
+            IMPORTS.test(withoutTsComments(program)),
+          ),
+      )
+      .map(({ path }) => path);
+    expect(searched(unread, { of: sources, what: 'source files' })).toEqual([]);
   });
 });
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/duplicate-imports.test.ts`
Expected: 12 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/duplicate-imports.test.ts
git commit -m "duplicate-imports counts the imports it judges (Refs #446)"
```

### Task 9: The mutation matrix

Run `python3 g2a_mut.py after <new tree>` and `python3 g2a_mut.py before <old tree>` from `../shyden.co.uk-446/.superpowers/sdd/446/`. The old tree is `develop`'s tree at `6d07d37`; the recorded run used the `shyden.co.uk-446` worktree at `7557b07`, the same tree. Each row applies its edits (each anchor must occur exactly once), runs the whole test file, and compares the named targets' verdicts with the prediction. The table is the prediction. Pass 0 corrected four predictions (S1, N1, N2, D2) and replaced one mutation that this corpus cannot express (L2), and pass 1 made the harness report a target with no test as ABSENT. Each reason is in the review log; the table below is the corrected one:

| Id | Mutation | Old tree | New tree |
| --- | --- | --- | --- |
| S1 | `declarationsIn` reads nothing | GREEN (isolated, parked); RED (viewport, which reports every viewport call with no owner as an orphan) | RED (×3) |
| S2 | the spec walk skips `*.journey.ts` | GREEN | RED (×3) |
| S3 | floor switched off, one file judged blind | – | RED (cross-check alone) |
| K1 | the capture scan matches nothing | GREEN | RED |
| K2 | the capture scan cannot see `x.shoot(` | – | RED |
| B1 | byte reads blind to the home | – | RED |
| N1 | `astroCodeViews` reads nothing | GREEN (the floor test is ABSENT there) | RED (the floor test; the verdict stays GREEN, since markup views still fill it) |
| N2 | `astroTemplate` reads nothing | GREEN (the floor test is ABSENT there) | RED (the floor test, as N1) |
| N3 | the clock pattern loses `Date.now(` | – | RED |
| D1 | component styles read as nothing | GREEN | RED (D1b) |
| D2 | a block's last declaration unread | – | RED (the planted form); the floor stays GREEN, since prettier ends every block with `;` and the corpus holds no instance |
| I1 | no import read | GREEN | RED |
| I2 | component imports unread | GREEN | RED (I2b) |
| E1 | the spread form unread | – | RED (×3) |
| E2 | no loop recognised | GREEN | RED |
| E3 | the tree blind to `.all()` | – | RED |
| P1 | the reference pattern matches nothing | GREEN | RED |
| P2 | a non-YAML file in the workflows directory | GREEN | RED |
| P3 | a dangling reference in a comment (control) | RED | RED |
| A1 | a script destructures `process.argv` to its entry | GREEN | RED |
| A2 | the argv reader blind | – | RED |
| L1 | the load-time rule skips every statement | GREEN | RED |
| L2 | the load-time rule skips `if` statements (21 scripts open one) | GREEN | RED (L2b) |
| C1 | page text read as nothing | GREEN | RED |
| X1, X2 | floor off; viewport's, then parked's, reading of `chrome.spec.ts` blind | – | RED |
| X3 | floor off; `helpers.ts`'s byte reads unjudged | – | RED |
| X4 | floor off; `chrome.spec.ts`'s captures unjudged | – | RED |
| X5 | floor off; a source holding `<html` reads no code | – | RED |
| X6 | floor off; a source holding `<html` reads no markup | – | RED |
| X7 | floor off; every component's styles unread | – | RED |
| X8 | floor off; every import under `src/` unread | – | RED |
| X9 | a workflow names `gone\x2eyml`, which only YAML reads as `gone.yml` | – | RED |
| X10 | floor off; the argv reader blind | – | RED |
| X11 | floor off; the load-time rule skips `if` statements | – | RED |
| X12 | floor off; every Chinese page's text read as blank | – | RED |

- [ ] **Step 1: Run both trees and read every row**

Expected: every row as predicted (recorded: 36 of 36 new, 16 of 16 old). A row that is not is a finding: read the whole failure list in `g2a-after.jsonl` or `g2a-before.jsonl` before believing either verdict.

### Task 10: Record Group 2a in the ledger, push, and open the pull request

The ledger gains a Group 2a section (what each guard now counts, the two form gaps, the matrix result), and the nine construct sites' status in Appendix A reads "done in Group 2a". Appendices A and B stay the census at `6d07d37`, and the section says so, naming the one Appendix B floor Group 2a removed.

**Files:** `docs/reviews/2026-10-03-guard-liveness-ledger.md`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index 0ff4227..d4adad8 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -110,6 +110,43 @@ fail-closed reading, and a planted construct in every form it takes.
 `pipeline-wiring.test.ts:1044` also skips a file that is not YAML with a
 silent `continue`. Appendix A gives each site's status.
 
+## Group 2a: construct guards, done
+
+The 9 sites above that judge a construct while counting files now count what
+they judge (#446 Group 2a, plan
+`docs/superpowers/plans/2026-10-03-guard-audit-group-2a.md`). Each verdict's
+population is the judged unit, the walk that made the verdict supplies it, and a
+floor at measured − 1, an independent cross-check and the construct's planted
+forms sit beside it:
+
+| Guard | Judged unit | Measured | Cross-check |
+| --- | --- | --- | --- |
+| `spec-scan.ts` (isolated-context, viewport, parked) | tests and groups read | 638, 771, 771 | `declaresTests`, text against the parse tree |
+| `spec-scan.ts` (`download-readers`) | download byte reads | 8 | a text scan for the three readers |
+| `spec-scan.ts` (`capture-after-assertion`) | evidence captures | 143 | `shoot` calls in the parse tree |
+| `no-dated-render` | code and markup views | 46 | `HOLDS_CODE`, frontmatter or a `<script` tag |
+| `deprecated-css` | declarations | 1170 | `HOLDS_CSS`, a rule or a `<style` tag |
+| `duplicate-imports` | imports read | 1512 | `IMPORTS`, a line opening an import |
+| `event-collectors` | locator loops | 8 | `.all()` in the text against the tree, per file |
+| `pipeline-wiring` dangling refs | workflow file references | 19 | the parsed document's string values |
+| `script-entry` argv / load-time | `process.argv` reads / statements | 10 / 313 | the text count / the statement filter |
+| `copy-reaches-a-page` dissolved | built pages read | 16 | a page with a body that read as blank |
+
+Two forms the code writes were invisible before: `formTextsUnderAA` loops a
+spread `.all()` list, which `event-collectors` counted as no loop (7 loops, really 8),
+and `script-entry` saw `process.argv[1]` only by index, never destructured,
+sliced from 1, read with `.at(1)` or passed on whole. Each reader now names
+what it cannot classify instead of skipping it, and `pipeline-wiring` names a
+file in the workflows directory that is not YAML instead of `continue`.
+
+The mutation matrix ran 52 rows, all as predicted: 16 on `develop`, where the
+blinded guard stayed GREEN (so the gap was real, except the viewport guard,
+whose orphan findings already caught a reader blind to every declaration), and
+36 on the new tree, where each one turned a guard RED. Twelve of those prove each
+cross-check alone, with its floor switched off. Appendices A and B below are the
+census at `6d07d37`, before Group 2a. `download-readers.test.ts:78`'s
+file-level floor in Appendix B is gone, replaced by the byte-read floor above.
+
 ## Group 3: plain counts, next
 
 9 `searched` calls pass a number (`text.length`, `result.scanned`,
@@ -159,7 +196,7 @@ on macOS is not the one CI reads.
 | `e2e/copy-reaches-a-page.spec.ts:291` | ${locale}: no defined copy renders nowhere | `defined` | `missing` | loop-built | to read |
 | `e2e/copy-reaches-a-page.spec.ts:295` | ${locale}: no defined copy renders nowhere | `defined` | `wronglyAllowed` | loop-built | to read |
 | `e2e/copy-reaches-a-page.spec.ts:305` | ${locale}: no defined copy renders nowhere | `[...seen]` | `phantom` | findings drawn from it | sound at one hop: findings are built from the population |
-| `e2e/copy-reaches-a-page.spec.ts:330` | every page in every locale | `pages` | `naming` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `e2e/copy-reaches-a-page.spec.ts:330` | every page in every locale | `pages` | `naming` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `e2e/disabled-controls.spec.ts:280` | (module level) | `reachable.map((a) => a.label)` | `reachable` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/disabled-controls.spec.ts:314` | (module level) | `painted.map((a) => a.label)` | `painted` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/disabled-controls.spec.ts:393` | (module level) | `seen.map((r) => r.label)` | `seen` | findings drawn from it | sound at one hop: findings are built from the population |
@@ -241,13 +278,13 @@ on macOS is not the one CI reads.
 | `unit/dead-copy.test.ts:121` | the site-wide copy defines nothing that no page renders | `groups` | `unused` | loop-built | to read |
 | `unit/dependabot-labels.test.ts:58` | come from the parsed document, so a comment cannot add one | `declaredLabels(withComment)` | `declaredLabels(withComment).filter((nam…` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/dependabot-labels.test.ts:143` | runs inside ${REQUIRED_JOB} or a job it stands for, the context branc… | `runs` | `runs.filter((run) => run.includes('scri…` | findings drawn from it | sound at one hop: findings are built from the population |
-| `unit/deprecated-css.test.ts:83` | finds none in any stylesheet under src/ | `sheets.map(({ css }) => css)` | `findings` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `unit/deprecated-css.test.ts:83` | finds none in any stylesheet under src/ | `sheets.map(({ css }) => css)` | `findings` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `unit/device-tool-homes.test.ts:38` | reads every call site through the one home | `files` | `spawning` | file-level | no cross-check found beside it yet; read in Group 2 |
 | `unit/device-tool-homes.test.ts:68` | only scripts/adb.mjs decides which listed device is ready | `files` | `reading` | file-level | sound: judges the unit it counts |
-| `unit/duplicate-imports.test.ts:150` | src, scripts and tests each import a module once | `sources` | `repeated` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `unit/duplicate-imports.test.ts:150` | src, scripts and tests each import a module once | `sources` | `repeated` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `unit/duplication.test.ts:126` | finds no cross-file duplicate that has not been given a verdict | `DECLARATIONS` | `findings` | loop-built | to read |
 | `unit/duplication.test.ts:139` | carries no verdict for a pair that no longer exists | `recorded` | `recorded.filter((key) => !live.has(key))` | findings drawn from it | sound at one hop: findings are built from the population |
-| `unit/event-collectors.test.ts:499` | every .all() loop proves its locator is not empty first | `SCANNED` | `unproved` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `unit/event-collectors.test.ts:499` | every .all() loop proves its locator is not empty first | `SCANNED` | `unproved` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `unit/evidence-page.test.ts:1064` | never deletes a directory the operator was asked to keep | `deletions.length` | `deletions` | count | to read |
 | `unit/evidence-page.test.ts:1247` | has no consumer spelling an evidence filename for itself | `consumers` | `respellings` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/evidence-page.test.ts:1586` | emits only media references the artifact serves | `srcs` | `unservable` | file-level | sound: judges the unit it counts |
@@ -286,7 +323,7 @@ on macOS is not the one CI reads.
 | `unit/message-parity.test.ts:173` | %s fills the slots English fills, in every string | `ENGLISH.map(([path]) => path)` | `differing` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/message-parity.test.ts:196` | %s offers every choice of sentence English offers | `choosing.map(([path]) => path)` | `differing` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/message-parity.test.ts:237` | every plural offers exactly the forms its language has | `plurals.map(({ where }) => where)` | `wrong` | findings drawn from it | sound at one hop: findings are built from the population |
-| `unit/no-dated-render.test.ts:34` | no .astro source reads the date, in its code or its markup | `sources` | `dated` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `unit/no-dated-render.test.ts:34` | no .astro source reads the date, in its code or its markup | `sources` | `dated` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `unit/one-test-per-case.test.ts:282` | loops no known population inside a test | `tests` | `sites` | loop-built | to read |
 | `unit/one-test-per-case.test.ts:295` | reads the tests every spec declares, and as many as there are | `specDirs().flatMap(tsFilesUnder)` | `unread` | loop-built | to read |
 | `unit/organisation-name.test.ts:61` | only the one historic fixture outside the dated docs | `files` | `hits.filter((hit) => !KEPT.includes(hit…` | file-level | sound: judges the unit it counts |
@@ -299,7 +336,7 @@ on macOS is not the one CI reads.
 | `unit/pipeline-wiring.test.ts:649` | no job that deploys or verifies prod reads a secret meant for dev (#2… | `prodJobs.map(({ where }) => where)` | `leaks` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/pipeline-wiring.test.ts:935` | documents only a context something in this repository can report | `claims.map(({ context }) => context)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/pipeline-wiring.test.ts:967` | never calls a deploy a release | `deploys` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
-| `unit/pipeline-wiring.test.ts:1044` | no workflow names a workflow file that does not exist | `workflows` | `dangling` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `unit/pipeline-wiring.test.ts:1044` | no workflow names a workflow file that does not exist | `workflows` | `dangling` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `unit/pipeline-wiring.test.ts:1171` | is not bypassed by any workflow calling Playwright directly | `workflowFileNames()` | `bypasses.map(({ file, line }) => `${fil…` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/pipeline-wiring.test.ts:1224` | takes the image the baselines are captured in from one selector | `workflows` | `named` | file-level | no cross-check found beside it yet; read in Group 2 |
 | `unit/pipeline-wiring.test.ts:1354` | no artifact capture in any workflow is set to ignore | `steps` | `silent` | findings drawn from it | sound at one hop: findings are built from the population |
@@ -339,9 +376,9 @@ on macOS is not the one CI reads.
 | `unit/scoped-classes.test.ts:266` | can read every class those files write | `all.flatMap(({ read }) => read)` | `unreadable` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/scratch-git-home.test.ts:79` | no call anywhere else hands git a cwd | `calls` | `calls .filter((call) => call.cwd && cal…` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/script-entry.test.ts:649` | reads every file under scripts/ | `files` | `unread` | file-level | sound: judges the unit it counts |
-| `unit/script-entry.test.ts:656` | never reads process.argv[1] | `modules` | `reads` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `unit/script-entry.test.ts:656` | never reads process.argv[1] | `modules` | `reads` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `unit/script-entry.test.ts:663` | decides on import.meta.main alone | `decisions` | `wrong` | findings drawn from it | sound at one hop: findings are built from the population |
-| `unit/script-entry.test.ts:784` | leaves every effect to an import.meta.main decision | `modules` | `work` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `unit/script-entry.test.ts:784` | leaves every effect to an import.meta.main decision | `modules` | `work` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `unit/shipped-defaults.test.ts:496` | refuses an expectation a roster-building test could not have written | `all` | `all .filter((collision) => collision.af…` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/shytalk-brand.test.ts:137` | is spelled out nowhere else in the repo | `files` | `offenders` | file-level | no cross-check found beside it yet; read in Group 2 |
 | `unit/shytalk-showcase.test.ts:98` | has a capture for every locale the site serves | `LOCALES` | `missing` | findings drawn from it | sound at one hop: findings are built from the population |
@@ -362,7 +399,7 @@ on macOS is not the one CI reads.
 | `unit/source-files.test.ts:151` | counts a zero and a false as content -- they are values, not blanks | `[0]` | `[]` | self-test of searched | sound: tests the control itself |
 | `unit/source-files.test.ts:152` | counts a zero and a false as content -- they are values, not blanks | `[false]` | `[]` | self-test of searched | sound: tests the control itself |
 | `unit/source-files.test.ts:156` | names the population in the message, so a failure says what died | `[]` | `[]` | self-test of searched | sound: tests the control itself |
-| `unit/spec-scan.ts:45` | (module level) | `files` | `findings` | file-level | mismatch: judges a construct, counts files (Group 2) |
+| `unit/spec-scan.ts:45` | (module level) | `files` | `findings` | file-level | done in Group 2a: judged unit, floor, cross-check |
 | `unit/stranded-docblocks.test.ts:126` | reads every source file git tracks | `tracked` | `tracked.filter((path) => !read.has(path…` | file-level | sound: judges the unit it counts |
 | `unit/stranded-docblocks.test.ts:167` | finds a docblock in every kind of source that holds one | `held` | `held.filter((kind) => !read.includes(ki…` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/stranded-docblocks.test.ts:176` | finds none sitting directly on another | `SCANS.flatMap((scan) => scan.docblocks)` | `SCANS.flatMap((scan) => scan.stranded)` | findings drawn from it | sound at one hop: findings are built from the population |
```


- [ ] **Step 2: Put this plan in the repository**

Copy the reviewed plan to `docs/superpowers/plans/2026-10-03-guard-audit-group-2a.md`: `cp ../shyden.co.uk-446/.superpowers/sdd/446/g2a-plan.md docs/superpowers/plans/2026-10-03-guard-audit-group-2a.md`.

- [ ] **Step 3: Run every gate on the whole tree**

Run: `git add -N . && npm run test:unit && npm run typecheck && npx prettier --check .`
Expected: unit 3439 passed (the plan file itself included, since guards read `.md`), `astro check` 0 errors, 0 warnings, 0 hints, prettier clean.

- [ ] **Step 4: Commit, push, open the pull request, merge on green**

```bash
git add docs/reviews/2026-10-03-guard-liveness-ledger.md docs/superpowers/plans/2026-10-03-guard-audit-group-2a.md
git commit -m "The ledger records Group 2a (Refs #446)"
git push -u origin 446-guard-audit-2a
```

Open the PR into `develop` with a body that says `Refs #446`, checked by `node scripts/closing-keywords.mjs <body> "this pull request body"`. Wait for CI with `wait-run.sh`, read every job by name at the PR's `headRefOid`, merge with a merge commit, then read `deploy-dev.yml`'s jobs by name and `dev-verified` off the merge commit.

## Review log

**Pass 0 (2026-10-03, prototype at `6d07d37`'s tree), 9 findings, all fixed in the patches above.** Ran, not read: the whole unit suite, `astro check`, prettier, the `content` run, and the matrix on both trees.

1. `absence-liveness` refused a synthetic capture test asserting `findings` empty with no population: the test now asserts the whole `Reading`, captures judged included.
2. `duplication` refused three near-identical `expectNothingFound` call bodies: `declarationsRead` gives them one home.
3. `one-home` refused a recursive YAML string walk in `pipeline-wiring`: it uses `stringLeaves`, the catalogue walk's home.
4. `astro check` refused the reference list's union element type (4 errors): annotated.
5. The first capture self-test had an expectation that could not mean anything (`[...].slice(0, 0)`): rewritten to the literal `Reading`.
6. S1 on the old tree: the viewport guard went RED, not GREEN. Its orphan findings fire when no declaration is read, so it was never vacuous to S1; S2 (a narrowed walk) does pass it. Prediction corrected.
7. N1 and N2 on the new tree: the verdict test stays GREEN because the other view kind still fills it, and the floor test goes RED. Predictions corrected to name the test that catches.
8. D2 on the new tree: the floor stays GREEN because no block in the corpus ends without `;`. The planted form goes RED. Prediction corrected.
9. L2 could not happen in this corpus: no script has a top-level expression statement. Replaced with "skips `if` statements" (21 scripts open one).

**Pass 1 (2026-10-03), 7 findings, all fixed.** Applied the plan to a clean `develop` tree with `g2a_plan.py --apply`; the result equals the prototype byte for byte; unit 3437/3437, `astro check` 0/0/0, prettier clean; the matrix re-run on both trees.

1. The matrix harness called a target GREEN when no failing title held it, so a target naming a test that does not exist read GREEN: N1 and N2's `reads every view` on the old tree. It now records every test name and reports ABSENT, and those two predictions say ABSENT. The whole matrix was re-run on both trees.
2. `spec-scan.ts`'s comment on `declarationsRead` said four guards read declarations; three do.
3. Task 1's prose said the same: corrected.
4. Review Focus 2 called `no-dated-render` and `deprecated-css` parse-tree readers; they are a region reader and a rule reader. Corrected, with the declaration guards named.
5. Task 7 claimed its argv fixtures were RED against the old reader without having run that; it now cites A1, which was run.
6. `unfollowedLists` cast its call to a property access; it now narrows with `isAllCall`, the type guard.
7. The dangling-reference population named a non-YAML file as `file → undefined`; it now names the file.

**Pass 2 (2026-10-03), 1 finding, fixed.** Applied the regenerated plan to a clean `develop` tree (equal to the prototype byte for byte); unit 3437/3437, `astro check` 0/0/0, prettier clean, the whole `copy-reaches-a-page` spec 13/13 in the `content` project, and the new-tree matrix re-run on the cleaned prototype (24/24 as predicted).

1. Task 10 described the ledger edit without giving it, and left Appendix B naming `download-readers.test.ts:78`, a floor this plan deletes. The edit is now a patch from the prototype like every other task, and its section says the appendices are the census at `6d07d37` and names the removed floor.

**Pass 3 (2026-10-03), 4 findings, fixed.** Applied to a clean `develop` tree with the plan file itself in place (`git add -N`): 9 patches equal to the prototype, prettier leaves the plan unchanged and its diff blocks intact, unit 3437/3437, `astro check` 0/0/0, prettier clean, no closing keyword in the plan. The code is unchanged since pass 2's matrix (the ledger patch is prose), so that result stands. Read every line of the prose.

1. Task 9 said pass 0 corrected four predictions; it corrected four, replaced a fifth row (L2), and pass 1 added ABSENT. Said so.
2. N1 and N2's old-tree cells hid that their floor test does not exist there. Said so.
3. Task 9 named `.superpowers/sdd/446/g2a_mut.py` as if every worktree held it; it lives in the `shyden.co.uk-446` worktree only. A "Where it runs" section now names the branch, its worktree and the tools' home.
4. Task 9 did not record the matrix result it expects. It does now, with each file's name.

**Pass 4 (2026-10-03), 6 findings, fixed.** `g2a-pass.sh` clean (patches equal to the prototype, unit 3437/3437, `astro check` 0/0/0, prettier, no closing keyword); read every line of the prose; the new-tree matrix re-run with 12 new rows, 36 of 36 as predicted.

1. A cross-check sits after its floor in one test, so every blinding mutation failed on the floor and only `spec-scan`'s cross-check (S3) had been proved on its own; Review Focus 1 claimed all were. Twelve rows (X1-X12) now switch each floor off and blind one file or form; all went RED. X9 plants a reference only YAML can read (`"gone\x2eyml"`), the form `pipeline-wiring`'s cross-check exists for.
2. `no-dated-render`'s cross-check called `astroCodeViews` and `astroTemplate` again rather than asking about the views the verdict judged, so a defect in the guard's own view filter would pass it. `readSource` now returns the code, the markup and the views together, and both checks read those.
3. The Architecture paragraph said the other four sites change in place; there are eight.
4. "How a review pass runs" named a tool path that exists in one worktree only; it now runs `g2a-pass.sh` from the tools' home and says what that does.
5. Review Focus 5 said "except where noted" and noted nothing.
6. The ledger section counted the matrix before the new rows; it now says 52 rows (16 old, 36 new).

**Pass 5 (2026-10-03), 1 finding, fixed.** `g2a-pass.sh` went RED on the whole unit suite. Pass 4 ran its gates before making its own `readSource` change, so this pass is the first to run that change.

1. `absence-liveness` refused `no-dated-render`'s comment fixture: once `viewsOf` went through `readSource`, its empty result was derived by a `.flatMap` with no population beside it. The fixture now asserts through `searched`, over the views it read. Rows N1-N3, X5 and X6 were re-run on the amended prototype: 5 of 5 as predicted.

**Pass 6 (2026-10-03), 1 finding, fixed.** `g2a-pass.sh` clean (patches equal to the prototype, unit 3437/3437, `astro check` 0/0/0, prettier, no closing keyword), `copy-reaches-a-page` 13/13 in `content`, the whole matrix on both trees (36 of 36 new, 16 of 16 old, ABSENT only where predicted); read every line of the prose.

1. "Where it runs" listed the session tools without `g2a-pass.sh`, the one this section's own procedure runs.

**Pass 7 (2026-10-03), 6 findings, fixed.** `g2a-pass.sh` clean, `copy-reaches-a-page` 13/13; this pass read every line of the patches as well as the prose.

1. Task 10 committed the plan file without any step putting it in `docs/superpowers/plans/`. A step now copies it there before the gates run.
2. `duplicate-imports` skipped a namespace import before counting it as read, so a program holding only `import * as x` would have tripped its own cross-check (`IMPORTS` matches it). A namespace import is now read, and judged allowed. The floor was re-measured.
3. `script-entry`'s destructuring rule called `const [, , x] = process.argv` a read of the entry, which binds index 2. It now asks whether index 1 is bound, or a rest element before it gathers it, with fixtures for both.
4. `copy-reaches-a-page`'s floor comment was wrapped mid-phrase by the edit that wrote it; rewrapped.
5. `download-readers` carried two comments that ran into each other, the first ending "(#446)." and the second repeating the issue; merged into one.
6. Three floor comments broke "Stated / tight" across lines, and `pipeline-wiring` said that `ref` is undefined for a non-YAML file in a second sentence after the first had said it; both tidied.

**Pass 8 (2026-10-03), 1 finding, fixed.** Ran on pass 7's fixes: `g2a-pass.sh` clean (patches equal to the prototype, unit 3439/3439, `astro check` 0/0/0, prettier, no closing keyword); the imports floor re-measured at 1512 (eight namespace imports were never counted) and set to > 1511 in the test, the ledger, this plan and the matrix's X8 row.

1. Task 7 still expected 127 tests and Task 10 3437; pass 7's two destructuring fixtures make them 129 and 3439.

**Pass 9 (2026-10-03), no findings.** `g2a-pass.sh` clean (patches equal to the prototype, unit 3439/3439, `astro check` 0/0/0, prettier, no closing keyword), `copy-reaches-a-page` 13/13 in `content`, the whole matrix on both trees (36 of 36 new, 16 of 16 old, ABSENT only where predicted); read pass 7's changed code and every line of the prose. **Approved 2026-10-03 on a pass with no findings, per the operator's standing rule (2026-09-24).**

**Execution stopped at old Task 4, and the approval is withdrawn.** On the branch, Tasks 1-3 committed green. Then `duplicate-imports` failed its own check: 1509 imports against a floor of 1511. Its floor counts every import under `src/`, `scripts/` and `tests/`, and the later `pipeline-wiring` and `script-entry` patches add three. Every pass so far applied all the patches at once, so none had looked at a task's own commit.

**Pass 10 (2026-10-03), 2 findings, fixed.**

1. Task order: `duplicate-imports` moves to Task 8, after the two tasks that add imports, and its text says why. Tasks 4-7 are the old 5-8, and every cross-reference outside this log is renumbered. Entries above this one keep the numbers they were written with.
2. The review procedure: `g2a-pass.sh` now also replays Tasks 1-8 one patch at a time on a scratch commit chain (`g2a_execute.py`, the same script that executes them on the branch). Each task's own check runs before its commit, so a task that is red at its own commit fails the pass.

**Pass 11 (2026-10-03), 1 finding, fixed.** `g2a-pass.sh` clean, including the new replay (Tasks 1-8 each green at their own commit); matrix 36 of 36 new, 16 of 16 old.

1. The content run reported 12 tests where the new spec holds 13. The replay ends with `git reset --hard` to `develop`, so the content spec that ran next was `develop`'s. The pass now re-applies the plan after the replay, checks the tree equals the prototype again, and only then runs anything else. The unit suite, typecheck and prettier ran before the replay and are unaffected.

**Pass 12 (2026-10-03), no findings.** `g2a-pass.sh` clean: patches equal to the prototype, unit 3439/3439, `astro check` 0/0/0, prettier, no closing keyword, Tasks 1-8 each green at their own commit (81, 7, 9, 27, 106, 129, 2 and 12 tests, as each task states), and the applied tree restored. `copy-reaches-a-page` 13/13 on that tree. The whole matrix: 36 of 36 new, 16 of 16 old, ABSENT only where predicted. Read the log entries since pass 9 and the moved Task 8. **Approved 2026-10-03.**
