import { execFileSync } from 'node:child_process';

import { die, messageOf } from './errors.mjs';

/**
 * May this commit be deployed to dev without re-running the whole suite?
 *
 * `deploy-dev.yml` used to re-run the entire merge gate on every push to
 * `develop`: the same seven steps `ci.yml` runs, ~26 minutes, against a tree
 * that had already passed them. That duplicate was also the ONLY place the
 * suite ran under a `timeout-minutes`, which is how run 34676066071 was
 * cancelled at 24m02s while both the deploy and the verify job were skipped —
 * a failure that posts no red gate and reads as "nothing happened" (#155).
 *
 * The obvious fix does not work, and finding that out first is what produced
 * this design. `ci.yml` never runs on a push (its triggers are `pull_request`
 * and the dispatch path's `workflow_call`), so a merge commit that a push
 * delivers carries no `build-and-test` status to read, and a gate querying
 * `/statuses` would find nothing at all.
 *
 * What is true is that `develop` sets `strict: true`, so a PR cannot merge
 * unless it is up to date with its base — which makes the merge commit's TREE
 * identical to the tested head's tree. Measured on 6695877: the merge commit
 * and its second parent 49fd9c5 are both tree
 * eb26eb490c6c84e670315b1103199d4006fa5998.
 *
 * So this verifies tree equality instead of trusting a status to exist, which
 * is strictly stronger: it refuses BY CONSTRUCTION whenever the deployed bytes
 * are not the bytes that passed — a direct push, a dispatched branch, or any
 * tree that differs.
 *
 * A squash merge (#892; every PR into `develop` squashes since 2026-10-21) has
 * one parent, so its tested head is found another way: GitHub records the pull
 * request a squash came from, as that pull request's `merge_commit_sha`.
 * `strict: true` holds there too, so the squash's tree is the tested head's,
 * and the gate demands exactly that, and the same checks. A one-parent commit
 * no merged pull request into `develop` landed is a direct push, and refused.
 *
 * The only dangerous failure here is a false GREEN, so every ambiguous case
 * refuses: an unresolvable tree, an absent check-run, a null conclusion. An
 * absent result must never be indistinguishable from a passing one (#146).
 */

/**
 * The checks that gate a merge into `develop`.
 *
 * A literal pin against the branch-protection contexts
 * (`["build-and-test","visual"]`, `strict: true`, `enforce_admins: true`).
 * `visual` belongs here: a gate that forgot it would deploy a tree whose visual
 * regressions were never judged, and #33 exists because a suite that detects
 * but does not block is decoration.
 */
export const REQUIRED_CHECKS = ['build-and-test', 'visual'];

/** @param {unknown} sha */
const short = (sha) => String(sha ?? '').slice(0, 7);

/** The branch whose pushes deploy to dev, and so the only base a squash may land on. */
export const DEPLOY_BASE = 'develop';

/**
 * One pull request, reduced to the fields that decide whether it landed a
 * commit: from `GET /repos/{repo}/commits/{sha}/pulls`.
 *
 * @typedef {{
 *   number: number,
 *   merged: boolean,
 *   mergeCommitSha: string | null,
 *   headSha: string,
 *   baseRef: string,
 * }} Pull
 */

/**
 * The head whose checks speak for `sha`, or why there is none. A merge
 * commit's is its second parent. A squash's is the head of the one merged pull
 * request into `DEPLOY_BASE` that landed it as its merge commit (#892).
 *
 * @param {{ sha: string, parents: readonly string[], pulls?: readonly Pull[] | string }} input
 * @returns {{ tested: string, as: string } | { refusal: string }}
 */
const testedHeadOf = ({ sha, parents, pulls }) => {
  if (parents.length >= 2) return { tested: parents[1] ?? '', as: '' };
  if (parents.length === 0)
    return {
      refusal: `${short(sha)} has no parents: no tested head can stand for it, so the suite has to run here.`,
    };
  if (pulls === undefined)
    return {
      refusal: `${short(sha)} has one parent and its pull requests were never read: refusing rather than assuming none.`,
    };
  if (typeof pulls === 'string')
    return {
      refusal: `could not read the pull requests of ${short(sha)} (${pulls}): refusing rather than assuming none.`,
    };
  const landing = pulls.filter(
    (pull) =>
      pull.merged &&
      pull.baseRef === DEPLOY_BASE &&
      pull.mergeCommitSha === sha,
  );
  const [pull, ...others] = landing;
  if (pull === undefined)
    return {
      refusal: `${short(sha)} has one parent and no merged pull request into ${DEPLOY_BASE} landed it as its merge commit: a direct push, so the suite has to run here.`,
    };
  if (others.length > 0)
    return {
      refusal: `${short(sha)} is the merge commit of pull requests ${landing.map(({ number }) => `#${number}`).join(' and ')}: refusing rather than choosing which head was tested.`,
    };
  return {
    tested: pull.headSha,
    as: `squash ${short(sha)} of pull request #${pull.number}: `,
  };
};

