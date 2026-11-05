import { describe, expect, it } from 'vitest';
import { DUPLICATE_RATIO, similarity, trigramBound } from './duplication';

/**
 * The duplication scorer against a reference (#700). The scan's cost was its
 * edit distance (25.1 s of the guard's 29.2 s on the runner), so it was cut
 * twice: the band's rows are reset at their edges only, and a trigram lower
 * bound turns pairs away before any row is built. Both cuts must leave every
 * score exactly as it was, so each case here is scored against a plain,
 * unbounded Levenshtein, at the places a banded table goes wrong: at the
 * allowed distance and one past it, and along both edges of the band.
 */

/** Levenshtein distance, the textbook full table: slow, and plainly right. */
const levenshtein = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = row;
  }
  return prev[b.length] ?? 0;
};

/** What `similarity` must answer: the ratio, or 0 below `minRatio`. */
const expected = (a: string, b: string, minRatio = DUPLICATE_RATIO): number => {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const ratio = 1 - levenshtein(a, b) / longest;
  return ratio >= minRatio ? ratio : 0;
};

/** 200 characters with no repeated neighbour, so no edit is free. */
const BASE = Array.from({ length: 200 }, (_, i) =>
  String.fromCharCode(97 + ((i * 7) % 26)),
).join('');

/** `text` with the character at each of `at` replaced by `#`. */
const substituted = (text: string, at: readonly number[]): string =>
  [...text].map((char, i) => (at.includes(i) ? '#' : char)).join('');

/** Positions 0, step, 2*step, ... `count` of them. */
const every = (count: number, step: number): number[] =>
  Array.from({ length: count }, (_, i) => i * step);

// At 0.85 on 200 characters, 30 edits is the most a duplicate may carry.
const ALLOWED = Math.floor((1 - DUPLICATE_RATIO) * 200);

const CASES: readonly (readonly [string, string, string, number?])[] = [
  ['identical', BASE, BASE],
  ['one substitution in the middle', BASE, substituted(BASE, [100])],
  [
    'exactly the allowed substitutions',
    BASE,
    substituted(BASE, every(ALLOWED, 6)),
  ],
  [
    'one substitution past the allowed',
    BASE,
    substituted(BASE, every(ALLOWED + 1, 6)),
  ],
  [
    'a run of insertions at the start, along one band edge',
    BASE,
    `${'#'.repeat(ALLOWED)}${BASE}`.slice(0, 200 + ALLOWED),
  ],
  [
    'a run of deletions at the end, along the other',
    BASE,
    BASE.slice(0, 200 - ALLOWED),
  ],
  [
    'insertions at the start and deletions at the end, crossing the band',
    BASE,
    `${'#'.repeat(ALLOWED / 2)}${BASE.slice(0, 200 - ALLOWED / 2)}`,
  ],
  [
    'lengths apart by one more than the allowed',
    BASE,
    BASE.slice(0, 200 - ALLOWED - 1),
  ],
  [
    'a change in the middle, after a shared head and tail',
    BASE,
    `${BASE.slice(0, 90)}${'#'.repeat(20)}${BASE.slice(110)}`,
  ],
  // Found by searching every pair of strings up to length 8 against the
  // reference: the smallest that a banded table gets wrong if the cell left of
  // its band keeps a value from two rows earlier (an answer of 2 where the
  // truth is 3) ...
  ['a stale cell left of the band', 'baaa', 'ab', 0.5],
  // ... or if its band is one cell too narrow (beyond, where the truth is 2).
  ['a path along the last cell of the band', 'a', 'bab', 0.3],
  // One substitution among unrepeated letters moves exactly six trigrams, so
  // the trigram bound is exactly the distance, 1, the most this pair may
  // carry: a bound that refused at the allowed distance itself would lose it.
  ['a trigram bound exactly at the allowed distance', 'abcdefg', 'abcXefg'],
];

/** Each case by name, with the ratio its question is asked at. */
const ROWS = CASES.map(([name, a, b, minRatio = DUPLICATE_RATIO]) => ({
  name,
  a,
  b,
  minRatio,
}));

describe('similarity scores every case as an unbounded edit distance would', () => {
  it.each(ROWS)('$name', ({ a, b, minRatio }) => {
    expect(similarity(a, b, minRatio)).toBe(expected(a, b, minRatio));
  });

  it('reaches both sides of the cut, so neither verdict is vacuous', () => {
    // A pass on every case above means nothing if every case scored 0, or
    // every case scored above the cut.
    const scores = ROWS.map(({ a, b, minRatio }) => similarity(a, b, minRatio));
    expect(scores.filter((score) => score > 0).length).toBe(9);
    expect(scores.filter((score) => score === 0).length).toBe(3);
  });
});

describe('trigramBound never claims more edits than there are (#700)', () => {
  it.each(ROWS)('$name', ({ a, b }) => {
    expect(trigramBound(a, b)).toBeLessThanOrEqual(levenshtein(a, b));
  });

  it('is exactly the distance for one substitution among unrepeated letters', () => {
    expect(trigramBound('abcdefg', 'abcXefg')).toBe(1);
  });

  // Twenty lines of code, then the same lines with every word spelled
  // backwards: the same characters in the same numbers, so the character
  // histogram cannot tell them apart, but different trigrams and a large edit
  // distance. Large bodies of different code are like this: alike in their
  // letters, unlike in their sequences, which is what cost the scan its time.
  // (Lines merely reordered would NOT do: they keep almost every trigram.)
  const WORDS = [
    'render',
    'columns',
    'tally',
    'sorted',
    'player',
    'margin',
    'bucket',
    'shadow',
    'filter',
    'locale',
    'parsed',
    'window',
    'cursor',
    'vector',
    'gather',
    'linked',
    'random',
    'thread',
    'signal',
    'quartz',
  ];
  const spelled = (word: string) => [...word].reverse().join('');
  const line = (word: (w: string) => string) => (_: unknown, i: number) =>
    `  ${word(WORDS[i] ?? '')}.${word(WORDS[(i * 7) % 20] ?? '')}(${word(WORDS[(i * 3) % 20] ?? '')});\n`;
  const forward = Array.from(
    { length: 20 },
    line((w) => w),
  ).join('');
  const reversed = Array.from({ length: 20 }, line(spelled)).join('');

  it('turns away a respelled body the character histogram cannot tell apart', () => {
    const allowed = Math.floor((1 - DUPLICATE_RATIO) * forward.length);
    expect(trigramBound(forward, reversed)).toBeGreaterThan(allowed);
  });

  it('scores that respelled pair below the cut, as the full distance does', () => {
    expect(similarity(forward, reversed)).toBe(expected(forward, reversed));
    expect(similarity(forward, reversed)).toBe(0);
  });
});
