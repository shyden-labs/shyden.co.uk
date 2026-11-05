/**
 * Whether a pull request into `main` is a release cut (#941): production gets
 * the contents of the release cut and nothing more (Shyden, 2026-10-17). A
 * release is a `release/<date>-<what>` branch cut at the commit Shyden chose
 * and frozen there, merged into `main` with a merge commit.
 *
 * WHY THIS STANDS WHERE "UP TO DATE" STOOD
 *
 * Each release lands on `main` as a merge commit `develop` never holds, so a
 * `main` demanding that a branch be up to date would refuse every cut after
 * the first. Shyden dropped that demand on `main` alone (2026-10-23). What it
 * guaranteed, that the tree which lands is the tree that was tested, is
 * checked here instead: the pull request's merge lands exactly the cut's own
 * tree, and `main` holds nothing but merges of earlier cuts, so nothing on
 * `main` can join a release unseen.
 *
 * WHOSE CODE RUNS (#944; Shyden's rulings of 2026-10-23 on repo-template#86)
 *
 * Never the pull request's: `release-cut.yml` runs on `pull_request_target`,
 * the default branch's own copy of this script, and fetches the pull
 * request's merge (`refs/pull/<n>/merge`) as git data only. The verdict is
 * the `release-cut` commit status on the head, which `main` requires; the
 * job's own check run is named `judge-release-cut`.
 *
 *   node scripts/release-cut.mjs   (release-cut.yml; reads HEAD_REF,
 *                                   HEAD_SHA, PR_NUMBER, GITHUB_TOKEN and
 *                                   the runner's GITHUB_* variables)
 */
import { execFileSync } from 'node:child_process';
import { messageOf } from './errors.mjs';

/** The branch every release comes from. */
export const CUT_PREFIX = 'release/';

/** Where the pull request's merge is fetched to, as data. */
export const MERGE_REF = 'refs/remotes/pull/merge';

/** The commit status `main` requires. */
const CONTEXT = 'release-cut';

/** GitHub keeps a status description of at most this many characters. */
const DESCRIPTION_LIMIT = 140;

/** @typedef {(args: string[]) => string} Git */

/**
 * Whether `ancestor` is on `descendant`'s history. `--is-ancestor` answers no
 * with status 1; any other failure is git's own and is thrown, never read as
 * a no.
 *
 * @param {Git} git
 * @param {string} ancestor
 * @param {string} descendant
 * @returns {boolean}
 */
