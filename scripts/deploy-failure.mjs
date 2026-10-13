#!/usr/bin/env node
/**
 * Tell the operator a develop deploy failed (#725). Run by the
 * `report-failure` job of `.github/workflows/deploy-dev.yml` after every other
 * job, whatever they did, handed their results in `NEEDS`
 * (`${{ toJSON(needs) }}`). It sends nothing unless one of them failed on
 * `develop`: a dispatched branch's failure is its dispatcher's to read.
 *
 *   node scripts/deploy-failure.mjs
 *
 * Opens one issue assigned to `NOTICE_ASSIGNEE`, naming the run, the commit,
 * the failed job and step, and the failed job's last error line; or, while
 * such a notice is still open, comments the same on it.
 *
 * The notice is the one thing that must not fail. A jobs list or a log this
 * cannot read is named in the notice instead of stopping it, and an issue
 * list it cannot read means a new issue: a second notice beats none. Only a
 * notice GitHub refuses, or one opened without its assignee, exits 1.
 *
 * Reads `NEEDS`, `GITHUB_REF_NAME`, `GITHUB_API_URL`, `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`,
 * `GITHUB_RUN_ID` and `GITHUB_SHA` (all set by Actions) and `GITHUB_TOKEN`,
 * which needs `actions: read` and `issues: write`. `DEPLOY_FAILURE_TIMEOUT_MS`
 * shortens the request timeout, so the tests can point it at a local
 * stand-in that never answers. Imports nothing from `node_modules`. Exits 2
 * on an argument, 1 on any failure.
 */
import { die, messageOf } from './errors.mjs';
import { endpoint, setting } from './settings.mjs';
import {
  NOTICE_ASSIGNEE,
  NOTICE_AUTHOR,
  NOTICE_TITLE,
  failedNeeds,
  failureOf,
  lastErrorLine,
  noticeBody,
  openNoticeOf,
} from '../src/lib/deploy-failure.ts';

/** Each GitHub request gives up after this long. */
const REQUEST_TIMEOUT_MS = 30_000;

const timeoutMs = () =>
  process.env.DEPLOY_FAILURE_TIMEOUT_MS === undefined
    ? REQUEST_TIMEOUT_MS
    : Number(setting('DEPLOY_FAILURE_TIMEOUT_MS', /^[1-9]\d*$/));

/** A client for this repository's part of the GitHub API. */
const github = () => {
  const api = endpoint('GITHUB_API_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const token = setting('GITHUB_TOKEN', /^\S+$/);
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'shyden-deploy-failure',
  };
  /**
   * The answer's text, once GitHub answered 2xx. Redirects are followed, as
   * a job log answers with one to its storage.
   *
   * @param {string} path
   * @param {unknown} [body]
   * @returns {Promise<string>}
   */
  const text = async (path, body) => {
    const response = await fetch(`${api}/repos/${repository}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? headers
          : { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs()),
    });
    const answer = await response.text();
    if (!response.ok)
      throw new Error(`GitHub answered HTTP ${response.status}`);
    return answer;
  };
  /**
   * @param {string} path
   * @param {unknown} [body]
   * @returns {Promise<unknown>}
   */
  const json = async (path, body) => {
    const answer = await text(path, body);
    try {
      return JSON.parse(answer);
    } catch {
      throw new Error('GitHub answered with what is not JSON');
    }
  };
  return { text, json };
};

const report = async () => {
  /** @type {string[]} */
  const unread = [];
  const ref = setting('GITHUB_REF_NAME', /^\S+$/);
  try {
    const failed = failedNeeds(JSON.parse(process.env.NEEDS ?? ''));
    if (failed.length === 0) {
      console.log('Nothing failed: no notice.');
      return;
    }
    console.log(`Failed: ${failed.join(', ')}.`);
  } catch (error) {
    // Unreadable is never "nothing failed": the notice goes, saying so.
    unread.push(`the run's needs (${messageOf(error)})`);
  }
  if (ref !== 'develop') {
    console.log(`A failure on ${ref}, not develop: no notice.`);
    return;
  }

  const server = endpoint('GITHUB_SERVER_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const run = setting('GITHUB_RUN_ID', /^\d+$/);
  const sha = setting('GITHUB_SHA', /^[0-9a-f]{40}$/);
  const { text, json } = github();

  /** @type {import('../src/lib/deploy-failure.ts').Failure | undefined} */
  let failure;
  try {
    failure = failureOf(
      await json(`/actions/runs/${run}/jobs?filter=latest&per_page=100`),
    );
  } catch (error) {
    unread.push(`the run's jobs (${messageOf(error)})`);
  }
  /** @type {string | undefined} */
  let errorLine;
  if (failure !== undefined) {
    try {
      errorLine = lastErrorLine(
        await text(`/actions/jobs/${failure.jobId}/logs`),
      );
    } catch (error) {
      unread.push(`the failed job's log (${messageOf(error)})`);
    }
  }
  const body = noticeBody({
    runUrl: `${server}/${repository}/actions/runs/${run}`,
    sha,
    failure,
    errorLine,
    unread,
  });

  /** @type {number | undefined} */
  let open;
  try {
    open = openNoticeOf(
      await json(
        `/issues?state=open&creator=${encodeURIComponent(NOTICE_AUTHOR)}&per_page=100`,
      ),
    );
  } catch (error) {
    console.log(
      `The open issues could not be read (${messageOf(error)}); opening a new notice.`,
    );
  }

  if (open !== undefined) {
    await json(`/issues/${open}/comments`, { body });
    console.log(`Commented on the open notice, #${open}.`);
    return;
  }
  const opened = await json('/issues', {
    title: NOTICE_TITLE,
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
  const assigned =
    Array.isArray(assignees) &&
    assignees.some(
      (each) =>
        typeof each === 'object' &&
        each !== null &&
        'login' in each &&
        each.login === NOTICE_ASSIGNEE,
    );
  // GitHub drops an assignee it will not accept and still answers 201, so
  // an unassigned notice is read back here: it would reach no one.
  if (!assigned)
    die(`Opened #${number}, but it is not assigned to ${NOTICE_ASSIGNEE}`);
  console.log(`Opened #${number}, assigned to ${NOTICE_ASSIGNEE}.`);
};

if (import.meta.main) {
  if (process.argv.length > 2) {
    console.error('usage: node scripts/deploy-failure.mjs');
    process.exit(2);
  }
  await report().catch((error) => die(messageOf(error)));
}
