# #446 Group 3: plain counts — plan

**Goal.** Nine `searched(findings, { of })` calls pass `of` a number, which
`searched` takes on trust: it checks only that the number is above zero. Each
is read for whether the count is of the unit the guard judges, and whether an
array could be passed instead, so `searched` content-checks it. Where a site
also lacks controls (b)-(d) of the guard rule (a tight floor, an independent
cross-check, fail-closed reading), they are added here.

**Base.** `develop` at `bbac359` (PR #466 merged). Branch
`446-guard-audit-3`, worktree `../shyden.co.uk-446d`.

**Method.** Prototyped first, as Group 2b was, then written down here from
the prototype's own commits: each task's code is the exact diff of its commit,
so the plan cannot drift from what runs. A review pass applies the plan's
diffs to a fresh `develop` tree and runs everything: the branch tree must
equal the applied tree byte for byte, then `astro check`, `prettier --check`,
the whole unit suite, the touched e2e tests on Chromium, and the mutation
matrix on both trees.

## The nine sites

Tasks 1-4 make these changes; Tasks 5 onward are fixes from the review
passes, each naming the findings it answers.

| Site | `of` before | Unit judged | Reading | Change |
| --- | --- | --- | --- | --- |
| `unit/absence-liveness.test.ts` verdict | `result.absences` (a count) | absence assertions | Count of the judged unit, but its floor sat at 398 under a real **421**: Groups 2a and 2b grew the suite the same day, and growth never fails a floor. No cross-check. An absence on any root but `expect(` was skipped, not refused: `expect.soft(x).toEqual([])` was invisible. | `of: result.sites` (the list); floor 420; `expect.soft` read; any other root refused by name, a polled value excepted; raw-text cross-check over 113 files that reads every spelling the reader reads. |
| `unit/pipeline-wiring.test.ts` step summary | `summaryWriters.length` | each write to the summary | **Wrong level**: it judged steps, so a step that tees one line and appends the next with `>>` passed. No floor beyond 0, no cross-check. | Judged per line (2 measured), floor 1, cross-check against the `visual` job's raw YAML. |
| `e2e/classroom-groups-roster.spec.ts` touch targets | `await controls.count()` | rendered controls | **Wrong unit**: `count()` counts every match, hidden ones too, while the measurement filters to rendered ones. A roster whose controls all stopped rendering measured nothing and passed. | `of: measured` (the rendered list). |
| `e2e/rendered-text.spec.ts` lost space | `text.length` | the page's text | Characters include whitespace, so a page rendered as blank space counted as searched. | `of: text.split(/\s+/)` (its words). |
| `e2e/rendered-text.spec.ts` placeholder | `text.length` | the page's text | As above. | As above. |
| `e2e/palette-controls.spec.ts` | `readings.length` | measured controls | Count of the very array, so the judged unit. | `of: readings`: form only, nothing a mutation can separate. |
| `e2e/theme.spec.ts` | `compared.length` | rendered elements | Count of the very array. | `of: compared`: form only. |
| `unit/anchored-presence.test.ts` | `result.scanned` | presence assertions over source text | Count of the judged unit; floor 75 under a measured 76, tight. Every member would be a location string, so an array adds no content check. Its population is defined by dataflow, which no raw-text reading reproduces, so it has no cross-check: recorded in the ledger. | None. |
| `unit/evidence-page.test.ts` deletions | `deletions.length` | `rmSync(reportDir…)` calls | The verdict is `toHaveLength(1)` on the population itself, which is exact and stronger than any floor; the conditional regex beside it is the cross-check. | None: sound. |

## Task 1: absence-liveness: the site list, a tight floor, `expect.soft`, fail-closed roots, a raw-text cross-check

TDD: the planted-spellings test gains `expect.soft(l)` and `expect.soft(m.length)`, and two new tests (refusal, cross-check) were run RED against a throwing `unclassified` stub and a never-matching `PLAIN_ABSENCE` first: 3 failed on their own assertions, 2 passed. The cross-check floor is the measured 113 − 1; the site floor the measured 421 − 1.

~~~~diff
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index e85b344..d453821 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -1,6 +1,8 @@
 import { describe, it, expect } from 'vitest';
 import ts from 'typescript';
+import { readFileSync } from 'node:fs';
 import { filesUnder, searched } from '../source-files';
+import { withoutTsComments } from './source-text';
 import { bindFiles, callGraph, derivationOf, where } from './ast';
 
 /**
@@ -71,12 +73,14 @@ const isZero = (arg: ts.Expression | undefined): boolean =>
   arg !== undefined && ts.isNumericLiteral(arg) && arg.text === '0';
 
 /**
- * Every spelling of "this is empty" -- `.toEqual([])`, `.toStrictEqual([])`,
- * `.toHaveLength(0)`, and a `.length` or `.size` held equal to 0 -- and never
- * a `.not` inverse. For the last two the subject is what the count is OF:
- * `expect(found.length).toBe(0)` asserts `found` empty (#390 F159).
+ * The call an absence matcher hangs off -- `expect(x)` in
+ * `expect(x).toEqual([])` -- for every spelling of "this is empty":
+ * `.toEqual([])`, `.toStrictEqual([])`, `.toHaveLength(0)`, and anything held
+ * equal to 0. Null for any other matcher, and for a `.not` inverse.
  */
-function absenceSubject(node: ts.CallExpression): ts.Expression | null {
+function absenceRoot(
+  node: ts.CallExpression,
+): { root: ts.Expression; zeroCount: boolean } | null {
   if (!ts.isPropertyAccessExpression(node.expression)) return null;
   const matcher = node.expression.name.text;
   const arg = node.arguments[0];
@@ -96,12 +100,33 @@ function absenceSubject(node: ts.CallExpression): ts.Expression | null {
     if (target.name.text === 'not') return null;
     target = target.expression;
   }
-  if (!ts.isCallExpression(target) || !ts.isIdentifier(target.expression))
-    return null;
-  if (target.expression.text !== 'expect') return null;
-  const subject = target.arguments[0];
+  return { root: target as ts.Expression, zeroCount };
+}
+
+/** `expect(x)` or `expect.soft(x)`: both assert, so both are read. */
+function isExpectCall(root: ts.Expression): root is ts.CallExpression {
+  if (!ts.isCallExpression(root)) return false;
+  const callee = root.expression;
+  if (ts.isIdentifier(callee)) return callee.text === 'expect';
+  return (
+    ts.isPropertyAccessExpression(callee) &&
+    ts.isIdentifier(callee.expression) &&
+    callee.expression.text === 'expect' &&
+    callee.name.text === 'soft'
+  );
+}
+
+/**
+ * What an absence assertion asserts empty. For a count held to 0 the subject
+ * is what the count is OF: `expect(found.length).toBe(0)` asserts `found`
+ * empty (#390 F159).
+ */
+function absenceSubject(node: ts.CallExpression): ts.Expression | null {
+  const shape = absenceRoot(node);
+  if (!shape || !isExpectCall(shape.root)) return null;
+  const subject = shape.root.arguments[0];
   if (subject === undefined) return null;
-  if (!zeroCount) return subject;
+  if (!shape.zeroCount) return subject;
   // A bare number held to 0 is a value, not a population.
   return ts.isPropertyAccessExpression(subject) &&
     (subject.name.text === 'length' || subject.name.text === 'size')
@@ -145,16 +170,78 @@ function unproved(subject: ts.Expression, file: string): string | null {
   return null;
 }
 
+/**
+ * An absence matcher on a root the reader cannot classify -- `expect.poll`,
+ * an aliased `expect`, a helper returning a matcher -- named, so the scan
+ * refuses it rather than skipping it: skipped, it is an absence nobody judges
+ * (#446, control d).
+ */
+function unclassified(node: ts.CallExpression): string | null {
+  const shape = absenceRoot(node);
+  if (!shape || isExpectCall(shape.root)) return null;
+  if (shape.zeroCount && !countsAPopulation(shape.root)) return null;
+  return shape.root.getText().replace(/\s+/g, ' ').slice(0, 70);
+}
+
+/**
+ * Whether a count held to 0 on an unread root is a population's size. A bare
+ * value held to 0 is not an absence, as `absenceSubject` says of
+ * `expect(k).toBe(0)`. A polled function is judged by what it returns
+ * (`evidence-page.spec.ts` polls an in-flight counter to 0), and one whose
+ * return cannot be read from here counts as a population, so it is refused.
+ */
+function countsAPopulation(root: ts.Expression): boolean {
+  if (!ts.isCallExpression(root)) return true;
+  let counted: ts.Expression | undefined = root.arguments[0];
+  const callee = root.expression;
+  const polled =
+    ts.isPropertyAccessExpression(callee) &&
+    ts.isIdentifier(callee.expression) &&
+    callee.expression.text === 'expect' &&
+    callee.name.text === 'poll';
+  if (polled) {
+    if (
+      counted === undefined ||
+      !ts.isArrowFunction(counted) ||
+      ts.isBlock(counted.body)
+    )
+      return true;
+    counted = counted.body;
+  }
+  while (counted !== undefined && ts.isParenthesizedExpression(counted))
+    counted = counted.expression;
+  return (
+    counted === undefined ||
+    (ts.isPropertyAccessExpression(counted) &&
+      (counted.name.text === 'length' || counted.name.text === 'size'))
+  );
+}
+
+/**
+ * An absence matcher as text, for the cross-check: no AST, so a reader blind
+ * to one file or one spelling disagrees with it. A count held to 0 is left
+ * out, because `toBe(0)` on a bare value is plainly not an absence.
+ */
+const PLAIN_ABSENCE =
+  /(?<!\.not)\.(?:toEqual|toStrictEqual)\(\[\]\)|(?<!\.not)\.toHaveLength\(0\)/;
+
 function scan() {
   const findings: string[] = [];
-  let absences = 0;
+  const sites: string[] = [];
+  const perFile = new Map<string, number>();
   let proved = 0;
   for (const [file, sf] of bound.files) {
     const check = (node: ts.Node) => {
       if (ts.isCallExpression(node)) {
+        const root = unclassified(node);
+        if (root)
+          findings.push(
+            `${where(sf, node)} — an absence on a root the reader cannot classify: ${root}`,
+          );
         const subject = absenceSubject(node);
         if (subject) {
-          absences += 1;
+          sites.push(where(sf, node));
+          perFile.set(file, (perFile.get(file) ?? 0) + 1);
           const why = unproved(subject, file);
           if (why === null) proved += 1;
           else
@@ -168,7 +255,7 @@ function scan() {
     };
     check(sf);
   }
-  return { absences, proved, findings };
+  return { sites, perFile, proved, findings };
 }
 
 const result = scan();
@@ -190,8 +277,10 @@ describe('absence assertions prove the population they searched', () => {
     // `absenceSubject` dead, this test stayed green. #390 F161 found it
     // there again, at 153 over a real 391, with the same branch dead and
     // the same test green; F159's spellings brought the figure to 394,
-    // and #446 measured 399 on 2026-10-03.
-    expect(result.absences).toBeGreaterThan(398);
+    // and #446 measured 399 on 2026-10-03. Groups 2a and 2b added 22 the
+    // same day and left it 22 slack, which is how a floor drifts: growth
+    // never fails it. Re-measured 421 at Group 3 (#446).
+    expect(result.sites.length).toBeGreaterThan(420);
     expect(result.proved).toBeGreaterThan(0);
   });
 
@@ -209,6 +298,8 @@ describe('absence assertions prove the population they searched', () => {
         'expect(e.size).toBe(0);',
         'expect(f.length).toEqual(0);',
         'expect(g.length).toStrictEqual(0);',
+        'expect.soft(l).toEqual([]);',
+        'expect.soft(m.length).toBe(0);',
         'expect(h).not.toEqual([]);',
         'expect(i.length).not.toBe(0);',
         'expect(j.length).toBe(1);',
@@ -226,13 +317,69 @@ describe('absence assertions prove the population they searched', () => {
       ts.forEachChild(node, visit);
     };
     visit(sf);
-    expect(subjects).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
+    expect(subjects).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'l', 'm']);
+  });
+
+  it('refuses an absence on a root it cannot classify, rather than skipping it', () => {
+    // `expect.soft(x)` asserts like `expect(x)` and is read above. Any other
+    // root -- `expect.poll(fn)`, an alias, a helper returning a matcher -- was
+    // silently not an absence at all, so nothing judged it (#446, control d).
+    const sf = ts.createSourceFile(
+      'fixture.test.ts',
+      [
+        'expect.poll(n).toEqual([]);',
+        'assertThat(o).toHaveLength(0);',
+        'expect.poll(() => p.length).toBe(0);',
+        'expect.poll(t).toBe(0);',
+        'expect.poll(async () => { return u.size; }).toBe(0);',
+        'assertThat(v.length).toBe(0);',
+        // Not refused: a value held to 0, a polled value, and the read roots.
+        'assertThat(w).toBe(0);',
+        'expect\n  .poll(async () => (await counters(x)).inflight)\n  .toBe(0);',
+        'expect.soft(q).toEqual([]);',
+        'expect(r).toEqual([]);',
+        'expect.poll(s).not.toEqual([]);',
+      ].join('\n'),
+      ts.ScriptTarget.Latest,
+      true,
+    );
+    const refused: string[] = [];
+    const visit = (node: ts.Node): void => {
+      if (ts.isCallExpression(node)) {
+        const root = unclassified(node);
+        if (root) refused.push(root);
+      }
+      ts.forEachChild(node, visit);
+    };
+    visit(sf);
+    expect(refused).toEqual([
+      'expect.poll(n)',
+      'assertThat(o)',
+      'expect.poll(() => p.length)',
+      'expect.poll(t)',
+      'expect.poll(async () => { return u.size; })',
+      'assertThat(v.length)',
+    ]);
+  });
+
+  it('reads an absence in every file whose text plainly writes one', () => {
+    // Independent of the AST walk (#446, control c). The floor above catches
+    // a reader that goes blind everywhere; this catches one blind to a single
+    // file, or to the one spelling that file uses. Matched on the stripped
+    // text, so a comment naming the matcher cannot satisfy it.
+    const plain = tsFiles.filter((file) =>
+      PLAIN_ABSENCE.test(withoutTsComments(readFileSync(file, 'utf8'))),
+    );
+    // Measured 113 files on 2026-10-03 (#446). Stated tight.
+    expect(plain.length).toBeGreaterThan(112);
+    const unread = plain.filter((file) => !result.perFile.has(file));
+    expect(searched(unread, { of: plain, what: 'files' })).toEqual([]);
   });
 
   it('finds none whose population could be empty without saying so', () => {
     expect(
       searched(result.findings, {
-        of: result.absences,
+        of: result.sites,
         what: 'absence assertions',
       }),
     ).toEqual([]);
~~~~

## Task 2: pipeline-wiring: the step-summary guard judges each write, with a floor and a raw-text cross-check

The population moves from steps to lines; 2 measured, so the floor is 1. The cross-check reads the `visual` job straight out of `ci.yml`, YAML comments aside.

~~~~diff
diff --git a/tests/unit/pipeline-wiring.test.ts b/tests/unit/pipeline-wiring.test.ts
index 6aae586..46a27f0 100644
--- a/tests/unit/pipeline-wiring.test.ts
+++ b/tests/unit/pipeline-wiring.test.ts
@@ -2164,16 +2164,36 @@ describe('the drift measurement reports, and never gates (#224)', () => {
     // A step summary is rendered in the UI and is not exposed by the Actions
     // API, so `gh run view --log` returns the script and nothing else. The
     // drift table was written only there once, and could not be read (#224).
-    const summaryWriters = visualSteps().filter(
-      (s) => typeof s.run === 'string' && s.run.includes('GITHUB_STEP_SUMMARY'),
-    );
-    const unreadable = summaryWriters.filter(
-      (s) => !/tee\s+-a\s+"\$GITHUB_STEP_SUMMARY"/.test(s.run as string),
+    //
+    // Judged per LINE, not per step: a step that tees one line and appends
+    // the next with `>>` holds a `tee` and still writes where nothing reads
+    // it back (#446). Shell comments are not writes.
+    const writesTheSummary = (line: string) =>
+      line.includes('GITHUB_STEP_SUMMARY') && !line.trimStart().startsWith('#');
+    const writes = visualSteps()
+      .flatMap((s) => (typeof s.run === 'string' ? s.run.split('\n') : []))
+      .filter(writesTheSummary);
+    // Measured 2 on 2026-10-03 (#446). Stated tight.
+    expect(writes.length).toBeGreaterThan(1);
+    // Independent of the YAML parse (#446, control c): the visual job's own
+    // text, YAML comments aside, names the summary on exactly as many lines.
+    const ci = workflow('ci.yml');
+    const start = ci.search(/^ {2}visual:$/m);
+    expect(start, 'ci.yml declares no visual job').toBeGreaterThan(-1);
+    const rest = ci.slice(start + 1);
+    const end = rest.search(/^ {2}\S/m);
+    const job = end === -1 ? rest : rest.slice(0, end);
+    expect(job.split('\n').filter(writesTheSummary)).toHaveLength(
+      writes.length,
+    );
+
+    const unreadable = writes.filter(
+      (line) => !/tee\s+-a\s+"\$GITHUB_STEP_SUMMARY"/.test(line),
     );
     expect(
       searched(unreadable, {
-        of: summaryWriters.length,
-        what: "steps writing a job summary in ci.yml's visual job",
+        of: writes,
+        what: "lines writing a job summary in ci.yml's visual job",
       }),
       'a summary written with >> cannot be read back from the job log',
     ).toEqual([]);
~~~~

## Task 3: e2e: four guards hand `searched` what they measured

Run on Chromium: 101 tests across the four files (5 + 32 + 32 + 32), all passed.

~~~~diff
diff --git a/tests/e2e/classroom-groups-roster.spec.ts b/tests/e2e/classroom-groups-roster.spec.ts
index 1cd5ca0..e2cad01 100644
--- a/tests/e2e/classroom-groups-roster.spec.ts
+++ b/tests/e2e/classroom-groups-roster.spec.ts
@@ -1959,11 +1959,12 @@ test.describe('the roster dropdowns are still reachable by thumb (#249)', () =>
         const controls = page.locator(
           '#cg-roster tbody tr select, #cg-roster tbody tr input',
         );
-        // Liveness first: three rows carry controls, so an empty set below
-        // would be a broken selector rather than a page that passes.
-        expect(await controls.count()).toBeGreaterThan(0);
-
-        const small = await controls.evaluateAll((els) =>
+        // Liveness is the controls MEASURED, which is the rendered ones. A
+        // `controls.count()` beside it counted every match, hidden ones too,
+        // so a roster whose controls all stopped rendering measured nothing
+        // and passed (#446). Three rows carry controls, so an empty set here
+        // is a broken selector or a page that hides them.
+        const measured = await controls.evaluateAll((els) =>
           els
             // `getClientRects()`, never the element's own computed display: a
             // `display: none` ANCESTOR leaves a descendant's computed display
@@ -1988,14 +1989,14 @@ test.describe('the roster dropdowns are still reachable by thumb (#249)', () =>
                 height:
                   Math.round(target.getBoundingClientRect().height * 10) / 10,
               };
-            })
-            .filter((c) => c.height < 44),
+            }),
         );
+        const small = measured.filter((c) => c.height < 44);
 
         expect(
           searched(small, {
-            of: await controls.count(),
-            what: 'roster controls',
+            of: measured,
+            what: 'rendered roster controls',
           }),
           small.map((c) => `${c.what} is ${c.height}px`).join('\n'),
         ).toEqual([]);
diff --git a/tests/e2e/palette-controls.spec.ts b/tests/e2e/palette-controls.spec.ts
index 9cf40c5..048c42b 100644
--- a/tests/e2e/palette-controls.spec.ts
+++ b/tests/e2e/palette-controls.spec.ts
@@ -152,7 +152,7 @@ for (const path of PAGES) {
 
       expect(
         searched(offPalette, {
-          of: readings.length,
+          of: readings,
           what: `controls measured on ${path}`,
         }),
         `${theme}: off-palette control colours on ${path}; the palette resolved to ${allowed.length} values`,
diff --git a/tests/e2e/rendered-text.spec.ts b/tests/e2e/rendered-text.spec.ts
index afa3a29..1dc7a12 100644
--- a/tests/e2e/rendered-text.spec.ts
+++ b/tests/e2e/rendered-text.spec.ts
@@ -375,7 +375,10 @@ test.describe('rendered text — no sentence may lose a space to the formatter',
         return `${why} -> …${context}…`;
       });
       expect(
-        searched(findings, { of: text.length, what: `characters of ${path}` }),
+        // Its words, not its characters: whitespace is characters, so a page
+        // rendered blank would have counted as searched (#446). `searched`
+        // drops the empty strings a split leaves at either end.
+        searched(findings, { of: text.split(/\s+/), what: `words of ${path}` }),
         findings.join('\n'),
       ).toEqual([]);
     });
@@ -438,7 +441,10 @@ test.describe('rendered text — no sentence may lose a space to the formatter',
         (m) => m[0],
       );
       expect(
-        searched(findings, { of: text.length, what: `characters of ${path}` }),
+        // Its words, not its characters: whitespace is characters, so a page
+        // rendered blank would have counted as searched (#446). `searched`
+        // drops the empty strings a split leaves at either end.
+        searched(findings, { of: text.split(/\s+/), what: `words of ${path}` }),
         findings.join('\n'),
       ).toEqual([]);
     });
diff --git a/tests/e2e/theme.spec.ts b/tests/e2e/theme.spec.ts
index cf58e43..ea3cd44 100644
--- a/tests/e2e/theme.spec.ts
+++ b/tests/e2e/theme.spec.ts
@@ -563,7 +563,7 @@ test.describe('nothing moves when the theme changes (#386)', () => {
               );
             expect(
               searched(moved, {
-                of: compared.length,
+                of: compared,
                 what: 'rendered elements',
               }),
             ).toEqual([]);
~~~~

## Task 4: The ledger records Group 3

Group 3 section, nine Appendix A rows resolved, matrix totals.

~~~~diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index b302549..8178b8b 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -187,12 +187,35 @@ each turned a guard RED. Eight of those prove a cross-check alone, with its
 floor switched off. The two workflow floors count #459's probe workflows, and
 say so. Appendices A and B below remain the census at `6d07d37`.
 
-## Group 3: plain counts, next
+## Group 3: plain counts, done
 
-9 `searched` calls pass a number (`text.length`, `result.scanned`,
-`readings.length` …), which `searched` takes on trust. Each is read for
+9 `searched` calls passed a number (`text.length`, `result.scanned`,
+`readings.length` …), which `searched` takes on trust. Each was read for
 whether the count is of the judged unit, and whether an array could be
-passed instead so the control content-checks it.
+passed instead so the control content-checks it (#446 Group 3, plan
+`docs/superpowers/plans/2026-10-03-guard-audit-group-3.md`).
+
+| Site | Reading | Now |
+| --- | --- | --- |
+| `absence-liveness` verdict | Its floor sat at 398 under a real 421: Groups 2a and 2b grew the suite the same day, and growth never fails a floor. No cross-check. `expect.soft(x).toEqual([])` was not read, and any root but `expect(` was skipped rather than refused. | The list of sites; floor 420; `expect.soft` read; any other root refused by name, except a polled value; a raw-text cross-check that each of 113 files writing an absence was read. |
+| `pipeline-wiring` step summary | Judged per step, so a step that tees one line and appends the next with `>>` passed. No floor. | Judged per write (2 measured), floor 1, cross-checked against the `visual` job's raw YAML. |
+| `classroom-groups-roster` touch targets | `controls.count()` counted hidden controls too, while the measurement judged rendered ones: a roster whose controls all stopped rendering passed. | The measured list. |
+| `rendered-text`, both page scans | Characters include whitespace, so a page rendered blank counted as searched. | The page's words. |
+| `palette-controls`, `theme` | The count of the very array. | The array: form only. |
+| `anchored-presence` | Count of the judged unit, floor tight (76). | Unchanged. Its population is defined by dataflow, which no raw-text reading reproduces, so it still has no cross-check. |
+| `evidence-page` deletions | `toHaveLength(1)` on the population itself, exact. | Unchanged: sound. |
+
+Fail-closed reading found one site at once: `evidence-page.spec.ts:234`
+spells `expect` and `.poll(` on two lines, which a one-line search for
+`expect.poll(` cannot see. It polls an in-flight counter to 0, a value, so it
+is exempt by the same rule that exempts `expect(k).toBe(0)`.
+
+The mutation matrix ran 16 rows, all as predicted: 6 on
+`develop`, where each stayed GREEN, and 10 on the new tree, where each
+turned a guard RED. Two prove a cross-check alone, with its floor switched
+off. Removing a `tee` from `ci.yml` was not a gap: on `develop` a sibling
+test ('prints the container architecture into the job summary') already
+catches it, so the matrix blinds the guard's reader instead.
 
 ## Group 4: loop-built findings, next
 
@@ -235,7 +258,7 @@ on macOS is not the one CI reads.
 | `e2e/classroom-groups-privacy.spec.ts:288` | submitting cannot put a class list in the URL | `keys` | `keys.filter((key) => !NON_PERSONAL_NAME…` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/classroom-groups-projector.spec.ts:708` | (module level) | `seen.cards` | `seen.unreachable` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/classroom-groups-roster.spec.ts:1904` | no dropdown ever truncates its own column name -- ${path} at ${width}… | `boxes.map((box) => box.label)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
-| `e2e/classroom-groups-roster.spec.ts:1996` | every roster control meets the 44px touch target with a placeholder s… | `await controls.count()` | `small` | count | to read |
+| `e2e/classroom-groups-roster.spec.ts:1996` | every roster control meets the 44px touch target with a placeholder s… | `await controls.count()` | `small` | count | fixed (Group 3): the measured, rendered list |
 | `e2e/copy-reaches-a-page.spec.ts:291` | ${locale}: no defined copy renders nowhere | `defined` | `missing` | loop-built | to read |
 | `e2e/copy-reaches-a-page.spec.ts:295` | ${locale}: no defined copy renders nowhere | `defined` | `wronglyAllowed` | loop-built | to read |
 | `e2e/copy-reaches-a-page.spec.ts:305` | ${locale}: no defined copy renders nowhere | `[...seen]` | `phantom` | findings drawn from it | sound at one hop: findings are built from the population |
@@ -252,26 +275,26 @@ on macOS is not the one CI reads.
 | `e2e/header-room.spec.ts:225` | (module level) | `rows` | `findings` | loop-built | to read |
 | `e2e/locale-beta.spec.ts:174` | ${locale}: the badge's spoken label keeps the page's language, even i… | `voices` | `misvoiced` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/not-found-report.spec.ts:175` | ${locale}: every control is at least 44px and every text meets AA | `read` | `failing` | loop-built | to read |
-| `e2e/palette-controls.spec.ts:154` | ${path}, ${theme}: every control it paints uses a palette colour | `readings.length` | `offPalette` | count | to read |
+| `e2e/palette-controls.spec.ts:154` | ${path}, ${theme}: every control it paints uses a palette colour | `readings.length` | `offPalette` | count | fixed (Group 3): the array, form only |
 | `e2e/print-legibility.spec.ts:156` | ${path}, ${saved ? `${saved} saved over a ${device} device` : `a ${de… | `inks` | `illegible` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/print-legibility.spec.ts:226` | ${theme}: a disabled control never depends on its fill reaching paper | `painted.rendered` | `painted.found` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/recorders.ts:159` | (module level) | `seen` | `[...consoleErrors, ...uncaught]` | loop-built | to read |
 | `e2e/recorders.ts:172` | (module level) | `seen` | `uncaught` | loop-built | to read |
-| `e2e/rendered-text.spec.ts:378` | ${path}: no sentence loses a space | `text.length` | `findings` | count | to read |
+| `e2e/rendered-text.spec.ts:378` | ${path}: no sentence loses a space | `text.length` | `findings` | count | fixed (Group 3): the page's words |
 | `e2e/rendered-text.spec.ts:420` | ${path}: no two words are rendered touching | `width` | `findings` | loop-built | to read |
-| `e2e/rendered-text.spec.ts:441` | ${path}: no unfilled [[placeholder]] reaches the page | `text.length` | `findings` | count | to read |
+| `e2e/rendered-text.spec.ts:441` | ${path}: no unfilled [[placeholder]] reaches the page | `text.length` | `findings` | count | fixed (Group 3): the page's words |
 | `e2e/report-completeness.spec.ts:112` | ${pagePath(pageId, locale)}: every catalogue string on the page is re… | `found` | `missing` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/report-form.spec.ts:82` | ${locale}: every control is at least 44px, every text meets AA, every… | `read` | `failing` | loop-built | to read |
 | `e2e/report-presence.spec.ts:44` | a built page with a footer carries the form exactly when its locale i… | `footed.map(({ file }) => file)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/text-over-ribbon.spec.ts:231` | ${theme} at ${width}px: every text run over the ribbon clears AA -- $… | `scan.seen` | `failing` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/thai-typography.spec.ts:135` | no Thai glyph draws beyond its line box -- ${route} at ${width}px, ${… | `examined` | `offenders` | findings drawn from it | sound at one hop: findings are built from the population |
 | `e2e/theme-script.spec.ts:122` | ${path}: runs it before the first paint: inline, classic, in <head>, … | `sheets` | `theme.sheetsBefore` | file-level | sound: judges the unit it counts |
-| `e2e/theme.spec.ts:565` | ${path} at ${width}px: no element moves between dark and light | `compared.length` | `moved` | count | to read |
+| `e2e/theme.spec.ts:565` | ${path} at ${width}px: no element moves between dark and light | `compared.length` | `moved` | count | fixed (Group 3): the array, form only |
 | `e2e/visual.spec.ts:134` | (module level) | `held` | `stillSticky` | loop-built | to read |
 | `e2e/zoom-on-focus.spec.ts:56` | ${path}: every typed field computes to at least ${IOS_ZOOM_FLOOR_PX}px | `controls` | `controls.filter((c) => !(c.fontSize >= …` | findings drawn from it | sound at one hop: findings are built from the population |
 | `shytalk-links.ts:45` | (module level) | `hosts` | `wrongHost` | findings drawn from it | sound at one hop: findings are built from the population |
-| `unit/absence-liveness.test.ts:234` | finds none whose population could be empty without saying so | `result.absences` | `result.findings` | count | to read |
-| `unit/anchored-presence.test.ts:307` | finds none reading raw source with an unanchored matcher | `result.scanned` | `result.findings` | count | to read |
+| `unit/absence-liveness.test.ts:234` | finds none whose population could be empty without saying so | `result.absences` | `result.findings` | count | fixed (Group 3): the site list, floor 420, cross-check, fail-closed |
+| `unit/anchored-presence.test.ts:307` | finds none reading raw source with an unanchored matcher | `result.scanned` | `result.findings` | count | sound (Group 3): judged unit, floor tight; no cross-check |
 | `unit/astro-css-strip.test.ts:121` | scans no comment that the per-style read removes | `comments` | `survivors` | loop-built | to read |
 | `unit/back-translate.test.ts:934` | reads every locale back into English and writes the review | `engine.sent` | `engine.sent.filter((text) => /[{}]/.tes…` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/back-translate.test.ts:1076` | fails loudly without an engine, before writing or sending anything | `engine.log` | `translateRequests(engine)` | findings drawn from it | sound at one hop: findings are built from the population |
@@ -328,7 +351,7 @@ on macOS is not the one CI reads.
 | `unit/duplication.test.ts:126` | finds no cross-file duplicate that has not been given a verdict | `DECLARATIONS` | `findings` | loop-built | to read |
 | `unit/duplication.test.ts:139` | carries no verdict for a pair that no longer exists | `recorded` | `recorded.filter((key) => !live.has(key))` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/event-collectors.test.ts:499` | every .all() loop proves its locator is not empty first | `SCANNED` | `unproved` | file-level | done in Group 2a: judged unit, floor, cross-check |
-| `unit/evidence-page.test.ts:1064` | never deletes a directory the operator was asked to keep | `deletions.length` | `deletions` | count | to read |
+| `unit/evidence-page.test.ts:1064` | never deletes a directory the operator was asked to keep | `deletions.length` | `deletions` | count | sound (Group 3): exact toHaveLength(1) |
 | `unit/evidence-page.test.ts:1247` | has no consumer spelling an evidence filename for itself | `consumers` | `respellings` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/evidence-page.test.ts:1586` | emits only media references the artifact serves | `srcs` | `unservable` | file-level | sound: judges the unit it counts |
 | `unit/evidence-page.test.ts:1663` | references every recording it was given | `keys` | `unreferenced` | findings drawn from it | sound at one hop: findings are built from the population |
@@ -393,7 +416,7 @@ on macOS is not the one CI reads.
 | `unit/pipeline-wiring.test.ts:1783` | pins an image rather than a label that migrates under it | `all.map(({ label }) => label)` | `floating` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/pipeline-wiring.test.ts:1820` | prints the container architecture into the job summary | `visualRuns()` | `recording` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/pipeline-wiring.test.ts:1942` | lets a fallback test the status of the command producing its text | `lines.map(({ line }) => line)` | `findings` | findings drawn from it | sound at one hop: findings are built from the population |
-| `unit/pipeline-wiring.test.ts:1961` | writes its numbers where they can be read back, not only to the summa… | `summaryWriters.length` | `unreadable` | count | to read |
+| `unit/pipeline-wiring.test.ts:1961` | writes its numbers where they can be read back, not only to the summa… | `summaryWriters.length` | `unreadable` | count | fixed (Group 3): judged per write, floor, cross-check |
 | `unit/pipeline-wiring.test.ts:2029` | uploads the gate diff and the measurement diff together (#311) | `paths` | `unreadable` | file-level | sound: judges the unit it counts |
 | `unit/pipeline-wiring.test.ts:2149` | clears every per-group report before a run, now that nothing wipes th… | `reports` | `uncleared` | findings drawn from it | sound at one hop: findings are built from the population |
 | `unit/pipeline-wiring.test.ts:2161` | nests none inside another, which a parent wipe would take with it | `dirs` | `nested` | findings drawn from it | sound at one hop: findings are built from the population |
~~~~

## Task 5: From review pass 1: the cross-check reads a count held to 0, and its spellings are planted

Pass 1 findings 1 and 2. The new test lists every spelling by hand, never from either reader. The population stays 113 files (measured).

~~~~diff
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index d453821..2b2f0d8 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -219,11 +219,18 @@ function countsAPopulation(root: ts.Expression): boolean {
 
 /**
  * An absence matcher as text, for the cross-check: no AST, so a reader blind
- * to one file or one spelling disagrees with it. A count held to 0 is left
- * out, because `toBe(0)` on a bare value is plainly not an absence.
+ * to one file or one spelling disagrees with it. A count held to 0 is read
+ * only on a `.length` or `.size`, as `absenceSubject` reads it: on a bare
+ * value it is plainly not an absence. A `.not` anywhere before the matcher
+ * inverts it.
  */
-const PLAIN_ABSENCE =
-  /(?<!\.not)\.(?:toEqual|toStrictEqual)\(\[\]\)|(?<!\.not)\.toHaveLength\(0\)/;
+const PLAIN_ABSENCE = new RegExp(
+  [
+    String.raw`(?<!\.not)\.(?:toEqual|toStrictEqual)\(\[\]\)`,
+    String.raw`(?<!\.not)\.toHaveLength\(0\)`,
+    String.raw`\.(?:length|size)\)\.(?:toBe|toEqual|toStrictEqual)\(0\)`,
+  ].join('|'),
+);
 
 function scan() {
   const findings: string[] = [];
@@ -362,6 +369,37 @@ describe('absence assertions prove the population they searched', () => {
     ]);
   });
 
+  it('reads as text every spelling the reader reads, and none it refuses', () => {
+    // The cross-check below is only independent if it knows the same forms.
+    // Written out, never generated from either reader's list: a plant built
+    // from the list a reader uses cannot see that list drop a form (#446).
+    const read = [
+      'expect(a).toEqual([]);',
+      'expect(b).toStrictEqual([]);',
+      'expect(c).toHaveLength(0);',
+      'expect(d.length).toBe(0);',
+      'expect(e.size).toBe(0);',
+      'expect(f.length).toEqual(0);',
+      'expect(g.length).toStrictEqual(0);',
+      'expect.soft(l).toEqual([]);',
+      'expect.soft(m.length).toBe(0);',
+    ];
+    const inverse = [
+      'expect(h).not.toEqual([]);',
+      'expect(i.length).not.toBe(0);',
+      'expect(j.length).toBe(1);',
+      'expect(k).toBe(0);',
+    ];
+    const missed = read.filter((line) => !PLAIN_ABSENCE.test(line));
+    expect(searched(missed, { of: read, what: 'planted absences' })).toEqual(
+      [],
+    );
+    const misread = inverse.filter((line) => PLAIN_ABSENCE.test(line));
+    expect(
+      searched(misread, { of: inverse, what: 'planted non-absences' }),
+    ).toEqual([]);
+  });
+
   it('reads an absence in every file whose text plainly writes one', () => {
     // Independent of the AST walk (#446, control c). The floor above catches
     // a reader that goes blind everywhere; this catches one blind to a single
~~~~

## Task 6: The ledger records review pass 1

Matrix totals 22 = 6 + 16.

~~~~diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index 8178b8b..8f83bd9 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -210,10 +210,13 @@ spells `expect` and `.poll(` on two lines, which a one-line search for
 `expect.poll(` cannot see. It polls an in-flight counter to 0, a value, so it
 is exempt by the same rule that exempts `expect(k).toBe(0)`.
 
-The mutation matrix ran 16 rows, all as predicted: 6 on
-`develop`, where each stayed GREEN, and 10 on the new tree, where each
-turned a guard RED. Two prove a cross-check alone, with its floor switched
-off. Removing a `tee` from `ci.yml` was not a gap: on `develop` a sibling
+Review pass 1 found the cross-check blind to a count held to 0
+(`expect(x.length).toBe(0)`), which the reader reads; it now reads that too,
+its spellings are planted, and each new branch has a matrix row. The matrix
+ran 22 rows, all as predicted: 6 on `develop`, where each stayed GREEN, and
+16 on the new tree, where 15 turned a guard RED and one, a shell comment
+naming the summary, stayed GREEN as the exclusion intends. Two prove a
+cross-check alone, with its floor switched off. Removing a `tee` from `ci.yml` was not a gap: on `develop` a sibling
 test ('prints the container architecture into the job summary') already
 catches it, so the matrix blinds the guard's reader instead.
 
~~~~

## Task 7: From review pass 2: no cast, an accurate title, the ledger rewrapped

Pass 2 findings 6-9; finding 5 is this document's own table.

~~~~diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index 8f83bd9..c2da5d7 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -202,7 +202,7 @@ passed instead so the control content-checks it (#446 Group 3, plan
 | `classroom-groups-roster` touch targets | `controls.count()` counted hidden controls too, while the measurement judged rendered ones: a roster whose controls all stopped rendering passed. | The measured list. |
 | `rendered-text`, both page scans | Characters include whitespace, so a page rendered blank counted as searched. | The page's words. |
 | `palette-controls`, `theme` | The count of the very array. | The array: form only. |
-| `anchored-presence` | Count of the judged unit, floor tight (76). | Unchanged. Its population is defined by dataflow, which no raw-text reading reproduces, so it still has no cross-check. |
+| `anchored-presence` | Count of the judged unit; floor 75 under a measured 76, tight. | Unchanged. Its population is defined by dataflow, which no raw-text reading reproduces, so it still has no cross-check. |
 | `evidence-page` deletions | `toHaveLength(1)` on the population itself, exact. | Unchanged: sound. |
 
 Fail-closed reading found one site at once: `evidence-page.spec.ts:234`
@@ -216,9 +216,10 @@ its spellings are planted, and each new branch has a matrix row. The matrix
 ran 22 rows, all as predicted: 6 on `develop`, where each stayed GREEN, and
 16 on the new tree, where 15 turned a guard RED and one, a shell comment
 naming the summary, stayed GREEN as the exclusion intends. Two prove a
-cross-check alone, with its floor switched off. Removing a `tee` from `ci.yml` was not a gap: on `develop` a sibling
-test ('prints the container architecture into the job summary') already
-catches it, so the matrix blinds the guard's reader instead.
+cross-check alone, with its floor switched off. Removing a `tee` from
+`ci.yml` was not a gap: on `develop` a sibling test ('prints the container
+architecture into the job summary') already catches it, so the matrix blinds
+the guard's reader instead.
 
 ## Group 4: loop-built findings, next
 
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index 2b2f0d8..7b5e903 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -95,12 +95,12 @@ function absenceRoot(
 
   // Walk back through any modifier chain (`.not`, `.resolves`). A `.not`
   // anywhere in it inverts the claim, so the assertion is not an absence one.
-  let target: ts.Node = node.expression.expression;
+  let target: ts.Expression = node.expression.expression;
   while (ts.isPropertyAccessExpression(target)) {
     if (target.name.text === 'not') return null;
     target = target.expression;
   }
-  return { root: target as ts.Expression, zeroCount };
+  return { root: target, zeroCount };
 }
 
 /** `expect(x)` or `expect.soft(x)`: both assert, so both are read. */
@@ -369,7 +369,7 @@ describe('absence assertions prove the population they searched', () => {
     ]);
   });
 
-  it('reads as text every spelling the reader reads, and none it refuses', () => {
+  it('reads as text every spelling the reader reads, and no inverse', () => {
     // The cross-check below is only independent if it knows the same forms.
     // Written out, never generated from either reader's list: a plant built
     // from the list a reader uses cannot see that list drop a form (#446).
~~~~

## Task 8: From review pass 3: the job is read by lines, and a fixture comment names all it spares

Pass 3 findings 10 and 11.

~~~~diff
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index 7b5e903..875f402 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -340,7 +340,8 @@ describe('absence assertions prove the population they searched', () => {
         'expect.poll(t).toBe(0);',
         'expect.poll(async () => { return u.size; }).toBe(0);',
         'assertThat(v.length).toBe(0);',
-        // Not refused: a value held to 0, a polled value, and the read roots.
+        // Not refused: a value held to 0, a polled value, the two roots that
+        // are read, and an inverse.
         'assertThat(w).toBe(0);',
         'expect\n  .poll(async () => (await counters(x)).inflight)\n  .toBe(0);',
         'expect.soft(q).toEqual([]);',
diff --git a/tests/unit/pipeline-wiring.test.ts b/tests/unit/pipeline-wiring.test.ts
index 46a27f0..e5b505c 100644
--- a/tests/unit/pipeline-wiring.test.ts
+++ b/tests/unit/pipeline-wiring.test.ts
@@ -2177,15 +2177,15 @@ describe('the drift measurement reports, and never gates (#224)', () => {
     expect(writes.length).toBeGreaterThan(1);
     // Independent of the YAML parse (#446, control c): the visual job's own
     // text, YAML comments aside, names the summary on exactly as many lines.
-    const ci = workflow('ci.yml');
-    const start = ci.search(/^ {2}visual:$/m);
+    // The job is every line after its key, up to the next line at a job's
+    // own two-space indent.
+    const lines = workflow('ci.yml').split('\n');
+    const start = lines.indexOf('  visual:');
     expect(start, 'ci.yml declares no visual job').toBeGreaterThan(-1);
-    const rest = ci.slice(start + 1);
-    const end = rest.search(/^ {2}\S/m);
-    const job = end === -1 ? rest : rest.slice(0, end);
-    expect(job.split('\n').filter(writesTheSummary)).toHaveLength(
-      writes.length,
-    );
+    const after = lines.slice(start + 1);
+    const end = after.findIndex((line) => /^ {2}\S/.test(line));
+    const job = end === -1 ? after : after.slice(0, end);
+    expect(job.filter(writesTheSummary)).toHaveLength(writes.length);
 
     const unreadable = writes.filter(
       (line) => !/tee\s+-a\s+"\$GITHUB_STEP_SUMMARY"/.test(line),
~~~~

## Mutation matrix

`.superpowers/sdd/446-g3/g3_mut.py`, copied from Group 2b's runner. Every
anchor must occur exactly once; a run that cannot start is NOT-RUN and a
target naming no test is ABSENT, never GREEN. Unit targets run the whole
file; e2e targets run on Chromium, filtered to one page.

| Id | Mutation | `develop` | branch |
| --- | --- | --- | --- |
| AL1 | `scan()` skips `tests/unit/report.test.ts` | liveness GREEN, cross-check ABSENT, verdict GREEN | liveness RED, cross-check RED, verdict GREEN |
| AL2 | AL1 with the site floor at 0 | — | liveness GREEN, cross-check RED |
| AL3 | `isExpectCall` blind to `soft` | — | spellings RED, refusal RED |
| AL4 | a planted `expect.poll(() => found.length).toBe(0)` | verdict GREEN | verdict RED |
| AL5 | the cross-check's reader blind | — | cross-check RED |
| PS1 | a tee step appends a line with `>>` | GREEN | RED |
| PS2 | the old reader drops the first writer step | GREEN (whole file 142/0) | — |
| PS2b | the new reader drops the first writer step | — | RED |
| PS3 | PS2b with the floor at 0 | — | RED |
| RO1 | the roster's controls hidden | GREEN | RED |
| RT1 | `renderedText` returns blank space | both GREEN | both RED |
| AL6 | the cross-check's count spelling removed | — | planted spellings RED |
| AL7 | the polled-value exemption removed | — | refusal RED, verdict RED |
| AL8 | `.length`/`.size` not read as a population | — | refusal RED |
| AL9 | a polled block body read as a value | — | refusal RED |
| PS4 | a shell comment naming the summary, planted | — | GREEN: excluded |
| PS4b | PS4 with comments read as writes | — | RED |

22 rows: 6 on `develop`, 16 on the branch. AL6-AL9, PS4 and PS4b came from
review pass 1, one per branch no earlier row observed.

## Review passes

`.superpowers/sdd/446-g3/g3-pass.sh <n>` copies the tools into `pass<n>.d/`
and runs from that snapshot. It resets `../shyden.co.uk-446d-pass` to
`bbac359`, applies each task's diff from THIS document with `git apply`,
commits each, and refuses unless the applied tree equals the branch tree
(this document aside). Then: `astro check` (three summary lines, all 0),
`prettier --check .`, the whole unit suite, the touched e2e tests on
Chromium, and the matrix on `develop` and on the applied tree. After the
script, the pass reads the whole document. The loop ends at a pass that
finds nothing.

## Pass log

**Pass 1** (branch at `5d31bfa`). Mechanical: the applied plan equals the
branch; `astro check` 0/0/0; prettier clean; unit 3532/3532; e2e 101 passed
on Chromium; matrix 6 + 10 as predicted, 0 XX. Reading: four findings.
(1) `PLAIN_ABSENCE` left out a count held to 0, so the cross-check could not
see a file writing only `expect(x.length).toBe(0)`. (2) Nothing planted the
reader's spellings against the cross-check's. (3) Six branches had no row
observing them: the count spelling, the polled-value exemption, the
`.length`/`.size` test, the block-body case, and the shell-comment exclusion
both ways. (4) `g3-pass.sh` exited with its last `grep`, so a clean run
reported rc=1, and it never checked the row counts. Fixed: Task 5 (1, 2);
rows AL6-AL9, PS4, PS4b (3); the script's own verdict, with 6 and 16 rows
required (4); Task 6, the ledger. While fixing, a `git checkout --` that
undid a measuring pin also reverted the uncommitted fix; it was restored and
committed, and `~/.claude/hooks/checkout-keeps-uncommitted-work.py` now
refuses that shape (27 cases, 9 mutations).

**Pass 2** (branch at `db2768d`). Mechanical: the applied plan equals the
branch; `astro check` 0/0/0; prettier clean; unit 3533/3533; e2e 101 passed
on Chromium; matrix 6 + 16 as predicted, 0 XX; the script's own verdict
CLEAN. Reading, the whole document again: five findings. (5) The head
table's absence-liveness row credited Task 1 only, though Task 5 changes the
same site. (6) `absenceRoot` returned `target as ts.Expression`, a cast only
the old `ts.Node` declaration needed. (7) The ledger paragraph pass 1 spliced
left a 105-character line. (8) The planted-spellings test said "none it
refuses", but "refuses" in that file names the unclassified-root branch; the
list is of inverses. (9) The ledger's anchored-presence row read "floor
tight (76)", which does not say the floor is 75. Fixed: this table (5), and
Task 7 (6-9).

**Pass 3** (branch at `195c48a`). Mechanical: the applied plan equals the
branch; `astro check` 0/0/0 (so the cast's removal type-checks); prettier
clean; unit 3533/3533; e2e 101 passed; matrix 6 + 16 as predicted, 0 XX;
verdict CLEAN. Reading, the whole document: two findings. (10) The refusal
fixture's comment listed what it spares and left out its last line, an
inverse. (11) The cross-check found the `visual` job with
`ci.slice(start + 1)`, skipping one character so the key's own line could
not end the job, which nothing explained and a tidy-up would break. Fixed:
Task 8.

**Pass 4** (branch at `e49a55d`). Mechanical: the applied plan equals the
branch; `astro check` 0/0/0; prettier clean; unit 3533/3533; e2e 101 passed;
matrix 6 + 16 as predicted, 0 XX, so Task 8's line reading holds under every
row; verdict CLEAN. Reading, the whole document, each claim against the
final code: one finding. (12) The head table's task attributions had gone
stale again (finding 5's class): absence-liveness is changed by Tasks 1, 5, 7
and 8, the step summary by Tasks 2 and 8. A column every fix task must
remember to update will keep going stale, so the attributions are gone and
one sentence says Tasks 5 onward answer the review passes.

**Pass 5** (branch at `5d2221c`). Mechanical: the applied plan equals the
branch; `astro check` 0/0/0; prettier clean; unit 3533/3533; e2e 101 passed;
matrix 6 + 16 as predicted, 0 XX; verdict CLEAN. Reading, the whole
document, each claim against the final code and the ledger's final state: no
findings. **Approved at pass 5.**
