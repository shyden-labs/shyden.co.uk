import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { slugOf } from '../../scripts/build-evidence-page.mjs';
import {
  changeMapOf,
  releaseOf,
  renderChangeMap,
} from '../../scripts/release-map.mjs';
import { filesUnder } from '../source-files';

const BASE = 'b'.repeat(40);
const entry = (
  sha: string,
  visitorFacing: boolean,
  areas = ['src'],
  subject = `commit ${sha}`,
) => ({
  sha: sha.repeat(40).slice(0, 40),
  subject,
  pr: 1,
  ticket: 2,
  files: [],
  visitorFacing,
  areas,
});
const A = entry('a', true);
const C = entry('c', true, ['src'], 'feat: <img src=x onerror=alert(1)>');
const D = entry('d', true);
const T = entry('e', false, ['tests', '.github']);
const U = entry('f', false, ['tests']);
const inventory = { base: BASE, entries: [A, C, D, T, U] };

const JOURNEY = 'a describe > a journey';
const SKIPPY = 'a describe > mobile only';
const release = (entries: Record<string, unknown>) => ({
  base: BASE,
  headline: 'h',
  lede: 'l',
  signoff: {},
  gapGroup: 'g',
  checks: [],
  entries,
});
const ALL = {
  [A.sha]: { kind: 'visible', journeys: [JOURNEY] },
  [C.sha]: { kind: 'gap', check: 'try it by hand' },
  [D.sha]: { kind: 'none', reason: 'a refactor' },
};
const journeys = new Set([JOURNEY, SKIPPY]);
const passing = new Map([
  [JOURNEY, ['passed', 'passed', 'passed', 'passed', 'passed']],
  [SKIPPY, ['passed', 'skipped', 'skipped', 'passed', 'passed']],
]);
const map = (
  entries: Record<string, unknown>,
  statuses: ReadonlyMap<string, readonly string[]> | null = passing,
) => changeMapOf({ inventory, release: release(entries), journeys, statuses });

