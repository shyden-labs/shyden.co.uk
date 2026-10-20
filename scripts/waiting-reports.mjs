#!/usr/bin/env node
/**
 * Tell the operator how many translation reports wait in production (#349).
 * Run daily by `.github/workflows/waiting-reports.yml`.
 *
 *   node scripts/waiting-reports.mjs                  count, and maybe post
 *   node scripts/waiting-reports.mjs report-failure   post the failure notice
 *
 * The count comes first: GitHub is not touched until D1 has answered with a
 * count above zero, so a failure or a zero sends GitHub nothing. At most one
 * count is posted per UTC day, on issue `NOTICE_ISSUE`. `report-failure` never
 * reads a Cloudflare variable, and posts a sentence that names no count: first
 * asking GitHub for the workflow on `main`, whose absence it names (#882).
 *
 * Reads `NOTICE_ISSUE`, `GITHUB_TOKEN` and `GITHUB_REPOSITORY` in both modes;
 * `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_READ_TOKEN` in count mode only;
 * `GITHUB_SERVER_URL` and `GITHUB_RUN_ID` in `report-failure` only; and the
 * endpoints `CLOUDFLARE_API_BASE` (default Cloudflare's v4 API) and
 * `GITHUB_API_URL` (set by Actions), so the tests can point it at local
 * stand-ins. `WAITING_REPORTS_TIMEOUT_MS` shortens the request timeout for
 * the same reason. It never fetches a report, so nothing it prints can come
 * from one: the repository's Actions logs are public.
 *
 * Imports nothing from `node_modules`: the job holding the token runs no
 * third-party package code. Exits 2 on a wrong argument, 1 on any failure.
 */
import { die, messageOf } from './errors.mjs';
import { endpoint, setting, timeoutSetting } from './settings.mjs';
import { answerOf, githubJson, statusOnMain } from './json-answer.mjs';
import {
  COUNT_SQL,
  REPORTS_DATABASE,
  REQUEST_TIMEOUT_MS,
  WORKFLOW_FILE,
  countFrom,
  databaseIdFrom,
  failureNoticeFor,
  noticeFor,
  postedToday,
  startOfUtcDay,
} from '../src/lib/waiting-reports.ts';

const timeoutMs = () =>
  timeoutSetting('WAITING_REPORTS_TIMEOUT_MS', REQUEST_TIMEOUT_MS);

/** The repository's API root, and a GitHub client for its token. */
const repositoryApi = () => {
  const api = endpoint('GITHUB_API_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  return {
    root: `${api}/repos/${repository}`,
    github: githubJson(
      setting('GITHUB_TOKEN', /^\S+$/),
      'shyden-waiting-reports',
      timeoutMs,
    ),
  };
};

/** The issue the notices go on, and a client for its comments. */
const noticeIssue = () => {
  const { root, github } = repositoryApi();
  const issue = setting('NOTICE_ISSUE', /^[1-9]\d*$/);
  const comments = `${root}/issues/${issue}/comments`;
  return {
    /** @param {Date} now */
    listToday: (now) =>
      github.get(`${comments}?since=${startOfUtcDay(now)}&per_page=100`),
    /** @param {string} body */
    post: (body) => github.post(comments, { body }),
  };
};

/** The production count, read from D1. */
const readCount = async () => {
  const base = endpoint(
    'CLOUDFLARE_API_BASE',
    'https://api.cloudflare.com/client/v4',
  );
  const account = setting('CLOUDFLARE_ACCOUNT_ID', /^[0-9a-f]{32}$/);
  const token = setting('CLOUDFLARE_D1_READ_TOKEN', /^\S+$/);
  const headers = { authorization: `Bearer ${token}` };
  const databases = `${base}/accounts/${account}/d1/database`;
  const id = databaseIdFrom(
    await answerOf(
      'Cloudflare',
      `${databases}?name=${encodeURIComponent(REPORTS_DATABASE)}`,
      { headers },
      timeoutMs(),
    ),
  );
  return countFrom(
    await answerOf(
      'Cloudflare',
      `${databases}/${id}/query`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ sql: COUNT_SQL }),
      },
      timeoutMs(),
    ),
  );
};

const count = async () => {
  const issue = noticeIssue();
  const waiting = await readCount();
  console.log(`Waiting reports: ${waiting}`);
  const notice = noticeFor(waiting);
  if (notice === null) return;
  const now = new Date();
  if (postedToday(await issue.listToday(now), now)) {
    console.log('A count was already posted today; nothing posted.');
    return;
  }
  await issue.post(notice);
  console.log('Posted.');
};

const reportFailure = async () => {
  const server = endpoint('GITHUB_SERVER_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const run = setting('GITHUB_RUN_ID', /^\d+$/);
  const { root, github } = repositoryApi();
  const notice = failureNoticeFor(
    await statusOnMain(github, root, WORKFLOW_FILE),
  );
  await noticeIssue().post(
    `${notice}\n\n${server}/${repository}/actions/runs/${run}`,
  );
  console.log('Posted the failure notice.');
};

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || (mode !== undefined && mode !== 'report-failure')) {
    console.error('usage: node scripts/waiting-reports.mjs [report-failure]');
    process.exit(2);
  }
  await (mode === 'report-failure' ? reportFailure() : count()).catch((error) =>
    die(messageOf(error)),
  );
}
