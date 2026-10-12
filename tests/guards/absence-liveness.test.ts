import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { floorBreach } from '../floors';
import {
  DISCOVERY,
  absenceSubject,
  absencesWritten,
  scanAbsences,
  unclassified,
  unproved,
} from '../absence-liveness';
import { ABSENCE_BURN_DOWN } from '../absence-liveness.burn-down';
import { burnDownBreaches } from '../burn-down';
import {
  committableFiles,
  filesUnder,
  isTsUnderTests,
  searched,
  walkDisagreements,
} from '../source-files';
import {
  bind,
  bindFiles,
  callGraph,
  parseFile,
  parseSource,
  seededClosure,
} from '../unit/ast';

/**
 * An absence assertion must prove its POPULATION was live (#118).
 *
 * `expect(findings).toEqual([])` is green in two different worlds: the guard
 * ran over a real subject and found nothing, and the guard was handed nothing
 * to run over. #84 measured what that costs -- twelve tests passed while
 * scanning zero files -- and put the control inside the file walk. #79 did
 * the same for browser events, inside the recorder. Neither generalised to
 * the third and largest case: a guard that BUILDS a list, from a file walk, a
 * match set, or a table read, and then asserts the list is empty.
 *
 * The control now lives inside the assertion's own expression:
 *
 *     expect(searched(findings, { of: files, what: 'files' })).toEqual([]);
 *
 * Every absence is judged, whatever its shape (#609, the operator's rule
 * from #534: no exceptions). Two structural shapes name their reason:
 *
 *  - **A collector** — a variable initialised empty and accumulated into, or
 *    produced by `.filter()` / `.flatMap()`, whether the call is in the
 *    binding's initialiser or written inline in the subject. Its emptiness
 *    says nothing until you know the thing it accumulated FROM was not empty.
 *  - **A discovery** — a subject whose derivation transitively reaches the
 *    filesystem. `const result = scan()` three hops above a `readFileSync` is
 *    the shape `anchored-presence.test.ts` uses on itself.
 *
 * Anything else not routed through `searched(` is "self-contained", and that
 * is a finding too. This guard used to put it out of scope --
 * `expect(rosterWarnings([], en)).toEqual([])`, "its population is the literal
 * written beside it" -- and 185 of 470 sites in 60 files went unjudged, with
 * neither a population in the verdict nor a floor, while the floor guard
 * judged only `searched(` calls and saw nothing either. A category the guard
 * cannot see is an exemption by another name.
 *
 * Today's unjudged sites are DEBT, listed in `absence-liveness.burn-down.ts`
 * by `file › test title as written`, and checked for equality both ways: a
 * converted site is red until the list is lowered, and a new unjudged site is
 * red by name. The list only shrinks, and nothing exempts a site by shape,
 * label or reason; the conversions (#610-#617) empty it.
 *
 * `.not.toEqual([])` is a PRESENCE assertion and is skipped: it fails, loudly,
 * on an empty population, so it cannot hide one.
 *
 * The scan covers EVERY `.ts` under `tests/`, not just `*.test.ts` and
 * `*.spec.ts`. That filter looked like a definition and was really a
 * hand-drawn boundary -- the kind #24's sweep was built on and #60 and #65
 * then found survivors outside. It excluded `tests/e2e/recorders.ts`, which
 * is where #79's collector-liveness lesson was learned and which carries
 * three absence assertions of its own. Derive the scope from the filesystem,
 * including for your own guard.
 */

const tsFiles = filesUnder('tests', (path) => path.endsWith('.ts'));
const discoverers = callGraph(tsFiles).close(DISCOVERY);

/** Bound once: each name resolves in its own scope, not by name (#184). */
const bound = bindFiles(tsFiles);

const result = scanAbsences(bound, discoverers);

const CEILING_SITES = 107;
const CEILING_SCOPES = 103;

