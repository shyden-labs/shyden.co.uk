import { describe, it, expect } from 'vitest';
import {
  committableFiles,
  filesUnder,
  isTsUnderTests,
  searched,
  walkDisagreements,
} from '../source-files';
import { bind, bindFiles, callGraph, parseFile, type Closure } from './ast';
import { presenceOverRawText } from './presence-text';
import { scanPresence, type PresenceClosures } from './presence-detector';
import { floorBreach } from '../floors';
/**
 * A presence assertion over source text must be STRIPPED or ANCHORED.
 *
 * Four sweeps established the absence direction of this class: a guard
 * asserting something is missing, fouled by a comment naming it. That one
 * goes RED, so you find out. The presence direction stays GREEN, and keeps
 * staying green after the thing it guards is deleted (#98).
 *
 * `.gitignore` carried the sharpest example: `toContain('.env.*')` was
 * satisfied by `# .env.*` while the rule ignored nothing, and that rule is
 * what stands between a real API key and a public repo.
 *
 * Three ways out, and this guard accepts any of them:
 *
 *  - **Stripped** — the text reaches the assertion through a comment
 *    remover. Detected TRANSITIVELY, because `locale-switcher.test.ts`'s
 *    `source()` strips inside itself and its call sites therefore read as
 *    unstripped. Three hand-written derivations for #98 each got this wrong
 *    by looking only at the call site.
 *  - **Anchored** — the matcher is a regex whose every top-level alternative
 *    starts with `^`, pinning the real syntax to a line. Any regex used to
 *    count, and `toMatch(/foo/)` matches exactly the text `toContain('foo')`
 *    does (#183). Preferred by #98's own AC, because stripping removes ONE
 *    way of faking the claim while an import left behind after the code was
 *    deleted is another, and only an anchor caught it. But an anchor is not
 *    a stripper: a BLOCK comment's inner lines are lines, and `^` matches
 *    them. A block comment below the migration's table, holding the old
 *    `quote` line, satisfied `report-endpoint`'s anchored check while the
 *    column itself had changed (#390 F160). Over a language with block
 *    comments, strip AND anchor.
 *  - **Comment-derived** — the text is BUILT from comments
 *    (`isMarkerCommentLine`, `commentsIn`), so the assertion is about the
 *    documentation by design, and a comment satisfying it is the point:
 *    `.env.example` explaining the `:fx` suffix. Recognised from the
 *    derivation, closed over callers like the strippers, never from a list
 *    of exempt sites.
 *
 * Deliberately NOT flagged, both measured rather than assumed:
 *
 *  - a list of file NAMES (`readdirSync`, `specDirs()`, `pageNames()`). A
 *    comment cannot hide in a filename. Including these produced twelve
 *    false positives and no real findings.
 *  - PARSED data (`JSON.parse`). JSON carries no comments, so
 *    `pkg.scripts['test:e2e']` cannot be satisfied by one. The exemption is
 *    the CALL standing between the read and the subject, never a name, and
 *    a read that also reaches the subject around its parse is scanned (#225).
 */

const READS_CONTENT = new Set(['readFileSync']);
const STRIPPERS = new Set([
  'withoutTsComments',
  'withoutMarkupComments',
  'withoutCommentLines',
  'withoutYamlComments',
  'withoutIniComments',
  'blankCommentLines',
  'withoutAstroComments',
  'withoutSqlComments',
  'withoutYamlQuotes',
]);
const COMMENT_READERS = new Set(['isMarkerCommentLine', 'commentsIn']);

const tsFiles = filesUnder('tests', (path) => path.endsWith('.ts'));

/**
 * Both properties are inherited by CALLERS, so both are closed transitively
 * over the whole of `tests/**` -- see `./ast`, which #118 extracted from here
 * so a second meta-guard could reason the same way without a second copy.
 */
const graph = callGraph(tsFiles);
const readers = graph.close(READS_CONTENT);
const strippers = graph.close(STRIPPERS);
const commentReaders = graph.close(COMMENT_READERS);

/**
 * Every file bound into one program, so a local name resolves to the
 * declaration its own scope sees. Resolved by bare name, `config` at
 * `supply-chain.test.ts:206` reached another test's `parseCleanYaml(...)`, and
 * a stripped assertion read as raw (#184).
 */
const bound = bindFiles(tsFiles);

const result = scanPresence(bound, { readers, strippers, commentReaders });

/** A closure whose seeds are the whole answer, so a fixture needs no graph. */
const seeded = (...names: string[]): Closure => ({
  reaches: (_file, name) => names.includes(name),
});

const FIXTURE_CLOSURES: PresenceClosures = {
  readers: seeded('readFileSync'),
  strippers: seeded('withoutTsComments'),
  commentReaders: seeded('isMarkerCommentLine', 'commentsIn'),
};

/** The line of every assertion the detector flags in one fixture test file. */
function flaggedLines(source: string): number[] {
  const bound = bind(new Map([['fixture.test.ts', source]]));
  return scanPresence(bound, FIXTURE_CLOSURES).findings.map((finding) =>
    Number(/^fixture\.test\.ts:(\d+) /.exec(finding)?.[1]),
  );
}

