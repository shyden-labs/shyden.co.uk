/**
 * The `operator-review` lock (#459, decision 4): holds a pull request that
 * carries an automatic rebaseline until the operator has approved it at its
 * current head. Design: docs/superpowers/specs/2026-10-03-visual-rebaseline-design.md,
 * Unit 4.
 *
 * `reviewVerdict` decides and is pure. `main` reads GitHub and writes step
 * outputs; operator-review.yml posts every status itself with `gh api`, where
 * the context it reports can be read from the workflow.
 */
import { appendFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import { messageOf } from './errors.mjs';

/** The one login whose approval counts. */
export const OPERATOR = 'ShydenMcM';

/** The identity a commit made with a job's GITHUB_TOKEN takes. */
const REBASELINER = 'github-actions[bot]';

const SCREENSHOTS = 'tests/e2e/__screenshots__/';

/** A COMMENTED review decides nothing, as in GitHub's own rule. */
const DECISIVE = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/**
 * @typedef {{ sha: string, author: string | null, paths: readonly string[], truncated: boolean }} Commit
 * @typedef {{ user: string | null, state: string, commitId: string }} Review
 * @typedef {{ state: 'success' | 'failure', description: string }} Verdict
 */

/**
 * The status for one head. Locked when any commit by the rebaseliner, or by
 * an author GitHub links to no account, changed a screenshot; then only the
 * operator's latest decisive review, an approval at this head, releases it.
 * @param {{ total: number, commits: readonly Commit[], reviews: readonly Review[], head: string }} facts
 * @returns {Verdict}
 */
export function reviewVerdict({ total, commits, reviews, head }) {
  if (commits.length < total)
    throw new Error(
      `read ${commits.length} of the pull request's ${total} commits; the list stops at 250`,
    );
  const truncated = commits.find((commit) => commit.truncated);
  if (truncated)
    throw new Error(`commit ${truncated.sha}'s file list is truncated`);
  const locked = commits.some(
    ({ author, paths }) =>
      (author === REBASELINER || author === null) &&
      paths.some((path) => path.startsWith(SCREENSHOTS)),
  );
  if (!locked)
    return {
      state: 'success',
      description: 'No automatic rebaseline in this pull request',
    };
  const decision = reviews
    .filter(({ user, state }) => user === OPERATOR && DECISIVE.has(state))
    .at(-1);
  const at = head.slice(0, 7);
  return decision?.state === 'APPROVED' && decision.commitId === head
    ? {
        state: 'success',
        description: `The operator approved the rebaseline at ${at}`,
      }
    : {
        state: 'failure',
        description: `Waiting for the operator to approve the rebaseline at ${at}`,
      };
}

// ---- I/O: everything below reads GitHub or writes step outputs -------------

const LIMIT_MS = 30_000;
const PAGE = 100;

/**
 * The variables a command needs, every missing one named in one refusal.
 * @param {readonly string[]} names
 * @returns {Record<string, string>}
 */
function settings(names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`${missing.join(', ')} not set`);
  return Object.fromEntries(names.map((name) => [name, String(env[name])]));
}

/**
 * One GET from this repository's API: a time limit, no retry, and any status
 * but 200 fails by name.
 * @param {string} path below /repos/{owner}/{repo}
 * @returns {Promise<{ body: any, link: string }>}
 */
async function read(path) {
  const { GITHUB_REPOSITORY, GITHUB_TOKEN } = settings([
    'GITHUB_REPOSITORY',
    'GITHUB_TOKEN',
  ]);
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${GITHUB_TOKEN}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(LIMIT_MS),
    },
  );
  const text = await response.text();
  if (response.status !== 200)
    throw new Error(
      `GET ${path} answered ${response.status}: ${text.slice(0, 200)}`,
    );
  return { body: JSON.parse(text), link: response.headers.get('link') ?? '' };
}

/**
 * Every page of a list endpoint, until one comes back short. Each page is new
 * data, never a second attempt at the same request.
 * @param {string} path
 * @returns {Promise<any[]>}
 */
async function everyPage(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const { body } = await read(`${path}?per_page=${PAGE}&page=${page}`);
    items.push(...body);
    if (body.length < PAGE) return items;
  }
}

/**
 * @param {string} name
 * @param {string} value
 */
function output(name, value) {
  appendFileSync(
    settings(['GITHUB_OUTPUT']).GITHUB_OUTPUT,
    `${name}=${value}\n`,
  );
}

async function runHead() {
  const { PR_NUMBER } = settings(['PR_NUMBER']);
  const { body: pr } = await read(`/pulls/${PR_NUMBER}`);
  console.log(`#${PR_NUMBER}'s head is ${pr.head.sha}.`);
  output('sha', pr.head.sha);
}

async function runVerdict() {
  const { PR_NUMBER, HEAD_SHA } = settings(['PR_NUMBER', 'HEAD_SHA']);
  const { body: pr } = await read(`/pulls/${PR_NUMBER}`);
  const commits = [];
  for (const { sha, author } of await everyPage(
    `/pulls/${PR_NUMBER}/commits`,
  )) {
    // GET /commits/{sha} pages its file list at 300; a next page means this
    // one is not the whole list. A rename counts its old path too.
    const { body, link } = await read(`/commits/${sha}`);
    commits.push({
      sha,
      author: author?.login ?? null,
      paths: body.files.flatMap(
        /** @param {{ filename: string, previous_filename?: string }} file */
        (file) =>
          file.previous_filename
            ? [file.filename, file.previous_filename]
            : [file.filename],
      ),
      truncated: /rel="next"/.test(link),
    });
  }
  const reviews = (await everyPage(`/pulls/${PR_NUMBER}/reviews`)).map(
    /** @param {{ user: { login: string } | null, state: string, commit_id: string }} r */
    (r) => ({
      user: r.user?.login ?? null,
      state: r.state,
      commitId: r.commit_id,
    }),
  );
  const verdict = reviewVerdict({
    total: pr.commits,
    commits,
    reviews,
    head: HEAD_SHA,
  });
  console.log(
    `operator-review on ${HEAD_SHA}: ${verdict.state}, ${verdict.description}`,
  );
  output('state', verdict.state);
  output('description', verdict.description);
}

/**
 * @param {readonly string[]} [args]
 */
export async function main(args = argv.slice(2)) {
  const [command] = args;
  try {
    if (command === 'head') await runHead();
    else if (command === 'verdict') await runVerdict();
    else
      throw new Error(
        `unknown command ${command ?? '(none)'}; expected head or verdict`,
      );
  } catch (error) {
    // The status stays `pending`, which blocks the merge, and the cause is in
    // the log and the job summary (#224: the API reads back the log).
    const reason = messageOf(error);
    console.log(`::error::${reason}`);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `Refused: ${reason}\n`);
    exit(1);
  }
}

if (import.meta.main) await main();
