import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchGit } from '../git-env';
import { runScript, standIn, type StandIn } from '../json-stand-in';

/**
 * `scripts/release-cut.mjs` as `release-cut.yml` runs it (#941, #944): in a
 * checkout of the default branch whose origin holds develop, main and the
 * pull request's merge ref, so every fetch, ancestry, tree and parent it reads
 * is git's own answer, and its verdict goes to a stand-in of GitHub's status
 * endpoint on this machine. `tests/unit/release-cut.test.ts` holds every
 * finding's wording.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/release-cut.mjs',
);

/** The pull request the stand-in origin holds a merge ref for. */
const PULL = 7;

let root: string;
let work: (args: readonly string[]) => string;
let workDir: string;
let checkout: string;
// One per test: a stand-in's record runs on across the tests it serves.
let github: StandIn;
let answer: number;

/** Commits `file` with `text` in the working repository, and returns it. */
const commit = (file: string, text: string) => {
  writeFileSync(path.join(workDir, file), text);
  work(['add', file]);
  work(['commit', '-q', '-m', file]);
  return work(['rev-parse', 'HEAD']).trim();
};

/** Publishes develop and main to origin, then clones the job's checkout. */
const publish = (develop: string, main: string) => {
  work(['push', '-q', 'origin', `${develop}:refs/heads/develop`]);
  work(['push', '-q', 'origin', `${main}:refs/heads/main`]);
  scratchGit(root)(['clone', '-q', 'origin.git', 'checkout']);
};

/** GitHub's merge of `cut` into `main`, published as the pull request's merge ref. */
const mergeRef = (main: string, cut: string) => {
  work(['checkout', '-q', '--detach', main]);
  work(['merge', '-q', '--no-ff', '--no-edit', cut]);
  const merge = work(['rev-parse', 'HEAD']).trim();
  work(['push', '-q', 'origin', `${merge}:refs/pull/${PULL}/merge`]);
  work(['checkout', '-q', 'develop']);
  return merge;
};

/** Runs the script in the checkout, with what release-cut.yml gives it. */
const run = (headRef: string, headSha: string) =>
  runScript(
    SCRIPT,
    [],
    {
      HOME: root,
      HEAD_REF: headRef,
      HEAD_SHA: headSha,
      PR_NUMBER: String(PULL),
      GITHUB_TOKEN: 'job-token',
      GITHUB_API_URL: github.url,
      GITHUB_REPOSITORY: 'shyden-labs/shyden.co.uk',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ID: '1',
    },
    checkout,
  );

/** The statuses that reached the stand-in, each as GitHub would read it. */
const posts = async () =>
  (await github.record()).map(({ method, url, auth, body }) => ({
    url: `${method} ${url}`,
    authorization: auth,
    body: JSON.parse(body) as unknown,
  }));

let base: string;
let cut: string;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'release-cut-'));
  scratchGit(root)(['init', '-q', '--bare', 'origin.git']);
  workDir = path.join(root, 'work');
  mkdirSync(workDir);
  checkout = path.join(root, 'checkout');
  work = scratchGit(workDir);
  work(['init', '-q', '-b', 'develop']);
  work(['config', 'user.email', 'cut@example.invalid']);
  work(['config', 'user.name', 'Cut']);
  work(['remote', 'add', 'origin', path.join(root, 'origin.git')]);
  base = commit('page.txt', 'live\n');
  cut = commit('page.txt', 'the release\n');
  answer = 201;
  github = standIn();
  github.answer(() => ({
    status: answer,
    body: answer === 201 ? {} : 'refused',
  }));
  await github.start();
});

afterEach(async () => {
  await github.stop();
  rmSync(root, { recursive: true, force: true });
});

/** The one status a run posts, on `sha`. */
const posted = (sha: string, state: string, description: string) => [
  {
    url: `POST /repos/shyden-labs/shyden.co.uk/statuses/${sha}`,
    authorization: 'Bearer job-token',
    body: {
      state,
      context: 'release-cut',
      description,
      target_url: 'https://github.com/shyden-labs/shyden.co.uk/actions/runs/1',
    },
  },
];

