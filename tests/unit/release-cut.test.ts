import { describe, expect, it } from 'vitest';
import {
  MERGE_REF,
  errorStatus,
  postStatus,
  releaseCutFindings,
  statusFor,
} from '../../scripts/release-cut.mjs';
import { floorBreach } from '../floors';
import { searched } from '../source-files';

/**
 * A release reaches `main` only from a frozen `release/*` cut of `develop`
 * (#941; Shyden, 2026-10-17: "we only deploy to production the contents of
 * the release cut, nothing more"). `main` no longer demands a branch be up to
 * date (Shyden, 2026-10-23), since each release lands as a merge commit
 * develop never holds; so this check stands where that rule stood: the tree
 * the merge lands is the cut's own tree, and `main` holds nothing but the
 * merges of earlier cuts.
 */

const CUT = 'a'.repeat(40);
const PREVIOUS_CUT = 'b'.repeat(40);
const OLD_MAIN = 'c'.repeat(40);
const RELEASE_MERGE = 'd'.repeat(40);
const HOTFIX = 'e'.repeat(40);
const THIS_MERGE = 'f'.repeat(40);
const CUT_TREE = '1'.repeat(40);
const OTHER_TREE = '2'.repeat(40);

/** What `git` answers, keyed by its arguments joined with spaces. */
type Answers = Record<string, string | { status: number }>;

/**
 * A `git` that answers from `answers` and throws for anything else, writing
 * each question into `asked` when one is handed in.
 */
const gitOf =
  (answers: Answers, asked: string[] = []) =>
  (args: string[]): string => {
    const key = args.join(' ');
    asked.push(key);
    const answer = answers[key];
    if (answer === undefined) throw new Error(`unexpected git ${key}`);
    if (typeof answer === 'string') return answer;
    throw Object.assign(
      new Error(`git ${key} exited ${answer.status}`),
      answer,
    );
  };

/** A cut of develop whose merge lands exactly its tree, on a main of release merges. */
const sound: Answers = {
  [`merge-base --is-ancestor ${CUT} origin/develop`]: '',
  [`rev-list --parents -n 1 ${MERGE_REF}`]: `${THIS_MERGE} ${RELEASE_MERGE} ${CUT}\n`,
  [`rev-parse --verify ${MERGE_REF}^{tree}`]: `${CUT_TREE}\n`,
  [`rev-parse --verify ${CUT}^{tree}`]: `${CUT_TREE}\n`,
  'rev-list --parents origin/develop..origin/main': `${RELEASE_MERGE} ${OLD_MAIN} ${PREVIOUS_CUT}\n`,
  [`merge-base --is-ancestor ${PREVIOUS_CUT} origin/develop`]: '',
};

