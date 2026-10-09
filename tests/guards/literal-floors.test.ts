import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { floorBreach, readFloors } from '../floors';
import { floorSitesIn } from '../literal-floors';
import {
  committableFiles,
  searched,
  tsFilesUnder,
  walkDisagreements,
} from '../source-files';
import { parseFile, parseSource, stringTextsIn } from '../unit/ast';
import { withoutTsComments } from '../unit/source-text';

/**
 * A liveness floor written as a literal is tight only on the day it is
 * measured (#468), so every floor demanding two or more goes through the
 * ratchet in `tests/floors.ts`, or carries a reason it is a product value.
 * This reader finds them, however they are written.
 */
const read = (source: string) =>
  floorSitesIn(parseSource(source, 'fixture.test.ts'));

/**
 * The units of a planted source the floor reader weighs, as it counts them:
 * the nodes `pick` keeps, in source order, each as its own text.
 */
const unitsIn = (
  source: string,
  pick: (node: ts.Node) => boolean,
): string[] => {
  const sf = parseSource(source, 'fixture.test.ts');
  const units: string[] = [];
  const visit = (node: ts.Node): void => {
    if (pick(node)) units.push(node.getText(sf));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return units;
};

/** A relational comparison: what a reader could mistake for a floor. */
const isComparison = (node: ts.Node): boolean =>
  ts.isBinaryExpression(node) &&
  [
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
  ].includes(node.operatorToken.kind);

/** A floor matcher call: the one thing a refused source is written around. */
const isFloorMatcher = (node: ts.Node): boolean =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text.startsWith('toBeGreaterThan');

describe('floorSitesIn', () => {
  // Planted by hand, one per way this repository writes a floor. Generated
  // from the reader's own list, a dropped form would vanish from both sides
  // (#446 Group 2b, PW6).
  it.each([
    ['a literal', 'expect(a.length).toBeGreaterThan(41);', 'a.length', 42],
    ['or equal', 'expect(c).toBeGreaterThanOrEqual(2);', 'c', 2],
    ['a floor of one', 'expect(d).toBeGreaterThan(1);', 'd', 2],
    ['a numeric separator', 'expect(f).toBeGreaterThan(5_197);', 'f', 5198],
    [
      'expect.soft',
      'expect.soft(g.length).toBeGreaterThan(9);',
      'g.length',
      10,
    ],
    [
      'expect.poll',
      'await expect.poll(() => rows.length).toBeGreaterThan(4);',
      '() => rows.length',
      5,
    ],
    [
      'a message and the bound on lines of their own',
      "expect(\n  b.length,\n  'the walk found nothing',\n).toBeGreaterThan(\n  7,\n);",
      'b.length',
      8,
    ],
  ])('reads %s as a counted floor', (_, source, subject, demands) => {
    expect(read(source)).toEqual({
      sites: [{ line: 1, kind: 'counted', demands, subject }],
      refused: [],
    });
  });

  it.each([
    ['greater than zero', 'expect(e).toBeGreaterThan(0);', 1],
    ['at least one', 'expect(e).toBeGreaterThanOrEqual(1);', 1],
    ['a negative bound', 'expect(e).toBeGreaterThan(-1);', 0],
  ])(
    'reads %s as presence, which searched() already demands',
    (_, source, demands) => {
      expect(read(source)).toEqual({
        sites: [{ line: 1, kind: 'presence', demands, subject: 'e' }],
        refused: [],
      });
    },
  );

  // A floor needs no matcher: evidence-recording.test.ts wrote two as
  // `expect({ acting: acting.length > 25, … }).toEqual({ acting: true, … })`,
  // which a reader of matchers alone never saw (#468).
  it.each([
    [
      'inside the value',
      'expect({ acting: acting.length > 25 }).toEqual({ acting: true });',
      'acting.length',
      26,
    ],
    [
      'with the bound first',
      'expect(2 < files.length).toBe(true);',
      'files.length',
      3,
    ],
    ['at least', 'expect(n >= 5).toBe(true);', 'n', 5],
    ['with the bound first, at least', 'expect(7 <= n).toBe(true);', 'n', 7],
  ])(
    'reads a comparison %s as a counted floor',
    (_, source, subject, demands) => {
      expect(read(source)).toEqual({
        sites: [
          { line: 1, kind: 'counted', demands, subject, form: 'comparison' },
        ],
        refused: [],
      });
    },
  );

  // Written backwards, the literal is the subject and the count the bound.
  // No file under tests/ writes one today (measured, review pass 1); read
  // anyway, because a form the reader cannot see is one nothing refuses.
  it.each([
    ['less than', 'expect(5).toBeLessThan(files.length);', 'files.length', 6],
    ['at most', 'expect(2).toBeLessThanOrEqual(n);', 'n', 2],
  ])(
    'reads a floor written backwards, %s, as counted',
    (_, source, subject, demands) => {
      expect(read(source)).toEqual({
        sites: [
          { line: 1, kind: 'counted', demands, subject, form: 'reversed' },
        ],
        refused: [],
      });
    },
  );

  it('reads a ceiling on a count as no floor', () => {
    expect(read('expect(x.length).toBeLessThan(5);')).toEqual({
      sites: [],
      refused: [],
    });
  });

  it('reads a comparison bounding from above as a ceiling', () => {
    expect(read('expect(x.length < 3).toBe(true);').sites).toEqual([
      { line: 1, kind: 'ceiling', subject: 'x.length', form: 'comparison' },
    ]);
  });

  it("reads no floor in a callback's own comparison", () => {
    const source = 'expect(rows.filter((r) => r.length > 3)).toEqual([]);';
    const comparisons = unitsIn(source, isComparison);
    expect(
      searched(read(source).sites, {
        of: comparisons,
        what: 'comparisons in the planted source',
      }),
    ).toEqual([]);
    expect(
      floorBreach('literal-floors/callback-comparisons', comparisons.length),
    ).toBeUndefined();
  });

  it('reads a bound computed in place as a comparison', () => {
    expect(read('expect(prod).toBeGreaterThan(dev);').sites).toEqual([
      { line: 1, kind: 'compared', subject: 'prod' },
    ]);
  });

  it('reads a fractional bound as a threshold on a measure, never a count', () => {
    expect(read('expect(contrast).toBeGreaterThanOrEqual(4.5);').sites).toEqual(
      [{ line: 1, kind: 'threshold', subject: 'contrast' }],
    );
  });

  it('reads a negated floor as a ceiling', () => {
    expect(read('expect(h).not.toBeGreaterThan(3);').sites).toEqual([
      { line: 1, kind: 'ceiling', subject: 'h' },
    ]);
  });

  it.each([
    [
      'a parameter',
      'const at = (n: number, moreThan: number) =>\n  expect(n).toBeGreaterThan(moreThan);',
    ],
    [
      "a parameter's property",
      'function expectRead(n: number, liveness: { moreThan: number }) {\n  expect(n).toBeGreaterThan(liveness.moreThan);\n}',
    ],
    [
      'a destructured parameter',
      'const at = (n: number, { moreThan }: { moreThan: number }) =>\n  expect(n).toBeGreaterThan(moreThan);',
    ],
  ])('reads a bound handed in through %s as forwarded', (_, source) => {
    expect(read(source)).toEqual({
      sites: [{ line: 2, kind: 'forwarded', subject: 'n' }],
      refused: [],
    });
  });

  it('reads a local bound as a comparison, not forwarded', () => {
    expect(
      read(
        'const f = (n: number) => {\n  const moreThan = 3;\n  expect(n).toBeGreaterThan(moreThan);\n};',
      ).sites,
    ).toEqual([{ line: 3, kind: 'compared', subject: 'n' }]);
  });

  it.each([
    [
      'a root it cannot read',
      'assertThat(k).toBeGreaterThan(3);',
      'assertThat',
    ],
    ['no bound', 'expect(k).toBeGreaterThan();', 'one bound'],
    ['a spread bound', 'expect(k).toBeGreaterThan(...bounds);', 'one bound'],
  ])('refuses %s by line, never skips it', (_, source, why) => {
    const { sites, refused } = read(source);
    const matchers = unitsIn(source, isFloorMatcher);
    expect(
      searched(sites, { of: matchers, what: 'floor matchers in the source' }),
    ).toEqual([]);
    expect(
      floorBreach('literal-floors/refused-matchers', matchers.length),
    ).toBeUndefined();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatch(/^fixture\.test\.ts:1: /);
    expect(refused[0]).toContain(why);
  });

  it('reads nothing a comment or a string spells', () => {
    expect(
      read(
        "// expect(a).toBeGreaterThan(41);\nconst s = 'expect(a).toBeGreaterThan(41)';",
      ),
    ).toEqual({ sites: [], refused: [] });
  });
});

/** The source of every regex literal in `sf`: text, but never a matcher call. */
const regexTextsIn = (sf: ts.SourceFile): string[] => {
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral)
      texts.push(node.getText(sf));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return texts;
};

