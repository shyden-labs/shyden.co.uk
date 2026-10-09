import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_RATIO,
  MIN_PRINTED_LENGTH,
  functionBodiesIn,
  isComparableFunction,
  functionBodiesOf,
  duplicatePairs,
  similarity,
  type DuplicatePair,
} from './duplication';
import { searched, trackedFiles } from '../source-files';
import { floorBreach } from '../floors';
import { nodesIn, parseSource } from './ast';

/**
 * Every file a duplicate could live in, from git rather than a list.
 *
 * #24's sweep worked from the file list written into its own issue and
 * covered only those files; #60 and #65 then found six survivors. #277's own
 * ticket named six pairs, and deriving the set from disk found twenty-seven.
 */
const SCANNED = trackedFiles(
  (path) => /^(src|tests|scripts)\//.test(path) && /\.(ts|mjs)$/.test(path),
);

const DECLARATIONS = SCANNED.flatMap(functionBodiesIn);
const PAIRS = duplicatePairs(DECLARATIONS);

/** `file:name <-> file:name`, without line numbers, which drift. */
const keyOf = (pair: DuplicatePair): string =>
  [`${pair.a.file}:${pair.a.name}`, `${pair.b.file}:${pair.b.name}`]
    .sort()
    .join('  <->  ');

/**
 * The measurement behind every entry below, written once because six copies
 * of a paragraph is the defect this file exists to find.
 *
 * What is left in these bodies, after `expectNoHorizontalScroll` took the
 * measurement into `tests/viewport.ts`, is the test's own setup: size the
 * viewport, open a page, assert. Collapsing THAT means generating the
 * `test()` calls from a helper -- and a helper is not a spec file.
 *
 * Measured, both directions, on `site-meta.spec.ts`'s four 404 tests.
 * Dropping their `@emulated-viewport` tag turns `viewport-tagging.test.ts`
 * red, naming the test and the line that resizes: the guard is live.
 * Generating those same four tests, still untagged, from `tests/viewport.ts`
 * leaves the WHOLE unit suite green -- 2054 passed, the same two deliberate
 * failures, nothing new red. Four tests that resize a viewport, none tagged,
 * and no guard in the repository can see them, because `specDirs()` derives
 * from the directories that hold spec files and `tests/` root is not one.
 *
 * So the duplication is the price of the tag guard being able to read the
 * declarations at all. A spec file is a source-scanning guard's input, and
 * moving code out of it is the same blindness this repo has now measured
 * three times -- #198's `rendered-text.spec.ts`, `homepage.spec.ts`'s
 * deliberately inline 44px loop, and here.
 */
const TEST_BODY_STAYS_IN_THE_SPEC =
  'the no-horizontal-scroll family: the measurement is shared ' +
  '(`expectNoHorizontalScroll`), and what remains is the test declaration ' +
  'itself. Generating it from a helper puts `test()` and `setViewportSize` ' +
  'outside `specDirs()`, where `viewport-tagging.test.ts` cannot read them ' +
  '-- measured: four untagged viewport tests, whole unit suite green.';

const CROSS_CHECK_STAYS_IN_ITS_GUARD =
  'Each guard checks its own walk against git beside the floor it ratchets ' +
  '(#477), and these two guards walk one population. A helper that returns ' +
  'the verdict hides `searched` from absence-liveness, which reads it only ' +
  'at the call site -- measured: three findings "derives from the ' +
  'filesystem". One shared walk would leave each guard checking a list it ' +
  'no longer owns.';

/**
 * Pairs read and deliberately left separate, each with the reason a reader
 * needs before deciding to collapse it after all.
 *
 * An entry here is a VERDICT, not a suppression: the liveness test below
 * fails when one stops matching a real pair, so a line cannot outlive the
 * code it excuses and quietly start excusing something else.
 */
