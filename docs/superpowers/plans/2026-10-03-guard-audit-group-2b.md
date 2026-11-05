# Guard Liveness, Group 2b: Twelve File-Level Absence Guards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every guard that judges files with a pattern and asserts that nothing matched proves its walk read as many files as there are, proves its pattern sees the construct in every form the code writes it, and is cross-checked by a reader that works by different means.

**Architecture:** Each guard's reader becomes a named function, so the verdict, the cross-check and the planted forms all call the same code. Beside each verdict sits one test that states the walk's floor (the measured figure minus one, with the figure in a comment) and runs the cross-check (`route-coverage` keeps its floor in the test it already had), and one generated test per planted form. Every control is proved by the mutation matrix in Task 8, run on `develop` (the blinded guard stays GREEN, so the gap was real) and on the new tree (it goes RED).

**Tech Stack:** Vitest, the TypeScript compiler API (`tests/unit/ast.ts`, `tests/playwright-declarations.ts`), the `yaml` parser through `tests/workflow-jobs.ts`, the repo's own `searched` (`tests/source-files.ts`).

**Spec:** issue #446 (the critical rule, its controls (a)-(e)) and the ledger `docs/reviews/2026-10-03-guard-liveness-ledger.md`, Group 2 and Appendix A. Read the ledger's Group 2 section before any task.

## Global Constraints

- The CRITICAL guard rule (operator, 2026-10-02): every guard carries (a) the population at the judged level inside the verdict, (b) a floor at the measured figure minus one with the figure in a comment, (c) an independent cross-check that a unit whose raw text plainly holds the construct was read as at least one, (d) fail-closed parsing that names what it cannot classify, and (e) the construct planted in each form the code writes it, going RED.
- One test per case: a population known before the run is generated as one test each (`it.each`), never looped inside one test.
- A retry is not a fix: none anywhere.
- No new dependency. No closing keyword beside an issue number: write `Refs #446`.
- Merge into `develop` with a merge commit, never a squash.
- When a meta-guard flags new code, change the code, never the meta-guard.

## Triage: what the twelve sites already had

The ledger listed twelve sites as "no cross-check found beside it yet". Reading each through to its verdict, at `e23567d`:

| Site (title) | Had | Adds here |
| --- | --- | --- |
| `browser-matrix` holds only content-only specs | an exact cross-check on `rendered-text.spec.ts`, 24 planted forms in `engine-dependence.test.ts`, a literal population whose files are checked to exist | nothing: sound, the ledger misread it |
| `device-tool-homes` reads every call site through the one home | the home caught by the same pattern | floor, the home inside the walk, a plant per spawner |
| `evidence-recording`, both directions | the action vocabulary planted | floors (specs, declaring, acting, still), the parse tree's `test.use` calls as cross-check, declaration forms |
| `pipeline-wiring` image | nothing | floor, the parsed document's values, five plants |
| `pipeline-wiring` shard budget, prebuilt | nothing | a shared suite reader, floor, raw text against the parse, plants for the suite and the build |
| `pipeline-wiring` wrangler | nothing | floor, a coarser line reading, six forms and every one of npm's twelve install verbs written out |
| `release-inventory` captures | two fixtures, the home inside the walk | floor, the parse tree's `shoot` calls, five plants |
| `route-coverage` locale routes | a floor (3) | the parse tree's strings, five plants and one per locale |
| `shytalk-brand` mark spelled nowhere else | exemptions checked, the triple among the forms | floor, the home and the token home read by the verdict's reader, eight plants across four file kinds |
| `typecheck-scope` ts-nocheck | nothing | floor, the compiler's own directive record, three plants |

## Review Focus

1. **A form the code writes that a pattern never saw.** Measured on `develop`, each planted in a real file of the judged kind and GREEN there: `'/id'`, the Indonesian home, with no slash after the prefix, and a route after a template substitution (`route-coverage`); a capture through a namespace import, `evidence.shoot(` (`release-inventory`); a Playwright image pinned by digest, or not pinned (`pipeline-wiring`); `npm install wrangler@4 -g`, the flag after the package, and `npm in -g wrangler`, one of the eleven install aliases npm documents (`pipeline-wiring`); a build inside the same block script as the suite, and `npx astro build` (`pipeline-wiring`); `rgb(208 188 255 / 0.3)`, the space-separated syntax `tokens.css` itself uses (`shytalk-brand`); `test.use( recorded )` on an idle spec (`evidence-recording`). Each pattern is widened, and each widening is a planted test.
2. **A cross-check that shares the reader's pattern is not independent.** Each pair reads by different means: the compiler's directive record against a raw scan (`typecheck-scope`); the parse tree's strings or calls against a text scan (`route-coverage`, `release-inventory`, `evidence-recording`); the parsed YAML's values or jobs against raw text (`pipeline-wiring` image, suites); a coarse line reading against a command parser (`pipeline-wiring` wrangler). The suites pair shares `runsTheE2eSuite` across its two media, as Group 2a's dangling-reference check shared its pattern, so that pattern is proved by its planted forms instead. `shytalk-brand` and `device-tool-homes` cross-check by reading known positives (the homes) through the verdict's own reader, which is what control (c) names; their pattern forms are proved by plants.
3. **A cross-check with no positive in the corpus runs on its plants.** No script carries a directive, no gate spec a locale route, no workflow an image. For those, each planted form is asserted twice, once by each reader, so the two agree on every form before either is trusted on the corpus.
4. **A cross-check sits after its floor in the same test.** A mutation that drops the count fails on the floor and never reaches the cross-check, so each new cross-check is mutated alone in Task 8, with the floor in its test switched off (`route-coverage`'s floor has a test of its own, and `device-tool-homes`' cross-check was already there).
5. **A floor that names a temporary file.** Two of the ten workflows are #459's probes (`probe-459.yml`, `probe-459-relay.yml`). The two workflow floors say so, so the session that removes them lowers the floors deliberately.
6. **Control (d), fail-closed reading, without a classifier.** None of these readers sorts its input into kinds it could skip. The YAML readers throw on anything unclean (`parseCleanYaml`, and `workflowJobs` on every field it cannot read). The two workflow walks read YAML files only, and a file in the workflows directory that is not YAML is already refused by name by Group 2a's dangling-reference guard (`pipeline-wiring.test.ts`, "not a workflow"). The text scans read every file they open in full.

## Measured on 2026-10-03, at `e23567d` (develop after #464)

| Guard | Judged unit | Measured | Floor |
| --- | --- | --- | --- |
| `typecheck-scope` | scripts read | 29 | > 28 |
| `route-coverage` | deploy-gate specs | 3 | > 2 (already there) |
| `release-inventory` | test helper modules | 58 | > 57 |
| `pipeline-wiring` image | workflow files | 10 | > 9 |
| `pipeline-wiring` budget, prebuilt | jobs running the e2e suite | 1 | > 0 |
| `pipeline-wiring` wrangler | workflow texts | 10 | > 9 |
| `shytalk-brand` | source files scanned | 329 | > 328 |
| `evidence-recording` | e2e specs, declaring, acting, still | 43, 26, 26, 17 | > 42, > 25, > 25, > 16 |
| `device-tool-homes` | files under `tests/` and `scripts/` | 294 | > 293 |

## Files

- Modify `tests/unit/typecheck-scope.test.ts` (Task 1).
- Modify `tests/unit/ast.ts`: `stringTextsIn`, and `tests/unit/route-coverage.test.ts` (Task 2).
- Modify `tests/unit/release-inventory.test.ts` (Task 3), `tests/unit/pipeline-wiring.test.ts` (Task 4), `tests/unit/shytalk-brand.test.ts` (Task 5), `tests/unit/evidence-recording.test.ts` (Task 6), `tests/unit/device-tool-homes.test.ts` (Task 7).
- Modify `docs/reviews/2026-10-03-guard-liveness-ledger.md`: Group 2b's section and #465 under side findings (Task 9). Appendices A and B stay the dated census, as Group 2a left them.

### Where it runs

On a branch `446-guard-audit-2b` from `develop` at `e23567d`, in the worktree `../shyden.co.uk-446c` with its own `npm ci` (never a symlinked `node_modules`). The prototype is `../shyden.co.uk-446c-proto` (one commit on `e23567d`) and review passes run in `../shyden.co.uk-446c-pass`. The session tools (`g2b_plan.py`, `g2b_mut.py`, `g2b-pass.sh`, `g2b_execute.py`) live in `../shyden.co.uk-446c/.superpowers/sdd/446-g2b/`, git-ignored and outside `$TMPDIR`.

### How a review pass runs this plan

Every patch below is the exact diff of the prototype that was run. A pass runs `zsh g2b-pass.sh <n>`, which first copies its tools into `pass<n>.d/` and runs only that copy. It runs the matrix `g2b_mut.py` on the prototype and on `develop`, refusing any row off its prediction, and builds this plan from those rows. It then resets the pass tree to `e23567d` and applies every `diff` block in order with `g2b_plan.py --apply`, refusing on the first that does not apply, and checks that the result equals the prototype. Next it puts this plan in place and runs the whole unit suite, `npm run typecheck`, `npx prettier --check .` and the closing-keyword check. It replays Tasks 1-7 and 9 one at a time, each task's own run before its commit, and runs the matrix again on the replay's head, which must give the prototype's rows exactly. The pass then reads the whole document.

### Why the tests and the code land in one patch

