#!/usr/bin/env node
/**
 * Tell the operator a Dependabot update run failed (#1119; Shyden's ruling
 * 2026-11-10, "Weekly check"). Run once a week by
 * `.github/workflows/dependabot-failures.yml`, after Dependabot's Monday
 * runs. GitHub shows a failed update only on the repository's Dependabot
 * page, which is how the Node pin sat a release behind for two weeks (#1117).
 *
 *   node scripts/dependabot-failures.mjs
 *
 * Reads the update runs of the last week; for each that failed, its failed
 * job's last error line. Opens one issue assigned to `NOTICE_ASSIGNEE`
 * naming them, or comments on the notice still open. A log it cannot read
 * is named in the notice instead of stopping it; runs it cannot read, a
 * notice GitHub refuses, or one opened without its assignee exit 1.
 *
 * Reads `GITHUB_API_URL` and `GITHUB_REPOSITORY` (set by Actions) and
 * `GITHUB_TOKEN`, which needs `actions: read` and `issues: write`. Imports
 * nothing from `node_modules`. Exits 2 on an argument, 1 on any failure.
 */
import { die, messageOf } from './errors.mjs';
import { githubJson } from './json-answer.mjs';
import { endpoint, setting } from './settings.mjs';
import {
  NOTICE_ASSIGNEE,
  NOTICE_AUTHOR,
  openNoticeOf,
} from '../src/lib/deploy-failure.ts';
import {
  FAILURES_TITLE,
  failedUpdates,
  failuresBody,
  updateErrorLine,
  windowStart,
} from '../src/lib/dependabot-failures.ts';

/** Each GitHub request gives up after this long. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * @typedef {{
 *   json: (path: string, body?: unknown) => Promise<unknown>,
 *   text: (path: string) => Promise<string>,
 * }} GitHub
 */

/**
 * The log's error line of the run's failed job.
 * @param {GitHub} github
 * @param {number} run
 * @returns {Promise<{ errorLine?: string, unread?: string }>}
 */
const errorOf = async (github, run) => {
  try {
    const answer = await github.json(
      `/actions/runs/${run}/jobs?filter=latest&per_page=100`,
    );
    const jobs =
      typeof answer === 'object' && answer !== null && 'jobs' in answer
        ? answer.jobs
        : undefined;
    const failed = Array.isArray(jobs)
      ? jobs.find((job) => job?.conclusion === 'failure')
      : undefined;
    if (typeof failed?.id !== 'number') return { unread: 'no failed job' };
    const errorLine = updateErrorLine(
      await github.text(`/actions/jobs/${failed.id}/logs`),
    );
    return errorLine === undefined ? {} : { errorLine };
  } catch (error) {
    return { unread: messageOf(error) };
  }
};

/**
 * Reads the week's Dependabot runs and writes the notice; answers what it did.
 * @param {GitHub} github
 * @param {Date} now
 * @returns {Promise<string>}
 */
export const report = async (github, now) => {
  const since = windowStart(now);
  const created = encodeURIComponent(`>=${since.toISOString().slice(0, 10)}`);
  const failures = failedUpdates(
    await github.json(
      `/actions/runs?event=dynamic&created=${created}&per_page=100`,
    ),
    since,
  );
  if (failures.length === 0)
    return `No Dependabot update run failed since ${since.toISOString().slice(0, 10)}: no notice.`;

  const reported = [];
  for (const failure of failures)
    reported.push({ ...failure, ...(await errorOf(github, failure.id)) });
  const body = failuresBody(reported, since);

  /** @type {number | undefined} */
  let open;
  try {
    open = openNoticeOf(
      await github.json(
        `/issues?state=open&creator=${encodeURIComponent(NOTICE_AUTHOR)}&per_page=100`,
      ),
      FAILURES_TITLE,
    );
  } catch (error) {
    console.log(
      `The open issues could not be read (${messageOf(error)}); opening a new notice.`,
    );
  }
  if (open !== undefined) {
    await github.json(`/issues/${open}/comments`, { body });
    return `Commented on the open notice, #${open}.`;
  }
  const opened = await github.json('/issues', {
    title: FAILURES_TITLE,
    body,
    assignees: [NOTICE_ASSIGNEE],
  });
  const number =
    typeof opened === 'object' && opened !== null && 'number' in opened
      ? String(opened.number)
      : '?';
  const assignees =
    typeof opened === 'object' && opened !== null && 'assignees' in opened
      ? opened.assignees
      : undefined;
  // GitHub drops an assignee it will not accept and still answers 201, so an
  // unassigned notice is read back here: it would reach no one.
  const assigned =
    Array.isArray(assignees) &&
    assignees.some((each) => each?.login === NOTICE_ASSIGNEE);
  if (!assigned)
    throw new Error(
      `Opened #${number}, but it is not assigned to ${NOTICE_ASSIGNEE}`,
    );
  return `Opened #${number}, assigned to ${NOTICE_ASSIGNEE}.`;
};

/** A client for this repository's part of the GitHub API. @returns {GitHub} */
const github = () => {
  const api = endpoint('GITHUB_API_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const token = setting('GITHUB_TOKEN', /^\S+$/);
  const client = githubJson(
    token,
    'shyden-dependabot-failures',
    () => REQUEST_TIMEOUT_MS,
  );
  /**
   * @param {string} path
   * @param {unknown} [body]
   */
  const text = (path, body) =>
    client.text(`${api}/repos/${repository}${path}`, body);
  return {
    text: (path) => text(path),
    json: async (path, body) => {
      const answer = await text(path, body);
      try {
        return JSON.parse(answer);
      } catch {
        throw new Error('GitHub answered with what is not JSON');
      }
    },
  };
};

if (import.meta.main) {
  if (process.argv.length > 2) {
    console.error('usage: node scripts/dependabot-failures.mjs');
    process.exit(2);
  }
  await report(github(), new Date())
    .then((done) => console.log(done))
    .catch((error) => die(messageOf(error)));
}