const SEPARATE: ReadonlyMap<string, string> = new Map([
  [
    "tests/guards/absence-liveness.test.ts:it('walks every .ts file git has under tests/')  <->  tests/guards/anchored-presence.test.ts:it('walks every .ts file git has under tests/')",
    CROSS_CHECK_STAYS_IN_ITS_GUARD,
  ],
  [
    'tests/e2e/classroom-groups-controls.spec.ts:test(`${path}: no horizontal scroll at ${width}px`)  <->  tests/e2e/classroom-groups-roster.spec.ts:test(`cards: no horizontal scroll at 320px once a student is marked absent -- ${path}`)',
    TEST_BODY_STAYS_IN_THE_SPEC,
  ],
  [
    'tests/e2e/classroom-groups-controls.spec.ts:test(`${path}: no horizontal scroll at ${width}px`)  <->  tests/e2e/yeetalk-calculators.spec.ts:test(`no horizontal scroll at ${width}px -- ${path}`)',
    TEST_BODY_STAYS_IN_THE_SPEC,
  ],
  [
    'tests/e2e/classroom-groups-controls.spec.ts:test(`${path}: no horizontal scroll at ${width}px`)  <->  tests/e2e/site-meta.spec.ts:test(`no horizontal scroll at ${width}px`)',
    TEST_BODY_STAYS_IN_THE_SPEC,
  ],
  [
    'tests/e2e/classroom-groups-controls.spec.ts:test(`${path}: no horizontal scroll at ${width}px`)  <->  tests/prod/prod-sanity.spec.ts:test(`${path} fits a 320px viewport`)',
    TEST_BODY_STAYS_IN_THE_SPEC,
  ],
  [
    'tests/e2e/classroom-groups-roster.spec.ts:test(`cards: no horizontal scroll at 320px once a student is marked absent -- ${path}`)  <->  tests/e2e/yeetalk-calculators.spec.ts:test(`no horizontal scroll at ${width}px -- ${path}`)',
    TEST_BODY_STAYS_IN_THE_SPEC,
  ],
  [
    'tests/e2e/classroom-groups-roster.spec.ts:test(`cards: no horizontal scroll at 320px once a student is marked absent -- ${path}`)  <->  tests/prod/prod-sanity.spec.ts:test(`${path} fits a 320px viewport`)',
    TEST_BODY_STAYS_IN_THE_SPEC,
  ],
  [
    'tests/e2e/site-meta.spec.ts:test(`no horizontal scroll at ${width}px`)  <->  tests/e2e/yeetalk-calculators.spec.ts:test(`no horizontal scroll at ${width}px -- ${path}`)',
    TEST_BODY_STAYS_IN_THE_SPEC,
  ],
  [
    'tests/e2e/yeetalk-calculators.spec.ts:test(`no horizontal scroll at ${width}px -- ${path}`)  <->  tests/prod/prod-sanity.spec.ts:test(`${path} fits a 320px viewport`)',
    TEST_BODY_STAYS_IN_THE_SPEC,
  ],
]);