describe('the change map (#362)', () => {
  it('has one row per visitor-facing commit, in release order', () => {
    expect(map(ALL).rows.map((r) => r.entry.sha)).toEqual([
      A.sha,
      C.sha,
      D.sha,
    ]);
  });

  it.each([
    [
      'a release for another base',
      { ...ALL },
      (r: ReturnType<typeof release>) => ({ ...r, base: 'x'.repeat(40) }),
      /is for x+, the inventory starts at b+/,
    ],
    [
      'an unclassified commit',
      { [A.sha]: ALL[A.sha], [C.sha]: ALL[C.sha] },
      null,
      /d{40} .* is unclassified/,
    ],
    [
      'a stale classification',
      { ...ALL, [T.sha]: { kind: 'none', reason: 'x' } },
      null,
      /e{40} is classified but is not a visitor-facing commit/,
    ],
    [
      'a visible change citing nothing',
      { ...ALL, [A.sha]: { kind: 'visible', journeys: [] } },
      null,
      /a{40} is visible but cites no journey/,
    ],
    [
      'an unknown journey',
      {
        ...ALL,
        [A.sha]: { kind: 'visible', journeys: ['a describe > a jorney'] },
      },
      null,
      /"a describe > a jorney", cited by a{40}, is not a journey/,
    ],
    [
      'a reasonless none',
      { ...ALL, [D.sha]: { kind: 'none', reason: ' ' } },
      null,
      /d{40} .* gives no reason/,
    ],
    [
      'an empty gap',
      { ...ALL, [C.sha]: { kind: 'gap', check: '' } },
      null,
      /c{40} .* says nothing to check/,
    ],
    [
      'a reason that is not words',
      { ...ALL, [D.sha]: { kind: 'none', reason: {} } },
      null,
      /d{40} .* gives no reason/,
    ],
    [
      'a check that is not words',
      { ...ALL, [C.sha]: { kind: 'gap', check: ['try it by hand'] } },
      null,
      /c{40} .* says nothing to check/,
    ],
    [
      'an unknown kind',
      { ...ALL, [D.sha]: { kind: 'visble', journeys: [JOURNEY] } },
      null,
      /d{40} .* kind "visble"/,
    ],
  ])('refuses %s', (_, entries, reshape, message) => {
    const r = release(entries);
    expect(() =>
      changeMapOf({
        inventory,
        release: reshape ? reshape(r) : r,
        journeys,
        statuses: passing,
      }),
    ).toThrow(message);
  });

  it('flags a journey that failed on any engine, and one that passed on none', () => {
    const failed = new Map(passing).set(JOURNEY, [
      'passed',
      'failed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(map(ALL, failed).rows[0]?.flagged).toBe(true);
    const skippedEverywhere = new Map(passing).set(JOURNEY, [
      'skipped',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(map(ALL, skippedEverywhere).rows[0]?.flagged).toBe(true);
  });

  it('does not flag a journey skipped on an engine by design', () => {
    const cites = { ...ALL, [A.sha]: { kind: 'visible', journeys: [SKIPPY] } };
    expect(map(cites).rows[0]?.flagged).toBe(false);
  });

  it('flags a cited journey that has no result at all', () => {
    const unrun = new Map(passing);
    unrun.delete(JOURNEY);
    expect(map(ALL, unrun).rows[0]?.flagged).toBe(true);
  });

  it('computes no flag from a listing', () => {
    expect(map(ALL, null).rows[0]?.flagged).toBeNull();
  });

  it('totals each kind, and counts only real flags', () => {
    const failed = new Map(passing).set(JOURNEY, [
      'failed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(map(ALL, failed).totals).toEqual({
      entries: 3,
      visible: 1,
      gap: 1,
      none: 1,
      flagged: 1,
    });
    expect(map(ALL).totals.flagged).toBe(0);
  });

  it('counts every commit a visitor never receives, by area', () => {
    const { otherCommits, otherAreas } = map(ALL);
    expect(otherCommits).toBe(2);
    expect(otherAreas).toEqual([
      ['.github', 1],
      ['tests', 2],
    ]);
  });

  it('renders every value escaped, and links each journey to its section', () => {
    const { changeMap, others } = renderChangeMap(map(ALL));
    expect(changeMap).not.toContain('<img src=x');
    expect(changeMap).toContain('feat: &lt;img src=x onerror=alert(1)&gt;');
    expect(changeMap).toContain(`<a href="#j-${slugOf(JOURNEY)}">`);
    expect(changeMap).toContain('try it by hand');
    expect(changeMap).toContain('a refactor');
    expect(others).toContain('tests');
  });

  it('renders refs, totals, flags and area counts, and escapes every value', () => {
    const TAGGED = 'a describe > a <b>tagged</b> journey';
    const G = { ...entry('g', true), pr: null, ticket: 9 };
    const H = { ...entry('h', true), pr: null, ticket: null };
    const { changeMap, others } = renderChangeMap(
      changeMapOf({
        inventory: { base: BASE, entries: [A, C, D, G, H, T, U] },
        release: release({
          [A.sha]: { kind: 'visible', journeys: [JOURNEY] },
          [C.sha]: { kind: 'gap', check: 'press <kbd>Tab</kbd>' },
          [D.sha]: { kind: 'none', reason: 'renames a <div>' },
          [G.sha]: { kind: 'visible', journeys: [TAGGED] },
          [H.sha]: { kind: 'gap', check: 'look' },
        }),
        journeys: new Set([JOURNEY, TAGGED]),
        statuses: new Map([
          [JOURNEY, ['passed', 'failed']],
          [TAGGED, ['passed']],
        ]),
      }),
    );
    // The header row comes first; each commit's row follows in order.
    const rows = changeMap.split('<tr>').slice(2);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain(
      '<td class="mono">aaaaaaa</td><td>PR #1 · #2</td>',
    );
    expect(rows[0]).toContain('Flagged: a journey below did not pass.');
    expect(rows[3]).toContain('<td class="mono">ggggggg</td><td>#9</td>');
    expect(rows[3]).not.toContain('Flagged');
    expect(rows[4]).toContain('<td class="mono">hhhhhhh</td><td></td>');
    expect(changeMap).toContain('press &lt;kbd&gt;Tab&lt;/kbd&gt;');
    expect(changeMap).toContain('renames a &lt;div&gt;');
    expect(changeMap).toContain(
      '>a describe &gt; a &lt;b&gt;tagged&lt;/b&gt; journey</a>',
    );
    expect(changeMap).not.toMatch(/<kbd>|<div>|<b>/);
    expect(changeMap).toContain(
      '<span class="mono">5</span> commits change what a visitor receives: ' +
        '<span class="mono">2</span> shown by journeys, <span class="mono">2</span> shown by none, ' +
        '<span class="mono">1</span> with no intended visible change, <span class="mono">1</span> flagged.',
    );
    expect(others).toBe(
      '<p class="sub"><span class="mono">2</span> more commits change nothing a visitor receives. By area: ' +
        '.github <span class="mono">1</span> · tests <span class="mono">2</span></p>',
    );
  });
});

describe('the release file, before anything reads it (#390)', () => {
  const good = () => ({
    ...release({}),
    base: BASE,
    headline: 'h',
    signoff: { lede: 'Yours.', approve: 'Release' },
    checks: [{ id: 'dev-home', group: 'On dev', label: 'Open it' }],
  });

  it('passes a whole release file, and every committed one', () => {
    expect(releaseOf(good())).toEqual(good());
    const files = filesUnder('docs/releases', (p) => p.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files)
      expect(
        () => releaseOf(JSON.parse(readFileSync(file, 'utf8'))),
        file,
      ).not.toThrow();
  });

  it.each([
    ['a list', () => [], /release file: is not an object/],
    ['no base', () => ({ ...good(), base: undefined }), /base is not words/],
    [
      'no headline',
      () => ({ ...good(), headline: '' }),
      /headline is not words/,
    ],
    ['a lede of 7', () => ({ ...good(), lede: 7 }), /lede is not words/],
    [
      'a blank gap group',
      () => ({ ...good(), gapGroup: ' ' }),
      /gapGroup is not words/,
    ],
    [
      'checks that are no list',
      () => ({ ...good(), checks: {} }),
      /checks is not a list/,
    ],
    [
      'a check with no label',
      () => ({ ...good(), checks: [{ id: 'a', group: 'b' }] }),
      /checks\[0\]\.label is not words/,
    ],
    [
      'a check that is a word',
      () => ({ ...good(), checks: ['a'] }),
      /checks\[0\]\.id is not words/,
    ],
    [
      'no sign-off',
      () => ({ ...good(), signoff: null }),
      /signoff is not an object/,
    ],
    [
      'a blank sign-off button',
      () => ({ ...good(), signoff: { approve: '' } }),
      /signoff\.approve is not words/,
    ],
    [
      'entries that are a list',
      () => ({ ...good(), entries: [] }),
      /entries is not an object/,
    ],
  ])('refuses %s', (_, file, message) => {
    expect(() => releaseOf(file())).toThrow(message);
  });

  it('lets a sign-off leave its wording to the page', () => {
    expect(() => releaseOf({ ...good(), signoff: {} })).not.toThrow();
  });
});