describe('release-cut.mjs', () => {
  it('passes a release/ cut of develop merged into a main develop holds', async () => {
    mergeRef(base, cut);
    publish(cut, base);
    const result = await run('release/2026-10-23-cut', cut);
    expect([result.code, result.out]).toEqual([
      0,
      `release-cut: release/2026-10-23-cut at ${cut} is a cut of develop, and its merge lands exactly its tree\n`,
    ]);
    expect(await posts()).toEqual(
      posted(
        cut,
        'success',
        'a frozen release/ cut of develop, whose merge lands exactly its tree',
      ),
    );
  });

  it('passes the second cut, onto a main holding the first cut as a merge', async () => {
    const firstRelease = mergeRef(base, cut);
    const second = commit('page.txt', 'the next release\n');
    mergeRef(firstRelease, second);
    publish(second, firstRelease);
    const result = await run('release/2026-10-30-next', second);
    expect([result.code, result.out]).toEqual([
      0,
      `release-cut: release/2026-10-30-next at ${second} is a cut of develop, and its merge lands exactly its tree\n`,
    ]);
    expect((await posts()).map(({ body }) => body)).toEqual(
      posted(
        second,
        'success',
        'a frozen release/ cut of develop, whose merge lands exactly its tree',
      ).map(({ body }) => body),
    );
  });

  it('fails a main holding a hotfix, naming it and the tree it changes', async () => {
    work(['checkout', '-q', '--detach', base]);
    const hotfix = commit('hotfix.txt', 'straight onto main\n');
    work(['checkout', '-q', 'develop']);
    const merge = mergeRef(hotfix, cut);
    publish(cut, hotfix);
    const landed = work(['rev-parse', `${merge}^{tree}`]).trim();
    const cutTree = work(['rev-parse', `${cut}^{tree}`]).trim();
    const result = await run('release/2026-10-23-cut', cut);
    const first = `the merge lands tree ${landed}, not the cut's tree ${cutTree}: main holds something the cut does not, so the release would ship a tree no run tested`;
    expect([result.code, result.out]).toEqual([
      1,
      [
        `::error::${first}`,
        `::error::main holds ${hotfix}, which is not the merge of a cut of develop: main takes release cuts and nothing else`,
        '',
      ].join('\n'),
    ]);
    expect(await posts()).toEqual(
      posted(cut, 'failure', `${first.slice(0, 139)}…`),
    );
  });

  it('fails a head that is not a release/ branch, naming it', async () => {
    mergeRef(base, cut);
    publish(cut, base);
    const result = await run('develop', cut);
    const finding =
      "the head is 'develop', not a release/ cut: a release comes from a release/<date>-<what> branch cut at the commit Shyden chose, frozen there";
    expect([result.code, result.out]).toEqual([1, `::error::${finding}\n`]);
    // 139 characters: under GitHub's 140, so it is posted whole.
    expect(await posts()).toEqual(posted(cut, 'failure', finding));
  });

  // GitHub builds no merge ref for a pull request that conflicts with main.
  it('posts an error, naming git, when the merge ref does not exist', async () => {
    publish(cut, base);
    const result = await run('release/2026-10-23-cut', cut);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(
      new RegExp(`^::error::release-cut: .*refs/pull/${PULL}/merge`),
    );
    expect(
      (await posts()).map(({ body }) => (body as { state: string }).state),
    ).toEqual(['error']);
  });

  it('fails, naming GitHub’s answer, when the status is refused', async () => {
    mergeRef(base, cut);
    publish(cut, base);
    answer = 403;
    const result = await run('release/2026-10-23-cut', cut);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(
      `release-cut: GitHub answered 403 to the status on ${cut}: refused`,
    );
  });
});
