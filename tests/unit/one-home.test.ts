import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { declaredName, parseSource } from './ast';
import { withoutTsComments } from './source-text';
import { filesUnder } from '../source-files';

/**
 * Comment stripping lives in one place. Seven private copies had accumulated
 * across the suites by #65, and one of them — `locale-switcher.test.ts` —
 * used the naive `/\/\/.*$/gm` that eats everything after `https:` in a URL,
 * the exact bug `withoutTsComments` exists to prevent.
 *
 * Finding a stripper is done BY the shared stripper: remove a file's real
 * comments, and every comment marker still standing is inside a string or a
 * regex — code that MATCHES comment syntax rather than code that IS a
 * comment. Requiring a delimited literal (`'//'`, or `\/\/` escaped inside a
 * regex) is what stops a URL in a string from registering.
 *
 * KNOWN LIMIT, stated so nobody trusts this further than it goes: it detects
 * only source-comment markers. A line filter keyed on a single character —
 * `line.startsWith('#')`, the form #65 removed from `git-hooks.test.ts` — is
 * not detectable by text, because the marker a legitimate CALLER passes to
 * `withoutCommentLines(text, '#')` is that same character.
 */
const COMMENT_SYNTAX_LITERAL = /(['"`])\/[/*]\1|\\\/\\[/*]|<!--/;

/**
 * A `#`-dialect stripper written as a REGEX LITERAL: `#.*$`, or the same
 * inside a character class for the `.npmrc`/INI dialect, `[#;].*$`.
 *
 * The limit above was stated broader than its own evidence. It is true that
 * `line.startsWith('#')` cannot be told apart from a legitimate caller
 * passing `'#'` as a marker to `withoutCommentLines`. It is NOT true of
 * `line.replace(/(^|\\s)#.*$/, '')`, which is a distinctive literal and
 * perfectly detectable — and two of them lived in `node-contract.test.ts`
 * for exactly as long as this rule only looked for `//` (#85). A rule
 * written wider than its evidence is a gap with a justification attached.
 */
const HASH_STRIPPER_LITERAL = /(?:#|\[[^\]\n]*#[^\]\n]*\])\.\*\$/;

/** `https:\/\/` inside a regex is a URL, not a comment. */
const URL_ESCAPE = /https?:\\\/\\\//g;

/** `withoutCommentLines(text, '//')` passes a marker; it does not define one. */
const MARKER_ARGUMENT = /,\s*(['"`])\/[/*]\1/g;

/** Every place a guard could live, from disk — never a list. */
const SCANNED = ['tests', 'scripts']
  .flatMap((dir) => filesUnder(dir, (path) => /\.(ts|mjs)$/.test(path)))
  .sort();

/**
 * Takes SOURCE, not a path — for the reason `definesADirectoryWalker` already
 * gives, and which this detector did not follow until #85: a detector nobody
 * has watched catch anything is worth exactly as much as the guards #79 found
 * asserting on an empty array. The fixtures below are that watching.
 */
export function definesACommentStripper(source: string): boolean {
  const code = withoutTsComments(source)
    .replace(URL_ESCAPE, '')
    .replace(MARKER_ARGUMENT, '');
  return COMMENT_SYNTAX_LITERAL.test(code) || HASH_STRIPPER_LITERAL.test(code);
}

describe('comment stripping has exactly one home', () => {
  it('scans the whole test and script tree', () => {
    // Anti-vacuity: an empty scan would satisfy the assertion below.
    expect(SCANNED.length).toBeGreaterThan(20);
    expect(SCANNED).toContain('tests/unit/source-text.ts');
  });

  it('is implemented only in source-text.ts', () => {
    // Sorted, because `SCANNED` is — an allow-list written in reading order
    // fails for a reason that has nothing to do with what it guards.
    expect(
      SCANNED.filter((path) =>
        definesACommentStripper(readFileSync(path, 'utf8')),
      ),
    ).toEqual([
      // The detector itself: the one other file that must name comment
      // syntax, in order to find it anywhere else. Renamed from
      // `stripper-homes.test.ts` in #80, when it grew a second rule.
      'tests/unit/one-home.test.ts',
      // The suite that proves the strippers work: it must quote the very
      // markers they remove, or it would be asserting on nothing.
      'tests/unit/source-text.test.ts',
      // The shared home. Everything else imports from here.
      'tests/unit/source-text.ts',
    ]);
  });

  it('catches a #-dialect stripper written as a regex literal', () => {
    expect(
      definesACommentStripper("const s = line.replace(/(^|\\s)#.*$/, '');"),
    ).toBe(true);
    // The .npmrc/INI form, where `;` opens a comment too.
    expect(
      definesACommentStripper("const s = line.replace(/(^|\\s)[#;].*$/, '');"),
    ).toBe(true);
  });

  it('still catches the // dialect it was written for', () => {
    expect(definesACommentStripper("const s = text.replace('//', '');")).toBe(
      true,
    );
  });

  it('is not fired by a caller passing a marker', () => {
    // The reason the KNOWN LIMIT above stops at `startsWith('#')` and no
    // further: a caller naming the marker is legitimate, and must stay so.
    expect(definesACommentStripper("withoutCommentLines(text, '#');")).toBe(
      false,
    );
    expect(definesACommentStripper("withoutCommentLines(text, '//');")).toBe(
      false,
    );
  });

  it('is not fired by a comment describing one', () => {
    expect(
      definesACommentStripper(
        "// line.replace(/(^|\\s)#.*$/, '') would be a private stripper\nconst x = 1;",
      ),
    ).toBe(false);
  });
});

/**
 * Walking a directory tree lives in one place too.
 *
 * #65 gave comment stripping a home after seven private copies had grown, one
 * of them silently broken. The rule above was written for that one function,
 * so it could not see the next duplication — and the next duplication grew
 * inside this very file — the walk this guard used to carry was the sixth of
 * NINE private directory walkers (#80), in three implementations whose
 * exclusions disagreed. `dead-copy.test.ts` reached for `statSync().
 * isDirectory()` where the others used `withFileTypes`; `download-tagging.
 * test.ts` skipped neither dotfiles nor `node_modules` where the four
 * identical copies skipped both. Whichever copy the next guard reached for
 * would have decided what that guard could see — #67's failure exactly.
 *
 * Detection is deliberately structural rather than name-based: a copy called
 * `collect`, `walk` or `listM4aFiles` is the same defect as one called
 * `listSourceFiles`, and only two of the nine shared a name.
 *
 * Takes SOURCE, not a path, so the mutation tests below can hand it text that
 * is not on disk — a detector nobody has watched catch anything is worth as
 * much as the guards #79 found asserting on an empty array.
 */
const READS_A_DIRECTORY = /\breaddirSync\s*\(/;
const RECURSES_INTO_SUBDIRECTORIES = /\bisDirectory\s*\(\s*\)/;

export function definesADirectoryWalker(source: string): boolean {
  const code = withoutTsComments(source);
  return (
    READS_A_DIRECTORY.test(code) && RECURSES_INTO_SUBDIRECTORIES.test(code)
  );
}

describe('walking a directory tree has exactly one home', () => {
  it('is implemented only in source-files.ts', () => {
    expect(
      SCANNED.filter((path) =>
        definesADirectoryWalker(readFileSync(path, 'utf8')),
      ),
    ).toEqual([
      // The commit job's walk of a downloaded artifact (#459). filesUnder
      // skips dotfiles and node_modules and refuses an empty walk, which
      // would blind a validator to exactly what it exists to refuse; this
      // one reads every entry with lstat and follows no symlink.
      'scripts/visual-rebaseline.mjs',
      // The shared home. Every scan in the suite recurses through here.
      'tests/source-files.ts',
      // The detector itself: the one other file that must name the syntax,
      // in order to find it anywhere else.
      'tests/unit/one-home.test.ts',
    ]);
  });

  it('catches a walker whatever it is called', () => {
    expect(
      definesADirectoryWalker(`
        const gather = (dir: string): string[] =>
          readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory() ? gather(join(dir, entry.name)) : [entry.name],
          );
      `),
    ).toBe(true);
  });

  it('catches the statSync variant, which shares no call with the others', () => {
    expect(
      definesADirectoryWalker(`
        const collect = (dir: string): string[] =>
          readdirSync(dir).flatMap((entry) =>
            statSync(join(dir, entry)).isDirectory() ? collect(join(dir, entry)) : [entry],
          );
      `),
    ).toBe(true);
  });

  it('is not fired by a comment describing one', () => {
    // The suppression direction: a guard that a comment can satisfy is not a
    // guard. Comments come off before matching, both ways.
    expect(
      definesADirectoryWalker(`
        // Deliberately flat: readdirSync(dir) with no entry.isDirectory()
        // recursion, because Astro puts every page at the top level.
        const pages = readdirSync('src/pages');
      `),
    ).toBe(false);
  });

  it('is not fired by reading a single directory', () => {
    expect(
      definesADirectoryWalker(`
        const assets = readdirSync('dist/_astro').filter((n) => n.endsWith('.m4a'));
      `),
    ).toBe(false);
  });
});

/**
 * Walking a copy table lives in one place too: `src/lib/catalogue-leaves.ts`,
 * which `tests/catalogue-leaves.ts` re-exports.
 *
 * The directory walk above got its home after nine private copies. Catalogue
 * walks reached seven before anyone counted -- three in `i18n.test.ts`, one
 * each in `locale-fallbacks.test.ts`, `message-characterisation.test.ts`,
 * `translate.test.ts` and `copy-reaches-a-page.spec.ts` -- and #136 wrote an
 * eighth while adding a guard. They disagreed the way the directory walkers
 * did: one never entered arrays, so a message added to a list would have been
 * invisible to the check built on it, and one spelled a position `a.0` where
 * the rest wrote `a[0]`. A search for `Array.isArray` found six of them; this
 * rule found the seventh, which never asks.
 *
 * Structural, like the rule above, and parsed rather than matched: what makes
 * a walk is a function referring to ITSELF, and only a parse knows which
 * function a name sits inside. A named function that calls or hands on its
 * own name (`walk(v)`, `value.forEach(walk)`) while taking a table apart with
 * `Object.entries`, `Object.values` or `Object.keys` is a walk, whatever it is
 * called.
 *
 * KNOWN LIMIT: the test tree only. `scripts/` and `src/` still hold walks of
 * their own -- the scaffold's `render`, back-translation's paired
 * `unitsBetween` -- and a guard importing the shipped walk would depend on
 * the thing it checks.
 * The walk itself now ships (#97); its behaviour is pinned by
 * `catalogue-leaves.test.ts`, which the move does not change.
 */
const TAKES_A_TABLE_APART = new Set([
  'Object.entries',
  'Object.values',
  'Object.keys',
]);

/** Every node inside `node`, depth first. */
function nodesWithin(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (child: ts.Node): void => {
    found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

export function definesACatalogueWalker(source: string): boolean {
  return nodesWithin(parseSource(source)).some((node) => {
    const name = ts.isFunctionLike(node) ? declaredName(node) : null;
    if (!name) return false;
    const calls = nodesWithin(node).filter(ts.isCallExpression);
    const takesATableApart = calls.some((call) =>
      TAKES_A_TABLE_APART.has(call.expression.getText()),
    );
    const refersToItself = calls.some((call) =>
      [call.expression, ...call.arguments].some(
        (part) => ts.isIdentifier(part) && part.text === name,
      ),
    );
    return takesATableApart && refersToItself;
  });
}

describe('walking a catalogue has exactly one home', () => {
  it('is implemented only in src/lib/catalogue-leaves.ts', () => {
    // The walk moved out of the test tree for #97, because the Pages Function
    // that validates a report needs it and shipped code cannot import tests/.
    // The rule still scans the test tree; it adds the one home in src/.
    const HOME = 'src/lib/catalogue-leaves.ts';
    const scanned = [
      ...SCANNED.filter((path) => path.startsWith('tests/')),
      HOME,
    ];
    expect(
      scanned.filter((path) =>
        definesACatalogueWalker(readFileSync(path, 'utf8')),
      ),
    ).toEqual([HOME]);
  });

  it('catches a walker whatever it is called', () => {
    expect(
      definesACatalogueWalker(`
        const gather = (node: unknown, at = ''): Array<[string, string]> => {
          if (typeof node === 'string') return [[at, node]];
          if (Array.isArray(node))
            return node.flatMap((v, i) => gather(v, at + '[' + i + ']'));
          return node && typeof node === 'object'
            ? Object.entries(node).flatMap(([k, v]) => gather(v, k))
            : [];
        };
      `),
    ).toBe(true);
  });

  it('catches one that hands itself on instead of calling itself', () => {
    expect(
      definesACatalogueWalker(`
        function collect(value: unknown): void {
          if (Array.isArray(value)) return value.forEach(collect);
          if (value && typeof value === 'object')
            return Object.values(value).forEach(collect);
          strings.add(String(value));
        }
      `),
    ).toBe(true);
  });

  it('is not fired by a comment describing one', () => {
    expect(
      definesACatalogueWalker(`
        // function walk(value) { return Object.values(value).forEach(walk); }
        const groups = Object.keys(siteEn);
      `),
    ).toBe(false);
  });

  it('is not fired by reading a table one level deep', () => {
    expect(
      definesACatalogueWalker(`
        function unusedGroups(): string[] {
          return Object.entries(siteEn)
            .filter(([, value]) => value && typeof value === 'object')
            .map(([group]) => group);
        }
      `),
    ).toBe(false);
  });

  it('is not fired by a recursion over something other than a table', () => {
    expect(
      definesACatalogueWalker(`
        const visit = (node: ts.Node): void => {
          kinds.push(node.kind);
          ts.forEachChild(node, visit);
        };
      `),
    ).toBe(false);
  });
});

/**
 * A directory read whose result a guard will scan, without proving the read
 * found anything (#84).
 *
 * `nonEmpty()` in `tests/source-files.ts` is that proof, and it has to wrap
 * the read itself. Eleven call sites hand-wrote
 * `expect(files.length).toBeGreaterThan(0)` — five copying a comment that
 * cites a sibling — and four forgot, leaving fifteen tests passing while they
 * scanned nothing at all. #79 settled the same argument for browser events:
 * the control belongs in the collector, because a call site cannot forget
 * what it never writes.
 *
 * Takes SOURCE, not a path, so the mutation tests below can hand it text that
 * is not on disk.
 *
 * KNOWN LIMIT — lexical, deliberately. `nonEmpty(` must be the token
 * immediately before the read, whitespace aside, so `nonEmpty(wrap(read…))`
 * would be reported although it is proved. No such shape exists in this repo,
 * and a rule a reader can check by eye beats one that needs a parser. It also
 * cannot see a read whose result is proved LATER, by a caller — that is the
 * convention #84 removed, and reporting it is the point, not a false
 * positive.
 */
const PROVED_RIGHT_HERE = /\bnonEmpty\s*\(\s*$/;

export function readsADirectoryUnproved(source: string): boolean {
  const code = withoutTsComments(source);
  // Built per call, never shared: a module-level /g regex carries `lastIndex`
  // between calls, so an early return would leave the next caller scanning
  // from halfway through its own file.
  const reads = /\breaddirSync\s*\(/g;
  for (let hit = reads.exec(code); hit; hit = reads.exec(code))
    if (!PROVED_RIGHT_HERE.test(code.slice(0, hit.index))) return true;
  return false;
}

describe('a directory read cannot reach a guard unproved', () => {
  it('is unwrapped only where the walk itself lives', () => {
    expect(
      SCANNED.filter((path) =>
        readsADirectoryUnproved(readFileSync(path, 'utf8')),
      ),
    ).toEqual([
      // The artifact walk (#459): an empty artifact is input for
      // validateArtifact to refuse by name, never an exception here.
      'scripts/visual-rebaseline.mjs',
      // The recursion. An empty sub-result is ordinary here and must stay
      // that way, so the proof belongs to the exported top-level form.
      'tests/source-files.ts',
      // The detector's own fixtures, which have to spell the syntax out in
      // order to prove the detector catches it.
      'tests/unit/one-home.test.ts',
    ]);
  });

  it('catches an unproved read however it is written', () => {
    expect(readsADirectoryUnproved("const x = readdirSync('dir');")).toBe(true);
    expect(
      readsADirectoryUnproved('const x = readdirSync(dir).filter(f);'),
    ).toBe(true);
  });

  it('accepts a read proved at the point of reading', () => {
    expect(
      readsADirectoryUnproved("const x = nonEmpty(readdirSync(dir), 'files');"),
    ).toBe(false);
    expect(
      readsADirectoryUnproved(
        "const x = nonEmpty(\n  readdirSync(dir).filter(f),\n  'files',\n);",
      ),
    ).toBe(false);
  });

  it('is not satisfied by a nonEmpty somewhere ELSE in the file', () => {
    // The whole reason the rule is lexical. "This file imports nonEmpty"
    // would be trivially satisfiable — use it once, then add a bare read —
    // which is the vacuity this ticket exists to remove, not to re-create.
    expect(
      readsADirectoryUnproved(
        "const a = nonEmpty(readdirSync(x), 'a');\nconst b = readdirSync(y);",
      ),
    ).toBe(true);
  });

  it('is not fired by a comment describing one', () => {
    expect(
      readsADirectoryUnproved(
        '// a bare readdirSync(dir) here would be unproved\nconst x = 1;',
      ),
    ).toBe(false);
  });
});

/**
 * Reading what a caught value says lives in `scripts/errors.mjs` too
 * (`messageOf`), for the reason its docblock gives: `catch` binds `unknown`.
 *
 * #390's review found five private copies of its one line -- two scripts,
 * two tests and a device helper -- after the review itself had written one
 * into a new test. Each was correct, and a correct copy is still how the
 * directory walkers above came to disagree.
 *
 * Structural: a conditional whose test is `x instanceof Error` and whose
 * true branch reads `x.message`, whatever `x` is called. A comment naming
 * the pattern never reaches the parse.
 */
export function readsACaughtMessage(source: string): boolean {
  return nodesWithin(parseSource(source)).some(
    (node) =>
      ts.isConditionalExpression(node) &&
      ts.isBinaryExpression(node.condition) &&
      node.condition.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      node.condition.right.getText() === 'Error' &&
      ts.isPropertyAccessExpression(node.whenTrue) &&
      node.whenTrue.name.text === 'message' &&
      node.whenTrue.expression.getText() === node.condition.left.getText(),
  );
}

describe("reading a caught value's message has exactly one home", () => {
  it('is implemented only in scripts/errors.mjs', () => {
    expect(
      SCANNED.filter((path) => readsACaughtMessage(readFileSync(path, 'utf8'))),
    ).toEqual(['scripts/errors.mjs']);
  });

  it('catches a copy whatever the value is called', () => {
    expect(
      readsACaughtMessage(
        'try { run(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); }',
      ),
    ).toBe(true);
  });

  it('is not fired by a comment describing one', () => {
    expect(
      readsACaughtMessage(
        '// error instanceof Error ? error.message : String(error)\nconst x = 1;',
      ),
    ).toBe(false);
  });

  it('is not fired by reading the message of something else', () => {
    expect(
      readsACaughtMessage(
        'const s = error instanceof Error ? fallback.message : "";',
      ),
    ).toBe(false);
  });

  // One fixture per clause of the detector, each refused by that clause
  // alone, so a mutation dropping any one of them goes red.
  it.each([
    ['another property', 'error instanceof Error ? error.stack : ""'],
    ['a narrower class', 'error instanceof TypeError ? error.message : ""'],
    ['a test that is not instanceof', 'error === Error ? error.message : ""'],
    ['a guard, not a choice', 'error instanceof Error && error.stack'],
  ])('is not fired by %s', (_, code) => {
    expect(readsACaughtMessage(`const s = ${code};`)).toBe(false);
  });
});
