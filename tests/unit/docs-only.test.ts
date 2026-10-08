import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOCS_ONLY_FILES,
  DOCS_READ_BY_CODE,
  DOCS_TREE,
  docsOnlyVerdict,
  isDocsOnlyPath,
  parseNameStatus,
  verdictFromGit,
} from '../../scripts/docs-only.mjs';
import { floorBreach } from '../floors';
import { trackedFiles } from '../source-files';
import { treeReading } from '../tree-reading';
import { withoutTsComments, withoutYamlComments } from './source-text';

describe('which paths are documentation alone', () => {
  it.each([
    ['HANDOVER.md', 'the handover, exactly'],
    ['docs/reviews/2026-09-30-release-review.md', 'a review ledger'],
    ['docs/a.md', 'a file directly under docs/'],
    ['docs/reviews/nested/deep.md', 'any depth under docs/'],
    ['docs/reviews/a file with spaces.md', 'a path with a space'],
    ['docs/HANDOVER.md', 'a handover-named file under docs/'],
    [
      'docs/releases-old/x.md',
      "a sibling whose name starts with a read tree's",
    ],
  ])('%s is documentation (%s)', (path) => {
    expect(isDocsOnlyPath(path)).toBe(true);
  });

  it.each([
    ['README.md', 'read by organisation-name.test.ts'],
    ['handover.md', 'the handover in another case'],
    ['HANDOVER.md.bak', 'a name that only starts with the handover'],
    ['src/HANDOVER.md', 'the handover name somewhere else'],
    ['docs', 'the tree itself, as a file'],
    ['docs/', 'the tree with no file in it'],
    ['docsx/a.md', 'a sibling of docs/'],
    ['Docs/a.md', 'docs/ in another case'],
    ['./docs/a.md', 'a path that is not normalised'],
    ['/docs/a.md', 'an absolute path'],
    ['docs/../src/a.ts', 'a path climbing out of docs/'],
    ['docs/./a.md', 'a dot segment'],
    ['docs//a.md', 'an empty segment'],
    ['docs/releases/a3a5adb.json', 'docs/releases/ is read by code'],
    ['docs/releases', 'a file where a read tree sits'],
    ['docs/runbooks/translation-reports.md', 'docs/runbooks/ is read by code'],
    ['docs/superpowers/notes/x.md', 'docs/superpowers/ is read by code'],
    ['', 'no path at all'],
    ['src/pages/index.astro', 'site source'],
  ])('%s is not documentation alone (%s)', (path) => {
    expect(isDocsOnlyPath(path)).toBe(false);
  });

  it('accepts exactly the tracked files a git pathspec of the same allowlist selects', () => {
    // Two matchers for one allowlist: this module's, and git's own pathspec
    // engine. They must agree on every tracked file.
    // Git was asked once per run, in the global setup, with the pathspec
    // from `docsPathspec()` (#631): a unit test starts no process.
    const selected = [...treeReading().docsPathspecSelected].sort();
    const accepted = trackedFiles(isDocsOnlyPath);
    expect(accepted).toEqual(selected);
    expect(
      floorBreach('docs-only/tracked-docs-files', accepted.length),
    ).toBeUndefined();
  });
});

/** What code reads under `docs/`, from the comment-stripped text of every tracked file outside it. */
const CODE_TEXT: readonly [RegExp, (text: string) => string][] = [
  [/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/, withoutTsComments],
  [/\.ya?ml$/, withoutYamlComments],
];
const isProse = (path: string): boolean => /\.md$/i.test(path);
/**
 * The files that define the allowlist and test it. They name every path in
 * it as the allowlist itself and as fixtures, never as a read, so the
 * derivation below leaves exactly these three out, and holds all three in the walk.
 */
const ALLOWLIST_HOMES = [
  'scripts/docs-only.mjs',
  'tests/unit/docs-only.test.ts',
  'tests/integration/docs-only.test.ts',
] as const;
const codeFiles = (): string[] =>
  trackedFiles((path) => !path.startsWith(DOCS_TREE) && !isProse(path));