/** Every TypeScript file either runner reads: unit tests, specs and helpers. */
const FILES = tsFilesUnder('tests');
const READINGS = FILES.map((file) => ({
  file,
  ...floorSitesIn(parseFile(file)),
}));
const SITES = READINGS.flatMap(({ file, sites }) =>
  sites.map((site) => ({ file, ...site })),
);
const keyOf = ({ file, subject }: { file: string; subject: string }) =>
  `${file}: ${subject}`;

/**
 * Literal floors that bound a product value, not a population a guard reads:
 * keyed `file: subject`, each with its reason.
 */
const PRODUCT_VALUES: Readonly<Record<string, string>> = {
  'tests/unit/browser-matrix.test.ts: all':
    'more than one engine is configured, or scoping a spec to one is trivially satisfied: a fact about the config',
  'tests/unit/deploy-gate.test.ts: r.reason.trim().length':
    'a refusal reason long enough to say something: a property of the text',
  'tests/unit/grouping.test.ts: arrangements.size':
    'shuffling gives more than one arrangement: the algorithm behaving randomly',
  'tests/unit/grouping.test.ts: attempts':
    'how many searches the grouping ran: a statistic of the algorithm',
  'tests/unit/grouping.test.ts: g.length':
    'every group holds at least the size asked for: the grouping rule itself',
  'tests/unit/grouping.test.ts: partitions.size':
    'how many distinct partitions the grouping produces: a statistic of the algorithm',
  'tests/unit/grouping.test.ts: successes':
    'how many searches succeeded: a statistic of the algorithm',
  'tests/unit/report-review.test.ts: body.length':
    "the lines a fixture's report block renders, fixed by the fixture",
  'tests/unit/report.test.ts: entry!.forms.length':
    'a select message offers more than one form: the language, not a population',
  'tests/unit/sfx.test.ts: distinct.size':
    'five draws of the PRNG are not all one value',
  'tests/unit/sfx.test.ts: interval':
    'two notes at least two semitones apart: sound design',
  'tests/unit/sfx.test.ts: lo.length': 'a chord has more than one voice',
  'tests/device/ios/journeys.journey.ts: Math.round(rect.width)':
    'the 44px touch target',
  'tests/device/ios/journeys.journey.ts: Math.round(rect.height)':
    'the 44px touch target',
  'tests/e2e/classroom-groups-controls.spec.ts: box':
    'the # input leaves room to draw a number',
  'tests/e2e/classroom-groups-controls.spec.ts: box!.width':
    'an avatar is a face, not a dot',
  'tests/e2e/classroom-groups-controls.spec.ts: g.markerGap':
    'a gap the eye can see between marker and label',
  'tests/e2e/classroom-groups-controls.spec.ts: g.stateGap':
    'a gap the eye can see between label and state',
  'tests/e2e/classroom-groups-roster.spec.ts: Math.round(number.height)':
    'the 44px touch target',
  'tests/e2e/homepage.spec.ts: Math.round(box!.width)': 'the 44px touch target',
  'tests/e2e/homepage.spec.ts: Math.round(box!.height)':
    'the 44px touch target',
  'tests/prod/prod-smoke.spec.ts: page.body.length':
    'a served page is a page, not an error stub',
  'tests/viewport.ts: Math.round(rect.width)': 'the 44px touch target',
  'tests/viewport.ts: Math.round(rect.height)': 'the 44px touch target',
};