describe('releaseCutFindings', () => {
  // A clean verdict counts the questions git answered: a check that asked
  // nothing would find nothing too.
  it('takes a release/ cut of develop whose merge lands exactly its tree', () => {
    const asked: string[] = [];
    expect(
      searched(
        releaseCutFindings({
          headRef: 'release/2026-10-23-cut',
          headSha: CUT,
          git: gitOf(sound, asked),
        }),
        { of: asked, what: 'questions git answered about the sound cut' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('release-cut/sound-cut-questions', asked.length),
    ).toBeUndefined();
    expect(asked).toEqual(Object.keys(sound));
  });

  it('takes a main that develop already holds whole, as before the first cut', () => {
    const asked: string[] = [];
    const answers = {
      ...sound,
      'rev-list --parents origin/develop..origin/main': '',
    };
    expect(
      searched(
        releaseCutFindings({
          headRef: 'release/2026-10-23-cut',
          headSha: CUT,
          git: gitOf(answers, asked),
        }),
        { of: asked, what: 'questions git answered about the first cut' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('release-cut/first-cut-questions', asked.length),
    ).toBeUndefined();
    expect(asked).toEqual(
      Object.keys(answers).filter((key) => !key.includes(PREVIOUS_CUT)),
    );
  });

  it.each([
    ['develop itself', 'develop'],
    ['a feature branch', '941-release-from-a-cut'],
    ['a name that only contains release/', 'x-release/2026-10-23'],
  ])('refuses %s as the head', (_, headRef) => {
    expect(
      releaseCutFindings({ headRef, headSha: CUT, git: gitOf(sound) }),
    ).toEqual([
      `the head is '${headRef}', not a release/ cut: a release comes from a release/<date>-<what> branch cut at the commit Shyden chose, frozen there`,
    ]);
  });

  it('refuses a run that names no head branch', () => {
    expect(
      releaseCutFindings({
        headRef: undefined,
        headSha: CUT,
        git: gitOf(sound),
      }),
    ).toEqual([
      "the head is '', not a release/ cut: a release comes from a release/<date>-<what> branch cut at the commit Shyden chose, frozen there",
    ]);
  });

  it.each([
    ['no head commit', undefined],
    ['a short head commit', 'a'.repeat(7)],
    ['a head commit that is not hex', 'g'.repeat(40)],
  ])('refuses %s, and asks git nothing', (_, headSha) => {
    expect(
      releaseCutFindings({
        headRef: 'release/2026-10-23-cut',
        headSha,
        git: gitOf({}),
      }),
    ).toEqual([
      `the head commit is '${headSha ?? ''}', not a full commit id, so the cut cannot be read`,
    ]);
  });

  it('refuses a head develop does not hold', () => {
    expect(
      releaseCutFindings({
        headRef: 'release/2026-10-23-cut',
        headSha: CUT,
        git: gitOf({
          ...sound,
          [`merge-base --is-ancestor ${CUT} origin/develop`]: { status: 1 },
        }),
      }),
    ).toEqual([
      `${CUT} is not on develop, so the release would ship a commit develop never held`,
    ]);
  });

  it('refuses a merge that lands a tree other than the cut', () => {
    expect(
      releaseCutFindings({
        headRef: 'release/2026-10-23-cut',
        headSha: CUT,
        git: gitOf({
          ...sound,
          [`rev-parse --verify ${MERGE_REF}^{tree}`]: `${OTHER_TREE}\n`,
        }),
      }),
    ).toEqual([
      `the merge lands tree ${OTHER_TREE}, not the cut's tree ${CUT_TREE}: main holds something the cut does not, so the release would ship a tree no run tested`,
    ]);
  });

  // GitHub's merge ref is the head merged into main: two parents, the second
  // the head itself. Anything else is not this pull request's merge (#944).
  it.each([
    [
      'a merge of another head',
      `${THIS_MERGE} ${RELEASE_MERGE} ${PREVIOUS_CUT}\n`,
    ],
    ['a commit with one parent', `${THIS_MERGE} ${CUT}\n`],
    ['a merge of three', `${THIS_MERGE} ${RELEASE_MERGE} ${CUT} ${HOTFIX}\n`],
  ])('refuses %s as the merge ref', (_, parents) => {
    expect(
      releaseCutFindings({
        headRef: 'release/2026-10-23-cut',
        headSha: CUT,
        git: gitOf({
          ...sound,
          [`rev-list --parents -n 1 ${MERGE_REF}`]: parents,
        }),
      }),
    ).toEqual([
      `${MERGE_REF} is ${parents.trim()}, not GitHub's merge of ${CUT} into main, so what would land cannot be read`,
    ]);
  });

  it('refuses a main holding a commit that is no merge', () => {
    expect(
      releaseCutFindings({
        headRef: 'release/2026-10-23-cut',
        headSha: CUT,
        git: gitOf({
          ...sound,
          'rev-list --parents origin/develop..origin/main': `${RELEASE_MERGE} ${OLD_MAIN} ${PREVIOUS_CUT}\n${HOTFIX} ${OLD_MAIN}\n`,
        }),
      }),
    ).toEqual([
      `main holds ${HOTFIX}, which is not the merge of a cut of develop: main takes release cuts and nothing else`,
    ]);
  });

  it('refuses a main merge whose second parent develop does not hold', () => {
    expect(
      releaseCutFindings({
        headRef: 'release/2026-10-23-cut',
        headSha: CUT,
        git: gitOf({
          ...sound,
          [`merge-base --is-ancestor ${PREVIOUS_CUT} origin/develop`]: {
            status: 1,
          },
        }),
      }),
    ).toEqual([
      `main holds ${RELEASE_MERGE}, which is not the merge of a cut of develop: main takes release cuts and nothing else`,
    ]);
  });

  it('names every finding at once', () => {
    expect(
      releaseCutFindings({
        headRef: 'develop',
        headSha: CUT,
        git: gitOf({
          ...sound,
          [`merge-base --is-ancestor ${CUT} origin/develop`]: { status: 1 },
          [`rev-parse --verify ${MERGE_REF}^{tree}`]: `${OTHER_TREE}\n`,
        }),
      }),
    ).toEqual([
      "the head is 'develop', not a release/ cut: a release comes from a release/<date>-<what> branch cut at the commit Shyden chose, frozen there",
      `${CUT} is not on develop, so the release would ship a commit develop never held`,
      `the merge lands tree ${OTHER_TREE}, not the cut's tree ${CUT_TREE}: main holds something the cut does not, so the release would ship a tree no run tested`,
    ]);
  });

  it('throws a git failure that is not a "no" answer, never reading it as one', () => {
    expect(() =>
      releaseCutFindings({
        headRef: 'release/2026-10-23-cut',
        headSha: CUT,
        git: gitOf({
          ...sound,
          [`merge-base --is-ancestor ${CUT} origin/develop`]: { status: 128 },
        }),
      }),
    ).toThrow(`git merge-base --is-ancestor ${CUT} origin/develop exited 128`);
  });
});

/**
 * The verdict is the `release-cut` commit status on the pull request's head
 * (#944; Shyden's rulings of 2026-10-23 on repo-template#86): the job runs
 * the default branch's copy on `pull_request_target`, and its own check run
 * is named `judge-release-cut`, so the status alone answers for it.
 */
describe('the release-cut status', () => {
  it('is success for a sound cut', () => {
    expect(statusFor([])).toEqual({
      state: 'success',
      description:
        'a frozen release/ cut of develop, whose merge lands exactly its tree',
    });
  });

  it('is failure naming the first finding', () => {
    expect(statusFor(['the first reason', 'the second'])).toEqual({
      state: 'failure',
      description: 'the first reason',
    });
  });

  it('is error when git could not answer', () => {
    expect(errorStatus('git fetch exited 128')).toEqual({
      state: 'error',
      description: 'git could not answer: git fetch exited 128',
    });
  });

  it('cuts a description to the 140 characters GitHub keeps, marking the cut', () => {
    const { description } = statusFor(['x'.repeat(200)]);
    expect([description.length, description.endsWith('x…')]).toEqual([
      140,
      true,
    ]);
  });

  it('posts the status on the head, as the job token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await postStatus(
      {
        api: 'https://api.github.com',
        repository: 'shyden-labs/shyden.co.uk',
        sha: CUT,
        token: 'job-token',
        targetUrl: 'https://github.com/shyden-labs/shyden.co.uk/actions/runs/1',
        status: { state: 'success', description: 'sound' },
      },
      async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response('{}', { status: 201 });
      },
    );
    expect(
      calls.map(({ url, init }) => ({
        url,
        method: init.method,
        headers: init.headers,
        body: JSON.parse(String(init.body)),
      })),
    ).toEqual([
      {
        url: `https://api.github.com/repos/shyden-labs/shyden.co.uk/statuses/${CUT}`,
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: 'Bearer job-token',
          'x-github-api-version': '2022-11-28',
        },
        body: {
          state: 'success',
          context: 'release-cut',
          description: 'sound',
          target_url:
            'https://github.com/shyden-labs/shyden.co.uk/actions/runs/1',
        },
      },
    ]);
  });

  it('throws when GitHub refuses the status, naming its answer', async () => {
    await expect(
      postStatus(
        {
          api: 'https://api.github.com',
          repository: 'shyden-labs/shyden.co.uk',
          sha: CUT,
          token: 'job-token',
          targetUrl: 'https://github.com/x',
          status: { state: 'success', description: 'sound' },
        },
        async () =>
          new Response('Resource not accessible by integration', {
            status: 403,
          }),
      ),
    ).rejects.toThrow(
      `release-cut: GitHub answered 403 to the status on ${CUT}: Resource not accessible by integration`,
    );
  });
});