/**
 * Sort key for "which run of this name is current".
 *
 * A run still going has no `completedAt` and is by definition not superseded,
 * so it sorts LAST and therefore decides — matching branch protection, where a
 * pending required check does not satisfy the rule.
 *
 *  @param {{ completedAt?: string | null } | undefined} run
 */
const finishedAt = (run) =>
  run?.completedAt ? Date.parse(run.completedAt) : Number.POSITIVE_INFINITY;

/**
 * One GitHub check-run, reduced to the three fields that decide anything.
 *
 * @typedef {{
 *   name: string,
 *   conclusion: string | null,
 *   completedAt: string | null,
 * }} CheckRun
 */

/**
 * Annotated rather than left to inference: TypeScript reads `parents = []` as
 * `never[]` and `treeOf = {}` as `{}`, so every real argument became a type
 * error and the suite could not be type-checked at all. `astro check` caught
 * it, which is the whole reason this repo turned type-checking on (#115).
 *
 * @param {{
 *   sha: string,
 *   parents?: readonly string[],
 *   pulls?: readonly Pull[] | string,
 *   treeOf?: Record<string, string | undefined>,
 *   checks?: readonly CheckRun[],
 * }} input
 * @returns {{ deploy: boolean, reason: string }}
 */
export const decideDeploy = ({
  sha,
  parents = [],
  pulls,
  treeOf = {},
  checks = [],
}) => {
  const head = testedHeadOf({ sha, parents, pulls });
  if ('refusal' in head) return { deploy: false, reason: head.refusal };
  const { tested, as } = head;
  const mergeTree = treeOf[sha];
  const testedTree = treeOf[tested];

  if (!mergeTree || !testedTree) {
    return {
      deploy: false,
      reason:
        `could not resolve a tree for ${short(mergeTree ? tested : sha)} — refusing rather ` +
        `than assuming the trees are equal.`,
    };
  }

  if (mergeTree !== testedTree) {
    return {
      deploy: false,
      reason:
        `tree mismatch: ${short(sha)} is ${short(mergeTree)} but its tested head ` +
        `${short(tested)} is ${short(testedTree)}. The bytes being deployed are not the ` +
        `bytes that passed.`,
    };
  }

  for (const name of REQUIRED_CHECKS) {
    const runs = checks.filter((run) => run?.name === name);
    if (runs.length === 0) {
      return {
        deploy: false,
        reason:
          `no ${name} check-run on the tested head ${short(tested)}. An absent result is ` +
          `not a pass — that equivalence is the defect this gate exists to avoid.`,
      };
    }
    const current = runs.reduce((a, b) =>
      finishedAt(b) >= finishedAt(a) ? b : a,
    );
    if (current.conclusion !== 'success') {
      return {
        deploy: false,
        reason:
          `${name} on ${short(tested)} is ${current.conclusion ?? 'still running'}, not ` +
          `success. Deploying would publish a tree whose gate did not pass.`,
      };
    }
  }

  return {
    deploy: true,
    reason:
      `${as}tree ${short(mergeTree)} is identical to tested head ${short(tested)}, which passed ` +
      `${REQUIRED_CHECKS.join(' + ')}.`,
  };
};

/** @param {...string} args */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/**
 * One GET against the API the runner names in GITHUB_API_URL (Actions sets it
 * on every runner, and `tests/integration/deploy-gate-script.test.ts` points
 * it at a stand-in).
 *
 * Node's `fetch` rejects an unreachable host with only "fetch failed" and
 * keeps the reason on `cause`, so the refusal names the request and the cause.
 *
 * @param {string} path below the API root, e.g. `/repos/o/r/commits/x/pulls`
 * @param {string} token
 * @param {string} what what the answer is, for a refusal
 * @returns {Promise<unknown>}
 */