/**
 * Playwright liveness floors, which #446 Group 5 ratchets once they are
 * measured in the container CI renders in. May only shrink.
 */
const GROUP_5: Readonly<Record<string, string>> = {
  'tests/e2e/classroom-groups-controls.spec.ts: appearances.length':
    'number fields measured for spinners',
  'tests/e2e/classroom-groups-controls.spec.ts: gaps.length':
    'disclosure labels measured for gaps',
  'tests/e2e/classroom-groups-controls.spec.ts: ids.length':
    'disclosures opened one at a time',
  'tests/e2e/classroom-groups-controls.spec.ts: seen':
    'controls measured for the touch target',
  'tests/e2e/classroom-groups-print.spec.ts: hairs.length':
    'hairlines measured on paper',
};

describe('every floor demanding two or more is ratcheted (#468)', () => {
  it('finds none written as a literal or handed in by a parameter', () => {
    const findings = SITES.filter(
      (site) =>
        (site.kind === 'counted' || site.kind === 'forwarded') &&
        !(keyOf(site) in PRODUCT_VALUES) &&
        !(keyOf(site) in GROUP_5),
    ).map(
      ({ file, line, kind, demands, subject }) =>
        `${file}:${line} ${kind}${demands === undefined ? '' : ` ${demands}`} expect(${subject})`,
    );
    expect(
      searched(findings, { of: SITES, what: 'floors read under tests/' }),
      findings.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('literal-floors/judged-sites', SITES.length),
    ).toBeUndefined();
  });
});