const codeText = (path: string): string | undefined => {
  const raw = readFileSync(path);
  if (raw.includes(0)) return undefined;
  const text = raw.toString('utf8');
  const strip = CODE_TEXT.find(([extension]) => extension.test(path))?.[1];
  return strip ? strip(text) : text;
};

describe('the parts of docs/ that code reads are never documentation alone', () => {
  it('DOCS_READ_BY_CODE is exactly the docs/ trees and files code names', () => {
    const files = codeFiles();
    expect(
      ALLOWLIST_HOMES.filter((home) => files.includes(home)),
      'every file left out of the reads is one the walk holds',
    ).toEqual([...ALLOWLIST_HOMES]);
    const docs = trackedFiles((path) => path.startsWith(DOCS_TREE));
    const named = new Set<string>();
    const reading = files.filter(
      (file) => !(ALLOWLIST_HOMES as readonly string[]).includes(file),
    );
    for (const file of reading) {
      const text = codeText(file);
      if (text === undefined) continue;
      for (const [, segment] of text.matchAll(/docs\/([\w.-]+)/g)) {
        const tree = `${DOCS_TREE}${segment}/`;
        if (docs.some((path) => path.startsWith(tree))) named.add(tree);
        else if (docs.includes(`${DOCS_TREE}${segment}`))
          named.add(`${DOCS_TREE}${segment}`);
      }
      for (const handover of DOCS_ONLY_FILES)
        if (text.includes(handover)) named.add(handover);
    }
    expect([...named].sort()).toEqual([...DOCS_READ_BY_CODE]);
    expect(
      floorBreach('docs-only/code-files-read', files.length),
    ).toBeUndefined();
  });

  it('the walk reads every file whose raw text names a docs/ path', () => {
    // An independent reading of the same population: git's own search over
    // the raw bytes, which no stripper or extension table stands between.
    // Git's own search, asked once per run in the global setup with
    // `docsNamingArgs()` (#631); a unit test starts no process.
    const naming = [...treeReading().docsNaming].sort();
    const walked = new Set(codeFiles());
    expect(naming.filter((path) => walked.has(path))).toEqual(naming);
    expect(
      floorBreach('docs-only/files-naming-docs', naming.length),
    ).toBeUndefined();
  });
});

describe('reading git diff --name-status -z', () => {
  it.each([
    ['nothing', '', []],
    [
      'a modification',
      'M\0docs/a.md\0',
      [{ status: 'M', paths: ['docs/a.md'] }],
    ],
    [
      'an addition',
      'A\0docs/a b.md\0',
      [{ status: 'A', paths: ['docs/a b.md'] }],
    ],
    ['a deletion', 'D\0src/a.ts\0', [{ status: 'D', paths: ['src/a.ts'] }]],
    [
      'a type change',
      'T\0docs/a.md\0',
      [{ status: 'T', paths: ['docs/a.md'] }],
    ],
    [
      'a rename, with its score',
      'R087\0docs/a.md\0src/a.md\0',
      [{ status: 'R', paths: ['docs/a.md', 'src/a.md'] }],
    ],
    [
      'a copy, with its score',
      'C100\0src/a.md\0docs/a.md\0',
      [{ status: 'C', paths: ['src/a.md', 'docs/a.md'] }],
    ],
    [
      'several changes',
      'M\0HANDOVER.md\0D\0docs/b.md\0',
      [
        { status: 'M', paths: ['HANDOVER.md'] },
        { status: 'D', paths: ['docs/b.md'] },
      ],
    ],
    [
      'a path holding a newline',
      'M\0docs/a\nb.md\0',
      [{ status: 'M', paths: ['docs/a\nb.md'] }],
    ],
  ])('reads %s', (_, output, changes) => {
    expect(parseNameStatus(output)).toEqual(changes);
  });

  it.each([
    ['a status with no path', 'M\0', /M .*no path/],
    ['a rename with one path', 'R100\0docs/a.md\0', /R100 .*2 paths/],
    ['an unknown status', 'Q\0docs/a.md\0', /unknown status "Q"/],
    ['output not ending in NUL', 'M\0docs/a.md', /does not end/],
    ['an empty status', '\0docs/a.md\0', /unknown status ""/],
  ])('refuses %s', (_, output, message) => {
    expect(() => parseNameStatus(output)).toThrow(message);
  });
});