describe('a function body has one home across files', () => {
  it('scans the whole tracked tree, not a list', () => {
    // Anti-vacuity: an empty scan satisfies every assertion below.
    expect(floorBreach('duplication/files', SCANNED.length)).toBeUndefined();
    expect(SCANNED).toContain('src/lib/grouping.ts');
    expect(SCANNED).toContain('scripts/test-devices.mjs');
    expect(
      floorBreach('duplication/declarations', DECLARATIONS.length),
    ).toBeUndefined();
  });

  it('finds no cross-file duplicate that has not been given a verdict', () => {
    const findings = PAIRS.filter((pair) => !SEPARATE.has(keyOf(pair))).map(
      (pair) =>
        `${pair.ratio.toFixed(3)}  ${pair.a.name} ${pair.a.at}  <->  ${pair.b.name} ${pair.b.at}`,
    );
    expect(
      searched(findings, { of: DECLARATIONS, what: 'function bodies' }),
      findings.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('duplication/judged-declarations', DECLARATIONS.length),
    ).toBeUndefined();
  });

  it('carries no verdict for a pair that no longer exists', () => {
    // An allow-list entry outliving its code is how a guard stops guarding:
    // the next duplicate between those two files inherits the excuse.
    const live = new Set(PAIRS.map(keyOf));
    const recorded = [...SEPARATE.keys()];
    // The population sits inside the assertion (#118): an empty `SEPARATE`
    // has nothing to outlive, and would satisfy a bare filter for free.
    expect(
      searched(
        recorded.filter((key) => !live.has(key)),
        { of: recorded, what: 'recorded verdicts' },
      ),
    ).toEqual([]);
    // A verdict dropped from the table would leave its pair unexcused, but a
    // reader dropping one silently would leave this test reading fewer (#524).
    expect(
      floorBreach('duplication/outliving-verdicts', recorded.length),
    ).toBeUndefined();
  });

  it('records each verdict against one pair, which no copy can inherit', () => {
    // A key describing two live pairs excuses the second unread: measured,
    // the walk check copied once more between the same two guards passed
    // under `anonymous <-> anonymous` (#477). Names alone cannot rule that
    // out, since two tests may share a title, so the count is checked here.
    const pairsPerKey = new Map<string, number>();
    for (const key of PAIRS.map(keyOf))
      pairsPerKey.set(key, (pairsPerKey.get(key) ?? 0) + 1);
    const recorded = [...SEPARATE.keys()];
    const shared = recorded.filter((key) => (pairsPerKey.get(key) ?? 0) > 1);
    expect(
      searched(
        shared.map((key) => `${key}: ${pairsPerKey.get(key)} live pairs`),
        { of: recorded, what: 'recorded verdicts' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('duplication/shared-verdicts', recorded.length),
    ).toBeUndefined();
  });
});

describe('the scan itself', () => {
  it('scores an identical body at 1 and an unrelated one at 0', () => {
    const body = 'x'.repeat(MIN_PRINTED_LENGTH);
    expect(similarity(body, body)).toBe(1);
    expect(similarity(body, 'y'.repeat(MIN_PRINTED_LENGTH))).toBe(0);
  });

  it('scores a one-character change just under 1', () => {
    const body = 'x'.repeat(100);
    const ratio = similarity(body, `${body.slice(0, 99)}y`);
    expect(ratio).toBeGreaterThan(DUPLICATE_RATIO);
    expect(ratio).toBeLessThan(1);
  });

  it('reports 0 rather than a ratio it stopped measuring', () => {
    // The banded distance aborts once the pair cannot come in under the
    // threshold, so there is no measured ratio below it to report, and no
    // caller may read one.
    expect(
      similarity('a'.repeat(200), `${'a'.repeat(100)}${'b'.repeat(100)}`),
    ).toBe(0);
  });

  it('ignores the name a body is assigned to', () => {
    // The renamed copies are the ones a name-based scan cannot see:
    // `anonymousStudent`, `isMvpLocale`, `findIosDevice` (#277).
    const shape = (name: string) =>
      [
        `const ${name} = (value: number): number => {`,
        '  const c = value / 255;',
        '  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;',
        '};',
      ].join('\n');
    const [a] = functionBodiesOf(shape('channel'), 'a.ts');
    const [b] = functionBodiesOf(shape('lin'), 'b.ts');
    expect(similarity(a.text, b.text)).toBe(1);
  });

  it('ignores comments, so prose is not behaviour', () => {
    const body = (note: string) =>
      [
        'const f = (value: number): number => {',
        `  /* ${note} */`,
        '  const c = value / 255;',
        '  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;',
        '};',
      ].join('\n');
    const [a] = functionBodiesOf(body('one reason'), 'a.ts');
    const [b] = functionBodiesOf(body('a completely different reason'), 'b.ts');
    expect(similarity(a.text, b.text)).toBe(1);
  });

  it('finds a body nested inside another function', () => {
    // #227's scan compared top-level declarations only, which is why three
    // copies of the luminance formula sat inside `page.evaluate()` callbacks
    // unreported until #277.
    const nested = `
      const outer = async () => {
        const inner = (value: number): number => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return inner(1);
      };`;
    const names = functionBodiesOf(nested, 'a.ts').map((d) => d.name);
    expect(names).toContain('inner');
    expect(names).toContain('outer');
  });

  // A callback has no name of its own, and `anonymous` for every one let a
  // verdict recorded for one pair excuse any other between the same two
  // files (#477). The call and its title are the name a reader knows it by.
  it.each([
    ["it('reads a title',", "it('reads a title')"],
    [
      'test(`no scroll at ${width}px`, { tag: "@x" },',
      'test(`no scroll at ${width}px`)',
    ],
    ["test.skip('a skipped case',", "test.skip('a skipped case')"],
    ['items.forEach(', 'anonymous'],
  ])('names the callback passed to %s as %s', (open, name) => {
    const source = `
      ${open} async ({ page }) => {
        const title = await page.title();
        expect(title.length + title.length + title.length).toBeGreaterThan(0);
      });`;
    expect(functionBodiesOf(source, 'a.ts').map((d) => d.name)).toEqual([name]);
  });

  it('reports a duplicated region once, at its outermost match', () => {
    const source = `
      const outer = async (value: number) => {
        const inner = (v: number): number => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return inner(value) + inner(value) + inner(value);
      };`;
    const pairs = duplicatePairs([
      ...functionBodiesOf(source, 'a.ts'),
      ...functionBodiesOf(source, 'b.ts'),
    ]);
    // Both `outer` and `inner` match across the two files; only `outer` is
    // reported, because a report that lists the same finding at every depth
    // is one a reader triages by scrolling past.
    expect(pairs.map((pair) => [pair.a.name, pair.b.name])).toEqual([
      ['outer', 'outer'],
    ]);
  });

  it('never pairs two bodies in the same file', () => {
    const source = `
      const first = (value: number): number => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const second = (value: number): number => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };`;
    const bodies = functionBodiesOf(source, 'a.ts');
    expect(
      searched(duplicatePairs(bodies), {
        of: bodies,
        what: 'function bodies',
      }),
    ).toEqual([]);
    expect(
      floorBreach('duplication/same-file-bodies', bodies.length),
    ).toBeUndefined();
  });

  it('ignores a body shorter than the floor', () => {
    const source = 'const f = (a: number) => a + 1;';
    // The units the scan weighs against the floor are every function-like node
    // it meets, before it drops the short ones.
    const candidates = nodesIn(
      parseSource(source, 'a.ts'),
      isComparableFunction,
    );
    expect(
      searched(functionBodiesOf(source, 'a.ts'), {
        of: candidates,
        what: 'function-like nodes',
      }),
    ).toEqual([]);
    expect(
      floorBreach('duplication/short-candidates', candidates.length),
    ).toBeUndefined();
  });
});
