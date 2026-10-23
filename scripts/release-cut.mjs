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
 *   node scripts/release-cut.mjs   (ci.yml's release-cut job; reads
 *                                   HEAD_REF and HEAD_SHA, and the pull
 *                                   request's merge checked out as HEAD)
 */
import { execFileSync } from 'node:child_process';
import { messageOf } from './errors.mjs';

/** The branch every release comes from. */
export const CUT_PREFIX = 'release/';

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

  const landed = treeOf(git, 'HEAD');
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

function main() {
  /** @type {Git} */
  const git = (args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let findings;
  try {
    findings = releaseCutFindings({
      headRef: process.env.HEAD_REF,
      headSha: process.env.HEAD_SHA,
      git,
    });
  } catch (error) {
    console.error(`::error::release-cut: ${messageOf(error)}`);
    process.exit(1);
  }
  for (const finding of findings) console.error(`::error::${finding}`);
  if (findings.length > 0) process.exit(1);
  console.log(
    `release-cut: ${process.env.HEAD_REF} at ${process.env.HEAD_SHA} is a cut of develop, and its merge lands exactly its tree`,
  );
}

if (import.meta.main) main();