For a liveness control, the corpus is the fixture: a new floor and cross-check pass the day they are written, because the corpus is healthy. Their RED is the mutation that blinds the reader or narrows the walk (Task 8), run on both trees. The widened patterns are proved RED first by the same matrix: each `*1` row plants the newly seen form in a real file, where `develop` stays GREEN and the new tree goes RED.

## Review passes

Each pass runs `zsh g2b-pass.sh <n>`, which executes every mechanical check above rather than reading it, and then reads the whole document. A pass that finds something fixes it and the loop goes on; the plan is approved on the first pass that finds nothing.

- **Pass 1** (mechanical clean: patches equal the prototype, unit 3518/3518, `astro check` 0/0/0, prettier, each task green at its own commit, matrix 17/17 and 44/44, plan rebuilt identical). Reading found four: Task 8 counted 45 branch rows (44); its exception named only cross-check-alone rows, not the narrowed walks and blinded forms whose verdict also stays GREEN; the matrix table listed rows by run, not by guard; and Review Focus 4 claimed every cross-check runs with its floor off, which `route-coverage` (floor in its own test) and `device-tool-homes` (cross-check not new) do not. Also four row ids carried a `[before]`/`[after]` tag the log already prints. All fixed.
- **Pass 2** (mechanical clean, except the last check: the plan had been built from pass 1's matrix, which carried the old row ids, so the rebuild from the fresh matrix differed in exactly those ten rows; the check did its job). Reading the code found one: the `route-coverage` and `pipeline-wiring` image cross-checks compare counts rather than sets, which is sound only because the verdict beside each holds the scan to none, and neither said so. Both now say why.
- **Pass 3** (mechanical clean through the per-task replay; the matrix then refused a row added mid-pass, whose anchor the pass's code did not yet hold, which is the harness failing closed). Reading the code found three: `buildsBeforeTheSuite` spelled the e2e-suite pattern a second time, so the two could drift (now one home, `E2E_SUITE_COMMAND`); the wrangler reader knew four install verbs where npm documents twelve, so `npm in -g wrangler` passed (now `NPM_INSTALL_VERBS`, one planted test per verb, and matrix rows PW5 and PW6); and Review Focus 2 called the suites pair independent without saying it shares its pattern across the two media.
- **Pass 4** (stopped during its first matrix run, cleanly: the harness restored its tree on SIGTERM). Reading the code found one: `callsShoot` claimed to read a capture as `capture-after-assertion` does, but refused a space before the parenthesis, which that guard's pattern allows; it now reads it, with a fifth planted form. The pass was stopped because a matrix row had again been edited while a pass ran, so `g2b-pass.sh` now copies its tools into a directory of its own and runs only the copy, runs the matrix first and builds the plan from those rows, and checks that the replay's head gives the same rows.
- **Pass 5** (its first step, the matrix, ran 18/18 on `develop` and 45/46 on the prototype). PW6, dropping `in` from the alias list, stayed GREEN: the per-alias tests were generated from `NPM_INSTALL_VERBS` itself, so a verb dropped from the list took its test with it, and the row's target, matched as a substring, also hit the tests for `ins`, `inst` and the rest. The twelve commands are now written out, and PW6 names its test exactly. Reading found two more: `shytalk-brand`'s negative `width: 1208.188px` holds no `255`, so it was false with or without the lookbehind it claimed to test (now `1208 188 255`, with rows SB6 and SB7 dropping each lookaround), and two ledger paragraphs rewritten by patches had lost the file's 78-column wrap.
- **Pass 6** (mechanical clean: matrix 18/18 and 48/48, patches equal the prototype, unit 3530/3530, `astro check` 0/0/0, prettier, each task green at its own commit, the replay head giving the prototype's rows exactly). Reading found stale prose only: the triage table still counted seven wrangler plants and four capture plants; Files said Task 9 edits Appendix A, which stays the dated census; "How a review pass runs this plan" described the order before pass 4; and Task 8's `develop` expectation left out the blinded-form row (DT2). All fixed.
- **Pass 7** (mechanical clean, as pass 6). Reading found two imprecisions: Task 3 still said `callsShoot` reads "the two forms" `capture-after-assertion` reads, after pass 4 added a space before the parenthesis; and Architecture put every floor in the new test, where `route-coverage` keeps its floor in the test it already had. Both fixed.
- **Pass 8** (mechanical clean, as pass 6). Reading found one: the constraints name control (d), fail-closed reading, and nothing said how these guards meet it. Review Focus 6 now does, with the dangling-reference guard's refusal of a non-YAML workflow file checked in the code.
- **Pass 9** (mechanical clean: matrix 18/18 and 48/48, patches equal the prototype, unit 3530/3530, `astro check` 0/0/0, prettier, closing keywords, each task green at its own commit, the replay head giving the prototype's rows exactly). Reading the whole document and every patch found nothing. **Approved at pass 9.**

---

### Task 1: `typecheck-scope` reads every script and agrees with the compiler

The directive scan becomes `optsOut`, the walk `scripts()`. A new test states the floor (29 scripts) and cross-checks the scan against the compiler's own record of a ts-nocheck directive (`silencedByCompiler`: `checkJsDirective` on the parsed file, a field TypeScript's public types leave out, read through a narrow cast). No script carries a directive, so three planted forms the compiler obeys (a line comment, a triple-slash comment, a line comment under a shebang) are asserted by both readers.

**Files:** `tests/unit/typecheck-scope.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/typecheck-scope.test.ts b/tests/unit/typecheck-scope.test.ts
index ff3d7e1..068b5e1 100644
--- a/tests/unit/typecheck-scope.test.ts
+++ b/tests/unit/typecheck-scope.test.ts
@@ -18,6 +18,7 @@
  */
 import { describe, it, expect } from 'vitest';
 import { readFileSync } from 'node:fs';
+import ts from 'typescript';
 import { withoutTsComments } from './source-text';
 import { filesUnder, searched, nonEmpty } from '../source-files';
 
@@ -25,6 +26,37 @@ import { filesUnder, searched, nonEmpty } from '../source-files';
 const tsconfig = (): Record<string, any> =>
   JSON.parse(withoutTsComments(readFileSync('tsconfig.json', 'utf8')));
 
+const scripts = (): string[] =>
+  nonEmpty(
+    filesUnder('scripts', (path) => path.endsWith('.mjs')),
+    'scripts',
+  );
+
+/**
+ * Whether `text` carries a ts-nocheck directive. Comment-stripped would HIDE
+ * it -- a directive IS a comment -- so this reads the raw text deliberately,
+ * and wider than the compiler does: a directive in a block comment, or below
+ * the first statement, is flagged although TypeScript ignores it.
+ *
+ * Matched WITHOUT comment syntax: spelling `//` here makes this file read as
+ * a comment stripper to `one-home.test.ts`, which is right to ask -- naming
+ * comment syntax is how a second stripper starts. The directive's own name is
+ * enough, and it appears nowhere else.
+ */
+const optsOut = (text: string): boolean => /@ts-nocheck/.test(text);
+
+/**
+ * Whether TypeScript itself reads `text` as switching checking off. The
+ * compiler records that on the parsed file as `checkJsDirective`, a field its
+ * public types leave out; the planted forms below fail if an upgrade moves it.
+ */
+const silencedByCompiler = (path: string, text: string): boolean =>
+  (
+    ts.createSourceFile(path, text, ts.ScriptTarget.Latest) as ts.SourceFile & {
+      checkJsDirective?: { enabled: boolean };
+    }
+  ).checkJsDirective?.enabled === false;
+
 describe('typecheck reads the scripts that deploy this site (#228)', () => {
   it('turns checkJs on, so a .js body is read and not merely admitted', () => {
     // Read from the STRIPPED text: this file's own comment explains what
@@ -68,20 +100,36 @@ describe('typecheck reads the scripts that deploy this site (#228)', () => {
   it('no script opts itself out with a ts-nocheck directive', () => {
     // A directive at the top of a file silences the whole file, which is the
     // one way to get back to where this ticket started without changing any
-    // config. Comment-stripped would HIDE it -- a directive IS a comment --
-    // so this reads the raw text deliberately, and that is why it matches
-    // the anchored form rather than the bare word.
-    const scripts = nonEmpty(
-      filesUnder('scripts', (path) => path.endsWith('.mjs')),
-      'scripts',
-    );
-    // Matched WITHOUT comment syntax: spelling `//` here makes this file
-    // read as a comment stripper to `one-home.test.ts`, which is right to
-    // ask -- naming comment syntax is how a second stripper starts. The
-    // directive's own name is enough, and it appears nowhere else.
-    const opted = scripts.filter((path) =>
-      /@ts-nocheck/.test(readFileSync(path, 'utf8')),
-    );
-    expect(searched(opted, { of: scripts, what: 'scripts read' })).toEqual([]);
+    // config.
+    const read = scripts();
+    const opted = read.filter((path) => optsOut(readFileSync(path, 'utf8')));
+    expect(searched(opted, { of: read, what: 'scripts read' })).toEqual([]);
+  });
+
+  it('reads every script, and as many as there are', () => {
+    // Measured 29 scripts on 2026-10-03 (#446). Stated tight, so a walk that
+    // comes back one short fails.
+    const read = scripts();
+    expect(read.length).toBeGreaterThan(28);
+    // Cross-checked against the compiler: every script TypeScript itself
+    // would stop checking must be one the raw scan flags. No script does
+    // today, so the planted forms below are what this check runs on.
+    const missed = read.filter((path) => {
+      const text = readFileSync(path, 'utf8');
+      return silencedByCompiler(path, text) && !optsOut(text);
+    });
+    expect(searched(missed, { of: read, what: 'scripts read' })).toEqual([]);
+  });
+
+  it.each([
+    ['a line comment', '// @ts-nocheck\nexport const a = 1;\n'],
+    ['a triple-slash comment', '/// @ts-nocheck\nexport const a = 1;\n'],
+    [
+      'a line comment under a shebang',
+      '#!/usr/bin/env node\n// @ts-nocheck\nexport const a = 1;\n',
+    ],
+  ])('flags a directive the compiler obeys, written as %s', (_form, text) => {
+    expect(silencedByCompiler('plant.mjs', text)).toBe(true);
+    expect(optsOut(text)).toBe(true);
   });
 });
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/typecheck-scope.test.ts`
Expected: 8 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/typecheck-scope.test.ts
git commit -m "typecheck-scope reads every script and agrees with the compiler (Refs #446)"
```

### Task 2: `route-coverage` sees a locale home and a route after a substitution

The scan becomes `localePrefixed`, widened to a prefix that ends the string or is followed by a path, query, fragment or substitution, and to a string resumed after a template substitution. The first version wanted a slash after the prefix, so `'/id'`, the Indonesian home, passed it, and it wanted a quote before the slash, so `` `${base}/vi/…` `` passed it too. The verdict now collects every file's routes into one assertion instead of asserting inside a loop. A new test cross-checks the scan against the parse tree's strings (`stringTextsIn`, added to `tests/unit/ast.ts`), and five forms plus one route per locale are planted, with a negative for a word that only starts with a prefix's letters.

**Files:** `tests/unit/ast.ts`, `tests/unit/route-coverage.test.ts`

**Interfaces:**
- Produces: `stringTextsIn(sf: ts.SourceFile): string[]` from `tests/unit/ast.ts`.

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/ast.ts b/tests/unit/ast.ts
index 5682cd4..cc19564 100644
--- a/tests/unit/ast.ts
+++ b/tests/unit/ast.ts
@@ -597,3 +597,27 @@ export function commentsIn(sf: ts.SourceFile): ts.CommentRange[] {
 export const where = (sf: ts.SourceFile, node: ts.Node): string =>
   `${relative(process.cwd(), sf.fileName)}:` +
   `${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
+
+/**
+ * The text of every string `sf` spells: string literals, templates with no
+ * substitution, and the literal head, middles and tail of a template with
+ * them. A comment is not a node, so nothing a comment says is here. This is
+ * the parse tree's answer to "which strings does this file hold", independent
+ * of any regex that tracks quotes for itself (#446).
+ */
+export function stringTextsIn(sf: ts.SourceFile): string[] {
+  const texts: string[] = [];
+  const visit = (node: ts.Node): void => {
+    if (
+      ts.isStringLiteral(node) ||
+      ts.isNoSubstitutionTemplateLiteral(node) ||
+      ts.isTemplateHead(node) ||
+      ts.isTemplateMiddle(node) ||
+      ts.isTemplateTail(node)
+    )
+      texts.push(node.text);
+    ts.forEachChild(node, visit);
+  };
+  visit(sf);
+  return texts;
+}
diff --git a/tests/unit/route-coverage.test.ts b/tests/unit/route-coverage.test.ts
index 9c76b16..0ece168 100644
--- a/tests/unit/route-coverage.test.ts
+++ b/tests/unit/route-coverage.test.ts
@@ -5,6 +5,7 @@ import { join } from 'node:path';
 import { LOCALES, PREFIXED_LOCALES } from '../../src/lib/i18n';
 import { withoutTsComments, withoutMarkupComments } from './source-text';
 import { nonEmpty, searched } from '../source-files';
+import { parseFile, parseSource, stringTextsIn } from './ast';
 
 /**
  * #21 Stage 4. Adding a locale must not mean writing routes by hand.
@@ -120,6 +121,21 @@ const gateSpecs = () =>
     ),
   );
 
+/**
+ * Every route in `code` under a locale prefix: a quote, a backtick or the end
+ * of a template substitution, then `/<locale>` ending the string or followed
+ * by a path, a query, a fragment or a substitution. `/id` alone is the
+ * Indonesian home, and the first version of this scan, which wanted a slash
+ * after the prefix, could not see it.
+ */
+const PREFIXED = `/(?:${PREFIXED_LOCALES.join('|')})(?=$|[/?#'"\`$])`;
+const localePrefixed = (code: string): string[] =>
+  [...code.matchAll(new RegExp(`['"\`}]${PREFIXED}`, 'g'))].map(([m]) => m);
+
+/** Whether a string, as the parse tree holds it, starts with a locale prefix. */
+const startsPrefixed = (text: string): boolean =>
+  new RegExp(`^${PREFIXED}`).test(text);
+
 describe('the post-deploy gates derive their routes', () => {
   it('has gate specs to check', () => {
     // Without this the loop below is vacuous if the directories are ever
@@ -130,23 +146,62 @@ describe('the post-deploy gates derive their routes', () => {
   });
 
   it('hardcodes no locale-prefixed route in any deploy gate', () => {
-    const pattern = new RegExp(
-      `['"\`]/(?:${PREFIXED_LOCALES.join('|')})/`,
-      'g',
+    const specs = gateSpecs();
+    const found = specs.flatMap((file) =>
+      localePrefixed(withoutTsComments(readFileSync(file, 'utf8'))).map(
+        (route) => `${file}: ${route}`,
+      ),
     );
+    expect(
+      searched(found, { of: specs, what: 'deploy-gate specs' }),
+      'a deploy gate hardcodes a locale-prefixed path. Derive it from LOCALES ' +
+        'and localisePath instead — a hand-written list stops covering new ' +
+        'locales silently, and this gate is what stands between develop and ' +
+        'production',
+    ).toEqual([]);
+  });
+
+  it('reads every locale-prefixed string the parse tree holds', () => {
+    // Cross-checked against the parse tree: a string the compiler reads as
+    // starting with a locale prefix must be one the text scan reports, or
+    // the scan's own quote handling has a blind spot. No gate spec holds one
+    // today, so the planted forms below are what this check runs on. Counts,
+    // not sets, because the verdict above holds the scan to none: any string
+    // the parse tree reads as prefixed is then one the scan missed.
     const specs = gateSpecs();
-    for (const file of specs) {
-      const found = [
-        ...withoutTsComments(readFileSync(file, 'utf8')).matchAll(pattern),
-      ].map((m) => m[0]);
-      expect(
-        searched(found, { of: specs, what: 'deploy-gate specs' }),
-        `${file} hardcodes a locale-prefixed path. Derive it from LOCALES ` +
-          `and localisePath instead — a hand-written list stops covering new ` +
-          `locales silently, and this gate is what stands between develop and ` +
-          `production`,
-      ).toEqual([]);
-    }
+    const missed = specs.flatMap((file) => {
+      const scanned = localePrefixed(
+        withoutTsComments(readFileSync(file, 'utf8')),
+      ).length;
+      const parsed = stringTextsIn(parseFile(file)).filter(startsPrefixed);
+      return parsed.length > scanned ? [`${file}: ${parsed.join(', ')}`] : [];
+    });
+    expect(searched(missed, { of: specs, what: 'deploy-gate specs' })).toEqual(
+      [],
+    );
+  });
+
+  it.each([
+    ['a quoted path', "await page.goto('/id/glory-points');"],
+    ['a locale home', 'await page.goto("/zh");'],
+    ['a template with a substitution', 'await page.goto(`/th/${page}`);'],
+    ['a path after a base URL', 'await fetch(`${base}/vi/classroom-groups`);'],
+    ['a query on a locale home', "await page.goto('/id?ref=x');"],
+  ])('reads a locale-prefixed route written as %s', (_form, source) => {
+    expect(
+      stringTextsIn(parseSource(source)).filter(startsPrefixed),
+    ).toHaveLength(1);
+    expect(localePrefixed(source)).toHaveLength(1);
+  });
+
+  it.each(PREFIXED_LOCALES)('reads a route under /%s', (locale) => {
+    expect(localePrefixed(`await page.goto('/${locale}/x');`)).toHaveLength(1);
+  });
+
+  it('does not read a route that only starts with the same letters', () => {
+    expect(localePrefixed("await page.goto('/identity'); '/thanks';")).toEqual(
+      [],
+    );
   });
 });
 
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/route-coverage.test.ts tests/unit/ast.test.ts`
Expected: all pass (route-coverage 17).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/ast.ts tests/unit/route-coverage.test.ts
git commit -m "route-coverage sees a locale home and a route after a substitution (Refs #446)"
```

### Task 3: `release-inventory` sees a capture through a namespace import

The scan becomes `callsShoot`, widened from refusing a dot before `shoot(` to reading it, so `evidence.shoot(page, 'x')` in a helper module is a capture, and to a space before the parenthesis, both of which `capture-after-assertion`'s pattern already allows. The walk becomes `helperModules()`. A new test states the floor (58 modules) with `tests/e2e/evidence.ts` inside the walk, and cross-checks the scan against the parse tree's calls to `shoot`, bare or through a property. Five forms are planted, a space before the parenthesis among them.

The release script's own selection (`scripts/release-inventory.mjs`) reads bare calls only. That is #465, outside this guard.

**Files:** `tests/unit/release-inventory.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/release-inventory.test.ts b/tests/unit/release-inventory.test.ts
index 2f276b0..24b1974 100644
--- a/tests/unit/release-inventory.test.ts
+++ b/tests/unit/release-inventory.test.ts
@@ -1,4 +1,5 @@
 import { spawnSync } from 'node:child_process';
+import ts from 'typescript';
 import {
   mkdirSync,
   mkdtempSync,
@@ -19,6 +20,8 @@ import {
 import { scratchGit, withoutLocalGit } from '../git-env';
 import { searched, trackedFiles } from '../source-files';
 import { withoutTsComments } from './source-text';
+import { parseSource } from './ast';
+import { callsIn } from '../playwright-declarations';
 
 /** A throwaway repository, driven by the real git. */
 const repository = () => {
@@ -364,27 +367,73 @@ describe('release-inventory.mjs as a command (#362)', () => {
     expect(run.status).toBe(2);
   });
 
-  it('can see every capture: no module but a spec calls shoot', () => {
-    // The selection reads specs alone, so a helper module that captured would
-    // put its tests' pictures on the release page without them ever running.
-    const calls = (source: string) =>
-      /(^|[^\w.$])shoot\(/m.test(withoutTsComments(source));
-    expect(calls("  await shoot(page, 'x');")).toBe(true);
-    expect(calls("  // await shoot(page, 'x');")).toBe(false);
-    const modules = trackedFiles(
+  /**
+   * Whether `source` calls `shoot`, bare or through a namespace import
+   * (`evidence.shoot(`), with or without space before the parenthesis, as
+   * `capture-after-assertion` reads a capture. The first version of this scan
+   * refused a dot before the name, so a helper capturing through a namespace
+   * passed it.
+   */
+  const callsShoot = (source: string) =>
+    /(^|[^\w$])shoot\s*\(/m.test(withoutTsComments(source));
+
+  /** Whether the parse tree of `source` holds a call to `shoot`, either way. */
+  const parsedShoot = (source: string, file = 'module.ts') =>
+    callsIn(parseSource(source, file)).some(
+      ({ expression: callee }) =>
+        (ts.isIdentifier(callee) && callee.text === 'shoot') ||
+        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'shoot'),
+    );
+
+  const helperModules = () =>
+    trackedFiles(
       (path) =>
         path.startsWith('tests/') &&
         !path.startsWith('tests/unit/') &&
         /\.(ts|mjs|js)$/.test(path) &&
         !path.endsWith('.spec.ts'),
     );
+
+  it('can see every capture: no module but a spec calls shoot', () => {
+    // The selection reads specs alone, so a helper module that captured would
+    // put its tests' pictures on the release page without them ever running.
+    expect(callsShoot("  // await shoot(page, 'x');")).toBe(false);
+    const modules = helperModules();
     const capturing = modules.filter((path) =>
-      calls(readFileSync(path, 'utf8')),
+      callsShoot(readFileSync(path, 'utf8')),
     );
     expect(
       searched(capturing, { of: modules, what: 'test helper modules' }),
     ).toEqual([]);
+  });
+
+  it('reads every helper module, and as many as there are', () => {
+    // Measured 58 helper modules on 2026-10-03 (#446). Stated tight, so a
+    // walk that comes back one short fails.
+    const modules = helperModules();
+    expect(modules.length).toBeGreaterThan(57);
     expect(modules).toContain('tests/e2e/evidence.ts');
+    // Cross-checked against the parse tree: every module whose code calls
+    // `shoot` must be one the text scan flags. None does today, so the
+    // planted forms below are what this check runs on.
+    const missed = modules.filter((path) => {
+      const source = readFileSync(path, 'utf8');
+      return parsedShoot(source, path) && !callsShoot(source);
+    });
+    expect(
+      searched(missed, { of: modules, what: 'test helper modules' }),
+    ).toEqual([]);
+  });
+
+  it.each([
+    ['a bare call', "  await shoot(page, 'x');"],
+    ['a call through a namespace import', "  await evidence.shoot(page, 'x');"],
+    ['a call at the start of a line', "shoot(page, 'x');"],
+    ['a returned call', "  return shoot(page, 'x');"],
+    ['a space before the parenthesis', "  await shoot (page, 'x');"],
+  ])('reads a capture written as %s', (_form, source) => {
+    expect(parsedShoot(source)).toBe(true);
+    expect(callsShoot(source)).toBe(true);
   });
 
   it('refuses a selection that is empty, rather than let a capture run everything', () => {
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/release-inventory.test.ts`
Expected: 24 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/release-inventory.test.ts
git commit -m "release-inventory sees a capture through a namespace import (Refs #446)"
```

### Task 4: `pipeline-wiring`'s four file-level guards share readers with controls

The image scan becomes `playwrightImagesIn`, widened to any Playwright image whatever follows the name, so a digest-pinned or unpinned image is named; its cross-check counts the parsed document's values naming the image (`parsedImageValues`). The two e2e-suite guards share `e2eSuites()`, whose cross-check is raw text against the parse; the build check becomes `buildsBeforeTheSuite`, which reads earlier in the same step's script as well as earlier steps, and knows `astro build`. The wrangler scan becomes `globalWranglerInstalls`, a command reader that takes the verb (`install` or any of the eleven aliases npm documents), the flag and the package in any order, through `sudo`, chained commands and continued lines; its cross-check is a coarser reading (`globalFlagLines`). Each has a floor test and planted forms; the helpers sit above their `describe` blocks' docblocks, never between a docblock and its `describe`.

**Files:** `tests/unit/pipeline-wiring.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/pipeline-wiring.test.ts b/tests/unit/pipeline-wiring.test.ts
index fbee2f7..6aae586 100644
--- a/tests/unit/pipeline-wiring.test.ts
+++ b/tests/unit/pipeline-wiring.test.ts
@@ -1241,6 +1241,21 @@ describe('the e2e reconciliation guard cannot be bypassed', () => {
   });
 });
 
+/**
+ * Every Playwright image `text` names, whatever follows the name: a tag, a
+ * digest or nothing at all, which is `latest`. The first version of this scan
+ * wanted a colon after the name, so an image pinned by digest, or not pinned,
+ * passed it.
+ */
+const playwrightImagesIn = (text: string): string[] =>
+  text.match(/mcr\.microsoft\.com\/playwright[\w.@:/-]*/g) ?? [];
+
+/** How many of a workflow's parsed string values name a Playwright image. */
+const parsedImageValues = (raw: string, file: string): number =>
+  stringLeaves(parseCleanYaml(raw, file)).filter(([, value]) =>
+    value.includes('mcr.microsoft.com/playwright'),
+  ).length;
+
 /**
  * The visual-regression job, and the one flag that would hollow it out (#33).
  *
@@ -1274,15 +1289,11 @@ describe('the visual-regression job cannot rewrite what it checks', () => {
     // pick (`localImage`), so a capture and its comparison share one image
     // without either writing it down. A browser bundle from a different
     // release than the library driving it fails in ways neither reports.
-    const workflows = workflowFileNames().filter(
-      (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
-    );
+    const workflows = workflowYamlNames();
     const named = workflows.flatMap((name) =>
-      (
-        withoutCommentLines(workflow(name), '#').match(
-          /mcr\.microsoft\.com\/playwright:[\w.@:-]+/g,
-        ) ?? []
-      ).map((image) => `${name}: ${image}`),
+      playwrightImagesIn(withoutCommentLines(workflow(name), '#')).map(
+        (image) => `${name}: ${image}`,
+      ),
     );
     expect(searched(named, { of: workflows, what: 'workflow files' })).toEqual(
       [],
@@ -1299,6 +1310,53 @@ describe('the visual-regression job cannot rewrite what it checks', () => {
     expect(image).toBe(localImage());
   });
 
+  it('reads every workflow for an image, and as many as there are', () => {
+    // Measured 10 workflow files on 2026-10-03 (#446), two of them #459's
+    // probes (probe-459.yml, probe-459-relay.yml): lower this when they go.
+    // Stated tight, so a walk that comes back one short fails.
+    const workflows = workflowYamlNames();
+    expect(workflows.length).toBeGreaterThan(9);
+    // Cross-checked against the parsed document: every value naming the
+    // image once YAML has unquoted and unfolded it must be one the text scan
+    // reports. No workflow names it today, so the planted forms below are
+    // what this check runs on. Counts, not sets, because the verdict above
+    // holds the scan to none: any value naming the image is then one missed.
+    const missed = workflows.filter(
+      (name) =>
+        parsedImageValues(workflow(name), name) >
+        playwrightImagesIn(withoutCommentLines(workflow(name), '#')).length,
+    );
+    expect(searched(missed, { of: workflows, what: 'workflow files' })).toEqual(
+      [],
+    );
+  });
+
+  it.each([
+    [
+      'a container image',
+      'jobs:\n  a:\n    container:\n      image: mcr.microsoft.com/playwright:v1.55.0-noble\n',
+    ],
+    [
+      'an image pinned by digest',
+      'jobs:\n  a:\n    container: mcr.microsoft.com/playwright@sha256:0123abcd\n',
+    ],
+    [
+      'an untagged image',
+      'jobs:\n  a:\n    container: mcr.microsoft.com/playwright\n',
+    ],
+    [
+      'a quoted image',
+      "jobs:\n  a:\n    container:\n      image: 'mcr.microsoft.com/playwright:v1.55.0-jammy'\n",
+    ],
+    [
+      'a script',
+      'jobs:\n  a:\n    steps:\n      - run: docker run --rm mcr.microsoft.com/playwright:v1.55.0-noble npx playwright test\n',
+    ],
+  ])('reads a Playwright image named in %s', (_where, raw) => {
+    expect(parsedImageValues(raw, 'plant.yml')).toBe(1);
+    expect(playwrightImagesIn(withoutCommentLines(raw, '#'))).toHaveLength(1);
+  });
+
   it('runs the visual project, with the switch that declares it', () => {
     const ci = withoutCommentLines(workflow('ci.yml'), '#');
     expect(ci).toMatch(/npx playwright test --project=visual\s*$/m);
@@ -1544,11 +1602,115 @@ describe('the e2e server is supervised, not handed to a daemon', () => {
 const E2E_SHARD_BUDGET_MINUTES = 20;
 
 /**
- * A step script that runs the e2e suite: the command itself, never a longer
+ * The command that runs the e2e suite: the command itself, never a longer
  * script name that merely starts with it.
  */
+const E2E_SUITE_COMMAND = /(?<![\w:-])npm run test:e2e(?![\w:-])/;
+
+/** A step script that runs the e2e suite. */
 const runsTheE2eSuite = (script: string): boolean =>
-  /(?<![\w:-])npm run test:e2e(?![\w:-])/.test(script);
+  E2E_SUITE_COMMAND.test(script);
+
+/** Every job, in every workflow, that runs the e2e suite. */
+const e2eSuites = () =>
+  workflowGraphs().flatMap(({ name, jobs }) =>
+    jobs
+      .filter((job) => job.runs.some(runsTheE2eSuite))
+      .map((job) => ({ name, job })),
+  );
+
+/** A command that builds the site: the npm script, or Astro's own. */
+const BUILDS_THE_SITE = /(?<![\w:-])(?:npm run build|astro build)(?![\w:-])/;
+
+/**
+ * Whether a job builds the site before it runs the e2e suite: in an earlier
+ * step, or earlier in the same step's script. The first version read earlier
+ * steps only, so a block script building and then testing passed it.
+ */
+const buildsBeforeTheSuite = (runs: readonly string[]): boolean => {
+  const script = runs.join('\n');
+  const at = script.search(E2E_SUITE_COMMAND);
+  return at >= 0 && BUILDS_THE_SITE.test(script.slice(0, at));
+};
+
+/** A one-job workflow whose job runs `steps`, for a planted form. */
+const plantedJob = (steps: string): WorkflowJob[] =>
+  workflowJobs(
+    `on: push\njobs:\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`,
+    'plant.yml',
+  );
+
+describe('every workflow that runs the e2e suite is read as doing so', () => {
+  it('reads every job running the suite, and as many as there are', () => {
+    // Measured 1 job on 2026-10-03 (#446): ci.yml's sharded e2e matrix, which
+    // the dispatch path calls rather than copying. Stated tight, so a reader
+    // that finds none fails.
+    expect(e2eSuites().length).toBeGreaterThan(0);
+    // Cross-checked against the text: a workflow whose runnable text runs
+    // the suite must contribute a job to the parsed population, or the parse
+    // has dropped the step that does it.
+    const workflows = workflowYamlNames();
+    const suites = e2eSuites();
+    const missed = workflows.filter(
+      (name) =>
+        runsTheE2eSuite(runnableText(workflow(name))) &&
+        !suites.some((suite) => suite.name === name),
+    );
+    expect(searched(missed, { of: workflows, what: 'workflow files' })).toEqual(
+      [],
+    );
+  });
+
+  it.each([
+    ['a one-line step', '      - run: npm run test:e2e\n'],
+    [
+      'a shard step',
+      '      - run: npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}\n',
+    ],
+    [
+      'a block script',
+      '      - run: |\n          npm ci\n          npm run test:e2e\n',
+    ],
+    ['a chained command', '      - run: npm ci && npm run test:e2e\n'],
+  ])('reads a job running the suite in %s', (_form, steps) => {
+    expect(
+      plantedJob(steps).filter((job) => job.runs.some(runsTheE2eSuite)),
+    ).toHaveLength(1);
+  });
+
+  it('does not read a longer script that starts with the same name', () => {
+    const [job] = plantedJob(
+      '      - run: npm run test:e2e:visual\n      - run: npm run test:e2e-report\n',
+    );
+    expect(job!.runs).toHaveLength(2);
+    expect(job!.runs.some(runsTheE2eSuite)).toBe(false);
+  });
+
+  it.each([
+    [
+      'an earlier step',
+      '      - run: npm run build\n      - run: npm run test:e2e\n',
+    ],
+    [
+      'the same block script',
+      '      - run: |\n          npm run build\n          npm run test:e2e\n',
+    ],
+    [
+      "Astro's own command",
+      '      - run: npx astro build\n      - run: npm run test:e2e\n',
+    ],
+  ])('reads a build before the suite in %s', (_form, steps) => {
+    const [job] = plantedJob(steps);
+    expect(buildsBeforeTheSuite(job!.runs)).toBe(true);
+  });
+
+  it('does not read a build after the suite as one before it', () => {
+    const [job] = plantedJob(
+      '      - run: npm run test:e2e\n      - run: npm run build\n',
+    );
+    expect(buildsBeforeTheSuite(job!.runs)).toBe(false);
+  });
+});
 
 describe('every job runs under a budget of its own (#157)', () => {
   it('pins the e2e budget as a chosen policy, not a number nobody picked', () => {
@@ -1587,11 +1749,7 @@ describe('every job runs under a budget of its own (#157)', () => {
   });
 
   it('every job running the e2e suite carries exactly the shard budget', () => {
-    const suites = workflowGraphs().flatMap(({ name, jobs }) =>
-      jobs
-        .filter((job) => job.runs.some(runsTheE2eSuite))
-        .map((job) => ({ name, job })),
-    );
+    const suites = e2eSuites();
     const offBudget = suites
       .filter(({ job }) => job.timeoutMinutes !== E2E_SHARD_BUDGET_MINUTES)
       .map(
@@ -1732,17 +1890,9 @@ describe('build-and-test stands for the whole suite, run as shards (#163)', () =
   // read of `dist/` anywhere the suite is collected. A build step here would
   // pay for a second build and blind the one cold listing CI performs.
   it('no job running the e2e suite builds the site before it', () => {
-    const suites = workflowGraphs().flatMap(({ name, jobs }) =>
-      jobs
-        .filter((job) => job.runs.some(runsTheE2eSuite))
-        .map((job) => ({ name, job })),
-    );
+    const suites = e2eSuites();
     const prebuilt = suites
-      .filter(({ job }) =>
-        job.runs
-          .slice(0, job.runs.findIndex(runsTheE2eSuite))
-          .some((script) => /(?<![\w:-])npm run build(?![\w:-])/.test(script)),
-      )
+      .filter(({ job }) => buildsBeforeTheSuite(job.runs))
       .map(
         ({ name, job }) =>
           `${name}: ${job.id} builds before the e2e suite, so its listing never runs cold`,
@@ -2453,6 +2603,59 @@ describe('the back-translation review', () => {
   });
 });
 
+/** `npm install` and every alias npm documents for it (`npm help install`). */
+const NPM_INSTALL_VERBS = [
+  'install',
+  'add',
+  'i',
+  'in',
+  'ins',
+  'inst',
+  'insta',
+  'instal',
+  'isnt',
+  'isnta',
+  'isntal',
+  'isntall',
+];
+
+/** `text` with each shell continuation joined onto the line it continues. */
+const joinedLines = (text: string): string[] =>
+  text.replace(/\\\n\s*/g, ' ').split('\n');
+
+/**
+ * Each command in `text` that installs wrangler globally: `npm` with an
+ * install verb, a global flag and a wrangler argument, in any order. The first
+ * version of this scan wanted the flag before the package, on one line, after
+ * `install` or `i`, so `npm install wrangler -g` and `npm in -g wrangler`
+ * passed it.
+ */
+const globalWranglerInstalls = (text: string): string[] =>
+  joinedLines(text)
+    .flatMap((line) => line.split(/&&|\|\||;/))
+    .map((command) => command.trim())
+    .filter((command) => {
+      const words = command.split(/\s+/);
+      const at = words.indexOf('npm');
+      if (at < 0) return false;
+      const args = words.slice(at + 2);
+      return (
+        NPM_INSTALL_VERBS.includes(words[at + 1] ?? '') &&
+        args.some((arg) =>
+          /^(?:-g|--global(?:=.*)?|--location=global)$/.test(arg),
+        ) &&
+        args.some((arg) => /^wrangler(?:@|$)/.test(arg))
+      );
+    });
+
+/** Every line of `text` naming wrangler beside a global flag, joined first. */
+const globalFlagLines = (text: string): string[] =>
+  joinedLines(text).filter(
+    (line) =>
+      line.includes('wrangler') &&
+      /(?:^|\s)(?:-g|--global|--location=global)(?![\w-])/.test(line),
+  );
+
 /**
  * wrangler comes from the lockfile (#97, spec section 9).
  *
@@ -2471,13 +2674,9 @@ describe('wrangler comes from the lockfile (#97)', () => {
 
   it('no workflow installs it globally', () => {
     const workflows = allWorkflows();
-    const globalInstalls = workflows
-      .filter(({ text }) =>
-        /\bnpm\s+(?:install|i)\b[^\n]*(?:\s-g\b|\s--global\b)[^\n]*\bwrangler\b/.test(
-          text,
-        ),
-      )
-      .map(({ name }) => name);
+    const globalInstalls = workflows.flatMap(({ name, text }) =>
+      globalWranglerInstalls(text).map((command) => `${name}: ${command}`),
+    );
     expect(
       searched(globalInstalls, {
         of: workflows.map(({ text }) => text),
@@ -2486,6 +2685,69 @@ describe('wrangler comes from the lockfile (#97)', () => {
     ).toEqual([]);
   });
 
+  it('reads every workflow for an install, and as many as there are', () => {
+    // Measured 10 workflow files on 2026-10-03 (#446), two of them #459's
+    // probes (probe-459.yml, probe-459-relay.yml): lower this when they go.
+    // Stated tight, so a walk that comes back one short fails.
+    const workflows = allWorkflows();
+    expect(workflows.length).toBeGreaterThan(9);
+    // Cross-checked against a coarser reading: any line naming wrangler
+    // beside a global flag must hold a command the parser reports, or the
+    // parser has a blind spot. No workflow holds one today, so the planted
+    // forms below are what this check runs on.
+    const missed = workflows.flatMap(({ name, text }) =>
+      globalFlagLines(text)
+        .filter((line) => globalWranglerInstalls(line).length === 0)
+        .map((line) => `${name}: ${line}`),
+    );
+    expect(
+      searched(missed, {
+        of: workflows.map(({ text }) => text),
+        what: 'workflow texts',
+      }),
+    ).toEqual([]);
+  });
+
+  it.each([
+    ['the flag before the package', 'run: npm install -g wrangler@4'],
+    ['the flag after the package', 'run: npm install wrangler@4 -g'],
+    ['the long flag', 'run: npm i --global wrangler'],
+    ['a continued line', 'run: |\n  npm install \\\n    -g wrangler'],
+    ['sudo', 'run: sudo npm i -g wrangler'],
+    ['a chained command', 'run: npm ci && npm i -g wrangler'],
+  ])('reads a global install written with %s', (_form, text) => {
+    expect(globalFlagLines(text)).toHaveLength(1);
+    expect(globalWranglerInstalls(text)).toHaveLength(1);
+  });
+
+  // Written out, never generated from NPM_INSTALL_VERBS: a test made from the
+  // list cannot see a verb dropped from it, because the verb's test goes too
+  // (#446, matrix row PW6).
+  it.each([
+    'npm install -g wrangler',
+    'npm add -g wrangler',
+    'npm i -g wrangler',
+    'npm in -g wrangler',
+    'npm ins -g wrangler',
+    'npm inst -g wrangler',
+    'npm insta -g wrangler',
+    'npm instal -g wrangler',
+    'npm isnt -g wrangler',
+    'npm isnta -g wrangler',
+    'npm isntal -g wrangler',
+    'npm isntall -g wrangler',
+  ])('reads a global install written `%s`', (command) => {
+    expect(globalWranglerInstalls(`run: ${command}`)).toHaveLength(1);
+  });
+
+  it('does not read the locked copy, or a global install of something else', () => {
+    expect(
+      globalWranglerInstalls(
+        'run: npx wrangler pages deploy dist\nrun: npm i -g pnpm && npx wrangler --version',
+      ),
+    ).toEqual([]);
+  });
+
   it('every deploy runs the locked copy', () => {
     const deploys = allWorkflows().flatMap(({ name, text }) =>
       text
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/pipeline-wiring.test.ts tests/unit/stranded-docblocks.test.ts tests/unit/absence-liveness.test.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/pipeline-wiring.test.ts
git commit -m "pipeline-wiring's file-level guards share readers with controls (Refs #446)"
```

### Task 5: `shytalk-brand` reads a space-separated triple

`spells` matches a channel triple with commas or spaces between channels, so `rgb(208 188 255 / 0.3)`, the syntax `tokens.css` uses, is the mark; the first version matched the comma-and-space spelling alone. The verdict reads through `readCode`, and a new test states the floor (329 files) and cross-checks through that same reader on the files that do spell the mark: the home spells every hex, the token home its one token exactly once. Eight forms are planted across stylesheets, scripts, components and `.tsx`, with negatives for a triple inside a longer number on either side, each of which only its own lookaround refuses.

**Files:** `tests/unit/shytalk-brand.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/shytalk-brand.test.ts b/tests/unit/shytalk-brand.test.ts
index 744d0ce..4e5d55d 100644
--- a/tests/unit/shytalk-brand.test.ts
+++ b/tests/unit/shytalk-brand.test.ts
@@ -63,6 +63,37 @@ const scannedFiles = (): string[] =>
     `source files under ${SCAN.join(', ')}`,
   );
 
+/**
+ * Whether lower-cased `code` spells `form`. A hex is matched as written. A
+ * channel triple is matched with either separator CSS accepts: commas, as
+ * `rgb(208, 188, 255)` writes them, or spaces, as `rgb(208 188 255 / 0.3)`
+ * does, the syntax `tokens.css` uses. The first version of this scan matched
+ * the comma-and-space spelling alone, so both of those others passed it.
+ */
+const spells = (code: string, form: string): boolean => {
+  if (form.startsWith('#')) return code.includes(form);
+  const [red, green, blue] = form.split(', ');
+  return new RegExp(
+    `(?<![\\d.])${red}\\s*[,\\s]\\s*${green}\\s*[,\\s]\\s*${blue}(?![\\d.])`,
+  ).test(code);
+};
+
+/**
+ * `text` as the scan reads it: comments stripped, because a comment NAMING the
+ * colour is documentation and a guard tripped by its own explanation is noise,
+ * and lower-cased, because a hex is the same colour in either case.
+ */
+const codeOf = (file: string, text: string): string =>
+  codeWithoutComments(file, text).toLowerCase();
+
+/** A file on disk, read as `codeOf` reads it. */
+const readCode = (file: string): string =>
+  codeOf(file, readFileSync(file, 'utf8'));
+
+/** Whether `text`, read as `file` is read, spells any form of the mark. */
+const spellsTheMark = (file: string, text: string): boolean =>
+  spellings().some((form) => spells(codeOf(file, text), form));
+
 describe("ShyTalk's brand mark has one home", () => {
   /**
    * The LEVEL, pinned literally and separately from everything derived.
@@ -114,19 +145,14 @@ describe("ShyTalk's brand mark has one home", () => {
 
     const offenders = files.flatMap((file) => {
       if (ALLOWED.has(file)) return [];
-      const raw = readFileSync(file, 'utf8');
-      // Comments stripped: a comment NAMING the colour is documentation, and
-      // a guard tripped by its own explanation is noise. The assertion is
-      // about what the code spells out.
-      const code = codeWithoutComments(file, raw);
-      const lower = code.toLowerCase();
+      const lower = readCode(file);
       const exempt = file === TOKEN_HOME ? [TOKEN_FORM] : [];
       const repeated = exempt.filter((form) => lower.split(form).length > 2);
       return [
         ...forms
           .filter(
             (form) =>
-              lower.includes(form.toLowerCase()) && !exempt.includes(form),
+              spells(lower, form.toLowerCase()) && !exempt.includes(form),
           )
           .map((form) => `${file} spells out ${form}`),
         ...repeated.map((form) => `${file} spells out ${form} more than once`),
@@ -137,4 +163,72 @@ describe("ShyTalk's brand mark has one home", () => {
       searched(offenders, { of: files, what: 'source files scanned' }),
     ).toEqual([]);
   });
+
+  it('reads every source file, and as many as there are', () => {
+    // Measured 329 source files on 2026-10-03 (#446). Stated tight, so a walk
+    // that comes back one short fails.
+    const files = scannedFiles();
+    expect(files.length).toBeGreaterThan(328);
+    // Cross-checked on the files that do spell the mark, by the same reading
+    // the verdict makes: the home spells every hex, and the token home spells
+    // its one token exactly once, so a reader gone blind to a script or to a
+    // stylesheet is caught by the file it missed.
+    const home = readCode(HOME);
+    const unread = Object.values(SHYTALK_MARK).filter(
+      (hex) => !spells(home, hex.toLowerCase()),
+    );
+    expect(
+      searched(unread, {
+        of: Object.values(SHYTALK_MARK),
+        what: 'brand hexes',
+      }),
+    ).toEqual([]);
+    expect(readCode(TOKEN_HOME).split(TOKEN_FORM).length - 1).toBe(1);
+  });
+
+  it.each([
+    ['a hex in a stylesheet', 'a.css', '.a { color: #D0BCFF; }'],
+    [
+      'a comma triple in a stylesheet',
+      'a.css',
+      '.a { color: rgba(208, 188, 255, 0.3); }',
+    ],
+    [
+      'a space triple in a stylesheet',
+      'a.css',
+      '.a { color: rgb(208 188 255 / 0.3); }',
+    ],
+    ['a tight triple in a script', 'a.ts', "const c = 'rgb(208,188,255)';"],
+    [
+      'a hex in a component style',
+      'a.astro',
+      '---\n---\n<p class="a">x</p>\n<style>\n  .a { color: #d0bcff; }\n</style>\n',
+    ],
+    [
+      'a hex in component frontmatter',
+      'a.astro',
+      "---\nconst c = '#d0bcff';\n---\n<p>{c}</p>\n",
+    ],
+    [
+      'a hex in a style attribute',
+      'a.astro',
+      '---\n---\n<p style="color: #d0bcff">x</p>\n',
+    ],
+    [
+      'a hex in a tsx file',
+      'a.tsx',
+      "export const C = () => <p style={{ color: '#d0bcff' }} />;",
+    ],
+  ])('reads the mark spelled as %s', (_form, file, text) => {
+    expect(spellsTheMark(file, text)).toBe(true);
+  });
+
+  it('does not read a triple inside longer numbers', () => {
+    expect(spellsTheMark('a.css', '.a { grid-area: 1208 188 255; }')).toBe(
+      false,
+    );
+    expect(spellsTheMark('a.css', '.a { color: rgb(208 188 2550); }')).toBe(
+      false,
+    );
+  });
 });
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/shytalk-brand.test.ts`
Expected: 16 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/shytalk-brand.test.ts
git commit -m "shytalk-brand reads a space-separated triple and counts its files (Refs #446)"
```

### Task 6: `evidence-recording` agrees with the parse tree on every declaration

`declaresRecorded` reads `test.use(recorded)` with any spacing and a trailing comma. A new test states the floors (43 specs, 26 declaring) and cross-checks the text reader against the parse tree's `test.use` calls (`useCallsIn`, `shared === 'recorded'`) in both directions. Three declaration forms are planted. The population control's slack (`acting > 0`, `still > 0`) becomes the measured floors (26 acting, 17 still).

**Files:** `tests/unit/evidence-recording.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/evidence-recording.test.ts b/tests/unit/evidence-recording.test.ts
index ecd3de9..d44241e 100644
--- a/tests/unit/evidence-recording.test.ts
+++ b/tests/unit/evidence-recording.test.ts
@@ -24,6 +24,7 @@ import {
   callsIn,
   declarationsIn,
   enclosingDeclaration,
+  useCallsIn,
 } from '../playwright-declarations';
 
 const E2E = 'tests/e2e';
@@ -92,7 +93,11 @@ const actionsIn = (text: string): string[] => {
 };
 
 const declaresRecorded = (text: string): boolean =>
-  text.includes('test.use(recorded)');
+  /\btest\.use\(\s*recorded\s*,?\s*\)/.test(text);
+
+/** Whether the parse tree of `text` passes `recorded` to `test.use`. */
+const parsedRecorded = (text: string): boolean =>
+  useCallsIn(parseSource(text)).some(({ shared }) => shared === 'recorded');
 
 /**
  * Whether a journey reaches the browser at all (#292) -- which is not the
@@ -288,6 +293,38 @@ describe('evidence recording is opt-in, and the opt-in is derived', () => {
     ).toEqual([]);
   });
 
+  it('reads every spec, and as many declarations as there are', () => {
+    // Measured 43 e2e specs on 2026-10-03 (#446), 26 of them declaring
+    // recorded. Stated tight, so a walk or a reader that comes back one short
+    // fails.
+    expect(SPECS.length).toBeGreaterThan(42);
+    const declaring = SPECS.filter((path) => declaresRecorded(sourceOf(path)));
+    expect(declaring.length).toBeGreaterThan(25);
+    // Cross-checked against the parse tree: a spec the compiler reads as
+    // passing `recorded` to `test.use` is one the text scan reads as
+    // declaring it, and the other way round, so neither reading has a form
+    // the other cannot see.
+    const disagree = SPECS.filter(
+      (path) =>
+        parsedRecorded(sourceOf(path)) !== declaresRecorded(sourceOf(path)),
+    );
+    expect(
+      searched(disagree, {
+        of: SPECS,
+        what: 'specs checked for a declaration',
+      }),
+    ).toEqual([]);
+  });
+
+  it.each([
+    ['on one line', 'test.use(recorded);\n'],
+    ['with spaces inside the call', 'test.use( recorded );\n'],
+    ['split over lines', 'test.use(\n  recorded,\n);\n'],
+  ])('reads a declaration written %s', (_form, text) => {
+    expect(parsedRecorded(text)).toBe(true);
+    expect(declaresRecorded(text)).toBe(true);
+  });
+
   it('every construct in the vocabulary is detectable', () => {
     // Anti-vacuity, done with FIXTURES rather than by demanding a real spec
     // use each token. A token no spec uses yet still states the policy for the
@@ -323,9 +360,11 @@ describe('evidence recording is opt-in, and the opt-in is derived', () => {
   it('some specs really do act, and some really do not', () => {
     // The population control for the two direction guards above: if every
     // spec landed on one side, both would pass while asserting nothing.
+    // Measured 26 acting and 17 still on 2026-10-03 (#446). Stated tight, so
+    // a reader that moves one spec across fails.
     const acting = SPECS.filter((p) => actionsIn(sourceOf(p)).length > 0);
     const still = SPECS.filter((p) => actionsIn(sourceOf(p)).length === 0);
-    expect({ acting: acting.length > 0, still: still.length > 0 }).toEqual({
+    expect({ acting: acting.length > 25, still: still.length > 16 }).toEqual({
       acting: true,
       still: true,
     });
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/evidence-recording.test.ts`
Expected: 12 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/evidence-recording.test.ts
git commit -m "evidence-recording agrees with the parse tree on every declaration (Refs #446)"
```

### Task 7: `device-tool-homes` counts its walk and plants every spawner

The pattern becomes `spawnsTool(tool)`. Per tool, a new test states the floor (294 files) with the home inside the walk, and one test per spawner form (seven spawners and a call split over lines) plants the call; a negative shows a longer tool name is not read as this one. The home control already there stays the cross-check.

**Files:** `tests/unit/device-tool-homes.test.ts`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/tests/unit/device-tool-homes.test.ts b/tests/unit/device-tool-homes.test.ts
index 153304e..7c74ce5 100644
--- a/tests/unit/device-tool-homes.test.ts
+++ b/tests/unit/device-tool-homes.test.ts
@@ -22,13 +22,35 @@ const files = ['tests', 'scripts'].flatMap((dir) =>
   filesUnder(dir, (file) => /\.(ts|mjs)$/.test(file)),
 );
 
+/** A call that runs `tool`: any of the spawners, with the tool as a literal. */
+const spawnsTool = (tool: string): RegExp =>
+  new RegExp(
+    String.raw`\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec|runWithDeadline)\(\s*['"\`]` +
+      tool +
+      String.raw`\b`,
+  );
+
+/** Each way the code runs a tool, as a source line naming it. */
+const SPAWN_FORMS: ReadonlyArray<[string, (tool: string) => string]> = [
+  ['execFileSync', (tool) => `execFileSync('${tool}', ['devices']);`],
+  ['execFile', (tool) => `execFile('${tool}', ['devices'], done);`],
+  ['spawnSync', (tool) => `spawnSync("${tool}", ['devices']);`],
+  ['spawn', (tool) => `spawn(\`${tool}\`, ['devices']);`],
+  ['execSync', (tool) => `execSync('${tool} devices');`],
+  ['exec', (tool) => `exec('${tool} devices', done);`],
+  [
+    'runWithDeadline',
+    (tool) => `runWithDeadline('${tool}', ['devices'], 5000);`,
+  ],
+  [
+    'a call split over lines',
+    (tool) => `spawnSync(\n  '${tool}',\n  ['devices'],\n);`,
+  ],
+];
+
 describe.each(HOMES)('no file spawns $tool but $home', ({ tool, home }) => {
   it('reads every call site through the one home', () => {
-    const spawns = new RegExp(
-      String.raw`\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec|runWithDeadline)\(\s*['"\`]` +
-        tool +
-        String.raw`\b`,
-    );
+    const spawns = spawnsTool(tool);
     const spawning = files.filter(
       (file) =>
         file !== home &&
@@ -49,6 +71,22 @@ describe.each(HOMES)('no file spawns $tool but $home', ({ tool, home }) => {
       `${home} spawns ${tool}`,
     ).toBe(true);
   });
+
+  it('reads every file under tests/ and scripts/, and as many as there are', () => {
+    // Measured 294 files on 2026-10-03 (#446). Stated tight, so a walk that
+    // comes back one short fails, and the home is among them, so a walk that
+    // loses scripts/ fails too.
+    expect(files.length).toBeGreaterThan(293);
+    expect(files).toContain(home);
+  });
+
+  it.each(SPAWN_FORMS)('reads a spawn written with %s', (_form, line) => {
+    expect(spawnsTool(tool).test(line(tool))).toBe(true);
+  });
+
+  it('does not read a longer tool name as this one', () => {
+    expect(spawnsTool(tool).test(`spawnSync('${tool}x', []);`)).toBe(false);
+  });
 });
 
 /**
```


- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/device-tool-homes.test.ts`
Expected: 23 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/device-tool-homes.test.ts
git commit -m "device-tool-homes counts its walk and plants every spawner (Refs #446)"
```

### Task 8: The mutation matrix, on both trees

Every control above is proved by `g2b_mut.py`, run on `develop` and on the branch. Each row applies its edits (each anchor must occur exactly once), runs the whole test file with the JSON reporter, compares each named test's verdict with the prediction for that tree, and restores the tree in `finally`. A target that names no test reports ABSENT, never GREEN.

- [ ] **Step 1: Run it on `develop`**

Run: `python3 .superpowers/sdd/446-g2b/g2b_mut.py before <a clean develop tree>`
Expected: 18 rows, all as predicted: every planted form, narrowed walk and blinded form GREEN, every new test ABSENT.

- [ ] **Step 2: Run it on the branch**

Run: `python3 .superpowers/sdd/446-g2b/g2b_mut.py after .`
Expected: 48 rows, all as predicted: every control a row names goes RED. Where a row also names the verdict (a narrowed walk, a blinded form, a cross-check alone), the verdict stays GREEN, which is the gap the control closes.

| Row | `develop` | branch |
| --- | --- | --- |
| TS1 walk narrowed | GREEN (no script opts itself out), ABSENT (reads every script) | GREEN (no script opts itself out), RED (reads every script) |
| TS2 reader blind, a real directive planted | GREEN (no script opts itself out) | - |
| TS3 reader blind | - | RED (flags a directive the compiler obeys) |
| TS4 cross-check alone (floor off, reader blind, directive planted) | - | GREEN (no script opts itself out), RED (reads every script) |
| TS5 floor at the measured 29 | - | RED (reads every script) |
| RC1 locale home planted | GREEN (hardcodes no locale-prefixed route) | RED (hardcodes no locale-prefixed route) |
| RC2 path after a base URL planted | GREEN (hardcodes no locale-prefixed route) | RED (hardcodes no locale-prefixed route) |
| RC3 reader blind | - | RED (reads a locale-prefixed route written as) |
| RC4 cross-check alone (scan blind after a substitution, base URL planted) | - | GREEN (hardcodes no locale-prefixed route), RED (reads every locale-prefixed string) |
| RI1 namespace capture planted | GREEN (can see every capture) | RED (can see every capture) |
| RI2 walk narrowed | GREEN (can see every capture), ABSENT (reads every helper module) | GREEN (can see every capture), RED (reads every helper module) |
| RI3 reader blind | - | RED (reads a capture written as) |
| RI4 cross-check alone (floor off, old dot-refusing scan, namespace capture planted) | - | GREEN (can see every capture), RED (reads every helper module) |
| RI5 floor at the measured 58 | - | RED (reads every helper module) |
| PI1 digest-pinned image planted | GREEN (takes the image the baselines are captured in) | RED (takes the image the baselines are captured in) |
| PI2 walk narrowed | GREEN (takes the image the baselines are captured in), ABSENT (reads every workflow for an image), GREEN (no workflow installs it globally), ABSENT (reads every workflow for an install) | GREEN (takes the image the baselines are captured in), RED (reads every workflow for an image), GREEN (no workflow installs it globally), RED (reads every workflow for an install) |
| PI3 reader blind | - | RED (reads a Playwright image named in) |
| PI4 cross-check alone (floor off, colon-only scan, digest planted) | - | GREEN (takes the image the baselines are captured in), RED (reads every workflow for an image) |
| PI5 floor at the measured 10 | - | RED (reads every workflow for an image) |
| PS1 build in the same block script planted | GREEN (builds the site before it), GREEN (carries exactly the shard budget) | RED (builds the site before it), GREEN (carries exactly the shard budget) |
| PS2 Astro build planted | GREEN (builds the site before it) | RED (builds the site before it) |
| PS3 suite reader blind | - | RED (carries exactly the shard budget), RED (builds the site before it), RED (reads every job running the suite) |
| PS4 cross-check alone (floor off, chained commands dropped, one planted) | - | GREEN (carries exactly the shard budget), GREEN (builds the site before it), RED (reads every job running the suite) |
| PS5 build reader blind | - | RED (reads a build before the suite in) |
| PS6 floor at the measured 1 | - | RED (reads every job running the suite) |
| PW1 flag after the package planted | GREEN (no workflow installs it globally) | RED (no workflow installs it globally) |
| PW2 reader blind | - | RED (reads a global install written with) |
| PW3 cross-check alone (floor off, short flag unread, one planted) | - | GREEN (no workflow installs it globally), RED (reads every workflow for an install) |
| PW4 floor at the measured 10 | - | RED (reads every workflow for an install) |
| PW5 an install alias planted | GREEN (no workflow installs it globally) | RED (no workflow installs it globally) |
| PW6 aliases dropped | - | RED (reads a global install written `npm in -g wrangler`) |
| SB1 space-separated triple planted | GREEN (is spelled out nowhere else) | RED (is spelled out nowhere else) |
| SB2 walk narrowed | GREEN (is spelled out nowhere else), ABSENT (reads every source file) | GREEN (is spelled out nowhere else), RED (reads every source file) |
| SB3 hex reader blind | - | RED (reads every source file) |
| SB4 cross-check alone (floor off, stylesheets unread) | - | GREEN (is spelled out nowhere else), RED (reads every source file) |
| SB5 floor at the measured 329 | - | RED (reads every source file) |
| SB6 triple read inside a longer number before it | - | RED (does not read a triple inside longer numbers) |
| SB7 triple read inside a longer number after it | - | RED (does not read a triple inside longer numbers) |
| ER1 spaced declaration, idle, planted | GREEN (no spec declares test.use(recorded) without acting) | RED (no spec declares test.use(recorded) without acting) |
| ER2 walk narrowed | GREEN (every spec that acts declares), GREEN (no spec declares test.use(recorded) without acting), ABSENT (reads every spec, and as many declarations) | GREEN (every spec that acts declares), GREEN (no spec declares test.use(recorded) without acting), RED (reads every spec, and as many declarations) |
| ER3 declaration reader blind | - | RED (reads a declaration written) |
| ER4 cross-check alone (floors off, old substring reader, spaced idle planted) | - | GREEN (no spec declares test.use(recorded) without acting), RED (reads every spec, and as many declarations) |
| ER5 spec floor at the measured 43 | - | RED (reads every spec, and as many declarations) |
| ER6 declaring floor at the measured 26 | - | RED (reads every spec, and as many declarations) |
| ER7 acting floor at the measured 26 | - | RED (some specs really do act) |
| ER8 still floor at the measured 17 | - | RED (some specs really do act) |
| DT1 walk narrowed | GREEN (reads every call site through the one home), ABSENT (reads every file under tests/ and scripts/) | GREEN (reads every call site through the one home), RED (reads every file under tests/ and scripts/) |
| DT2 blind to execFileSync | GREEN (reads every call site through the one home), ABSENT (reads a spawn written with execFileSync) | GREEN (reads every call site through the one home), RED (reads a spawn written with execFileSync) |
| DT3 floor at the measured 294 | - | RED (reads every file under tests/ and scripts/) |


### Task 9: The ledger records Group 2b

**Files:** `docs/reviews/2026-10-03-guard-liveness-ledger.md`

- [ ] **Step 1: Apply the patch**

```diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index d4adad8..b302549 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -147,6 +147,46 @@ cross-check alone, with its floor switched off. Appendices A and B below are the
 census at `6d07d37`, before Group 2a. `download-readers.test.ts:78`'s
 file-level floor in Appendix B is gone, replaced by the byte-read floor above.
 
+## Group 2b: file-level absence guards, done
+
+The 12 sites above that judge each file with a pattern and assert an empty
+result now prove their walk, their pattern and a second reading (#446
+Group 2b, plan `docs/superpowers/plans/2026-10-03-guard-audit-group-2b.md`).
+One needed nothing: `browser-matrix`'s content-only guard already had an exact
+cross-check on `rendered-text.spec.ts` and 24 planted forms in
+`engine-dependence.test.ts`, which this census missed by stopping at the
+verdict. `device-tool-homes` and `release-inventory` had part of it. Each of
+the other sites now has a floor at measured − 1, a cross-check by different
+means, and its construct planted in each form:
+
+| Guard | Floor (measured) | Cross-check |
+| --- | --- | --- |
+| `typecheck-scope` ts-nocheck | 29 scripts | the compiler's own directive record |
+| `route-coverage` locale routes | 3 gate specs (already there) | the parse tree's strings |
+| `release-inventory` captures | 58 helper modules | the parse tree's `shoot` calls |
+| `pipeline-wiring` image | 10 workflow files | the parsed document's values |
+| `pipeline-wiring` budget, prebuilt | 1 job running the suite | raw text against the parsed jobs |
+| `pipeline-wiring` wrangler | 10 workflow texts | a coarser line reading |
+| `shytalk-brand` | 329 source files | the homes, through the verdict's reader |
+| `evidence-recording`, both directions | 43 specs, 26 declaring, 26 acting, 17 still | the parse tree's `test.use` calls |
+| `device-tool-homes` | 294 files | the home, through the same pattern (already there) |
+
+Ten forms the code writes, or could write the next day, were invisible, and
+each was planted in a real file and stayed GREEN on `develop`: `'/id'` (a
+locale home with no slash after it) and a route after a template substitution;
+a capture through a namespace import (`evidence.shoot(`); a Playwright image
+pinned by digest or not pinned; `npm install wrangler@4 -g`, and `npm in -g
+wrangler`, one of the eleven install aliases npm documents; a build inside the
+suite's own block script, and `npx astro build`; `rgb(208 188 255 / 0.3)`, the
+space-separated syntax `tokens.css` uses; and `test.use( recorded )` on an
+idle spec.
+
+The mutation matrix ran 66 rows, all as predicted: 18 on `develop`, where each
+planted form and narrowed walk stayed GREEN, and 48 on the new tree, where
+each turned a guard RED. Eight of those prove a cross-check alone, with its
+floor switched off. The two workflow floors count #459's probe workflows, and
+say so. Appendices A and B below remain the census at `6d07d37`.
+
 ## Group 3: plain counts, next
 
 9 `searched` calls pass a number (`text.length`, `result.scanned`,
@@ -169,6 +209,9 @@ on macOS is not the one CI reads.
 
 ## Side findings
 
+- **#465**: `scripts/release-inventory.mjs` selects a test as capturing only
+  through a bare `shoot(` call, so a spec capturing through a namespace
+  import would be left off the release page. No spec does today.
 - **#462**: 169 loops over a population known before the run sit inside a
   single test body, which one-test-per-case does not flag because they
   change no state. The operator decided on 2026-10-03 to widen the guard.
```


- [ ] **Step 2: Check it**

Run: `npx prettier --check docs/reviews/2026-10-03-guard-liveness-ledger.md && npx vitest run tests/unit`
Expected: clean, and the whole unit suite green (its guards read `.md`).

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/2026-10-03-guard-liveness-ledger.md
git commit -m "The ledger records Group 2b (Refs #446)"
```