/** Each matcher on its own line under one raw read, so a line names a case. */
const overRaw = (...matchers: string[]): string =>
  [
    "const raw = readFileSync('x.ts', 'utf8');",
    ...matchers.map((matcher) => `expect(raw).${matcher};`),
  ].join('\n');

describe('the detector counts only a real anchor (#183)', () => {
  it('flags an unanchored regex over raw source, as it flags toContain', () => {
    expect(flaggedLines(overRaw("toContain('foo')", 'toMatch(/foo/)'))).toEqual(
      [2, 3],
    );
  });

  it('accepts a regex whose every alternative starts at a line', () => {
    expect(
      flaggedLines(
        overRaw('toMatch(/^foo$/m)', 'toMatch(/^foo/)', 'toMatch(/^a|^b/m)'),
      ),
    ).toEqual([]);
  });

  it('does not count `$` alone, or an anchor on only one alternative', () => {
    expect(
      flaggedLines(overRaw('toMatch(/foo$/m)', 'toMatch(/^a|b/m)')),
    ).toEqual([2, 3]);
  });

  it('does not read an escaped caret or a negated class as an anchor', () => {
    expect(
      flaggedLines(overRaw('toMatch(/\\^foo/)', 'toMatch(/[^x]foo/)')),
    ).toEqual([2, 3]);
  });

  it('splits alternatives only at the top level', () => {
    expect(
      flaggedLines(
        overRaw(
          'toMatch(/^[a|b]c/)',
          'toMatch(/^(a|b)c/)',
          'toMatch(/^a\\|b/)',
        ),
      ),
    ).toEqual([]);
  });

  it('flags a string handed to toMatch, which is a substring test', () => {
    expect(flaggedLines(overRaw("toMatch('foo')"))).toEqual([2]);
  });

  it('accepts stripped text with any matcher', () => {
    expect(
      flaggedLines(
        [
          "const code = withoutTsComments(readFileSync('x.ts', 'utf8'));",
          "expect(code).toContain('foo');",
          'expect(code).toMatch(/foo/);',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('accepts text derived from the comments, which asserts documentation', () => {
    expect(
      flaggedLines(
        [
          "const example = readFileSync('.env.example', 'utf8');",
          'const docs = example',
          "  .split('\\n')",
          "  .filter((line) => isMarkerCommentLine(line, '#'))",
          "  .join('\\n');",
          'expect(docs).toMatch(/:fx\\b/);',
          'const prose = commentsIn(parseSource(example)).map((c) => c.pos);',
          "expect(prose).toContain('timeout');",
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('scans only content reads in test files, and never parsed data', () => {
    const scanOf = (file: string, source: string) =>
      scanPresence(bind(new Map([[file, source]])), FIXTURE_CLOSURES);
    const parsed = [
      "const pkg = JSON.parse(readFileSync('package.json', 'utf8'));",
      "expect(pkg.scripts).toContain('test');",
    ].join('\n');

    expect(scanOf('fixture.test.ts', overRaw("toContain('foo')"))).toEqual({
      scanned: 1,
      perFile: new Map([['fixture.test.ts', 1]]),
      findings: [expect.stringMatching(/^fixture\.test\.ts:2 /)],
    });
    expect(scanOf('helper.ts', overRaw("toContain('foo')")).scanned).toBe(0);
    expect(scanOf('fixture.test.ts', parsed).scanned).toBe(0);
  });
});

describe('the detector exempts a read only where JSON.parse stands between it and the subject (#225)', () => {
  // JSON carries no comments, so a comment cannot satisfy a matcher over
  // parsed data: the PARSE is the exemption, and a name is not a parse. The
  // detector once skipped any subject whose derivation mentioned `JSON` or
  // `parse` anywhere, so a helper's `JSON.stringify` exempted a raw read.
  it('scans a raw read whose derivation reaches a helper calling JSON.stringify', () => {
    expect(
      flaggedLines(
        [
          'const stamp = () => JSON.stringify({ at: 1 });',
          "const text = readFileSync('package.json', 'utf8') + stamp();",
          "expect(text).toContain('name');",
        ].join('\n'),
      ),
    ).toEqual([3]);
  });

  it('reads a bare JSON or parse name as no parse at all', () => {
    // A method called `parse` is not JSON's: Markdown parsed to HTML keeps
    // every `<!-- comment -->`, so a comment can still satisfy the matcher.
    expect(
      flaggedLines(
        [
          'const parse = (text: string) => text.trim();',
          "const raw = parse(readFileSync('x.ts', 'utf8'));",
          "expect(raw).toContain('foo');",
          "expect(JSON.stringify(readFileSync('x.ts', 'utf8'))).toContain('foo');",
          "expect(marked.parse(readFileSync('x.md', 'utf8'))).toContain('foo');",
        ].join('\n'),
      ),
    ).toEqual([3, 4, 5]);
  });

  it('leaves a read passed through JSON.parse unscanned, directly or through a local', () => {
    const source = [
      "expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts).toContain('test');",
      "const text = readFileSync('package.json', 'utf8');",
      "expect(JSON.parse(text).name).toContain('shyden');",
      "const pkg = JSON.parse(readFileSync('package.json', 'utf8'));",
      "expect(pkg.scripts).toContain('test');",
      "const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));",
      "expect(readJson('package.json').scripts).toContain('test');",
      "expect(readFileSync('x.ts', 'utf8')).toContain('control');",
    ].join('\n');
    // The call graph counts `readJson` among the readers, because it calls
    // `readFileSync`. Only its body shows the read never leaves the parse,
    // so the fixture seeds it as the graph would.
    const closures = {
      ...FIXTURE_CLOSURES,
      readers: seeded('readFileSync', 'readJson'),
    };
    expect(
      scanPresence(bind(new Map([['fixture.test.ts', source]])), closures),
    ).toEqual({
      scanned: 1,
      perFile: new Map([['fixture.test.ts', 1]]),
      findings: [expect.stringMatching(/^fixture\.test\.ts:8 /)],
    });
  });

  it('scans a read that also reaches the subject around its parse', () => {
    expect(
      flaggedLines(
        [
          "const text = readFileSync('package.json', 'utf8');",
          'const pkg = JSON.parse(text);',
          "expect(text + pkg.name).toContain('shyden');",
          "const clean = JSON.parse(withoutTsComments(readFileSync('a.json', 'utf8')));",
          "expect(text + clean.name).toContain('shyden');",
        ].join('\n'),
      ),
    ).toEqual([3, 5]);
  });
});

describe('presence assertions over source text are stripped or anchored', () => {
  // The liveness control, and the reason it is a SEPARATE assertion: the
  // verdict below asserts absence, so a detector whose AST walk quietly
  // stopped matching would report zero findings and zero scanned, and only
  // one of those is good news. `event-collectors.test.ts` settled this shape.
  it('scans the presence assertions that actually read source text', () => {
    // The figure is recorded exactly (#468), because slack here has cost
    // before: the floor sat at 20 while the truth was 27, so a control with that much slack in it is most of the way
    // back to no control at all. #118 moved the number twice -- UP as the
    // derivation learned to follow local bindings to a fixed point, then back
    // DOWN as it stopped reading object-literal keys and parameter names as
    // references. Both were corrections, not drift. #184 found this comment
    // still saying 28 over a real 42, and moved the figure to 45: resolving
    // names by scope brought in three assertions a file-wide map had been
    // sending to another test's declaration. #225 measured 46 (the suite had
    // grown by one under a floor of 44) and moved it to 48: two `evidence-page`
    // assertions a helper's `JSON.stringify` had been exempting as parsed. #390
    // found 77 under that floor of 47, the suite having grown with nobody
    // moving it, and set it to the 77. #454 took one away on purpose: a text
    // check on visual.mjs's import became a check of the image it uses, so 76.
    expect(
      floorBreach('anchored-presence/scanned', result.scanned),
    ).toBeUndefined();
    expect(
      floorBreach('anchored-presence/ts-files', tsFiles.length),
    ).toBeUndefined();
  });

  it('walks every .ts file git has under tests/', () => {
    // Independent of the walk (#477): git's list, not the disk, so a walk
    // that narrows (skips a directory, a suffix) names what it dropped.
    expect(
      searched(walkDisagreements(tsFiles, committableFiles(isTsUnderTests)), {
        of: tsFiles,
        what: 'files under tests/',
      }),
    ).toEqual([]);
    // The walk and git's list can narrow together, and agree over less (#522).
    expect(
      floorBreach('anchored-presence/walked-files', tsFiles.length),
    ).toBeUndefined();
  });

  it('scans, in each file, the presence its text writes over raw file text', () => {
    // Independent of the dataflow reader (#477): per file, the reader judged
    // exactly what a text reading counts. Fewer is a reader blind to a form;
    // more is a reader counting a read that is not one, which is how two
    // names resolved across modules by bare name were found (a `config` from
    // playwright.config.ts, a destructured `source`). The text follows no
    // import, so a subject read through an imported helper would disagree
    // here by name: then the text reading learns to follow imports.
    const testFiles = tsFiles.filter((file) => /\.(test|spec)\.ts$/.test(file));
    const disagree = testFiles
      .map((file) => ({
        file,
        judged: result.perFile.get(file) ?? 0,
        written: presenceOverRawText(parseFile(file)),
      }))
      .filter(({ judged, written }) => judged !== written)
      .map(
        ({ file, judged, written }) =>
          `${file}: the reader judged ${judged}, its text writes ${written}`,
      );
    expect(searched(disagree, { of: testFiles, what: 'test files' })).toEqual(
      [],
    );
    expect(
      floorBreach('anchored-presence/compared-test-files', testFiles.length),
    ).toBeUndefined();
  });

  it('finds none reading raw source with an unanchored matcher', () => {
    expect(
      searched(result.findings, {
        of: result.scanned,
        what: 'presence assertions over source text',
      }),
      result.findings.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('anchored-presence/judged-scanned', result.scanned),
    ).toBeUndefined();
  });
});
