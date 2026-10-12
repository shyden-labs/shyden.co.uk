import { describe, it, expect } from 'vitest';
import { bind, seededClosure } from './ast';
import { lintChangedTests, type BurnDownLists } from '../changed-tests';

/**
 * The pre-push lint's core (#662): the three test-code meta-guards' finders
 * (floorless-searches, absence-liveness, anchored-presence), applied to the
 * test files a branch changed. Each fixture plants one finder's construct;
 * the tree is bound in memory, and every closure is seeded, so no test reads
 * the disk or builds a call graph.
 */

const FIXTURES = {
  'clean.test.ts': [
    "it('clean', () => {",
    "  expect(searched(f, { of: p, what: 'w' })).toEqual([]);",
    "  expect(floorBreach('x/y', p.length)).toBeUndefined();",
    '});',
  ],
  'floorless.test.ts': [
    "it('no floor', () => {",
    "  expect(searched(f, { of: p, what: 'w' })).toEqual([]);",
    '});',
  ],
  'absence.test.ts': [
    "it('self-contained', () => {",
    '  expect(rosterWarnings([], en)).toEqual([]);',
    '});',
  ],
  'presence.test.ts': [
    "import { readFileSync } from 'node:fs';",
    "it('raw read', () => {",
    "  expect(readFileSync('x.ts', 'utf8')).toContain('needle');",
    '});',
  ],
};

const TREE = {
  bound: bind(
    new Map(
      Object.entries(FIXTURES).map(([file, lines]) => [file, lines.join('\n')]),
    ),
  ),
  discoverers: seededClosure('readFileSync', 'readdirSync', 'filesUnder'),
  presence: {
    readers: seededClosure('readFileSync'),
    strippers: seededClosure('withoutTsComments'),
    commentReaders: seededClosure('isMarkerCommentLine', 'commentsIn'),
  },
};

const UNLISTED: BurnDownLists = { floorless: {}, absence: {} };

describe('lintChangedTests names what each finder plants, by file:line', () => {
  it('names a search with no floor in a changed file', () => {
    expect(
      lintChangedTests(['floorless.test.ts'], TREE, UNLISTED).findings,
    ).toEqual([
      'floorless.test.ts:2: floorless-searches: a search with no recorded floor in the same test (no floor). Check floorBreach on its population.',
    ]);
  });

  it('names an absence with no population in its verdict', () => {
    expect(
      lintChangedTests(['absence.test.ts'], TREE, UNLISTED).findings,
    ).toEqual([
      'absence.test.ts:2: absence-liveness: self-contained: no population in the verdict (self-contained). Route it through searched() and check a floor.',
    ]);
  });

  it('names a presence assertion over raw source text', () => {
    expect(
      lintChangedTests(['presence.test.ts'], TREE, UNLISTED).findings,
    ).toEqual([
      "presence.test.ts:3: anchored-presence: expect(readFileSync('x.ts', 'utf8')).toContain('needle'). Strip the comments, or anchor the matcher.",
    ]);
  });
});

describe('lintChangedTests judges only the changed files, as the guards would', () => {
  it('reads a clean changed file and names only the other', () => {
    const lint = lintChangedTests(
      ['clean.test.ts', 'floorless.test.ts'],
      TREE,
      UNLISTED,
    );
    expect(lint.findings.map((finding) => finding.split(':')[0])).toEqual([
      'floorless.test.ts',
    ]);
    // Both files' searches and absences were read, the clean one's included.
    expect(lint.judged).toEqual({ searches: 2, absences: 2, presence: 0 });
  });

  it('leaves a file the branch did not change to the guards', () => {
    expect(
      lintChangedTests(['presence.test.ts'], TREE, UNLISTED).judged,
    ).toEqual({ searches: 0, absences: 0, presence: 1 });
  });

  it('holds a listed scope to its burn-down entry, as the guard does', () => {
    expect(
      lintChangedTests(['floorless.test.ts', 'absence.test.ts'], TREE, {
        floorless: { 'floorless.test.ts › no floor': 1 },
        absence: {},
      }).findings.map((finding) => finding.split(':')[0]),
    ).toEqual(['absence.test.ts']);
  });

  it('names a listed scope that now reads fewer, so its entry is lowered', () => {
    expect(
      lintChangedTests(['clean.test.ts', 'absence.test.ts'], TREE, {
        floorless: {},
        absence: {
          'clean.test.ts › clean': 1,
          'absence.test.ts › self-contained': 1,
        },
      }).findings,
    ).toEqual([
      'clean.test.ts › clean: absence-liveness: 0 read, 1 listed. Lower the entry in tests/absence-liveness.burn-down.ts: the list only shrinks.',
    ]);
  });
});
