import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import {
  docsNamingArgs,
  docsPathspec,
  ignoreQuestions,
} from '../git-questions';
import { searched } from '../source-files';
import { treeReading } from '../tree-reading';

/**
 * The snapshot the unit suite reads is git's own answer (#631): each field
 * compared, as sets and in both directions, with a fresh git call. This may
 * start git; the unit suite may not.
 */
const git = (args: readonly string[], input?: string): string => {
  const run = spawnSync('git', [...args], { encoding: 'utf8', input });
  expect([0, 1], run.stderr).toContain(run.status);
  return run.stdout;
};
const nul = (text: string): string[] => text.split('\0').filter(Boolean);

const bothWays = (snapshot: readonly string[], fresh: readonly string[]) => {
  const have = new Set(snapshot);
  const want = new Set(fresh);
  return [
    ...fresh.filter((path) => !have.has(path)).map((p) => `${p}: missing`),
    ...snapshot.filter((path) => !want.has(path)).map((p) => `${p}: extra`),
  ];
};

describe('the tree reading is what git says now (#631)', () => {
  it('tracked equals git ls-files', () => {
    const fresh = nul(git(['ls-files', '-z']));
    expect(
      searched(bothWays(treeReading().tracked, fresh), {
        of: fresh,
        what: 'tracked files',
      }),
    ).toEqual([]);
    expect(
      floorBreach('tree-reading/fresh-tracked', fresh.length),
    ).toBeUndefined();
  });

  it('committable equals git ls-files with the untracked, unignored files', () => {
    const fresh = nul(
      git(['ls-files', '-z', '--others', '--exclude-standard', '--cached']),
    );
    expect(
      searched(bothWays(treeReading().committable, fresh), {
        of: fresh,
        what: 'committable files',
      }),
    ).toEqual([]);
    expect(
      floorBreach('tree-reading/fresh-committable', fresh.length),
    ).toBeUndefined();
  });

  it('every ignore answer equals git check-ignore', () => {
    const asked = ignoreQuestions();
    const ignored = new Set(
      git(['check-ignore', '--stdin'], asked.join('\n'))
        .split('\n')
        .filter(Boolean),
    );
    const answers = treeReading().ignored;
    const wrong = asked.filter((path) => answers[path] !== ignored.has(path));
    expect(searched(wrong, { of: asked, what: 'ignore questions' })).toEqual(
      [],
    );
    expect(
      floorBreach('tree-reading/fresh-ignore-questions', asked.length),
    ).toBeUndefined();
  });

  it('the docs-only selections equal git`s own', () => {
    const selected = nul(git(['ls-files', '-z', '--', ...docsPathspec()]));
    expect(
      searched(bothWays(treeReading().docsPathspecSelected, selected), {
        of: selected,
        what: 'docs-only files',
      }),
    ).toEqual([]);
    const naming = nul(git(docsNamingArgs()));
    expect(
      searched(bothWays(treeReading().docsNaming, naming), {
        of: naming,
        what: 'files naming docs/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('tree-reading/fresh-docs-selected', selected.length),
    ).toBeUndefined();
    expect(
      floorBreach('tree-reading/fresh-docs-naming', naming.length),
    ).toBeUndefined();
  });
});