describe('absence assertions prove the population they searched', () => {
  // Separate from the verdict, and load-bearing: the verdict below is itself
  // an absence assertion, so a detector whose AST walk quietly stopped
  // matching would report zero findings over zero absences -- and only one of
  // those is good news. This is the shape `event-collectors.test.ts` settled.
  it('finds the absence assertions it is meant to be judging', () => {
    // Ratcheted (#468): exact against tests/floors.json, so one file short
    // fails, and so does one more until it is recorded.
    expect(
      floorBreach('absence-liveness/ts-files', tsFiles.length),
    ).toBeUndefined();
    // The figure is recorded exactly rather than left comfortably low, for
    // the reason `anchored-presence` records: a control with slack in it is
    // most of the way back to no control at all. #184 found it at 100 over a
    // real 154, and showed what that slack costs: with the `toHaveLength(0)` branch of
    // `absenceSubject` dead, this test stayed green. #390 F161 found it
    // there again, at 153 over a real 391, with the same branch dead and
    // the same test green; F159's spellings brought the figure to 394,
    // and #446 measured 399 on 2026-10-03. Groups 2a and 2b added 22 the
    // same day and left it 22 slack, which is how a floor drifts: growth
    // never fails it. Re-measured 421 at Group 3 (#446), and 424 an hour
    // after that merged: so it is ratcheted now (#468), exact both ways.
    expect(
      floorBreach('absence-liveness/sites', result.sites.length),
    ).toBeUndefined();
    expect(result.proved).toBeGreaterThan(0);
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
      floorBreach('absence-liveness/walked-files', tsFiles.length),
    ).toBeUndefined();
  });

  it('reads an absence however it is spelled, and never its inverse', () => {
    // Only `toEqual([])` and `toHaveLength(0)` were read, so an absence
    // written `expect(found.length).toBe(0)` over a file walk was never
    // judged (#390 F159).
    const sf = ts.createSourceFile(
      'fixture.test.ts',
      [
        'expect(a).toEqual([]);',
        'expect(b).toStrictEqual([]);',
        'expect(c).toHaveLength(0);',
        'expect(d.length).toBe(0);',
        'expect(e.size).toBe(0);',
        'expect(f.length).toEqual(0);',
        'expect(g.length).toStrictEqual(0);',
        'expect.soft(l).toEqual([]);',
        'expect.soft(m.length).toBe(0);',
        'expect(h).not.toEqual([]);',
        'expect(i.length).not.toBe(0);',
        'expect(j.length).toBe(1);',
        'expect(k).toBe(0);',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );
    const subjects: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const subject = absenceSubject(node);
        if (subject) subjects.push(subject.getText(sf));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(subjects).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'l', 'm']);
  });

  it('judges a subject that is not routed through searched, whatever its shape', () => {
    // Planted (#609). Written out, never generated from `unproved`'s own
    // branches: a plant built from the reader's list cannot see it drop one.
    // The fixture is bound on its own, closures seeded: judged against the
    // real tree, its subjects derived from that tree's file reads, and the
    // presence reader counted five raw-source assertions here (#662).
    const reasonFor = (subject: string): string | null => {
      const fixture = bind(
        new Map([['fixture.test.ts', `expect(${subject}).toEqual([]);`]]),
      );
      const sf = fixture.files.get('fixture.test.ts')!;
      let why: string | null = 'no absence read';
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const read = absenceSubject(node);
          if (read)
            why = unproved(
              read,
              'fixture.test.ts',
              fixture,
              seededClosure(...DISCOVERY),
            );
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return why;
    };
    // The exempt shape: a call over input written beside it.
    expect(reasonFor('rosterWarnings([], en)')).toMatch(/^self-contained/);
    expect(reasonFor('plantedNameNothingDeclares')).toMatch(/^self-contained/);
    // An inline derivation, read on the subject itself, in every position of
    // the receiver chain.
    expect(reasonFor('LOCALES.filter((l) => l !== "en")')).toMatch(
      /^derived by \.filter\(\)/,
    );
    expect(reasonFor('rows.flatMap((r) => r.cells)')).toMatch(
      /^derived by \.flatMap\(\)/,
    );
    expect(reasonFor('rows.filter((r) => r.bad).map((r) => r.id)')).toMatch(
      /^derived by \.filter\(\)/,
    );
    // Routed through the helper: the population is in the verdict.
    expect(reasonFor("searched(f, { of: p, what: 'w' })")).toBeNull();
  });

  it('refuses an absence on a root it cannot classify, rather than skipping it', () => {
    // `expect.soft(x)` asserts like `expect(x)` and is read above. Any other
    // root -- `expect.poll(fn)`, an alias, a helper returning a matcher -- was
    // silently not an absence at all, so nothing judged it (#446, control d).
    const sf = ts.createSourceFile(
      'fixture.test.ts',
      [
        'expect.poll(n).toEqual([]);',
        'assertThat(o).toHaveLength(0);',
        'expect.poll(() => p.length).toBe(0);',
        'expect.poll(t).toBe(0);',
        'expect.poll(async () => { return u.size; }).toBe(0);',
        'assertThat(v.length).toBe(0);',
        // Not refused: a value held to 0, a polled value, the two roots that
        // are read, and an inverse.
        'assertThat(w).toBe(0);',
        'expect\n  .poll(async () => (await counters(x)).inflight)\n  .toBe(0);',
        'expect.soft(q).toEqual([]);',
        'expect(r).toEqual([]);',
        'expect.poll(s).not.toEqual([]);',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );
    const refused: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const root = unclassified(node);
        if (root) refused.push(root);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(refused).toEqual([
      'expect.poll(n)',
      'assertThat(o)',
      'expect.poll(() => p.length)',
      'expect.poll(t)',
      'expect.poll(async () => { return u.size; })',
      'assertThat(v.length)',
    ]);
  });

  it('reads as text every spelling the reader reads, and no inverse', () => {
    // The cross-check below is only independent if it knows the same forms.
    // Written out, never generated from either reader's list: a plant built
    // from the list a reader uses cannot see that list drop a form (#446).
    const read = [
      'expect(a).toEqual([]);',
      'expect(b).toStrictEqual([]);',
      'expect(c).toHaveLength(0);',
      'expect(d.length).toBe(0);',
      'expect(e.size).toBe(0);',
      'expect(f.length).toEqual(0);',
      'expect(g.length).toStrictEqual(0);',
      'expect.soft(l).toEqual([]);',
      'expect.soft(m.length).toBe(0);',
      // Split by prettier, and with a message: the forms a line-by-line
      // reading of raw text could not see (#477).
      'expect(\n  n,\n).toEqual(\n  [],\n);',
      'expect(o.length, "why").toBe(0);',
      'expect(\n  p.size,\n  `why`,\n).toBe(0);',
      'expect(q)\n  .toHaveLength(0);',
    ];
    const inverse = [
      'expect(h).not.toEqual([]);',
      'expect(i.length).not.toBe(0);',
      'expect(j.length).toBe(1);',
      'expect(k).toBe(0);',
      'expect(r)\n  .not\n  .toHaveLength(0);',
      // A value, not a population: the AST reads no subject here either.
      'expect(s.length - t.length, "why").toBe(0);',
      // A fixture that spells an absence holds none (#477).
      "const u = 'expect(a).toEqual([])';",
      'const v = `expect(${w}).toHaveLength(0)`;',
      String.raw`const x = /expect\(y\)\.toEqual\(\[\]\)/;`,
      '// expect(z).toEqual([]);',
    ];
    const missed = read.filter(
      (line) => absencesWritten(parseSource(line)) !== 1,
    );
    expect(searched(missed, { of: read, what: 'planted absences' })).toEqual(
      [],
    );
    const misread = inverse.filter(
      (line) => absencesWritten(parseSource(line)) !== 0,
    );
    expect(
      searched(misread, { of: inverse, what: 'planted non-absences' }),
    ).toEqual([]);
    // A spelling quietly deleted from either table drops its check (#522).
    expect(
      floorBreach('absence-liveness/planted-absences', read.length),
    ).toBeUndefined();
    expect(
      floorBreach('absence-liveness/planted-non-absences', inverse.length),
    ).toBeUndefined();
  });

  it('reads as many absences in each file as its text writes', () => {
    // Independent of the AST walk (#446, control c), and per unit (#477): a
    // reader blind to one spelling in a file that writes two others was
    // invisible to a file-level check. Counted in code with every literal
    // and comment removed, so neither a fixture string nor a comment naming
    // the matcher can satisfy it.
    const written = new Map(
      tsFiles.map((file) => [file, absencesWritten(parseFile(file))]),
    );
    const disagree = tsFiles
      .filter((file) => (result.perFile.get(file) ?? 0) !== written.get(file))
      .map(
        (file) =>
          `${file}: the reader found ${result.perFile.get(file) ?? 0}, ` +
          `its text writes ${written.get(file)}`,
      );
    expect(searched(disagree, { of: tsFiles, what: 'files' })).toEqual([]);
    // Ratcheted after the verdict (#468), so growth never hides a finding:
    // the files compared (#522), then those that write an absence.
    expect(
      floorBreach('absence-liveness/compared-files', tsFiles.length),
    ).toBeUndefined();
    expect(
      floorBreach(
        'absence-liveness/plain-files',
        tsFiles.filter((file) => (written.get(file) ?? 0) > 0).length,
      ),
    ).toBeUndefined();
  });

  it('finds every scope holding exactly the unjudged absences listed', () => {
    // The listed sites are today's debt (#609), keyed by the test that holds
    // them. Equality both ways: a converted site leaves its key too high and
    // is red until the list is lowered, and a new unjudged site is red by
    // name. Nothing is exempt by shape, label or reason.
    const mismatched = burnDownBreaches(result.unjudged, ABSENCE_BURN_DOWN).map(
      ({ key, read, listed }) =>
        read > listed
          ? `${key}: ${read} absences with no population in the verdict, ${listed} listed. Route each through searched() and check a floor.`
          : `${key}: ${read} unjudged, ${listed} listed. Lower the entry in tests/absence-liveness.burn-down.ts: the list only shrinks.`,
    );
    expect(
      searched(result.findings, {
        of: result.sites,
        what: 'absence assertions',
      }),
      result.findings.join('\n'),
    ).toEqual([]);
    expect(
      searched(mismatched, { of: result.sites, what: 'absence assertions' }),
      mismatched.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('absence-liveness/judged-sites', result.sites.length),
    ).toBeUndefined();
  });

  it('only shrinks the burn-down list', () => {
    // Measured when the list landed (#609); a conversion lowers these with
    // the list and nothing else raises them. The recorded floor holds the
    // list's own size, so a key quietly deleted from it is seen.
    const counts = Object.values(ABSENCE_BURN_DOWN);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(
      CEILING_SITES,
    );
    expect(counts.length).toBeLessThanOrEqual(CEILING_SCOPES);
    expect(counts.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
    expect(
      floorBreach('absence-liveness/burn-down-scopes', counts.length),
    ).toBeUndefined();
  });
});
