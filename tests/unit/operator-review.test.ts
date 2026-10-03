import { describe, expect, it } from 'vitest';
import { reviewVerdict } from '../../scripts/operator-review.mjs';

// The operator-review lock (#459, decision 4). Fixtures are written here,
// never imported from the code under test, so they can disagree with it.

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const SHOT = 'tests/e2e/__screenshots__/home-mobile-linux.png';
const OPERATOR = 'ShydenMcM';
const ACTIONS = 'github-actions[bot]';

interface Commit {
  sha: string;
  author: string | null;
  paths: string[];
  truncated: boolean;
}

interface Review {
  user: string | null;
  state: string;
  commitId: string;
}

const commit = (
  author: string | null,
  paths: string[],
  change: Partial<Commit> = {},
): Commit => ({
  sha: 'c'.repeat(40),
  author,
  paths,
  truncated: false,
  ...change,
});

const review = (user: string, state: string, commitId = HEAD): Review => ({
  user,
  state,
  commitId,
});

const verdictOf = (
  commits: Commit[],
  reviews: Review[] = [],
  total = commits.length,
) => reviewVerdict({ total, commits, reviews, head: HEAD });

/** Dependabot's bump, then the commit workflow's recapture. */
const REBASELINE = [
  commit('dependabot[bot]', ['package.json', 'package-lock.json']),
  commit(ACTIONS, [SHOT]),
];

const UNLOCKED = {
  state: 'success',
  description: 'No automatic rebaseline in this pull request',
};
const WAITING = {
  state: 'failure',
  description: 'Waiting for the operator to approve the rebaseline at aaaaaaa',
};
const APPROVED = {
  state: 'success',
  description: 'The operator approved the rebaseline at aaaaaaa',
};

describe('reviewVerdict: a pull request with no automatic rebaseline (#459)', () => {
  it('passes one with no bot commit, screenshots included', () => {
    expect(verdictOf([commit(OPERATOR, [SHOT])])).toEqual(UNLOCKED);
  });

  it('passes a bot commit that touches no screenshot', () => {
    expect(verdictOf([commit(ACTIONS, ['package.json'])])).toEqual(UNLOCKED);
  });

  it('passes a bot commit on a path that only begins like the folder', () => {
    expect(
      verdictOf([commit(ACTIONS, ['tests/e2e/__screenshots__-notes.md'])]),
    ).toEqual(UNLOCKED);
  });
});

describe('reviewVerdict: a pull request carrying one (#459)', () => {
  it('holds it with no review', () => {
    expect(verdictOf(REBASELINE)).toEqual(WAITING);
  });

  it('holds a screenshot commit whose author resolves to no account', () => {
    expect(verdictOf([commit(null, [SHOT])])).toEqual(WAITING);
  });

  it("releases it on the operator's approval at the head", () => {
    expect(verdictOf(REBASELINE, [review(OPERATOR, 'APPROVED')])).toEqual(
      APPROVED,
    );
  });

  it('holds an approval given at an older commit', () => {
    expect(
      verdictOf(REBASELINE, [review(OPERATOR, 'APPROVED', OLDER)]),
    ).toEqual(WAITING);
  });

  it("holds the agent App's approval", () => {
    expect(
      verdictOf(REBASELINE, [review('shyden-agent[bot]', 'APPROVED')]),
    ).toEqual(WAITING);
  });

  it("holds Dependabot's approval", () => {
    expect(
      verdictOf(REBASELINE, [review('dependabot[bot]', 'APPROVED')]),
    ).toEqual(WAITING);
  });

  it('holds once changes are requested after the approval', () => {
    expect(
      verdictOf(REBASELINE, [
        review(OPERATOR, 'APPROVED'),
        review(OPERATOR, 'CHANGES_REQUESTED'),
      ]),
    ).toEqual(WAITING);
  });

  it('releases an approval given again after a change request', () => {
    expect(
      verdictOf(REBASELINE, [
        review(OPERATOR, 'CHANGES_REQUESTED'),
        review(OPERATOR, 'APPROVED'),
      ]),
    ).toEqual(APPROVED);
  });

  it('keeps the approval when a comment follows it', () => {
    expect(
      verdictOf(REBASELINE, [
        review(OPERATOR, 'APPROVED'),
        review(OPERATOR, 'COMMENTED'),
      ]),
    ).toEqual(APPROVED);
  });

  it('holds a dismissed approval, which the API returns as DISMISSED', () => {
    expect(verdictOf(REBASELINE, [review(OPERATOR, 'DISMISSED')])).toEqual(
      WAITING,
    );
  });
});

describe('reviewVerdict: what it refuses to decide (#459)', () => {
  it("refuses a commit list shorter than the pull request's count", () => {
    expect(() => verdictOf(REBASELINE, [], 251)).toThrow(
      "read 2 of the pull request's 251 commits",
    );
  });

  it('refuses a commit whose file list is truncated', () => {
    const sha = 'd'.repeat(40);
    expect(() =>
      verdictOf([commit(OPERATOR, ['src/a.ts'], { sha, truncated: true })]),
    ).toThrow(`commit ${sha}'s file list is truncated`);
  });
});
