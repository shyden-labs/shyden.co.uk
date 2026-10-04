# Plan: floor cross-checks A, the meta-guards that read test code (#477)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Refs #477, part of #469 under the #446 guard audit.

**Goal:** every liveness floor in the six meta-guards that read test code
is checked against a second, independent reading of the same population,
per file, carrying no literal number.

**Architecture:** three shared readings, each with one home. Code with its
literals and comments removed (`codeWithoutLiterals`, `tests/unit/ast.ts`)
lets a text count stand beside an AST reader. Git's own list
(`committableFiles`, `walkDisagreements`, `specDirFilesGitHas`) stands
beside every walk. A line scan gets the parse tree's count through
`spec-scan`'s optional per-file `count`. Each guard compares, per file,
after its verdict and beside its ratcheted floor.

**Tech Stack:** TypeScript, vitest 5, the `typescript` compiler API, git.

**Spec:** `.superpowers/sdd/477/design.md` (measured on `7948355`), and the
ticket's acceptance criteria.

**Built from commits.** Each task below is `git show` of its commit on
`477-floor-cross-checks-meta`, fenced with `~~~~`. Each was written
test-first: where the code was new, its tests ran RED against a throwing
stub (none passed); where it was a fix, against the defect itself; each
task's note says which, and names the one check never seen RED before it
went in. Then GREEN, then `npm run floors:record` ran the whole suite and
every floor that moved was read against the diff, measured with
`.superpowers/sdd/477/count-bodies.mjs` for `duplication/declarations`.
A review pass applies every task's diff to `develop` at `7948355` and
refuses unless the result equals the branch tree, then runs every gate and
the matrix on that tree (see Review passes).

## Global Constraints