describe('the verdict on a diff', () => {
  const change = (status: string, ...paths: string[]) => ({ status, paths });

  it.each([
    ['one modified doc', [change('M', 'docs/reviews/r.md')]],
    [
      'the handover and a doc',
      [change('M', 'HANDOVER.md'), change('A', 'docs/new.md')],
    ],
    ['a deleted doc', [change('D', 'docs/reviews/r.md')]],
    ['a rename within docs/', [change('R', 'docs/a.md', 'docs/b.md')]],
  ])('%s is docs-only', (_, changes) => {
    expect(docsOnlyVerdict(changes)).toEqual({ docsOnly: true, reasons: [] });
  });

  it.each([
    ['an empty diff', [], /empty/],
    [
      'a doc beside source',
      [change('M', 'docs/a.md'), change('M', 'src/a.ts')],
      /src\/a\.ts/,
    ],
    [
      'a rename out of docs/',
      [change('R', 'docs/a.md', 'src/a.md')],
      /src\/a\.md/,
    ],
    [
      'a rename into docs/',
      [change('R', 'src/a.md', 'docs/a.md')],
      /src\/a\.md/,
    ],
    [
      'a deleted read doc',
      [change('D', 'docs/releases/a.json')],
      /docs\/releases\/a\.json/,
    ],
    ['a deleted source file', [change('D', 'src/a.ts')], /src\/a\.ts/],
    ['a type change in docs/', [change('T', 'docs/a.md')], /T .*docs\/a\.md/],
    [
      'a copy into docs/',
      [change('C', 'docs/a.md', 'docs/b.md')],
      /C .*docs\/a\.md/,
    ],
    ['an unmerged doc', [change('U', 'docs/a.md')], /U .*docs\/a\.md/],
    ['an unknown change', [change('X', 'docs/a.md')], /X .*docs\/a\.md/],
  ])('%s is not docs-only', (_, changes, reason) => {
    const verdict = docsOnlyVerdict(changes);
    expect(verdict.docsOnly).toBe(false);
    expect(verdict.reasons.join('\n')).toMatch(reason);
  });

  it('names every path that is not documentation, not only the first', () => {
    const verdict = docsOnlyVerdict([
      change('M', 'src/a.ts'),
      change('M', 'docs/a.md'),
      change('A', 'tests/b.ts'),
    ]);
    expect(verdict.reasons).toHaveLength(2);
    expect(verdict.reasons.join('\n')).toMatch(/src\/a\.ts[^]*tests\/b\.ts/);
  });

  it('no tracked file outside the allowlist can share a docs-only verdict', () => {
    // Every tracked file, each beside a doc: the ones that leave the verdict
    // docs-only must be the allowlisted ones and nothing else.
    const tracked = trackedFiles(() => true);
    const passing = tracked.filter(
      (path) =>
        docsOnlyVerdict([change('M', 'docs/reviews/r.md'), change('M', path)])
          .docsOnly,
    );
    expect(passing).toEqual(tracked.filter(isDocsOnlyPath));
    expect(passing.length).toBeLessThan(tracked.length);
    expect(
      floorBreach('docs-only/tracked-files', tracked.length),
    ).toBeUndefined();
  });
});

describe('the verdict on a pull request checkout', () => {
  it('a git that fails runs everything, naming the failure', () => {
    const verdict = verdictFromGit({
      event: 'pull_request',
      git: () => {
        throw new Error('fatal: not a git repository');
      },
    });
    expect(verdict.docsOnly).toBe(false);
    expect(verdict.reasons.join('\n')).toMatch(/not a git repository/);
  });
});