describe('the floor reader proves what it read (#468)', () => {
  it('counts every floor matcher the code writes, file by file', () => {
    // Independent of the reader's walk (control c): the matcher counted in
    // each file's comment-stripped text, less the ones a string or a regex
    // literal spells (this file's own MATCHER is one), against what the
    // reader returned for that file, sites and refusals both. Per file, with
    // no number to drift.
    const MATCHER = /\.toBeGreaterThan(?:OrEqual)?\(/g;
    const count = (text: string) => text.match(MATCHER)?.length ?? 0;
    const misread = READINGS.filter(({ file, sites, refused }) => {
      const code = withoutTsComments(readFileSync(file, 'utf8'));
      const sf = parseFile(file);
      const spelled = [...stringTextsIn(sf), ...regexTextsIn(sf)].reduce(
        (sum, text) => sum + count(text),
        0,
      );
      const matchers = sites.filter(({ form }) => form === undefined);
      return count(code) - spelled !== matchers.length + refused.length;
    }).map(({ file }) => file);
    expect(
      searched(misread, { of: FILES, what: 'TypeScript files under tests/' }),
    ).toEqual([]);
    expect(
      floorBreach('literal-floors/compared-files', FILES.length),
    ).toBeUndefined();
  });

  it('reads every TypeScript file git has under tests/', () => {
    // Its per-file cross-check counts over this walk, so the walk is checked
    // against git's own list (#477).
    const known = committableFiles(
      (path) => path.startsWith('tests/') && /\.tsx?$/.test(path),
    );
    expect(
      searched(walkDisagreements(FILES, known), {
        of: FILES,
        what: 'files under tests/',
      }),
    ).toEqual([]);
    // The walk and git's list can narrow together, and agree over less (#525).
    expect(
      floorBreach('literal-floors/walked-files', FILES.length),
    ).toBeUndefined();
  });

  it('refuses nothing it could not classify', () => {
    const refused = READINGS.flatMap(({ refused }) => refused);
    expect(
      searched(refused, { of: SITES, what: 'floors read under tests/' }),
      refused.join('\n'),
    ).toEqual([]);
    expect(floorBreach('literal-floors/sites', SITES.length)).toBeUndefined();
  });

  it('lists no product value or Group 5 floor that is gone', () => {
    const live = new Set(
      SITES.filter(
        ({ kind }) => kind === 'counted' || kind === 'forwarded',
      ).map(keyOf),
    );
    const listed = [...Object.keys(PRODUCT_VALUES), ...Object.keys(GROUP_5)];
    const stale = listed.filter((key) => !live.has(key));
    expect(searched(stale, { of: listed, what: 'listed floors' })).toEqual([]);
    expect(
      floorBreach('literal-floors/listed-floors', listed.length),
    ).toBeUndefined();
  });

  it('only shrinks the Group 5 list', () => {
    // Five Playwright liveness floors wait for #446 Group 5 (#475 ratcheted
    // two); a new one is ratcheted from the start, never added here.
    expect(Object.keys(GROUP_5).length).toBeLessThanOrEqual(5);
  });

  it('spells every recorded id exactly once under tests/', () => {
    const ids = Object.keys(readFloors());
    const spelled = FILES.flatMap((file) => stringTextsIn(parseFile(file)));
    const wrong = ids
      .map((id) => ({
        id,
        times: spelled.filter((text) => text === id).length,
      }))
      .filter(({ times }) => times !== 1)
      .map(({ id, times }) => `${id}: spelled ${times} times`);
    expect(
      searched(wrong, { of: ids, what: 'recorded floor ids' }),
      wrong.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('literal-floors/recorded-ids', ids.length),
    ).toBeUndefined();
  });
});