- A cross-check carries no literal number (#469 AC5): it counts the same population another way.
- Per unit wherever the units can be named: per file, not only as totals.
- Every floor stays a `floorBreach` id in `tests/floors.json`, after its verdict (#468).
- `searched(…)` sits at the call site, where `absence-liveness` reads it.
- No new npm dependency.
- A new file is `git add -N`'d before `npm run floors:record`.

## Review Focus

- A spelling no reader knows: each text count has hand-written plants, read and not read, never generated from a reader's list.
- A literal spelling a construct: `codeWithoutLiterals` blanks strings, templates (whole) and regexes from the parse tree before any count.
- A test file written before its `git add`: `committableFiles` includes untracked files, so it is no false red (matrix X4).
- A walk that drops a file from both sides of a per-file count: every such walk is checked against git (Task 6, matrix R8-R10, F6, F8, F10).
- A reader counting a unit that is not one: the presence check is an equality, not "at least" (Task 7, matrix X7, X8).

## Acceptance criteria to evidence

| AC | Evidence |
| --- | --- |
| 1 scope re-derived on develop's head | the ten ids in `tests/floors.json` at `7948355`, none added or gone (ledger) |
| 2 each guard read to its verdict, its cross-check by `file:line` | the ledger's table, before and now |
| 3 a number-free cross-check, per file | Tasks 1-7 |
| 4 a dataflow population says why | the ledger: the text reading turned out to equal the reader once two false units were removed (Task 7); the one form it cannot follow is named |
| 5 mutation-verified with the floor off; develop GREEN on one-lost-one-added | Mutation matrix below |
| 6 plan run to a clean pass; CI; merge; dev deploy | Review passes, Pass log; the PR |
| 7 control (c) in both CLAUDE.md files | Task 8; the global file is edited outside the repo |

## Task 1: absence-liveness counts each file's absences twice

`codeWithoutLiterals` first (8 tests RED against a throwing stub), then the per-file check (2 RED against a stub). The first full run showed the old raw-text check reading this commit's own fixture string as an absence, which is why the two land together. Measured 434 = 434 over 266 files.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 0a8e757..8b30aa3 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,5 +1,5 @@
 {
-  "absence-liveness/plain-files": 115,
+  "absence-liveness/plain-files": 117,
   "absence-liveness/sites": 434,
   "absence-liveness/ts-files": 266,
   "anchored-presence/scanned": 76,
@@ -12,8 +12,8 @@
   "deprecated-css/declarations": 1170,
   "device-tool-homes/files": 299,
   "download-readers/byte-reads": 8,
-  "duplicate-imports/imports": 1575,
-  "duplication/declarations": 5350,
+  "duplicate-imports/imports": 1574,
+  "duplication/declarations": 5357,
   "duplication/files": 343,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index f663098..013d264 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -1,10 +1,16 @@
 import { describe, it, expect } from 'vitest';
 import ts from 'typescript';
-import { readFileSync } from 'node:fs';
 import { floorBreach } from '../floors';
 import { filesUnder, searched } from '../source-files';
-import { withoutTsComments } from './source-text';
-import { bindFiles, callGraph, derivationOf, where } from './ast';
+import {
+  bindFiles,
+  callGraph,
+  codeWithoutLiterals,
+  derivationOf,
+  parseFile,
+  parseSource,
+  where,
+} from './ast';
 
 /**
  * An absence assertion must prove its POPULATION was live (#118).
@@ -219,20 +225,33 @@ function countsAPopulation(root: ts.Expression): boolean {
 }
 
 /**
- * An absence matcher as text, for the cross-check: no AST, so a reader blind
- * to one file or one spelling disagrees with it. A count held to 0 is read
- * only on a `.length` or `.size`, as `absenceSubject` reads it: on a bare
- * value it is plainly not an absence. A `.not` anywhere before the matcher
- * inverts it.
+ * An absence matcher as text, for the cross-check: no AST walk, so a reader
+ * blind to one file or one spelling disagrees with it. Matched in code with
+ * its literals and comments removed (`codeWithoutLiterals`), then with all
+ * whitespace and every trailing comma gone, so a matcher prettier split over
+ * lines reads as one. A count held to 0 is read only on a `.length` or
+ * `.size` written inside `expect(`, as `absenceSubject` reads it: on a bare
+ * value, or on arithmetic, it is plainly not an absence. A `.not` directly
+ * before the matcher inverts it.
  */
-const PLAIN_ABSENCE = new RegExp(
+const ABSENCE_TEXT = new RegExp(
   [
     String.raw`(?<!\.not)\.(?:toEqual|toStrictEqual)\(\[\]\)`,
     String.raw`(?<!\.not)\.toHaveLength\(0\)`,
-    String.raw`\.(?:length|size)\)\.(?:toBe|toEqual|toStrictEqual)\(0\)`,
+    String.raw`expect(?:\.soft)?\([\w$.()[\]]+?\.(?:length|size)(?:,"")?\)\.(?:toBe|toEqual|toStrictEqual)\(0\)`,
   ].join('|'),
+  'g',
 );
 
+/** How many absence matchers `sf` writes, counted as text (#477). */
+function absencesWritten(sf: ts.SourceFile): number {
+  const code = codeWithoutLiterals(sf)
+    .replace(/\s+/g, '')
+    .replace(/,\)/g, ')')
+    .replace(/,\]/g, ']');
+  return code.match(ABSENCE_TEXT)?.length ?? 0;
+}
+
 function scan() {
   const findings: string[] = [];
   const sites: string[] = [];
@@ -389,36 +408,64 @@ describe('absence assertions prove the population they searched', () => {
       'expect(g.length).toStrictEqual(0);',
       'expect.soft(l).toEqual([]);',
       'expect.soft(m.length).toBe(0);',
+      // Split by prettier, and with a message: the forms a line-by-line
+      // reading of raw text could not see (#477).
+      'expect(\n  n,\n).toEqual(\n  [],\n);',
+      'expect(o.length, "why").toBe(0);',
+      'expect(\n  p.size,\n  `why`,\n).toBe(0);',
+      'expect(q)\n  .toHaveLength(0);',
     ];
     const inverse = [
       'expect(h).not.toEqual([]);',
       'expect(i.length).not.toBe(0);',
       'expect(j.length).toBe(1);',
       'expect(k).toBe(0);',
+      'expect(r)\n  .not\n  .toHaveLength(0);',
+      // A value, not a population: the AST reads no subject here either.
+      'expect(s.length - t.length, "why").toBe(0);',
+      // A fixture that spells an absence holds none (#477).
+      "const u = 'expect(a).toEqual([])';",
+      'const v = `expect(${w}).toHaveLength(0)`;',
+      String.raw`const x = /expect\(y\)\.toEqual\(\[\]\)/;`,
+      '// expect(z).toEqual([]);',
     ];
-    const missed = read.filter((line) => !PLAIN_ABSENCE.test(line));
+    const missed = read.filter(
+      (line) => absencesWritten(parseSource(line)) !== 1,
+    );
     expect(searched(missed, { of: read, what: 'planted absences' })).toEqual(
       [],
     );
-    const misread = inverse.filter((line) => PLAIN_ABSENCE.test(line));
+    const misread = inverse.filter(
+      (line) => absencesWritten(parseSource(line)) !== 0,
+    );
     expect(
       searched(misread, { of: inverse, what: 'planted non-absences' }),
     ).toEqual([]);
   });
 
-  it('reads an absence in every file whose text plainly writes one', () => {
-    // Independent of the AST walk (#446, control c). The floor above catches
-    // a reader that goes blind everywhere; this catches one blind to a single
-    // file, or to the one spelling that file uses. Matched on the stripped
-    // text, so a comment naming the matcher cannot satisfy it.
-    const plain = tsFiles.filter((file) =>
-      PLAIN_ABSENCE.test(withoutTsComments(readFileSync(file, 'utf8'))),
+  it('reads as many absences in each file as its text writes', () => {
+    // Independent of the AST walk (#446, control c), and per unit (#477): a
+    // reader blind to one spelling in a file that writes two others was
+    // invisible to a file-level check. Counted in code with every literal
+    // and comment removed, so neither a fixture string nor a comment naming
+    // the matcher can satisfy it.
+    const written = new Map(
+      tsFiles.map((file) => [file, absencesWritten(parseFile(file))]),
     );
-    const unread = plain.filter((file) => !result.perFile.has(file));
-    expect(searched(unread, { of: plain, what: 'files' })).toEqual([]);
+    const disagree = tsFiles
+      .filter((file) => (result.perFile.get(file) ?? 0) !== written.get(file))
+      .map(
+        (file) =>
+          `${file}: the reader found ${result.perFile.get(file) ?? 0}, ` +
+          `its text writes ${written.get(file)}`,
+      );
+    expect(searched(disagree, { of: tsFiles, what: 'files' })).toEqual([]);
     // Ratcheted after the verdict (#468), so growth never hides a finding.
     expect(
-      floorBreach('absence-liveness/plain-files', plain.length),
+      floorBreach(
+        'absence-liveness/plain-files',
+        tsFiles.filter((file) => (written.get(file) ?? 0) > 0).length,
+      ),
     ).toBeUndefined();
   });
 
diff --git a/tests/unit/ast.test.ts b/tests/unit/ast.test.ts
index cd781a7..b6ef345 100644
--- a/tests/unit/ast.test.ts
+++ b/tests/unit/ast.test.ts
@@ -2,7 +2,14 @@ import { describe, it, expect } from 'vitest';
 import { writeFileSync } from 'node:fs';
 import { join } from 'node:path';
 import ts from 'typescript';
-import { bind, callGraph, derivationOf, type Bound } from './ast';
+import {
+  bind,
+  callGraph,
+  codeWithoutLiterals,
+  derivationOf,
+  parseSource,
+  type Bound,
+} from './ast';
 import { scratchDir } from '../scratch-dir';
 
 /**
@@ -456,3 +463,56 @@ describe('a parameter binds its name, like any other local (#277)', () => {
     expect(reached.reaches(user, 'lines')).toBe(false);
   });
 });
+
+describe('code without its literals is what a text cross-check reads (#477)', () => {
+  // A cross-check counting a construct in raw text is satisfied by a string,
+  // a template or a regex that spells it: the guards' own fixtures do. The
+  // parse tree, not a quote-tracking scanner, decides what a literal is.
+  const blanked = (source: string): string =>
+    codeWithoutLiterals(parseSource(source));
+
+  it('keeps code that is not a literal as it is written', () => {
+    expect(blanked('expect(a).toEqual([]);')).toBe('expect(a).toEqual([]);');
+  });
+
+  it('blanks a string literal that spells a matcher', () => {
+    expect(blanked("const s = 'expect(a).toEqual([])';")).toBe('const s = "";');
+  });
+
+  it('blanks a template with no substitution', () => {
+    expect(blanked('const s = `expect(a).toHaveLength(0)`;')).toBe(
+      'const s = "";',
+    );
+  });
+
+  it('blanks a template whole, its substitutions with it', () => {
+    expect(blanked('const s = `a ${"b"} ${c.toHaveLength(0)} d`; go();')).toBe(
+      'const s = ""; go();',
+    );
+  });
+
+  it('blanks a regular expression literal', () => {
+    expect(blanked(String.raw`const r = /\.toEqual\(\[\]\)/g;`)).toBe(
+      'const r = "";',
+    );
+  });
+
+  it('removes a comment that spells a matcher', () => {
+    const out = blanked('// expect(a).toEqual([])\nconst b = 1;');
+    expect(out).toContain('const b = 1;');
+    expect(out).not.toContain('toEqual');
+  });
+
+  it('keeps code after a string a scanner would read as a comment', () => {
+    expect(blanked("const s = '// x'; expect(b).toHaveLength(0);")).toBe(
+      'const s = ""; expect(b).toHaveLength(0);',
+    );
+  });
+
+  it('keeps code after a regex holding a quote', () => {
+    const out = blanked(`const r = /['"]/g; // gone\nexpect(c).toEqual([]);`);
+    expect(out).toContain('const r = "";');
+    expect(out).toContain('expect(c).toEqual([]);');
+    expect(out).not.toContain('gone');
+  });
+});
diff --git a/tests/unit/ast.ts b/tests/unit/ast.ts
index cc19564..8e9424e 100644
--- a/tests/unit/ast.ts
+++ b/tests/unit/ast.ts
@@ -1,6 +1,7 @@
 import ts from 'typescript';
 import { readFileSync } from 'node:fs';
 import { relative } from 'node:path';
+import { withoutTsComments } from './source-text';
 
 /**
  * The TypeScript-AST machinery the meta-guards share (#118).
@@ -621,3 +622,36 @@ export function stringTextsIn(sf: ts.SourceFile): string[] {
   visit(sf);
   return texts;
 }
+
+/**
+ * `sf`'s code with every literal replaced by `""` and every comment removed:
+ * what a text cross-check counts in, so that a fixture string, a template or
+ * a regex spelling the construct it counts cannot satisfy it (#477). The
+ * parse tree says what is a literal, outermost only, so a template is blanked
+ * whole with its substitutions; `withoutTsComments` then removes comments
+ * from text that holds no literal it could misread.
+ *
+ * The visitor returns nothing: `ts.forEachChild` stops at the first child
+ * whose callback returns a truthy value.
+ */
+export function codeWithoutLiterals(sf: ts.SourceFile): string {
+  const ranges: [number, number][] = [];
+  const visit = (node: ts.Node): void => {
+    if (
+      ts.isStringLiteral(node) ||
+      ts.isNoSubstitutionTemplateLiteral(node) ||
+      ts.isTemplateExpression(node) ||
+      ts.isRegularExpressionLiteral(node)
+    ) {
+      ranges.push([node.getStart(sf), node.end]);
+      return;
+    }
+    ts.forEachChild(node, visit);
+  };
+  visit(sf);
+  let code = sf.getFullText();
+  // End first, so each replacement leaves the earlier ranges where they were.
+  for (const [from, to] of ranges.reverse())
+    code = code.slice(0, from) + '""' + code.slice(to);
+  return withoutTsComments(code);
+}
~~~~

## Task 2: Every walk a meta-guard counts is checked against git

8 tests RED against throwing stubs; a ninth, the absence floor, RED because the five new verdicts grew it. `duplication.test.ts` caught the two identical walk checks, and a helper wrapping `searched` drew three absence-liveness findings, so `searched` stays at each call site and the pair carries a verdict with that measurement.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 8b30aa3..20d4bd2 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,6 +1,6 @@
 {
   "absence-liveness/plain-files": 117,
-  "absence-liveness/sites": 434,
+  "absence-liveness/sites": 439,
   "absence-liveness/ts-files": 266,
   "anchored-presence/scanned": 76,
   "anchored-presence/ts-files": 266,
@@ -12,8 +12,8 @@
   "deprecated-css/declarations": 1170,
   "device-tool-homes/files": 299,
   "download-readers/byte-reads": 8,
-  "duplicate-imports/imports": 1574,
-  "duplication/declarations": 5357,
+  "duplicate-imports/imports": 1576,
+  "duplication/declarations": 5369,
   "duplication/files": 343,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/source-files.ts b/tests/source-files.ts
index 9b60254..15c41cc 100644
--- a/tests/source-files.ts
+++ b/tests/source-files.ts
@@ -198,7 +198,32 @@ export function searched<T>(
  * file deleted in the working tree is tracked until the deletion is staged.
  */
 export function trackedFiles(keep: (path: string) => boolean): string[] {
-  const run = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
+  return gitListed([], keep, 'tracked files');
+}
+
+/**
+ * Every path git tracks, or would track at the next `git add -A`: tracked,
+ * plus untracked and not ignored. The list a walk is checked against (#477):
+ * a test file written before its `git add` is in it, so a TDD cycle is not
+ * red for the wrong reason, and `dist/` or a test report is not, so one
+ * machine's build output is not a finding on another.
+ */
+export function committableFiles(keep: (path: string) => boolean): string[] {
+  return gitListed(
+    ['--others', '--exclude-standard', '--cached'],
+    keep,
+    'committable files',
+  );
+}
+
+function gitListed(
+  options: readonly string[],
+  keep: (path: string) => boolean,
+  what: string,
+): string[] {
+  const run = spawnSync('git', ['ls-files', '-z', ...options], {
+    encoding: 'utf8',
+  });
   if (run.status !== 0)
     throw new Error(
       `git ls-files failed (${run.status}): ${run.error ?? run.stderr}`,
@@ -207,5 +232,30 @@ export function trackedFiles(keep: (path: string) => boolean): string[] {
     .split('\0')
     .filter((path) => keep(path) && existsSync(path))
     .sort();
-  return nonEmpty(paths, 'tracked files');
+  return nonEmpty(paths, what);
+}
+
+/**
+ * Where a walk and git's list of the same population disagree, one line per
+ * file, both directions (#477). Compared as sets: the walk's order and
+ * repeats are its own business.
+ */
+export function walkDisagreements(
+  walked: readonly string[],
+  known: readonly string[],
+): string[] {
+  const read = new Set(walked);
+  const listed = new Set(known);
+  return [
+    ...[...listed]
+      .filter((path) => !read.has(path))
+      .map((path) => `${path}: git has it, the walk did not read it`),
+    ...[...read]
+      .filter((path) => !listed.has(path))
+      .map((path) => `${path}: the walk read it, git does not have it`),
+  ];
 }
+
+/** A TypeScript file under `tests/`, as git spells its path. */
+export const isTsUnderTests = (path: string): boolean =>
+  path.startsWith('tests/') && path.endsWith('.ts');
diff --git a/tests/unit/absence-liveness.test.ts b/tests/unit/absence-liveness.test.ts
index 013d264..f4f277d 100644
--- a/tests/unit/absence-liveness.test.ts
+++ b/tests/unit/absence-liveness.test.ts
@@ -1,7 +1,13 @@
 import { describe, it, expect } from 'vitest';
 import ts from 'typescript';
 import { floorBreach } from '../floors';
-import { filesUnder, searched } from '../source-files';
+import {
+  committableFiles,
+  filesUnder,
+  isTsUnderTests,
+  searched,
+  walkDisagreements,
+} from '../source-files';
 import {
   bindFiles,
   callGraph,
@@ -315,6 +321,17 @@ describe('absence assertions prove the population they searched', () => {
     expect(result.proved).toBeGreaterThan(0);
   });
 
+  it('walks every .ts file git has under tests/', () => {
+    // Independent of the walk (#477): git's list, not the disk, so a walk
+    // that narrows (skips a directory, a suffix) names what it dropped.
+    expect(
+      searched(walkDisagreements(tsFiles, committableFiles(isTsUnderTests)), {
+        of: tsFiles,
+        what: 'files under tests/',
+      }),
+    ).toEqual([]);
+  });
+
   it('reads an absence however it is spelled, and never its inverse', () => {
     // Only `toEqual([])` and `toHaveLength(0)` were read, so an absence
     // written `expect(found.length).toBe(0)` over a file walk was never
diff --git a/tests/unit/anchored-presence.test.ts b/tests/unit/anchored-presence.test.ts
index 9e88e66..c5bb198 100644
--- a/tests/unit/anchored-presence.test.ts
+++ b/tests/unit/anchored-presence.test.ts
@@ -1,5 +1,11 @@
 import { describe, it, expect } from 'vitest';
-import { filesUnder, searched } from '../source-files';
+import {
+  committableFiles,
+  filesUnder,
+  isTsUnderTests,
+  searched,
+  walkDisagreements,
+} from '../source-files';
 import { bind, bindFiles, callGraph, type Closure } from './ast';
 import { scanPresence, type PresenceClosures } from './presence-detector';
 import { floorBreach } from '../floors';
@@ -304,6 +310,17 @@ describe('presence assertions over source text are stripped or anchored', () =>
     ).toBeUndefined();
   });
 
+  it('walks every .ts file git has under tests/', () => {
+    // Independent of the walk (#477): git's list, not the disk, so a walk
+    // that narrows (skips a directory, a suffix) names what it dropped.
+    expect(
+      searched(walkDisagreements(tsFiles, committableFiles(isTsUnderTests)), {
+        of: tsFiles,
+        what: 'files under tests/',
+      }),
+    ).toEqual([]);
+  });
+
   it('finds none reading raw source with an unanchored matcher', () => {
     expect(
       searched(result.findings, {
diff --git a/tests/unit/duplication.test.ts b/tests/unit/duplication.test.ts
index 71729da..68c06ee 100644
--- a/tests/unit/duplication.test.ts
+++ b/tests/unit/duplication.test.ts
@@ -62,6 +62,14 @@ const TEST_BODY_STAYS_IN_THE_SPEC =
   'outside `specDirs()`, where `viewport-tagging.test.ts` cannot read them ' +
   '-- measured: four untagged viewport tests, whole unit suite green.';
 
+const CROSS_CHECK_STAYS_IN_ITS_GUARD =
+  'Each guard checks its own walk against git beside the floor it ratchets ' +
+  '(#477), and these two guards walk one population. A helper that returns ' +
+  'the verdict hides `searched` from absence-liveness, which reads it only ' +
+  'at the call site -- measured: three findings "derives from the ' +
+  'filesystem". One shared walk would leave each guard checking a list it ' +
+  'no longer owns.';
+
 /**
  * Pairs read and deliberately left separate, each with the reason a reader
  * needs before deciding to collapse it after all.
@@ -71,6 +79,10 @@ const TEST_BODY_STAYS_IN_THE_SPEC =
  * code it excuses and quietly start excusing something else.
  */
 const SEPARATE: ReadonlyMap<string, string> = new Map([
+  [
+    'tests/unit/absence-liveness.test.ts:anonymous  <->  tests/unit/anchored-presence.test.ts:anonymous',
+    CROSS_CHECK_STAYS_IN_ITS_GUARD,
+  ],
   [
     'tests/e2e/classroom-groups-controls.spec.ts:anonymous  <->  tests/e2e/classroom-groups-roster.spec.ts:anonymous',
     TEST_BODY_STAYS_IN_THE_SPEC,
diff --git a/tests/unit/event-collectors.test.ts b/tests/unit/event-collectors.test.ts
index 23ac411..ffe527d 100644
--- a/tests/unit/event-collectors.test.ts
+++ b/tests/unit/event-collectors.test.ts
@@ -8,7 +8,13 @@ import {
   type Declaration,
 } from '../playwright-declarations';
 import { specDirs } from '../spec-dirs';
-import { searched, tsFilesUnder } from '../source-files';
+import { dirname } from 'node:path';
+import {
+  committableFiles,
+  searched,
+  tsFilesUnder,
+  walkDisagreements,
+} from '../source-files';
 import { parseSource } from './ast';
 import { withoutTsComments } from './source-text';
 import { floorBreach } from '../floors';
@@ -67,6 +73,27 @@ describe('browser-event collectors have exactly one home', () => {
     expect(SCANNED).toContain(RECORDERS);
   });
 
+  it('scans every file git has in a directory that holds a spec', () => {
+    // Independent of the walk (#477): spec directories and their files both
+    // derived from git's list, so a walk that drops a directory or a suffix
+    // names what it dropped.
+    const known = committableFiles(
+      (path) => path.startsWith('tests/') && /\.tsx?$/.test(path),
+    );
+    const dirs = new Set(
+      known.filter((path) => path.endsWith('.spec.ts')).map(dirname),
+    );
+    const inSpecDirs = known.filter((path) =>
+      [...dirs].some((dir) => path.startsWith(`${dir}/`)),
+    );
+    expect(
+      searched(walkDisagreements(SCANNED, inSpecDirs), {
+        of: SCANNED,
+        what: 'files in spec directories',
+      }),
+    ).toEqual([]);
+  });
+
   it('is subscribed to only in recorders.ts', () => {
     expect(
       SCANNED.filter((path) =>
diff --git a/tests/unit/source-files.test.ts b/tests/unit/source-files.test.ts
index 5897b7f..08a940d 100644
--- a/tests/unit/source-files.test.ts
+++ b/tests/unit/source-files.test.ts
@@ -1,5 +1,13 @@
 import { describe, expect, it } from 'vitest';
-import { filesUnder, nonEmpty, searched } from '../source-files';
+import { existsSync } from 'node:fs';
+import {
+  committableFiles,
+  filesUnder,
+  nonEmpty,
+  searched,
+  trackedFiles,
+  walkDisagreements,
+} from '../source-files';
 import { floorBreach } from '../floors';
 
 /**
@@ -158,3 +166,48 @@ describe('searched -- the population a finding list was drawn from', () => {
     );
   });
 });
+
+describe('committableFiles -- what git tracks or would (#477)', () => {
+  // The list a walk is checked against. Untracked files count, so a test
+  // file written before its `git add` is not a false red mid-cycle; ignored
+  // files do not, so a build output on one machine is not a finding.
+  it('holds every file git tracks', () => {
+    const tracked = trackedFiles((path) => path.startsWith('tests/'));
+    const listed = new Set(
+      committableFiles((path) => path.startsWith('tests/')),
+    );
+    const dropped = tracked.filter((path) => !listed.has(path));
+    expect(searched(dropped, { of: tracked, what: 'tracked files' })).toEqual(
+      [],
+    );
+  });
+
+  it('holds no file git ignores, though it is on disk', () => {
+    const ignored = 'node_modules/typescript/package.json';
+    expect(existsSync(ignored)).toBe(true);
+    const listed = committableFiles(
+      (path) => path === 'package.json' || path.startsWith('node_modules/'),
+    );
+    // The known positive: the same filter does list what git tracks.
+    expect(listed).toContain('package.json');
+    expect(listed).not.toContain(ignored);
+  });
+});
+
+describe('walkDisagreements -- a walk against the list git keeps (#477)', () => {
+  it('names a file git has and the walk missed', () => {
+    expect(walkDisagreements(['a.ts'], ['a.ts', 'b.ts'])).toEqual([
+      'b.ts: git has it, the walk did not read it',
+    ]);
+  });
+
+  it('names a file the walk read that git does not have', () => {
+    expect(walkDisagreements(['a.ts', 'c.ts'], ['a.ts'])).toEqual([
+      'c.ts: the walk read it, git does not have it',
+    ]);
+  });
+
+  it('names nothing when the two agree, in any order', () => {
+    expect(walkDisagreements(['b.ts', 'a.ts'], ['a.ts', 'b.ts'])).toEqual([]);
+  });
+});
~~~~

## Task 3: capture-after-assertion counts each file's captures twice

No stub: the refusal test went RED because nothing read `count` yet (no throw), then RED on its message, which truncated the list; the lines now go in the message.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 20d4bd2..99001c7 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,6 +1,6 @@
 {
   "absence-liveness/plain-files": 117,
-  "absence-liveness/sites": 439,
+  "absence-liveness/sites": 440,
   "absence-liveness/ts-files": 266,
   "anchored-presence/scanned": 76,
   "anchored-presence/ts-files": 266,
@@ -13,7 +13,7 @@
   "device-tool-homes/files": 299,
   "download-readers/byte-reads": 8,
   "duplicate-imports/imports": 1576,
-  "duplication/declarations": 5369,
+  "duplication/declarations": 5370,
   "duplication/files": 343,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/unit/capture-after-assertion.test.ts b/tests/unit/capture-after-assertion.test.ts
index 02e1b62..39548d7 100644
--- a/tests/unit/capture-after-assertion.test.ts
+++ b/tests/unit/capture-after-assertion.test.ts
@@ -3,7 +3,7 @@ import { describe, it, expect } from 'vitest';
 import { callsIn } from '../playwright-declarations';
 import { parseSource } from './ast';
 import { blankCommentLines } from './source-text';
-import { expectNothingFound, type Analyze } from './spec-scan';
+import { expectNothingFound, type Analyze, type Liveness } from './spec-scan';
 
 /**
  * An evidence capture belongs AFTER the assertion it documents (#261).
@@ -79,17 +79,24 @@ const capturesBeforeAssertion: Analyze = (file, source) => {
 };
 
 /**
- * True where the file calls `shoot`, read from the parse tree: independent of
- * the line scan above, so a scan gone blind to a capture's spelling is caught
- * by the file it judged none in (#446).
+ * How many times the file calls `shoot`, read from the parse tree:
+ * independent of the line scan above, so a scan gone blind to a capture's
+ * spelling is caught by the file it judged too few in (#446, per file #477).
  */
-const callsShoot = (file: string, source: string): boolean =>
-  callsIn(parseSource(source, file)).some(({ expression }) =>
+const shootCalls = (file: string, source: string): number =>
+  callsIn(parseSource(source, file)).filter(({ expression }) =>
     ts.isIdentifier(expression)
       ? expression.text === 'shoot'
       : ts.isPropertyAccessExpression(expression) &&
         expression.name.text === 'shoot',
-  );
+  ).length;
+
+const captures: Liveness = {
+  what: 'evidence captures',
+  floor: 'capture-after-assertion/captures',
+  carries: (file, source) => shootCalls(file, source) > 0,
+  count: shootCalls,
+};
 
 describe('capturesBeforeAssertion -- the scan proven on synthetic input', () => {
   const scan = (...lines: string[]) =>
@@ -170,10 +177,17 @@ describe('capturesBeforeAssertion -- the scan proven on synthetic input', () =>
 
 describe('an evidence capture documents an assertion that already passed', () => {
   it('never runs before the assertion it claims to document', () => {
-    expectNothingFound(capturesBeforeAssertion, {
-      what: 'evidence captures',
-      floor: 'capture-after-assertion/captures',
-      carries: callsShoot,
-    });
+    expectNothingFound(capturesBeforeAssertion, captures);
+  });
+
+  it('refuses a file where the scan and the tree count differently', () => {
+    // The per-file count's own liveness (#477): one capture more than the
+    // scan judged, in every file, as a scan blind to a spelling leaves it.
+    expect(() =>
+      expectNothingFound(capturesBeforeAssertion, {
+        ...captures,
+        count: (file, source) => shootCalls(file, source) + 1,
+      }),
+    ).toThrow(/\.spec\.ts: judged \d+, counted another way \d+/);
   });
 });
diff --git a/tests/unit/spec-scan.ts b/tests/unit/spec-scan.ts
index 849669d..9224a69 100644
--- a/tests/unit/spec-scan.ts
+++ b/tests/unit/spec-scan.ts
@@ -64,6 +64,13 @@ export type Liveness = {
    * a form the reader is blind to.
    */
   readonly carries: (file: string, source: string) => boolean;
+  /**
+   * The same file's units counted another way, where they can be. Given,
+   * every file's `judged` must number exactly this (#477): a reader blind to
+   * one unit in a file that holds two others still judges something there,
+   * which `carries` cannot see.
+   */
+  readonly count?: (file: string, source: string) => number;
 };
 
 /**
@@ -112,7 +119,29 @@ export const expectNothingFound = (
     }),
     `files holding ${liveness.what} where the reader judged none`,
   ).toEqual([]);
-  // After both verdicts, so a population that grew never hides a finding.
+  const { count } = liveness;
+  if (count) {
+    const disagree = readings
+      .map(({ file, source, judged }) => ({
+        file,
+        judged: judged.length,
+        counted: count(file, source),
+      }))
+      .filter(({ judged, counted }) => judged !== counted)
+      .map(
+        ({ file, judged, counted }) =>
+          `${file}: judged ${judged}, counted another way ${counted}`,
+      );
+    expect(
+      searched(disagree, {
+        of: readings,
+        what: 'files under the spec directories',
+      }),
+      `${liveness.what}, judged and counted another way, per file:\n` +
+        disagree.join('\n'),
+    ).toEqual([]);
+  }
+  // After every verdict, so a population that grew never hides a finding.
   expect(
     floorBreach(liveness.floor, judged.length),
     `${liveness.what}: not the recorded figure`,
~~~~

## Task 4: one-test-per-case counts each file's tests twice

12 forms planted to count, 9 not to, RED against a stub. The file-level check stays: it catches a form both readers miss.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 99001c7..1bd5059 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,6 +1,6 @@
 {
   "absence-liveness/plain-files": 117,
-  "absence-liveness/sites": 440,
+  "absence-liveness/sites": 443,
   "absence-liveness/ts-files": 266,
   "anchored-presence/scanned": 76,
   "anchored-presence/ts-files": 266,
@@ -12,8 +12,8 @@
   "deprecated-css/declarations": 1170,
   "device-tool-homes/files": 299,
   "download-readers/byte-reads": 8,
-  "duplicate-imports/imports": 1576,
-  "duplication/declarations": 5370,
+  "duplicate-imports/imports": 1577,
+  "duplication/declarations": 5374,
   "duplication/files": 343,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/playwright-declarations.ts b/tests/playwright-declarations.ts
index 6c0c477..ff63a47 100644
--- a/tests/playwright-declarations.ts
+++ b/tests/playwright-declarations.ts
@@ -1,4 +1,5 @@
 import ts from 'typescript';
+import { codeWithoutLiterals } from './unit/ast';
 import { withoutTsComments } from './unit/source-text';
 
 /**
@@ -240,6 +241,22 @@ const DECLARES_TESTS = /(?<![\w.])test(?:\.(?:only|skip|fixme|fail))*\s*\(/;
 export const declaresTests = (text: string): boolean =>
   DECLARES_TESTS.test(withoutTsComments(text));
 
+/**
+ * A test as text: `test(` or a `test.<modifier>(` form, then a title (blanked
+ * to `""`, or a name) and a body or details. A runtime `test.skip(cond, why)`
+ * passes no body, so it is not one.
+ */
+const WRITES_A_TEST =
+  /(?<![\w.$])test(?:\.(?:only|skip|fixme|fail))*\s*\(\s*(?:""|[A-Za-z_$][\w$.]*)\s*,\s*(?:async\b|function\b|\(|\{|[A-Za-z_$][\w$]*\s*=>)/g;
+
+/**
+ * How many tests `sf` writes, counted as text in its code with every literal
+ * and comment removed: the per-file cross-check on `declarationsIn`'s tests
+ * (#477), independent of the parse tree's reading of calls.
+ */
+export const testsWritten = (sf: ts.SourceFile): number =>
+  codeWithoutLiterals(sf).match(WRITES_A_TEST)?.length ?? 0;
+
 /** Every test and group `sf` declares, in source order. */
 export function declarationsIn(sf: ts.SourceFile): Declaration[] {
   return callsIn(sf).flatMap((call) => {
diff --git a/tests/unit/one-test-per-case.test.ts b/tests/unit/one-test-per-case.test.ts
index 05a8140..59506fc 100644
--- a/tests/unit/one-test-per-case.test.ts
+++ b/tests/unit/one-test-per-case.test.ts
@@ -9,7 +9,7 @@ import {
   testsRead,
   type LoopedCase,
 } from '../one-test-per-case';
-import { declaresTests } from '../playwright-declarations';
+import { declaresTests, testsWritten } from '../playwright-declarations';
 import { floorBreach } from '../floors';
 
 /**
@@ -244,6 +244,7 @@ const scan = (): {
   tests: string[];
   sites: string[];
   unread: string[];
+  miscounted: string[];
 } => {
   // Every TypeScript file in a directory that holds specs, not only the
   // `*.spec.ts` ones: the Android preflight (`*.setup.ts`) and the iOS
@@ -264,7 +265,17 @@ const scan = (): {
       declaresTests(readFileSync(file, 'utf8')) &&
       testsRead(parsed(file)).length === 0,
   );
-  return { specs, tests, sites, unread };
+  // Per file (#477): the reader's count against the text's, so a reader
+  // blind to one form in a file that writes two others is caught.
+  const miscounted = specs.flatMap((file) => {
+    const sf = parsed(file);
+    const read = testsRead(sf).length;
+    const written = testsWritten(sf);
+    return read === written
+      ? []
+      : [`${file}: read ${read} tests, its text writes ${written}`];
+  });
+  return { specs, tests, sites, unread, miscounted };
 };
 
 describe('the suite', () => {
@@ -283,13 +294,16 @@ describe('the suite', () => {
     // absence-liveness sat at 153 under a real 391 (#390 F161). And no spec
     // whose text declares a test may read as none: a reader blind to one
     // form (`test.fail.only` was) is caught by the file it missed.
-    const { tests, unread } = scan();
+    const { specs, tests, unread, miscounted } = scan();
     expect(
       searched(unread, {
         of: specDirs().flatMap(tsFilesUnder),
         what: 'files in spec directories',
       }),
     ).toEqual([]);
+    expect(
+      searched(miscounted, { of: specs, what: 'files in spec directories' }),
+    ).toEqual([]);
     // After the verdict, so a population that grew never hides a finding.
     expect(
       floorBreach('one-test-per-case/tests', tests.length),
diff --git a/tests/unit/playwright-declarations.test.ts b/tests/unit/playwright-declarations.test.ts
index f8d7b7a..97c9ea1 100644
--- a/tests/unit/playwright-declarations.test.ts
+++ b/tests/unit/playwright-declarations.test.ts
@@ -6,6 +6,7 @@ import {
   callsIn,
   declarationsIn,
   enclosingDeclaration,
+  testsWritten,
   useCallsIn,
 } from '../playwright-declarations';
 
@@ -289,6 +290,52 @@ describe('useCallsIn() reads what a test.use() sets', () => {
   });
 });
 
+describe('testsWritten() counts the tests a file writes, as text (#477)', () => {
+  // The per-file cross-check on the parse tree's reader. Written out by
+  // hand, never generated from a reader's list (#446).
+  const counted = [
+    "test('a', async ({ page }) => {});",
+    'test("a", () => {});',
+    'test(`a ${b}`, async () => {});',
+    'test(title, async () => {});',
+    "test('a', { tag: '@x' }, async () => {});",
+    "test('a', function () {});",
+    "test('a', page => {});",
+    "test.only('a', async () => {});",
+    "test.skip('a', async () => {});",
+    "test.fixme('a', async () => {});",
+    "test.fail.only('a', async () => {});",
+    "test(\n  'a',\n  async () => {},\n);",
+  ];
+  const notCounted = [
+    "test.skip(isMobile, 'a reason');",
+    "test.describe('g', () => {});",
+    'test.beforeEach(async ({ page }) => {});',
+    'test.use({ viewport: { width: 320, height: 640 } });',
+    "await test.step('s', async () => {});",
+    'const s = "test(\'a\', async () => {})";',
+    "// test('a', async () => {});",
+    "it('a', () => {});",
+    "latest('a', () => {});",
+  ];
+
+  it('counts every way a spec writes a test', () => {
+    const missed = counted.filter((line) => testsWritten(source(line)) !== 1);
+    expect(searched(missed, { of: counted, what: 'planted tests' })).toEqual(
+      [],
+    );
+  });
+
+  it('counts nothing that is not a test', () => {
+    const misread = notCounted.filter(
+      (line) => testsWritten(source(line)) !== 0,
+    );
+    expect(
+      searched(misread, { of: notCounted, what: 'planted non-tests' }),
+    ).toEqual([]);
+  });
+});
+
 describe('every declaration and test.use() in the spec corpus can be read', () => {
   it('no tag or use option is written in a form the guards would misread', () => {
     const files = specDirs().flatMap(tsFilesUnder);
~~~~

## Task 5: anchored-presence is checked against a text reading

14 forms planted, RED against a stub. Shipped here as a lower bound; Task 7 makes it an equality.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 1bd5059..4f06712 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,20 +1,21 @@
 {
   "absence-liveness/plain-files": 117,
-  "absence-liveness/sites": 443,
-  "absence-liveness/ts-files": 266,
+  "absence-liveness/sites": 444,
+  "absence-liveness/ts-files": 268,
   "anchored-presence/scanned": 76,
-  "anchored-presence/ts-files": 266,
+  "anchored-presence/text-sites": 74,
+  "anchored-presence/ts-files": 268,
   "back-translate/translated-id": 262,
   "back-translate/translated-th": 261,
   "back-translate/translated-vi": 261,
   "back-translate/translated-zh": 261,
   "capture-after-assertion/captures": 143,
   "deprecated-css/declarations": 1170,
-  "device-tool-homes/files": 299,
+  "device-tool-homes/files": 301,
   "download-readers/byte-reads": 8,
-  "duplicate-imports/imports": 1577,
-  "duplication/declarations": 5374,
-  "duplication/files": 343,
+  "duplicate-imports/imports": 1583,
+  "duplication/declarations": 5391,
+  "duplication/files": 345,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
   "evidence-recording/acting-specs": 26,
@@ -27,7 +28,7 @@
   "isolated-context-tagging/tests": 639,
   "literal-floors/sites": 198,
   "no-dated-render/views": 46,
-  "one-home/files": 299,
+  "one-home/files": 301,
   "one-test-per-case/tests": 639,
   "parked-tests/declarations": 772,
   "pipeline-wiring/dev-sanity-tests": 15,
@@ -44,7 +45,7 @@
   "route-coverage/gate-specs": 3,
   "script-entry/argv-reads": 10,
   "script-entry/load-time-statements": 320,
-  "shytalk-brand/files": 333,
+  "shytalk-brand/files": 335,
   "site-pages/pages": 3,
   "sitemap-config/locales": 5,
   "source-files/specs": 48,
@@ -54,5 +55,5 @@
   "tokens/dark-blocks": 2,
   "typecheck-scope/scripts": 30,
   "viewport-tagging/declarations": 772,
-  "wcag/files": 344
+  "wcag/files": 346
 }
diff --git a/tests/unit/anchored-presence.test.ts b/tests/unit/anchored-presence.test.ts
index c5bb198..b06e65f 100644
--- a/tests/unit/anchored-presence.test.ts
+++ b/tests/unit/anchored-presence.test.ts
@@ -6,7 +6,8 @@ import {
   searched,
   walkDisagreements,
 } from '../source-files';
-import { bind, bindFiles, callGraph, type Closure } from './ast';
+import { bind, bindFiles, callGraph, parseFile, type Closure } from './ast';
+import { presenceOverRawText } from './presence-text';
 import { scanPresence, type PresenceClosures } from './presence-detector';
 import { floorBreach } from '../floors';
 /**
@@ -201,6 +202,7 @@ describe('the detector counts only a real anchor (#183)', () => {
 
     expect(scanOf('fixture.test.ts', overRaw("toContain('foo')"))).toEqual({
       scanned: 1,
+      perFile: new Map([['fixture.test.ts', 1]]),
       findings: [expect.stringMatching(/^fixture\.test\.ts:2 /)],
     });
     expect(scanOf('helper.ts', overRaw("toContain('foo')")).scanned).toBe(0);
@@ -263,6 +265,7 @@ describe('the detector exempts a read only where JSON.parse stands between it an
       scanPresence(bind(new Map([['fixture.test.ts', source]])), closures),
     ).toEqual({
       scanned: 1,
+      perFile: new Map([['fixture.test.ts', 1]]),
       findings: [expect.stringMatching(/^fixture\.test\.ts:8 /)],
     });
   });
@@ -321,6 +324,38 @@ describe('presence assertions over source text are stripped or anchored', () =>
     ).toEqual([]);
   });
 
+  it('scans every presence its text plainly writes over raw file text', () => {
+    // Independent of the dataflow reader (#477): per file, the reader judged
+    // at least what plain text shows, so one blind to a form judges fewer
+    // there than the text counts. A lower bound only: the text follows no
+    // import, so the two read through helpers source-text.ts exports
+    // (browser-matrix.test.ts, source-text.test.ts) are the reader's alone.
+    const testFiles = tsFiles.filter((file) => /\.(test|spec)\.ts$/.test(file));
+    const written = new Map(
+      testFiles.map((file) => [file, presenceOverRawText(parseFile(file))]),
+    );
+    const underRead = testFiles
+      .filter(
+        (file) => (written.get(file) ?? 0) > (result.perFile.get(file) ?? 0),
+      )
+      .map(
+        (file) =>
+          `${file}: the reader judged ${result.perFile.get(file) ?? 0}, ` +
+          `its text plainly writes ${written.get(file)}`,
+      );
+    expect(searched(underRead, { of: testFiles, what: 'test files' })).toEqual(
+      [],
+    );
+    // Ratcheted after the verdict (#468): without it, "at least" holds
+    // trivially once the text reading goes blind.
+    expect(
+      floorBreach(
+        'anchored-presence/text-sites',
+        [...written.values()].reduce((sum, n) => sum + n, 0),
+      ),
+    ).toBeUndefined();
+  });
+
   it('finds none reading raw source with an unanchored matcher', () => {
     expect(
       searched(result.findings, {
diff --git a/tests/unit/presence-detector.ts b/tests/unit/presence-detector.ts
index 853538a..82ed562 100644
--- a/tests/unit/presence-detector.ts
+++ b/tests/unit/presence-detector.ts
@@ -39,6 +39,8 @@ export interface PresenceClosures {
 
 export interface PresenceScan {
   readonly scanned: number;
+  /** `scanned`, per file, for a cross-check that counts per file (#477). */
+  readonly perFile: ReadonlyMap<string, number>;
   readonly findings: readonly string[];
 }
 
@@ -103,6 +105,7 @@ export function scanPresence(
 ): PresenceScan {
   const findings: string[] = [];
   let scanned = 0;
+  const perFile = new Map<string, number>();
   for (const [file, sf] of bound.files) {
     if (!/\.(test|spec)\.ts$/.test(file)) continue;
 
@@ -133,6 +136,7 @@ export function scanPresence(
             const readsRaw = opaque.some((n) => readers.reaches(file, n));
             if (readsRaw) {
               scanned += 1;
+              perFile.set(file, (perFile.get(file) ?? 0) + 1);
               const arg = node.arguments[0];
               const anchored =
                 arg !== undefined &&
@@ -156,5 +160,5 @@ export function scanPresence(
     };
     check(sf);
   }
-  return { scanned, findings };
+  return { scanned, perFile, findings };
 }
diff --git a/tests/unit/presence-text.test.ts b/tests/unit/presence-text.test.ts
new file mode 100644
index 0000000..108353d
--- /dev/null
+++ b/tests/unit/presence-text.test.ts
@@ -0,0 +1,126 @@
+import { describe, expect, it } from 'vitest';
+import { parseSource } from './ast';
+import { presenceOverRawText } from './presence-text';
+
+/**
+ * The text reading anchored-presence's dataflow reader is checked against
+ * (#477). Each form is written out by hand, never generated from either
+ * reader's list (#446).
+ */
+const count = (...lines: string[]): number =>
+  presenceOverRawText(parseSource(lines.join('\n'), 'fixture.test.ts'));
+
+describe('presenceOverRawText counts, as text, presence over raw file text (#477)', () => {
+  it('counts one whose subject reads the file in place', () => {
+    expect(count("expect(readFileSync('a', 'utf8')).toContain('x');")).toBe(1);
+  });
+
+  it('counts toMatch as toContain', () => {
+    expect(count("expect(readFileSync('a', 'utf8')).toMatch(/x/);")).toBe(1);
+  });
+
+  it('counts expect.soft as expect', () => {
+    expect(
+      count("expect.soft(readFileSync('a', 'utf8')).toContain('x');"),
+    ).toBe(1);
+  });
+
+  it('reads an assertion prettier split over lines', () => {
+    expect(
+      count('expect(', "  readFileSync('a', 'utf8'),", ").toContain('x');"),
+    ).toBe(1);
+  });
+
+  it('follows a binding that reads the file', () => {
+    expect(
+      count(
+        "const text = readFileSync('a', 'utf8');",
+        "expect(text).toContain('x');",
+      ),
+    ).toBe(1);
+  });
+
+  it('follows a function whose body reads it', () => {
+    expect(
+      count(
+        "function read(path: string) { return readFileSync(path, 'utf8'); }",
+        "expect(read('a')).toContain('x');",
+      ),
+    ).toBe(1);
+  });
+
+  it('follows bindings to a fixed point', () => {
+    expect(
+      count(
+        "const lines = raw.split('\\n');",
+        "const raw = readFileSync('a', 'utf8');",
+        "expect(lines).toContain('x');",
+      ),
+    ).toBe(1);
+  });
+
+  it('sees a binding the enclosing describe makes', () => {
+    expect(
+      count(
+        "describe('d', () => {",
+        "  const text = readFileSync('a', 'utf8');",
+        "  it('b', () => {",
+        "    expect(text).toContain('x');",
+        '  });',
+        '});',
+      ),
+    ).toBe(1);
+  });
+
+  it('counts none through a JSON.parse', () => {
+    expect(
+      count(
+        "const data = JSON.parse(readFileSync('a', 'utf8'));",
+        "expect(data.keys).toContain('x');",
+      ),
+    ).toBe(0);
+  });
+
+  it('does not see a binding another test makes', () => {
+    expect(
+      count(
+        "it('a', () => {",
+        "  const text = readFileSync('a', 'utf8');",
+        '});',
+        "it('b', () => {",
+        "  expect(text).toContain('x');",
+        '});',
+      ),
+    ).toBe(0);
+  });
+
+  it('counts no inverse', () => {
+    expect(count("expect(readFileSync('a', 'utf8')).not.toContain('x');")).toBe(
+      0,
+    );
+  });
+
+  it('counts none over a value read some other way', () => {
+    expect(count("expect(page.url()).toContain('x');")).toBe(0);
+  });
+
+  it('takes neither a longer name nor a property for a binding', () => {
+    expect(
+      count(
+        "const text = readFileSync('a', 'utf8');",
+        "expect(context).toContain('x');",
+        "expect(page.text).toContain('x');",
+      ),
+    ).toBe(0);
+  });
+
+  it('counts none a string, a template or a comment spells', () => {
+    expect(
+      count(
+        "const s = \"expect(readFileSync('a')).toContain('x')\";",
+        "const t = `expect(${readFileSync('a')}).toContain('x')`;",
+        "// expect(readFileSync('a')).toContain('x');",
+      ),
+    ).toBe(0);
+  });
+});
diff --git a/tests/unit/presence-text.ts b/tests/unit/presence-text.ts
new file mode 100644
index 0000000..e1595d6
--- /dev/null
+++ b/tests/unit/presence-text.ts
@@ -0,0 +1,148 @@
+import ts from 'typescript';
+import { codeWithoutLiterals } from './ast';
+
+/**
+ * Presence assertions over raw file text, counted as TEXT (#477).
+ *
+ * `scanPresence` finds them by dataflow: a `toContain`/`toMatch` whose
+ * subject derives, through the program's bindings and its call graph, from a
+ * `readFileSync` no `JSON.parse` stands on. This reads the same thing with
+ * none of that machinery, so anchored-presence can check, per file, that its
+ * reader judged at least what plain text shows: a reader blind to one form
+ * judges fewer in that file than this counts.
+ *
+ * It is a lower bound, never the population. It follows bindings only inside
+ * one file, and only `const`/`let`/`var` and `function` declarations, each
+ * visible in the innermost `describe`/`it`/`test` callback that makes it, or
+ * the module. A subject read through a helper another file exports is the
+ * reader's alone to see (anchored-presence says which, by name).
+ *
+ * Read in code with every literal and comment removed (`codeWithoutLiterals`),
+ * so a bracket inside a string never unbalances the walk below, and a fixture
+ * spelling an assertion is not one.
+ */
+export function presenceOverRawText(sf: ts.SourceFile): number {
+  const code = codeWithoutLiterals(sf);
+
+  const scopes: Span[] = [[0, code.length]];
+  for (const match of code.matchAll(SCOPE)) {
+    const open = match.index + match[0].length - 1;
+    const close = partner(code, open);
+    if (close > 0) scopes.push([open, close]);
+  }
+  const innermost = (at: number): Span =>
+    scopes
+      .filter(([from, to]) => from <= at && at <= to)
+      .reduce((a, b) => (b[1] - b[0] < a[1] - a[0] ? b : a));
+
+  const bindings: Binding[] = [];
+  for (const match of code.matchAll(DECLARED)) {
+    const from = match.index + match[0].length;
+    bindings.push({
+      name: match[1],
+      at: match.index,
+      made: code.slice(from, statementEnd(code, from)),
+      scope: innermost(match.index),
+    });
+  }
+  for (const match of code.matchAll(FUNCTION)) {
+    const open = code.indexOf('{', match.index);
+    bindings.push({
+      name: match[1],
+      at: match.index,
+      made: code.slice(open, partner(code, open) + 1),
+      scope: innermost(match.index),
+    });
+  }
+
+  const raw = new Set<Binding>();
+  const readsRaw = (text: string, at: number): boolean =>
+    !text.includes('JSON.parse(') &&
+    (text.includes('readFileSync(') ||
+      bindings.some(
+        (binding) =>
+          raw.has(binding) &&
+          binding.scope[0] <= at &&
+          at <= binding.scope[1] &&
+          names(text, binding.name),
+      ));
+  // To a fixed point: a binding may name one declared below it.
+  for (let grew = true; grew;) {
+    grew = false;
+    for (const binding of bindings)
+      if (!raw.has(binding) && readsRaw(binding.made, binding.at)) {
+        raw.add(binding);
+        grew = true;
+      }
+  }
+
+  let count = 0;
+  for (const match of code.matchAll(ASSERTED)) {
+    const open = match.index + match[0].length - 1;
+    const close = partner(code, open);
+    if (close < 0 || !PRESENCE.test(code.slice(close + 1))) continue;
+    if (readsRaw(firstArgument(code.slice(open + 1, close)), match.index))
+      count += 1;
+  }
+  return count;
+}
+
+type Span = readonly [number, number];
+
+interface Binding {
+  readonly name: string;
+  /** Where the declaration starts. */
+  readonly at: number;
+  /** What it is made of: an initializer, or a function's body. */
+  readonly made: string;
+  readonly scope: Span;
+}
+
+/** A callback scope a binding can be shared across. */
+const SCOPE = /\b(?:describe|it|test)(?:\.[A-Za-z]+)*\(/g;
+const DECLARED = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*/g;
+const FUNCTION = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
+const ASSERTED = /\bexpect(?:\.soft)?\(/g;
+/** The matcher directly after `expect(…)`: a `.not` between is an inverse. */
+const PRESENCE = /^\s*\.(?:toContain|toMatch)\(/;
+
+/** Whether `text` refers to `name`: not part of a longer name, nor a property. */
+const names = (text: string, name: string): boolean =>
+  new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text);
+
+/** From the opening bracket at `open`, the index of its partner, or -1. */
+function partner(code: string, open: number): number {
+  let depth = 0;
+  for (let i = open; i < code.length; i += 1) {
+    if ('([{'.includes(code[i])) depth += 1;
+    else if (')]}'.includes(code[i])) {
+      depth -= 1;
+      if (depth === 0) return i;
+    }
+  }
+  return -1;
+}
+
+/** `inner` up to its first comma outside brackets. */
+function firstArgument(inner: string): string {
+  let depth = 0;
+  for (let i = 0; i < inner.length; i += 1) {
+    if ('([{'.includes(inner[i])) depth += 1;
+    else if (')]}'.includes(inner[i])) depth -= 1;
+    else if (inner[i] === ',' && depth === 0) return inner.slice(0, i);
+  }
+  return inner;
+}
+
+/** Where a statement starting at `from` ends: `;` at its depth, or a close. */
+function statementEnd(code: string, from: number): number {
+  let depth = 0;
+  for (let i = from; i < code.length; i += 1) {
+    if ('([{'.includes(code[i])) depth += 1;
+    else if (')]}'.includes(code[i])) {
+      depth -= 1;
+      if (depth < 0) return i;
+    } else if (code[i] === ';' && depth === 0) return i;
+  }
+  return code.length;
+}
~~~~

## Task 6: Every walk a per-file cross-check counts over is checked against git

Found while planning the matrix: AC5's narrowed walk could not go RED for captures or tests, since their per-file counts run over the walk itself. `specDirFilesGitHas`'s two tests and the spec-scan and one-test-per-case walk checks ran RED against a throwing stub; literal-floors' walk check calls `committableFiles` directly and was never seen RED before it went in, so matrix rows R10 and F10 are its proof.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 4f06712..89ae1df 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,6 +1,6 @@
 {
   "absence-liveness/plain-files": 117,
-  "absence-liveness/sites": 444,
+  "absence-liveness/sites": 447,
   "absence-liveness/ts-files": 268,
   "anchored-presence/scanned": 76,
   "anchored-presence/text-sites": 74,
@@ -13,8 +13,8 @@
   "deprecated-css/declarations": 1170,
   "device-tool-homes/files": 301,
   "download-readers/byte-reads": 8,
-  "duplicate-imports/imports": 1583,
-  "duplication/declarations": 5391,
+  "duplicate-imports/imports": 1582,
+  "duplication/declarations": 5395,
   "duplication/files": 345,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/spec-dirs.ts b/tests/spec-dirs.ts
index d5edb76..72e48eb 100644
--- a/tests/spec-dirs.ts
+++ b/tests/spec-dirs.ts
@@ -1,5 +1,5 @@
 import { dirname } from 'node:path';
-import { specFilesUnder } from './source-files';
+import { committableFiles, specFilesUnder } from './source-files';
 
 const TESTS_DIR = 'tests';
 
@@ -16,3 +16,20 @@ const TESTS_DIR = 'tests';
  */
 export const specDirs = (): string[] =>
   [...new Set(specFilesUnder(TESTS_DIR).map((path) => dirname(path)))].sort();
+
+/**
+ * Every TypeScript file git has in a directory that holds a spec, the
+ * directories read from git's list as well: what
+ * `specDirs().flatMap(tsFilesUnder)` walks, read without the disk walk, so a
+ * guard can check its walk against it (#477). Untracked files count, as in
+ * `committableFiles`.
+ */
+export const specDirFilesGitHas = (): string[] => {
+  const known = committableFiles(
+    (path) => path.startsWith(`${TESTS_DIR}/`) && /\.tsx?$/.test(path),
+  );
+  const dirs = [
+    ...new Set(known.filter((path) => path.endsWith('.spec.ts')).map(dirname)),
+  ];
+  return known.filter((path) => dirs.some((dir) => path.startsWith(`${dir}/`)));
+};
diff --git a/tests/unit/event-collectors.test.ts b/tests/unit/event-collectors.test.ts
index ffe527d..1443328 100644
--- a/tests/unit/event-collectors.test.ts
+++ b/tests/unit/event-collectors.test.ts
@@ -7,14 +7,8 @@ import {
   enclosingDeclaration,
   type Declaration,
 } from '../playwright-declarations';
-import { specDirs } from '../spec-dirs';
-import { dirname } from 'node:path';
-import {
-  committableFiles,
-  searched,
-  tsFilesUnder,
-  walkDisagreements,
-} from '../source-files';
+import { specDirFilesGitHas, specDirs } from '../spec-dirs';
+import { searched, tsFilesUnder, walkDisagreements } from '../source-files';
 import { parseSource } from './ast';
 import { withoutTsComments } from './source-text';
 import { floorBreach } from '../floors';
@@ -77,17 +71,8 @@ describe('browser-event collectors have exactly one home', () => {
     // Independent of the walk (#477): spec directories and their files both
     // derived from git's list, so a walk that drops a directory or a suffix
     // names what it dropped.
-    const known = committableFiles(
-      (path) => path.startsWith('tests/') && /\.tsx?$/.test(path),
-    );
-    const dirs = new Set(
-      known.filter((path) => path.endsWith('.spec.ts')).map(dirname),
-    );
-    const inSpecDirs = known.filter((path) =>
-      [...dirs].some((dir) => path.startsWith(`${dir}/`)),
-    );
     expect(
-      searched(walkDisagreements(SCANNED, inSpecDirs), {
+      searched(walkDisagreements(SCANNED, specDirFilesGitHas()), {
         of: SCANNED,
         what: 'files in spec directories',
       }),
diff --git a/tests/unit/literal-floors.test.ts b/tests/unit/literal-floors.test.ts
index 2a07291..4c42936 100644
--- a/tests/unit/literal-floors.test.ts
+++ b/tests/unit/literal-floors.test.ts
@@ -3,7 +3,12 @@ import { readFileSync } from 'node:fs';
 import ts from 'typescript';
 import { floorBreach, readFloors } from '../floors';
 import { floorSitesIn } from '../literal-floors';
-import { searched, tsFilesUnder } from '../source-files';
+import {
+  committableFiles,
+  searched,
+  tsFilesUnder,
+  walkDisagreements,
+} from '../source-files';
 import { parseFile, parseSource, stringTextsIn } from './ast';
 import { withoutTsComments } from './source-text';
 
@@ -339,6 +344,20 @@ describe('the floor reader proves what it read (#468)', () => {
     ).toEqual([]);
   });
 
+  it('reads every TypeScript file git has under tests/', () => {
+    // Its per-file cross-check counts over this walk, so the walk is checked
+    // against git's own list (#477).
+    const known = committableFiles(
+      (path) => path.startsWith('tests/') && /\.tsx?$/.test(path),
+    );
+    expect(
+      searched(walkDisagreements(FILES, known), {
+        of: FILES,
+        what: 'files under tests/',
+      }),
+    ).toEqual([]);
+  });
+
   it('refuses nothing it could not classify', () => {
     const refused = READINGS.flatMap(({ refused }) => refused);
     expect(
diff --git a/tests/unit/one-test-per-case.test.ts b/tests/unit/one-test-per-case.test.ts
index 59506fc..6e9c3df 100644
--- a/tests/unit/one-test-per-case.test.ts
+++ b/tests/unit/one-test-per-case.test.ts
@@ -1,8 +1,13 @@
 import { describe, expect, it } from 'vitest';
 import { readFileSync } from 'node:fs';
 import { parseSource } from './ast';
-import { filesUnder, searched, tsFilesUnder } from '../source-files';
-import { specDirs } from '../spec-dirs';
+import {
+  filesUnder,
+  searched,
+  tsFilesUnder,
+  walkDisagreements,
+} from '../source-files';
+import { specDirFilesGitHas, specDirs } from '../spec-dirs';
 import {
   loopedCases,
   statefulHelpers,
@@ -304,6 +309,14 @@ describe('the suite', () => {
     expect(
       searched(miscounted, { of: specs, what: 'files in spec directories' }),
     ).toEqual([]);
+    // Both checks above count over the walk, so it is checked against git's
+    // own list too (#477): a walk that drops a file drops it from both sides.
+    expect(
+      searched(walkDisagreements(specs, specDirFilesGitHas()), {
+        of: specs,
+        what: 'files in spec directories',
+      }),
+    ).toEqual([]);
     // After the verdict, so a population that grew never hides a finding.
     expect(
       floorBreach('one-test-per-case/tests', tests.length),
diff --git a/tests/unit/spec-dirs.test.ts b/tests/unit/spec-dirs.test.ts
index e335c2a..3ede659 100644
--- a/tests/unit/spec-dirs.test.ts
+++ b/tests/unit/spec-dirs.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { specDirs } from '../spec-dirs';
+import { specDirFilesGitHas, specDirs } from '../spec-dirs';
 import { floorBreach } from '../floors';
 
 describe('the directories guards scan are derived, not listed', () => {
@@ -23,3 +23,15 @@ describe('the directories guards scan are derived, not listed', () => {
     expect(specDirs()).not.toContain('tests/unit');
   });
 });
+
+describe('specDirFilesGitHas -- the spec directories, read from git (#477)', () => {
+  it('holds a spec and a helper beside it', () => {
+    const files = specDirFilesGitHas();
+    expect(files).toContain('tests/e2e/classroom-groups.spec.ts');
+    expect(files).toContain('tests/e2e/recorders.ts');
+  });
+
+  it('holds nothing from a directory with no spec', () => {
+    expect(specDirFilesGitHas()).not.toContain('tests/unit/ast.ts');
+  });
+});
diff --git a/tests/unit/spec-scan.ts b/tests/unit/spec-scan.ts
index 9224a69..068a248 100644
--- a/tests/unit/spec-scan.ts
+++ b/tests/unit/spec-scan.ts
@@ -1,9 +1,9 @@
 import { readFileSync } from 'node:fs';
 import { expect } from 'vitest';
-import { specDirs } from '../spec-dirs';
+import { specDirFilesGitHas, specDirs } from '../spec-dirs';
 import { declaresTests } from '../playwright-declarations';
 import { floorBreach } from '../floors';
-import { searched, tsFilesUnder } from '../source-files';
+import { searched, tsFilesUnder, walkDisagreements } from '../source-files';
 
 /**
  * The body every source-scanning guard in this repo ends with, once (#277).
@@ -119,6 +119,18 @@ export const expectNothingFound = (
     }),
     `files holding ${liveness.what} where the reader judged none`,
   ).toEqual([]);
+  // The walk against git's list (#477): the per-file checks above are
+  // computed over the walk, so a walk that dropped a file drops it from
+  // both sides of them.
+  expect(
+    searched(
+      walkDisagreements(
+        readings.map(({ file }) => file),
+        specDirFilesGitHas(),
+      ),
+      { of: readings, what: 'files under the spec directories' },
+    ),
+  ).toEqual([]);
   const { count } = liveness;
   if (count) {
     const disagree = readings
~~~~

## Task 7: anchored-presence counted two reads that are not reads

RED against the defect, not a stub: five call-graph fixtures, four RED before the fix (the fifth is the positive control, GREEN throughout). Every site both meta-guards judge was logged before and after: only the two false units left.

~~~~diff
diff --git a/tests/floors.json b/tests/floors.json
index 89ae1df..a724afb 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -2,8 +2,7 @@
   "absence-liveness/plain-files": 117,
   "absence-liveness/sites": 447,
   "absence-liveness/ts-files": 268,
-  "anchored-presence/scanned": 76,
-  "anchored-presence/text-sites": 74,
+  "anchored-presence/scanned": 74,
   "anchored-presence/ts-files": 268,
   "back-translate/translated-id": 262,
   "back-translate/translated-th": 261,
@@ -14,7 +13,7 @@
   "device-tool-homes/files": 301,
   "download-readers/byte-reads": 8,
   "duplicate-imports/imports": 1582,
-  "duplication/declarations": 5395,
+  "duplication/declarations": 5399,
   "duplication/files": 345,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/unit/anchored-presence.test.ts b/tests/unit/anchored-presence.test.ts
index b06e65f..2df128f 100644
--- a/tests/unit/anchored-presence.test.ts
+++ b/tests/unit/anchored-presence.test.ts
@@ -324,36 +324,29 @@ describe('presence assertions over source text are stripped or anchored', () =>
     ).toEqual([]);
   });
 
-  it('scans every presence its text plainly writes over raw file text', () => {
+  it('scans, in each file, the presence its text writes over raw file text', () => {
     // Independent of the dataflow reader (#477): per file, the reader judged
-    // at least what plain text shows, so one blind to a form judges fewer
-    // there than the text counts. A lower bound only: the text follows no
-    // import, so the two read through helpers source-text.ts exports
-    // (browser-matrix.test.ts, source-text.test.ts) are the reader's alone.
+    // exactly what a text reading counts. Fewer is a reader blind to a form;
+    // more is a reader counting a read that is not one, which is how two
+    // names resolved across modules by bare name were found (a `config` from
+    // playwright.config.ts, a destructured `source`). The text follows no
+    // import, so a subject read through an imported helper would disagree
+    // here by name: then the text reading learns to follow imports.
     const testFiles = tsFiles.filter((file) => /\.(test|spec)\.ts$/.test(file));
-    const written = new Map(
-      testFiles.map((file) => [file, presenceOverRawText(parseFile(file))]),
-    );
-    const underRead = testFiles
-      .filter(
-        (file) => (written.get(file) ?? 0) > (result.perFile.get(file) ?? 0),
-      )
+    const disagree = testFiles
+      .map((file) => ({
+        file,
+        judged: result.perFile.get(file) ?? 0,
+        written: presenceOverRawText(parseFile(file)),
+      }))
+      .filter(({ judged, written }) => judged !== written)
       .map(
-        (file) =>
-          `${file}: the reader judged ${result.perFile.get(file) ?? 0}, ` +
-          `its text plainly writes ${written.get(file)}`,
+        ({ file, judged, written }) =>
+          `${file}: the reader judged ${judged}, its text writes ${written}`,
       );
-    expect(searched(underRead, { of: testFiles, what: 'test files' })).toEqual(
+    expect(searched(disagree, { of: testFiles, what: 'test files' })).toEqual(
       [],
     );
-    // Ratcheted after the verdict (#468): without it, "at least" holds
-    // trivially once the text reading goes blind.
-    expect(
-      floorBreach(
-        'anchored-presence/text-sites',
-        [...written.values()].reduce((sum, n) => sum + n, 0),
-      ),
-    ).toBeUndefined();
   });
 
   it('finds none reading raw source with an unanchored matcher', () => {
diff --git a/tests/unit/ast.test.ts b/tests/unit/ast.test.ts
index b6ef345..93cc10e 100644
--- a/tests/unit/ast.test.ts
+++ b/tests/unit/ast.test.ts
@@ -464,6 +464,84 @@ describe('a parameter binds its name, like any other local (#277)', () => {
   });
 });
 
+describe('a name resolves through the import that binds it, or the binding that makes it (#477)', () => {
+  /**
+   * `anchored-presence` counted two assertions over raw file text that read
+   * none, found by #477's text reading of the same population: a `config`
+   * imported from `playwright.config.ts`, outside the graph, and a `source`
+   * destructured in a `for...of` over string literals. Neither is declared
+   * locally, so each fell through to the union of every same-named function
+   * in the suite, and some `config` and some `source` there read a file.
+   */
+  const corpus = () => {
+    const dir = scratchDir('ast-import-');
+    const file = (name: string, text: string) => {
+      const path = join(dir, name);
+      writeFileSync(path, text);
+      return path;
+    };
+    return {
+      reader: file(
+        'reader.ts',
+        "export const load = (f: string) => readFileSync(f, 'utf8');\n" +
+          "export function config() { return readFileSync('c', 'utf8'); }\n" +
+          "export function source() { return readFileSync('s', 'utf8'); }\n",
+      ),
+      pure: file('pure.ts', 'export const load = (s: string) => s.trim();\n'),
+      fromReader: file(
+        'from-reader.ts',
+        "import { load } from './reader';\nexport const a = load('x');\n",
+      ),
+      fromPure: file(
+        'from-pure.ts',
+        "import { load } from './pure';\nexport const b = load('x');\n",
+      ),
+      aliased: file(
+        'aliased.ts',
+        "import { load as fetchText } from './reader';\nexport const c = fetchText('x');\n",
+      ),
+      outside: file(
+        'outside.ts',
+        "import config from '../not-in-the-graph';\nexport const d = config.x;\n",
+      ),
+      destructured: file(
+        'destructured.ts',
+        "for (const [source] of [['a']]) use(source);\n",
+      ),
+    };
+  };
+  const reached = (files: Record<string, string>) =>
+    callGraph(Object.values(files)).close(new Set(['readFileSync']));
+
+  it('follows an import to the module it names', () => {
+    const files = corpus();
+    expect(reached(files).reaches(files.fromReader, 'load')).toBe(true);
+  });
+
+  it('does not follow an import to a same-named function elsewhere', () => {
+    const files = corpus();
+    expect(reached(files).reaches(files.fromPure, 'load')).toBe(false);
+  });
+
+  it('follows an aliased import under its local name', () => {
+    const files = corpus();
+    expect(reached(files).reaches(files.aliased, 'fetchText')).toBe(true);
+  });
+
+  it('gives an import from outside the graph nothing inside it', () => {
+    const files = corpus();
+    // The positive control: the same name, declared in the graph, reads.
+    expect(reached(files).reaches(files.reader, 'config')).toBe(true);
+    expect(reached(files).reaches(files.outside, 'config')).toBe(false);
+  });
+
+  it('binds a destructured name locally', () => {
+    const files = corpus();
+    expect(reached(files).reaches(files.reader, 'source')).toBe(true);
+    expect(reached(files).reaches(files.destructured, 'source')).toBe(false);
+  });
+});
+
 describe('code without its literals is what a text cross-check reads (#477)', () => {
   // A cross-check counting a construct in raw text is satisfied by a string,
   // a template or a regex that spells it: the guards' own fixtures do. The
diff --git a/tests/unit/ast.ts b/tests/unit/ast.ts
index 8e9424e..1d5ada4 100644
--- a/tests/unit/ast.ts
+++ b/tests/unit/ast.ts
@@ -1,6 +1,6 @@
 import ts from 'typescript';
 import { readFileSync } from 'node:fs';
-import { relative } from 'node:path';
+import { dirname, join, relative } from 'node:path';
 import { withoutTsComments } from './source-text';
 
 /**
@@ -474,6 +474,29 @@ export function callGraph(files: readonly string[]): CallGraph {
    * #118 exists about.
    */
   const bound = new Map<string, Set<string>>();
+  /**
+   * Every name a file imports, by local name: the graph file it comes from
+   * (null when the module lies outside the graph) and the name it has there
+   * (null for a default or namespace import, which stands for the module).
+   * Resolved through this, an import reaches what its own module declares,
+   * never a same-named function elsewhere (#477): `browser-matrix.test.ts`'s
+   * `config`, imported from `playwright.config.ts`, inherited a `config`
+   * that reads a file three directories away.
+   */
+  const imports = new Map<
+    string,
+    Map<string, { from: string | null; name: string | null }>
+  >();
+  const inGraph = new Set(files);
+  const moduleFile = (file: string, specifier: string): string | null => {
+    if (!specifier.startsWith('.')) return null;
+    const base = join(dirname(file), specifier);
+    return (
+      [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((path) =>
+        inGraph.has(path),
+      ) ?? null
+    );
+  };
 
   for (const file of files) {
     const visit = (node: ts.Node, owner: string | null) => {
@@ -493,11 +516,35 @@ export function callGraph(files: readonly string[]): CallGraph {
           }
         }
       }
+      // A destructured name binds like any other (#477): `source` in
+      // `for (const [source] of ...)` is a string, not a reader elsewhere.
       if (
-        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
+        (ts.isVariableDeclaration(node) ||
+          ts.isParameter(node) ||
+          ts.isBindingElement(node)) &&
         ts.isIdentifier(node.name)
       )
         bound.set(file, (bound.get(file) ?? new Set()).add(node.name.text));
+      if (
+        ts.isImportDeclaration(node) &&
+        ts.isStringLiteral(node.moduleSpecifier) &&
+        node.importClause
+      ) {
+        const from = moduleFile(file, node.moduleSpecifier.text);
+        const own = imports.get(file) ?? new Map();
+        const clause = node.importClause;
+        if (clause.name) own.set(clause.name.text, { from, name: null });
+        const named = clause.namedBindings;
+        if (named && ts.isNamespaceImport(named))
+          own.set(named.name.text, { from, name: null });
+        if (named && ts.isNamedImports(named))
+          for (const element of named.elements)
+            own.set(element.name.text, {
+              from,
+              name: (element.propertyName ?? element.name).text,
+            });
+        imports.set(file, own);
+      }
       if (mine && ts.isCallExpression(node) && ts.isIdentifier(node.expression))
         calls.get(mine)?.add(node.expression.text);
       ts.forEachChild(node, (child) => visit(child, mine));
@@ -505,10 +552,27 @@ export function callGraph(files: readonly string[]): CallGraph {
     visit(parseFile(file), null);
   }
 
-  const resolve = (file: string, name: string): string[] => {
+  const resolve = (
+    file: string,
+    name: string,
+    seen = new Set<string>(),
+  ): string[] => {
     const local = keyOf(file, name);
     if (calls.has(local)) return [local];
     if (bound.get(file)?.has(name)) return [];
+    const imported = imports.get(file)?.get(name);
+    if (imported) {
+      // Outside the graph, nothing in it is what was imported.
+      if (imported.from === null) return [];
+      // A default or namespace import stands for the whole module.
+      if (imported.name === null)
+        return [...calls.keys()].filter(
+          (key) => fileOf.get(key) === imported.from,
+        );
+      if (seen.has(local)) return [];
+      return resolve(imported.from, imported.name, seen.add(local));
+    }
+    // Declared nowhere this file can see: a global, or a re-export.
     return keysByName.get(name) ?? [];
   };
 
diff --git a/tests/unit/presence-text.ts b/tests/unit/presence-text.ts
index e1595d6..dfc9a9b 100644
--- a/tests/unit/presence-text.ts
+++ b/tests/unit/presence-text.ts
@@ -8,14 +8,15 @@ import { codeWithoutLiterals } from './ast';
  * subject derives, through the program's bindings and its call graph, from a
  * `readFileSync` no `JSON.parse` stands on. This reads the same thing with
  * none of that machinery, so anchored-presence can check, per file, that its
- * reader judged at least what plain text shows: a reader blind to one form
- * judges fewer in that file than this counts.
+ * reader judged exactly what plain text shows: a reader blind to one form
+ * judges fewer in that file, and one counting a read that is not one judges
+ * more.
  *
- * It is a lower bound, never the population. It follows bindings only inside
- * one file, and only `const`/`let`/`var` and `function` declarations, each
- * visible in the innermost `describe`/`it`/`test` callback that makes it, or
- * the module. A subject read through a helper another file exports is the
- * reader's alone to see (anchored-presence says which, by name).
+ * It follows bindings only inside one file, and only `const`/`let`/`var` and
+ * `function` declarations, each visible in the innermost `describe`/`it`/
+ * `test` callback that makes it, or the module. A subject read through a
+ * helper another file exports is beyond it: none does today, and
+ * anchored-presence names the file if one appears.
  *
  * Read in code with every literal and comment removed (`codeWithoutLiterals`),
  * so a bracket inside a string never unbalances the walk below, and a fixture
~~~~

## Task 8: The ledger and CLAUDE.md

AC2, AC4, AC5 and AC7. The global rule's control (c) is edited outside the repo, in `~/.claude/CLAUDE.md`.

~~~~diff
diff --git a/CLAUDE.md b/CLAUDE.md
index 022d927..f627a75 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -11,6 +11,7 @@
 - **A hand-written list of things to check will miss the one that breaks.** The no-horizontal-scroll tests opened `#cg-grouping-toggle` and `#cg-sound-toggle` — added one at a time as each section gained content — and never `#cg-io-toggle`, the only section holding a native `<input type="file">`. Its ~344px intrinsic minimum propagated up `#cg-form`'s grid (items default to `min-width: auto`) and pinned the track to 378px at every viewport: 5px of horizontal scroll at 390px, **74px at 320px**. `max-width: 100%` does not fix this — the automatic minimum reads the element's min-content size, which `max-width` does not change; an explicit `width` replaces it. The replacement test _derives_ every disclosure from the DOM, so a section added later is covered the day it appears.
 - **A guard you have not watched fail is not a guard.** This repo has shipped two that asserted nothing, and both read as correct on the page. The supply-chain sub-path check (#23) was satisfied by `dependabot.yml`'s own **comment** describing the group it was meant to require — no group configured, suite green. #21 Stage 4's first replacement for the prod-smoke path list used `prod.includes(path)`, and `/glory-points` is a substring of `/id/glory-points`: the English assertion passed on the **Indonesian** path, and mutating a path to `/id/glory-pointsXX` left it green because that still contains the needle. **Every guard asserting against source text, config, or a workflow file is mutation-verified in BOTH directions before it lands** — break the thing it protects and watch it fail, then restore it and watch it pass. Strip comments before matching, so the file's documentation cannot satisfy its own guard. Prefer an exact set comparison to a substring test, and assert ORDER where order carries meaning (Dependabot stops at the first matching group). Presence is not the assertion; failure is. **And a mutation that comes back GREEN where you predicted RED has three causes, not one** (#250): the guard is weak, the mutation never reached `dist/`, or the medium made the mutation impossible. A RED is self-proving — the test failed BECAUSE of the change — so only a GREEN needs the built-output check, and that check belongs on the OBSERVED verdict rather than the predicted one, since a wrong prediction is exactly when it is needed. Rule out "never landed" by asserting the mutation's shape in the built bytes (for a REMOVAL, assert the absence WITH a liveness probe beside it, or an empty file list satisfies it for free), and rule out "weak guard" by probing the assertion's own liveness. What remains is an illegal mutation: `max-height: 40px !important` can never shrink a control, because CSS resolves a box as `max(min-height, min(max-height, height))` and a 44px `min-height` beats any smaller max-height however important it is.
 - **A liveness floor is a recorded figure, checked for equality (#468).** A floor written `toBeGreaterThan(measured - 1)` is tight only on the day it is measured, because growth never fails it: `absence-liveness` read 424 an hour after it was set to `> 420`. So a guard proves it read its population with `expect(floorBreach('<id>', count)).toBeUndefined()` (`tests/floors.ts`), placed after its verdict, against the figure in `tests/floors.json`: one unit short fails, and so does one more. When a change grows a population, `npm run floors:record` raises the figure and prints every floor that moved; read each delta against your diff, because a raise smaller than the units you added is a reader that lost some, and put the lines in the commit. It never lowers a figure: a real shrink is a hand edit with the reason in the commit. CI never records. `literal-floors.test.ts` refuses a literal floor demanding two or more, however it is written (a matcher, a parameter, `n > 25` inside an `expect`, or backwards as `expect(5).toBeLessThan(n)`), unless it bounds a product value and says so. A new test file grows several floors at once, and a new file is invisible to the tracked-file guards until `git add -N`, so add it before recording.
+- **A floor is half the proof; a second, number-free reading is the other half (#469).** A floor alone accepts a change that adds five units while its reader loses three, as +2. So each guard also counts its population another way and compares, per unit wherever the units can be named: in each file, the reader's count equals the same construct counted in code with its literals and comments removed (`codeWithoutLiterals` in `tests/unit/ast.ts`, so a fixture string or a comment spelling it is not one); a walk equals git's own list of the same files, both ways (`committableFiles` and `walkDisagreements` in `tests/source-files.ts`, untracked files included); a line scan equals the parse tree (`spec-scan`'s per-file `count`). **That cross-check carries no literal number**: a figure typed into it drifts exactly as a floor does. A population defined by dataflow can still be read a second way: `anchored-presence`'s text reading (`presenceOverRawText`) equals its reader in every file, and that equality is what found two units the reader counted that read nothing (#477). Where no second reading exists, the ledger says why and names what would make one.
 - **No message may put a closing keyword next to an issue number — not even one you mean.** `close`/`fix`/`resolve` and their inflections, beside `#<n>`, are refused in a commit message (`.githooks/commit-msg`) and in a pull request body (`.github/workflows/pr-body.yml`), both through one home: `scripts/closing-keywords.mjs`. GitHub's parser has no model of negation, tense or intent, and it has retired an issue here **twice** — once from a sentence in capitals saying the issue must stay open, once from a body promising to retire it by hand later. There is deliberately **no exception**, because no such keyword appears in the last 300 commit bodies or 40 pull request bodies: the capability an exception would preserve has never been used, and an allowance branch nothing exercises is the vacuity #118 was filed about. Write `Refs #<n>`, and retire an issue with `gh issue close <n>` once the work is verified. Check a body before it reaches GitHub with `node scripts/closing-keywords.mjs <file> "this pull request body"`. The workflow re-runs on `edited` — a body edited after a green run is how such a sentence gets written — and is **not a gate** until `closing-keywords` joins `required_status_checks.contexts`, which is repository administration and so the operator's (#278).
 - **Locale files are a review surface.** Every catalogue is typed `Catalogue`, so `npm run typecheck` (`astro check`, run in CI) fails on a missing key; it cannot read copy, so tests hold the rest. `tests/unit/i18n.test.ts` and `dead-copy.test.ts`: blank values, untranslated copy, copy no page renders. `locale-fallbacks.test.ts`: English left in zh, vi and th. `message-parity.test.ts`: every language fills the slots English fills, offers the choices it offers, and has exactly its own plural forms. `label-check.test.ts` and `verified-labels.test.ts`: a label of three words or fewer is checked against its own locale's copy that uses its English and says more, and one that disagrees, or that a namesake renders in other words, is either pinned or listed as awaiting the operator's read (#161). A label can be translated, non-blank and slot-perfect and still name the wrong thing: `Tình dục` passed every other guard here for a month. Messages are templates (#136) — English decides which entries are messages — and zh/vi/th wording is a DeepL draft until a speaker has reviewed it.
 - **The e2e suite measures `dist/`**, not the dev server (`playwright.config.ts` builds and previews). Anything asserted against `astro dev` is asserting about bytes nobody receives.
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index 34a5391..1cf2052 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -287,6 +287,80 @@ gone. The CI refusal is mutated in its words, not removed, because a
 recorder that ran under the probe would run the suite and could rewrite the
 real `tests/floors.json`.
 
+## Cross-checks A (#477): the meta-guards that read test code, done
+
+A floor alone accepts a change that adds five units while its reader loses
+three, as +2. #469 gives every floor a second reading of the same
+population that carries no literal number; #477 does it for the six guards
+that read test code. Scope re-derived from `tests/floors.json` on develop's
+head at the start, `7948355`: the ten ids the ticket names, none added or
+gone.
+
+| Floor id | What its guard reads | Its cross-check before | Now, on the branch |
+| --- | --- | --- | --- |
+| `absence-liveness/sites` | absence matchers, from the AST (`absenceSubject`) | file level: a file whose raw text matched `PLAIN_ABSENCE` was read at all; blind to a split matcher, to a message argument, and fooled by a string spelling one | per file, the AST count equals the count in code with its literals and comments removed (`absence-liveness.test.ts:463`) |
+| `absence-liveness/plain-files` | that text reading's files | the AST `perFile` keys, one direction | the files whose text writes one, under the same per-file check |
+| `absence-liveness/ts-files` | `filesUnder('tests', .ts)` | none | the walk equals git's list, both ways (`absence-liveness.test.ts:328`) |
+| `anchored-presence/scanned` | `toContain`/`toMatch` over raw file text, by dataflow (`scanPresence`) | none | per file, the reader judged exactly what a text reading counts (`anchored-presence.test.ts:327`, `presenceOverRawText`); 76 became 74, see below |
+| `anchored-presence/ts-files` | `filesUnder('tests', .ts)` | none | the walk equals git's list (`anchored-presence.test.ts:320`) |
+| `capture-after-assertion/captures` | `shoot(` by line scan | file level: a file whose parse tree calls `shoot` was judged at all | per file, judged equals the parse tree's `shoot` calls (`spec-scan.ts:135`, the optional `count`); the walk equals git's list (`spec-scan.ts:127`) |
+| `event-collectors/locator-loops` | the `locatorLoops` tree | per unit already: every `.all()` followed or named (`event-collectors.test.ts:322`), text against tree per file (`:339`) | unchanged; its walk is `event-collectors/specs`' |
+| `event-collectors/specs` | `specDirs().flatMap(tsFilesUnder)` | none | the walk equals git's list of the files in spec directories (`event-collectors.test.ts:75`) |
+| `literal-floors/sites` | `floorSitesIn` | per unit already: the matcher count per file in stripped text less literals (`literal-floors.test.ts:324`) | unchanged, and its walk equals git's list (`literal-floors.test.ts:347`) |
+| `one-test-per-case/tests` | `testsRead` | file level: a spec whose text declares a test read as at least one | per file, `testsRead` equals `testsWritten`, the text count (`one-test-per-case.test.ts:310`); the walk equals git's list (`:315`); the file-level check stays |
+
+Three homes carry the readings: `codeWithoutLiterals` (`tests/unit/ast.ts`)
+blanks every string, template and regex the parse tree finds, then strips
+comments, so a fixture spelling a construct is not one; `committableFiles`
+and `walkDisagreements` (`tests/source-files.ts`) list what git has,
+untracked files included so a test written before its `git add` is no false
+red, and compare a walk with it both ways; `specDirFilesGitHas`
+(`tests/spec-dirs.ts`) reads the spec directories from that list.
+
+Building it found the hole the ticket is about in the work itself: the
+per-file counts for captures and for tests run over the guard's own walk,
+so a walk that dropped a file dropped it from both sides and only the floor
+saw it. Those walks, and literal-floors', are now checked against git too.
+
+**What the cross-check found, and AC4.** `anchored-presence`'s population
+is defined by dataflow, and the design took the text reading for a lower
+bound: it counted 74 of the reader's 76, and the two looked like reads
+through helpers in another module. Probed, neither was a read.
+`browser-matrix.test.ts:294` asserts on `config`, the default import from
+`playwright.config.ts`; `source-text.test.ts:733` on text built from
+`source`, a `for...of` variable over string literals. `callGraph` bound
+neither name, so each fell through to the union of every same-named
+function in `tests/`, and a `config` and a `source` there read a file:
+#118's collision, through two doors it had left. It now binds a
+destructured name locally and resolves an import through the module it
+names (nothing, outside the graph). Every site both meta-guards judge was
+logged before and after: only those two left, all 447 absence verdicts
+held, no presence finding appeared. The text reading now equals the reader
+in every file, so the check is an equality, and catches a reader that
+counts too many as well as one blind to a form. The one form it cannot
+follow is a subject read through a helper another file exports; none does
+today, and if one appears the check names its file, and the text reading
+then has to follow imports.
+
+**AC5, the matrix** (`.superpowers/sdd/477/m477.py`, 38 rows, predictions
+written first, all as predicted). On `develop`, ten mutations that lose one
+unit and add one, so every total holds, stayed GREEN against the floor
+alone: one absence, one presence, one capture and one test lost at a site
+in a file the branch never touches and appended back to it, and six walks
+dropping a file with no unit in it while an empty file appeared. On the
+branch the same ten turned the new cross-check RED. With every floor
+switched off, each cross-check alone went RED against a reader blind to one
+form (`toHaveLength(0)`, `toMatch`, a capture call split over lines, a
+template-titled test) and against each walk skipping `tests/device`. Eight
+more went RED against the machinery itself: the text reading blind,
+spec-scan ignoring a per-file count, `codeWithoutLiterals` keeping the
+literals, git's list without untracked files, a walk compared one way only,
+the spec directories read from git keeping every directory, an import
+resolved by bare name again, and a destructured name left unbound. Two
+forms the design proposed were dead in the corpus and replaced before any
+run: no spec calls `.shoot(`, and every `test.skip(`/`test.fail(` is a
+runtime call, so no modifier declaration exists to blind.
+
 ## Group 4: loop-built findings, next
 
 41 `searched` calls build their findings by pushing inside a loop, which
~~~~

## Task 9: From review pass 2: two docblocks say what the code does and where

Comments only. The `config` callGraph's note named is `dependabot-labels.test.ts:32`, measured; `expectNothingFound`'s docblock now names every check it makes.

~~~~diff
diff --git a/tests/unit/ast.ts b/tests/unit/ast.ts
index 1d5ada4..90fc8c3 100644
--- a/tests/unit/ast.ts
+++ b/tests/unit/ast.ts
@@ -480,8 +480,8 @@ export function callGraph(files: readonly string[]): CallGraph {
    * (null for a default or namespace import, which stands for the module).
    * Resolved through this, an import reaches what its own module declares,
    * never a same-named function elsewhere (#477): `browser-matrix.test.ts`'s
-   * `config`, imported from `playwright.config.ts`, inherited a `config`
-   * that reads a file three directories away.
+   * `config`, imported from `playwright.config.ts`, inherited
+   * `dependabot-labels.test.ts`'s, which reads a file.
    */
   const imports = new Map<
     string,
diff --git a/tests/unit/spec-scan.ts b/tests/unit/spec-scan.ts
index 068a248..a7d5030 100644
--- a/tests/unit/spec-scan.ts
+++ b/tests/unit/spec-scan.ts
@@ -86,9 +86,11 @@ export const declarationsRead = (what: string, floor: string): Liveness => ({
 
 /**
  * Run `analyze` over every file in the spec directories and assert it found
- * nothing, over a population of the units it judged, at least as many as
- * measured, with none missed in a file that plainly holds one. The failure
- * message is every finding, one per line.
+ * nothing, over a population of the units it judged; that no file which
+ * plainly holds one was judged empty; that the walk read exactly the files
+ * git has there; where the liveness gives a `count`, that every file was
+ * judged exactly that many (#477); and that the total is the recorded
+ * figure (#468). The failure message is every finding, one per line.
  */
 export const expectNothingFound = (
   analyze: Analyze,
~~~~

## Task 10: From review pass 3: one-test-per-case names its walk once

The `unread` verdict's `of` is `specs`, the walk its sibling verdicts name.

~~~~diff
diff --git a/tests/unit/one-test-per-case.test.ts b/tests/unit/one-test-per-case.test.ts
index 6e9c3df..d312839 100644
--- a/tests/unit/one-test-per-case.test.ts
+++ b/tests/unit/one-test-per-case.test.ts
@@ -301,10 +301,7 @@ describe('the suite', () => {
     // form (`test.fail.only` was) is caught by the file it missed.
     const { specs, tests, unread, miscounted } = scan();
     expect(
-      searched(unread, {
-        of: specDirs().flatMap(tsFilesUnder),
-        what: 'files in spec directories',
-      }),
+      searched(unread, { of: specs, what: 'files in spec directories' }),
     ).toEqual([]);
     expect(
       searched(miscounted, { of: specs, what: 'files in spec directories' }),
~~~~

## Task 11: From review pass 4: the ledger's line references point at the checks again

Four citations went stale when Tasks 9 and 10 moved lines. The pass script now checks every `file:line` in the section lands on a check (`it(`, `searched(`, `walkDisagreements(`, `if (count)`); proved on the stale ledger at `HEAD` (4 of 13, exit 1) and the fixed one (0 of 13).

~~~~diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index 1cf2052..ef90e5f 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -303,11 +303,11 @@ gone.
 | `absence-liveness/ts-files` | `filesUnder('tests', .ts)` | none | the walk equals git's list, both ways (`absence-liveness.test.ts:328`) |
 | `anchored-presence/scanned` | `toContain`/`toMatch` over raw file text, by dataflow (`scanPresence`) | none | per file, the reader judged exactly what a text reading counts (`anchored-presence.test.ts:327`, `presenceOverRawText`); 76 became 74, see below |
 | `anchored-presence/ts-files` | `filesUnder('tests', .ts)` | none | the walk equals git's list (`anchored-presence.test.ts:320`) |
-| `capture-after-assertion/captures` | `shoot(` by line scan | file level: a file whose parse tree calls `shoot` was judged at all | per file, judged equals the parse tree's `shoot` calls (`spec-scan.ts:135`, the optional `count`); the walk equals git's list (`spec-scan.ts:127`) |
+| `capture-after-assertion/captures` | `shoot(` by line scan | file level: a file whose parse tree calls `shoot` was judged at all | per file, judged equals the parse tree's `shoot` calls (`spec-scan.ts:137`, the optional `count`); the walk equals git's list (`spec-scan.ts:129`) |
 | `event-collectors/locator-loops` | the `locatorLoops` tree | per unit already: every `.all()` followed or named (`event-collectors.test.ts:322`), text against tree per file (`:339`) | unchanged; its walk is `event-collectors/specs`' |
 | `event-collectors/specs` | `specDirs().flatMap(tsFilesUnder)` | none | the walk equals git's list of the files in spec directories (`event-collectors.test.ts:75`) |
 | `literal-floors/sites` | `floorSitesIn` | per unit already: the matcher count per file in stripped text less literals (`literal-floors.test.ts:324`) | unchanged, and its walk equals git's list (`literal-floors.test.ts:347`) |
-| `one-test-per-case/tests` | `testsRead` | file level: a spec whose text declares a test read as at least one | per file, `testsRead` equals `testsWritten`, the text count (`one-test-per-case.test.ts:310`); the walk equals git's list (`:315`); the file-level check stays |
+| `one-test-per-case/tests` | `testsRead` | file level: a spec whose text declares a test read as at least one | per file, `testsRead` equals `testsWritten`, the text count (`one-test-per-case.test.ts:307`); the walk equals git's list (`:312`); the file-level check stays |
 
 Three homes carry the readings: `codeWithoutLiterals` (`tests/unit/ast.ts`)
 blanks every string, template and regex the parse tree finds, then strips
~~~~

## Task 12: From the side finding after pass 5: a duplication verdict names one pair

Fix-first against the defect itself: H1/H2 (a copy of the walk check under a new title, and under its own) left all 12 duplication tests GREEN on `806303a` with the floor off. The three titled naming cases ran RED (each named `anonymous`) before `nameOfBody` learned titles; the untitled control passed. The one-pair check passed on the corpus before any mutation, as it must, and was first seen RED in K4. Floors: `duplication/declarations` +3 (count-bodies: +2, +1), `absence-liveness/sites` +1. The eight e2e verdicts predate #477 and are narrowed with it (K1 GREEN on develop).

~~~~diff
diff --git a/docs/reviews/2026-10-03-guard-liveness-ledger.md b/docs/reviews/2026-10-03-guard-liveness-ledger.md
index ef90e5f..bfa50d6 100644
--- a/docs/reviews/2026-10-03-guard-liveness-ledger.md
+++ b/docs/reviews/2026-10-03-guard-liveness-ledger.md
@@ -342,7 +342,20 @@ follow is a subject read through a helper another file exports; none does
 today, and if one appears the check names its file, and the text reading
 then has to follow imports.
 
-**AC5, the matrix** (`.superpowers/sdd/477/m477.py`, 38 rows, predictions
+**A verdict that excused more than its pair.** The two walk checks above
+are identical in `absence-liveness` and `anchored-presence`, so
+`duplication` needed a verdict for them, and it keyed verdicts by
+`file:name`, where every test callback was named `anonymous`. One verdict
+therefore excused every anonymous copy between its two files: with the
+floor off, the walk check copied once more between the two guards, under a
+new title and under its own, left `duplication` green on `806303a`. The
+eight verdicts for the no-horizontal-scroll family had the same breadth on
+`develop` before #477. A test callback is now known by its call and title
+(`nameOfBody`), each verdict names its pair's titles, and a verdict whose
+key describes more than one live pair is refused
+(`duplication.test.ts:157`), since two tests may share a title.
+
+**AC5, the matrix** (`.superpowers/sdd/477/m477.py`, 44 rows, predictions
 written first, all as predicted). On `develop`, ten mutations that lose one
 unit and add one, so every total holds, stayed GREEN against the floor
 alone: one absence, one presence, one capture and one test lost at a site
@@ -356,7 +369,12 @@ more went RED against the machinery itself: the text reading blind,
 spec-scan ignoring a per-file count, `codeWithoutLiterals` keeping the
 literals, git's list without untracked files, a walk compared one way only,
 the spec directories read from git keeping every directory, an import
-resolved by bare name again, and a destructured name left unbound. Two
+resolved by bare name again, and a destructured name left unbound. Six
+rows hold the verdict key: a test copied between two e2e specs stayed
+GREEN on `develop` and went RED on the branch; the walk check copied under
+a new title went RED, and under its own title went RED through the
+one-pair check alone, which stayed GREEN with that check off; a test
+callback named `anonymous` again went RED. Two
 forms the design proposed were dead in the corpus and replaced before any
 run: no spec calls `.shoot(`, and every `test.skip(`/`test.fail(` is a
 runtime call, so no modifier declaration exists to blind.
diff --git a/tests/floors.json b/tests/floors.json
index a724afb..f089065 100644
--- a/tests/floors.json
+++ b/tests/floors.json
@@ -1,6 +1,6 @@
 {
   "absence-liveness/plain-files": 117,
-  "absence-liveness/sites": 447,
+  "absence-liveness/sites": 448,
   "absence-liveness/ts-files": 268,
   "anchored-presence/scanned": 74,
   "anchored-presence/ts-files": 268,
@@ -13,7 +13,7 @@
   "device-tool-homes/files": 301,
   "download-readers/byte-reads": 8,
   "duplicate-imports/imports": 1582,
-  "duplication/declarations": 5399,
+  "duplication/declarations": 5402,
   "duplication/files": 345,
   "event-collectors/locator-loops": 8,
   "event-collectors/specs": 65,
diff --git a/tests/unit/duplication.test.ts b/tests/unit/duplication.test.ts
index 68c06ee..8d739c0 100644
--- a/tests/unit/duplication.test.ts
+++ b/tests/unit/duplication.test.ts
@@ -80,39 +80,39 @@ const CROSS_CHECK_STAYS_IN_ITS_GUARD =
  */
 const SEPARATE: ReadonlyMap<string, string> = new Map([
   [
-    'tests/unit/absence-liveness.test.ts:anonymous  <->  tests/unit/anchored-presence.test.ts:anonymous',
+    "tests/unit/absence-liveness.test.ts:it('walks every .ts file git has under tests/')  <->  tests/unit/anchored-presence.test.ts:it('walks every .ts file git has under tests/')",
     CROSS_CHECK_STAYS_IN_ITS_GUARD,
   ],
   [
-    'tests/e2e/classroom-groups-controls.spec.ts:anonymous  <->  tests/e2e/classroom-groups-roster.spec.ts:anonymous',
+    'tests/e2e/classroom-groups-controls.spec.ts:test(`${path}: no horizontal scroll at ${width}px`)  <->  tests/e2e/classroom-groups-roster.spec.ts:test(`cards: no horizontal scroll at 320px once a student is marked absent -- ${path}`)',
     TEST_BODY_STAYS_IN_THE_SPEC,
   ],
   [
-    'tests/e2e/classroom-groups-controls.spec.ts:anonymous  <->  tests/e2e/glory-points.spec.ts:anonymous',
+    'tests/e2e/classroom-groups-controls.spec.ts:test(`${path}: no horizontal scroll at ${width}px`)  <->  tests/e2e/glory-points.spec.ts:test(`no horizontal scroll at ${width}px -- ${path}`)',
     TEST_BODY_STAYS_IN_THE_SPEC,
   ],
   [
-    'tests/e2e/classroom-groups-controls.spec.ts:anonymous  <->  tests/e2e/site-meta.spec.ts:anonymous',
+    'tests/e2e/classroom-groups-controls.spec.ts:test(`${path}: no horizontal scroll at ${width}px`)  <->  tests/e2e/site-meta.spec.ts:test(`no horizontal scroll at ${width}px`)',
     TEST_BODY_STAYS_IN_THE_SPEC,
   ],
   [
-    'tests/e2e/classroom-groups-controls.spec.ts:anonymous  <->  tests/prod/prod-sanity.spec.ts:anonymous',
+    'tests/e2e/classroom-groups-controls.spec.ts:test(`${path}: no horizontal scroll at ${width}px`)  <->  tests/prod/prod-sanity.spec.ts:test(`${path} fits a 320px viewport`)',
     TEST_BODY_STAYS_IN_THE_SPEC,
   ],
   [
-    'tests/e2e/classroom-groups-roster.spec.ts:anonymous  <->  tests/e2e/glory-points.spec.ts:anonymous',
+    'tests/e2e/classroom-groups-roster.spec.ts:test(`cards: no horizontal scroll at 320px once a student is marked absent -- ${path}`)  <->  tests/e2e/glory-points.spec.ts:test(`no horizontal scroll at ${width}px -- ${path}`)',
     TEST_BODY_STAYS_IN_THE_SPEC,
   ],
   [
-    'tests/e2e/classroom-groups-roster.spec.ts:anonymous  <->  tests/prod/prod-sanity.spec.ts:anonymous',
+    'tests/e2e/classroom-groups-roster.spec.ts:test(`cards: no horizontal scroll at 320px once a student is marked absent -- ${path}`)  <->  tests/prod/prod-sanity.spec.ts:test(`${path} fits a 320px viewport`)',
     TEST_BODY_STAYS_IN_THE_SPEC,
   ],
   [
-    'tests/e2e/glory-points.spec.ts:anonymous  <->  tests/e2e/site-meta.spec.ts:anonymous',
+    'tests/e2e/glory-points.spec.ts:test(`no horizontal scroll at ${width}px -- ${path}`)  <->  tests/e2e/site-meta.spec.ts:test(`no horizontal scroll at ${width}px`)',
     TEST_BODY_STAYS_IN_THE_SPEC,
   ],
   [
-    'tests/e2e/glory-points.spec.ts:anonymous  <->  tests/prod/prod-sanity.spec.ts:anonymous',
+    'tests/e2e/glory-points.spec.ts:test(`no horizontal scroll at ${width}px -- ${path}`)  <->  tests/prod/prod-sanity.spec.ts:test(`${path} fits a 320px viewport`)',
     TEST_BODY_STAYS_IN_THE_SPEC,
   ],
 ]);
@@ -153,6 +153,24 @@ describe('a function body has one home across files', () => {
       ),
     ).toEqual([]);
   });
+
+  it('records each verdict against one pair, which no copy can inherit', () => {
+    // A key describing two live pairs excuses the second unread: measured,
+    // the walk check copied once more between the same two guards passed
+    // under `anonymous <-> anonymous` (#477). Names alone cannot rule that
+    // out, since two tests may share a title, so the count is checked here.
+    const pairsPerKey = new Map<string, number>();
+    for (const key of PAIRS.map(keyOf))
+      pairsPerKey.set(key, (pairsPerKey.get(key) ?? 0) + 1);
+    const recorded = [...SEPARATE.keys()];
+    const shared = recorded.filter((key) => (pairsPerKey.get(key) ?? 0) > 1);
+    expect(
+      searched(
+        shared.map((key) => `${key}: ${pairsPerKey.get(key)} live pairs`),
+        { of: recorded, what: 'recorded verdicts' },
+      ),
+    ).toEqual([]);
+  });
 });
 
 describe('the scan itself', () => {
@@ -224,6 +242,26 @@ describe('the scan itself', () => {
     expect(names).toContain('outer');
   });
 
+  // A callback has no name of its own, and `anonymous` for every one let a
+  // verdict recorded for one pair excuse any other between the same two
+  // files (#477). The call and its title are the name a reader knows it by.
+  it.each([
+    ["it('reads a title',", "it('reads a title')"],
+    [
+      'test(`no scroll at ${width}px`, { tag: "@x" },',
+      'test(`no scroll at ${width}px`)',
+    ],
+    ["test.skip('a skipped case',", "test.skip('a skipped case')"],
+    ['items.forEach(', 'anonymous'],
+  ])('names the callback passed to %s as %s', (open, name) => {
+    const source = `
+      ${open} async ({ page }) => {
+        const title = await page.title();
+        expect(title.length + title.length + title.length).toBeGreaterThan(0);
+      });`;
+    expect(functionBodiesOf(source, 'a.ts').map((d) => d.name)).toEqual([name]);
+  });
+
   it('reports a duplicated region once, at its outermost match', () => {
     const source = `
       const outer = async (value: number) => {
diff --git a/tests/unit/duplication.ts b/tests/unit/duplication.ts
index 0949de6..807cf63 100644
--- a/tests/unit/duplication.ts
+++ b/tests/unit/duplication.ts
@@ -89,10 +89,15 @@ const isComparableFunction = (node: ts.Node): boolean =>
   ts.isMethodDeclaration(node);
 
 /**
- * The name a function is known by — declared, assigned, or the property it
- * is the value of. `declaredName` in `ast.ts` answers the first two for a
- * call graph; a scan that collects callbacks needs the third and a fallback,
- * because an argument to `evaluate` has no name at all.
+ * The name a function is known by — declared, assigned, the property it is
+ * the value of, or the titled call it is passed to. `declaredName` in
+ * `ast.ts` answers the first two for a call graph; a scan that collects
+ * callbacks needs the rest and a fallback, because an argument to `evaluate`
+ * has no name at all.
+ *
+ * A test's callback is known by its title, `it('…')`: as `anonymous`, every
+ * test in a file shared one name, so a verdict keyed by name excused any
+ * copy between the same two files (#477).
  */
 const nameOfBody = (node: ts.Node): string => {
   if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
@@ -107,9 +112,20 @@ const nameOfBody = (node: ts.Node): string => {
     return parent.name.text;
   if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name))
     return parent.name.text;
+  if (parent && ts.isCallExpression(parent)) {
+    const [title] = parent.arguments;
+    if (title && title !== node && isTitle(title))
+      return `${parent.expression.getText()}(${title.getText()})`;
+  }
   return 'anonymous';
 };
 
+/** A string, written in any quote, that a call takes as its title. */
+const isTitle = (node: ts.Node): boolean =>
+  ts.isStringLiteral(node) ||
+  ts.isNoSubstitutionTemplateLiteral(node) ||
+  ts.isTemplateExpression(node);
+
 /**
  * Every function-like node in `source`, at any depth.
  *
~~~~

## Mutation matrix

`.superpowers/sdd/477/m477.py`, copied from #468's runner, vitest only.
Every anchor must occur exactly once (an empty anchor appends to the file;
a created file must not exist yet); a run that cannot start is NOT-RUN and
a target naming no test is ABSENT, never GREEN. The whole test file runs
per row. Predictions were written before the first run.

The develop rows are AC5's "one unit added, one lost": the reader skips one
unit at a site in a file the branch never touches (`i18n.test.ts:109`,
`i18n-scaffold.test.ts:177`, `chrome.spec.ts:49` and `:57`), and one unit is
appended to the same file; or a walk drops `tests/e2e/locale-sampling.ts`
(no unit of any population) while an empty `tests/e2e/zz-plant-477.ts`
appears. The total is unchanged, so the floor alone stays GREEN on develop,
and the same mutation turns the new cross-check RED on the branch. The F
rows switch every floor off (`floorBreach` returns nothing) and leave each
cross-check alone against a reader blind to one form, or a narrowed walk.

| Id | Mutation | `develop` | branch |
| --- | --- | --- | --- |
| D1 / R1 | absence: one site lost, one added | GREEN | RED |
| D2 / R2 | presence: one site lost, one added | GREEN | RED |
| D3 / R3 | captures: one lost, one added | GREEN | RED |
| D4 / R4 | tests: one lost, one added | GREEN | RED |
| D5 / R5 | absence walk: one file dropped, one added | GREEN | RED |
| D6 / R6 | presence walk: one file dropped, one added | GREEN | RED |
| D7 / R7 | event-collectors walk: one file dropped, one added | GREEN | RED |
| D8 / R8 | spec-scan walk: one file dropped, one added | GREEN | RED |
| D9 / R9 | one-test-per-case walk: one file dropped, one added | GREEN | RED |
| D10 / R10 | literal-floors walk: one file dropped, one added | GREEN | RED |
| F1 | floors off; absence reader blind to `toHaveLength(0)` | — | RED |
| F2 | floors off; absence walk skips `tests/device` | — | RED |
| F3 | floors off; presence reader blind to `toMatch` | — | RED |
| F4 | floors off; presence walk skips `tests/device` | — | RED |
| F5 | floors off; capture scan blind to a split call (103 of 143) | — | RED |
| F6 | floors off; spec-scan walk skips `tests/device` | — | RED |
| F7 | floors off; tests reader blind to a template title | — | RED |
| F8 | floors off; one-test-per-case walk skips `tests/device` | — | RED |
| F9 | floors off; event-collectors walk skips `tests/device` | — | RED |
| F10 | floors off; literal-floors walk skips `tests/device` | — | RED |
| X1 | the presence text reading goes blind | — | RED |
| X2 | spec-scan ignores a per-file count | — | RED |
| X3 | `codeWithoutLiterals` keeps the literals | — | RED |
| X4 | git's list leaves out an untracked file | — | RED |
| X5 | a walk disagreement is counted one way only | — | RED |
| X6 | the spec directories read from git keep every directory | — | RED |
| X7 | an import resolves by bare name again | — | RED |
| X8 | a destructured name is left unbound | — | RED |
| K1 / K2 | duplication: a test copied between two e2e specs | GREEN | RED |
| K3 | duplication: the walk check copied under a new title | — | RED |
| K4 | duplication: the walk check copied under its own title | — | RED (the one-pair check) |
| K5 | K4 with the one-pair check off | — | GREEN |
| K6 | a test callback is named `anonymous` again | — | RED |

44 rows: 11 on `develop`, 33 on the branch. The K rows (Task 12) plant at
top level, with the floors off: a `describe` around the copy is an identical
outer body itself, which the scan reports at its outermost match, so the
first plants went RED for the wrapper and were rewritten before these runs. Two forms the design proposed
were dead in the corpus and were replaced before any run: no spec calls
`.shoot(`, and the one `test.fail(` is a runtime call (as are all seven
`test.skip(`), so no modifier declaration exists to blind.

## Review passes

`.superpowers/sdd/477/p477-pass.sh <n>` copies the tools into `pass<n>.d/`
and runs from that snapshot. It resets `../shyden.co.uk-477-mut` to
`7948355`, applies each task's diff from THIS document with `git apply`,
commits each, and refuses unless the applied tree equals the branch tree
(this document aside). Then: every `file:line` the ledger's #477 section
cites must land on a check in that tree (added at pass 4); `astro check`
(three summary lines, all 0),
`prettier --check .`, the whole unit suite, `npm run floors:record` on the
applied tree (it must report that every floor already matches and leave the
tree clean), and the matrix on `develop` and on the applied tree. After the
script, the pass reads the whole document. The loop ends at a pass that finds
nothing.

## Pass log

### Pass 1 (2026-10-04, 05:32Z, tree `987b7f9`)

Mechanical, by `p477-pass.sh 1`: the eight task diffs applied to `7948355`
equal the branch; `astro check` 0/0/0; prettier clean; unit 3643/3643;
`npm run floors:record` on the applied tree: every floor already matches,
tree clean; matrix 10 + 28 as predicted, 0 mismatches. CLEAN.

Reading: the head, every task note, the Task 8 ledger and CLAUDE.md diff as
rendered, the matrix and review sections. FINDINGS, in this document only:
the head said every task's tests ran RED against a throwing stub, and
three notes said the same. Task 3's refusal test and Task 7's fixtures went
RED against the real defect, not a stub; Task 2's ninth red was the
absence floor growing; and Task 6's literal-floors walk check was never
seen RED before it went in (matrix R10 and F10 are its proof). The head
and those notes now say which.

### Pass 2 (2026-10-04, 05:35Z, tree `987b7f9`)

Mechanical, by `p477-pass.sh 2`: applied plan equals the branch; `astro
check` 0/0/0; prettier clean; unit 3643/3643; the recorder matches every
floor and leaves the tree clean; matrix 10 + 28 as predicted. CLEAN.

Reading: Task 7's `ast.ts` diff line by line, and the final forms of
`source-files.ts`, `spec-dirs.ts` and `spec-scan.ts`. FINDINGS: callGraph's
import docblock placed the inherited `config` "three directories away",
never measured (it is `dependabot-labels.test.ts:32`, the same directory);
and `expectNothingFound`'s docblock promised a total "at least as many as
measured", stale since #468, naming neither new check. Both fixed in Task
9. A sweep for the stale wording under `tests/` and `scripts/`, its pattern
shown to find the original at `HEAD`, found no other.

### Pass 3 (2026-10-04, 05:39Z, tree `e57378a`)

Mechanical, by `p477-pass.sh 3`: applied plan equals the branch; `astro
check` 0/0/0; prettier clean; unit 3643/3643; the recorder matches every
floor and leaves the tree clean; matrix 10 + 28 as predicted. CLEAN.

Reading: the rendered head, Review Focus and AC table, and each guard test
that gained a verdict, in its final form. FINDING: one-test-per-case's
`unread` verdict spelled its population a second way
(`specDirs().flatMap(tsFilesUnder)`) beside `specs`, which the per-file and
git verdicts in the same test name. Fixed in Task 10.

### Pass 4 (2026-10-04, 05:42Z, tree `5e05bc3`)

Mechanical, by `p477-pass.sh 4`: applied plan equals the branch; `astro
check` 0/0/0; prettier clean; unit 3643/3643; the recorder matches every
floor and leaves the tree clean; matrix 10 + 28 as predicted. CLEAN.

Reading: every comment the branch adds that carries a figure or a file
reference, and every `file:line` the ledger's #477 section cites, read at
that line. FINDING: four citations stale, moved by Tasks 9 and 10
(`spec-scan.ts:127`/`:135`, `one-test-per-case.test.ts:310`/`:315`).
Fixed in Task 11, and prevented: the pass script now refuses a citation
that does not land on a check, proved RED on the stale ledger at `HEAD`
(4 of 13) and GREEN on the fixed one.

### Pass 5 (2026-10-04, 05:46Z, tree `db8f52b`)

Mechanical, by `p477-pass.sh 5`: applied plan equals the branch; the
ledger's 13 citations each land on a check; `astro check` 0/0/0; prettier
clean; unit 3643/3643; the recorder matches every floor and leaves the tree
clean; matrix 10 + 28 as predicted. CLEAN.

Reading: every task heading and note against its commit, the head, the
matrix and review sections as rendered. Nothing found. **The loop ends
here; the plan is approved** (operator rule 2026-09-24: reviewed to zero,
then self-approved).