const isAncestor = (git, ancestor, descendant) => {
  try {
    git(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (error) {
    if (/** @type {{ status?: unknown } | null} */ (error)?.status === 1)
      return false;
    throw error;
  }
};

/** @param {Git} git @param {string} commit */
const treeOf = (git, commit) =>
  git(['rev-parse', '--verify', `${commit}^{tree}`]).trim();

/**
 * Every reason this run is not a sound release cut, empty when it is one.
 *
 * @param {{ headRef: string | undefined, headSha: string | undefined, git: Git }} input
 * @returns {string[]}
 */
export function releaseCutFindings({ headRef, headSha, git }) {
  const findings = [];
  if (!(headRef ?? '').startsWith(CUT_PREFIX))
    findings.push(
      `the head is '${headRef ?? ''}', not a ${CUT_PREFIX} cut: a release comes from a ${CUT_PREFIX}<date>-<what> branch cut at the commit Shyden chose, frozen there`,
    );
  if (headSha === undefined || !/^[0-9a-f]{40}$/.test(headSha))
    return [
      ...findings,
      `the head commit is '${headSha ?? ''}', not a full commit id, so the cut cannot be read`,
    ];

  if (!isAncestor(git, headSha, 'origin/develop'))
    findings.push(
      `${headSha} is not on develop, so the release would ship a commit develop never held`,
    );

  // GitHub's merge of this head into main: two parents, the second the head.
  const merge = git(['rev-list', '--parents', '-n', '1', MERGE_REF]).trim();
  const [, ...mergeParents] = merge.split(' ');
  if (mergeParents.length !== 2 || mergeParents[1] !== headSha)
    findings.push(
      `${MERGE_REF} is ${merge}, not GitHub's merge of ${headSha} into main, so what would land cannot be read`,
    );

  const landed = treeOf(git, MERGE_REF);
  const cut = treeOf(git, headSha);
  if (landed !== cut)
    findings.push(
      `the merge lands tree ${landed}, not the cut's tree ${cut}: main holds something the cut does not, so the release would ship a tree no run tested`,
    );

  // Each commit main holds outside develop must be a release merge: two
  // parents, the second a commit develop holds. A hotfix, or a merge of
  // anything develop never saw, brings a commit of its own into this list.
  const outside = git(['rev-list', '--parents', 'origin/develop..origin/main'])
    .split('\n')
    .filter((line) => line !== '');
  for (const line of outside) {
    const [sha, ...parents] = line.split(' ');
    const cutOfDevelop =
      parents.length === 2 && isAncestor(git, parents[1], 'origin/develop');
    if (!cutOfDevelop)
      findings.push(
        `main holds ${sha}, which is not the merge of a cut of develop: main takes release cuts and nothing else`,
      );
  }
  return findings;
}

/** @typedef {{ state: 'success' | 'failure' | 'error', description: string }} Status */

/** @param {string} text */
const described = (text) =>
  text.length <= DESCRIPTION_LIMIT
    ? text
    : `${text.slice(0, DESCRIPTION_LIMIT - 1)}…`;

/**
 * The status a verdict posts: success, or failure naming the first finding.
 *
 * @param {readonly string[]} findings
 * @returns {Status}
 */
export const statusFor = (findings) =>
  findings.length === 0
    ? {
        state: 'success',
        description: described(
          `a frozen ${CUT_PREFIX} cut of develop, whose merge lands exactly its tree`,
        ),
      }
    : { state: 'failure', description: described(findings[0] ?? '') };

/**
 * The status when git could not answer: never read as either verdict.
 *
 * @param {string} message
 * @returns {Status}
 */
export const errorStatus = (message) => ({
  state: 'error',
  description: described(`git could not answer: ${message}`),
});

/**
 * Posts `status` as the `release-cut` commit status on `sha`, as the job's
 * own token; a refusal is thrown, naming GitHub's answer.
 *
 * @param {{ api: string, repository: string, sha: string, token: string, targetUrl: string, status: Status }} post
 * @param {typeof fetch} [send]
 */
export const postStatus = async (
  { api, repository, sha, token, targetUrl, status },
  send = fetch,
) => {
  const answer = await send(`${api}/repos/${repository}/statuses/${sha}`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({
      state: status.state,
      context: CONTEXT,
      description: status.description,
      target_url: targetUrl,
    }),
  });
  if (!answer.ok)
    throw new Error(
      `release-cut: GitHub answered ${answer.status} to the status on ${sha}: ${await answer.text()}`,
    );
};

/** @param {string} name */
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`release-cut: ${name} is not set`);
  return value;
};

async function main() {
  /** @type {Git} */
  const git = (args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const headRef = process.env.HEAD_REF;
  // Without these there is no head to post on, so the run refuses in one
  // line and posts nothing.
  const config = (() => {
    try {
      const sha = required('HEAD_SHA');
      const repository = required('GITHUB_REPOSITORY');
      return {
        headSha: sha,
        number: required('PR_NUMBER'),
        post: {
          api: required('GITHUB_API_URL'),
          repository,
          sha,
          token: required('GITHUB_TOKEN'),
          targetUrl: `${required('GITHUB_SERVER_URL')}/${repository}/actions/runs/${required('GITHUB_RUN_ID')}`,
        },
      };
    } catch (error) {
      console.error(`::error::${messageOf(error)}`);
      return process.exit(1);
    }
  })();
  const { headSha, number, post } = config;
  /** @type {Status} */
  let status;
  /** @type {string[]} */
  let findings = [];
  try {
    if (!/^[1-9][0-9]*$/.test(number))
      throw new Error(`PR_NUMBER is '${number}', not a pull request number`);
    // As data: nothing fetched here is run.
    git([
      'fetch',
      '--no-tags',
      'origin',
      '+refs/heads/develop:refs/remotes/origin/develop',
      '+refs/heads/main:refs/remotes/origin/main',
      `+refs/pull/${number}/merge:${MERGE_REF}`,
    ]);
    findings = releaseCutFindings({ headRef, headSha, git });
    status = statusFor(findings);
  } catch (error) {
    console.error(`::error::release-cut: ${messageOf(error)}`);
    status = errorStatus(messageOf(error));
  }
  for (const finding of findings) console.error(`::error::${finding}`);
  await postStatus({ ...post, status });
  if (status.state !== 'success') process.exit(1);
  console.log(
    `release-cut: ${headRef} at ${headSha} is a cut of develop, and its merge lands exactly its tree`,
  );
}

if (import.meta.main) await main();
