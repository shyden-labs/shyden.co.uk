import { describe, expect, it } from 'vitest';
import { inventoryFor } from '../../scripts/release-inventory.mjs';

/**
 * #1275: SonarCloud's S8705. The base and head come from the command line and
 * reach `git rev-parse`; one starting with `-` would be read by git as an
 * option. A commit name is checked against what a revision can be spelled
 * with before git sees it, and git is told where its options end.
 */
const recording = () => {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    return args[0] === 'rev-parse' ? 'a'.repeat(40) : '';
  };
  return { calls, git };
};

describe('the commits release-inventory names', () => {
  it('refuses a base that git would read as an option, before running git', () => {
    const { calls, git } = recording();
    expect(() =>
      inventoryFor({ base: '--output=/tmp/x', head: 'HEAD', git }),
    ).toThrow('release-inventory: "--output=/tmp/x" is not a commit name');
    expect(calls).toEqual([]);
  });

  it('refuses a head that git would read as an option, before running git', () => {
    const { calls, git } = recording();
    expect(() => inventoryFor({ base: 'abc1234', head: '-n1', git })).toThrow(
      'release-inventory: "-n1" is not a commit name',
    );
    expect(calls).toEqual([]);
  });

  it('tells git where its options end before each commit name', () => {
    const { calls, git } = recording();
    inventoryFor({ base: 'abc1234', head: 'HEAD', git });
    expect(calls.slice(0, 2)).toEqual([
      ['rev-parse', '--verify', '--end-of-options', 'abc1234^{commit}'],
      ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'],
    ]);
  });
});