const getJson = async (path, token, what) => {
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const url = `${api}${path}`;
  /** @type {Response} */
  let res;
  try {
    res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    throw new Error(`GET ${url} could not be reached: ${messageOf(cause)}`);
  }
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
  return res.json();
};

/**
 * The check-runs on `sha`.
 *
 * @param {string} repo
 * @param {string} sha
 * @param {string} token
 * @returns {Promise<CheckRun[]>}
 */
const checkRunsFor = async (repo, sha, token) => {
  const body =
    /** @type {{ check_runs?: { name: string, conclusion: string | null, completed_at: string | null }[] }} */ (
      await getJson(
        `/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
        token,
        `check-runs for ${short(sha)}`,
      )
    );
  return (body.check_runs ?? []).map((run) => ({
    name: run.name,
    conclusion: run.conclusion,
    completedAt: run.completed_at,
  }));
};

/**
 * The pull requests GitHub associates with `sha`, or why they could not be
 * read: a squash's own pull request is among them, as its merge commit (#892).
 *
 * @param {string} repo
 * @param {string} sha
 * @param {string} token
 * @returns {Promise<Pull[] | string>}
 */
const pullsFor = async (repo, sha, token) => {
  try {
    const body =
      /** @type {{ number: number, merged_at: string | null, merge_commit_sha: string | null, head: { sha: string }, base: { ref: string } }[]} */ (
        await getJson(
          `/repos/${repo}/commits/${sha}/pulls?per_page=100`,
          token,
          `pulls for ${short(sha)}`,
        )
      );
    return body.map((pull) => ({
      number: pull.number,
      merged: pull.merged_at !== null,
      mergeCommitSha: pull.merge_commit_sha,
      headSha: pull.head.sha,
      baseRef: pull.base.ref,
    }));
  } catch (error) {
    return messageOf(error);
  }
};

/**
 * A commit's tree, from git when the checkout holds the commit, else from the
 * API: a squashed pull request's head may be on no branch the checkout
 * fetched. `undefined` when neither can say, which the gate refuses.
 *
 * @param {string} repo
 * @param {string} sha
 * @param {string} token
 * @returns {Promise<string | undefined>}
 */
const treeFor = async (repo, sha, token) => {
  try {
    return git('rev-parse', `${sha}^{tree}`);
  } catch {
    try {
      const body = /** @type {{ tree?: { sha?: string } }} */ (
        await getJson(
          `/repos/${repo}/git/commits/${sha}`,
          token,
          `commit ${short(sha)}`,
        )
      );
      return body.tree?.sha;
    } catch {
      return undefined;
    }
  }
};

const main = async () => {
  const sha = process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD');
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  // Refusing is the safe direction: without the API this cannot prove anything.
  if (!repo || !token)
    die('deploy-gate: GITHUB_REPOSITORY and GITHUB_TOKEN are required');

  const parents = git('rev-list', '--parents', '-n', '1', sha)
    .split(/\s+/)
    .slice(1);
  const pulls =
    parents.length === 1 ? await pullsFor(repo, sha, token) : undefined;
  // The head whose tree and checks are read, by the same rule decideDeploy
  // judges with: a refusal reads nothing more, and decideDeploy says why.
  const head = testedHeadOf({ sha, parents, pulls });
  const tested = 'tested' in head ? head.tested : undefined;
  /** @type {Record<string, string | undefined>} */
  const treeOf = {};
  for (const ref of [sha, ...(tested === undefined ? [] : [tested])])
    treeOf[ref] = await treeFor(repo, ref, token);
  /** @type {CheckRun[]} */
  let checks = [];
  try {
    if (tested !== undefined) checks = await checkRunsFor(repo, tested, token);
  } catch (error) {
    die(`deploy-gate: REFUSE — ${messageOf(error)}`);
  }

  const { deploy, reason } = decideDeploy({
    sha,
    parents,
    pulls,
    treeOf,
    checks,
  });
  console.log(`deploy-gate: ${deploy ? 'PROCEED' : 'REFUSE'} — ${reason}`);
  if (!deploy) process.exit(1);
};

// Only when run, never when imported: `tests/unit/deploy-gate.test.ts` imports
// `decideDeploy`. Matching the entry file's name would run `main()` for any
// entry file whose name ended the same way (#221,
// `tests/guards/script-entry.test.ts`).
if (import.meta.main) await main();
