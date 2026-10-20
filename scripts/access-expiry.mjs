#!/usr/bin/env node
/**
 * Warn before a Cloudflare Access service token lapses (#796). Run daily on
 * `main` by `.github/workflows/access-expiry.yml`.
 *
 *   node scripts/access-expiry.mjs                  read every token, warn
 *   node scripts/access-expiry.mjs report-failure   say the check could not run
 *
 * Cloudflare comes first: GitHub is not touched until every token's expiry
 * has been read and one falls within `WARN_DAYS`. Each token due gets one
 * issue per expiry date, assigned to the operator. `report-failure` never
 * reads a Cloudflare variable; it comments the run on the open failure issue,
 * or opens one.
 *
 * Reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY` and `GITHUB_API_URL` in both
 * modes; `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_ACCESS_READ_TOKEN` in check
 * mode only; `GITHUB_SERVER_URL` and `GITHUB_RUN_ID` in `report-failure`
 * only; and `CLOUDFLARE_API_BASE` (default Cloudflare's v4 API) and
 * `ACCESS_EXPIRY_TIMEOUT_MS`, so the tests can point it at local stand-ins.
 * It prints and posts token names and expiry times only, never an id or a
 * client id: the repository's issues and Actions logs are public.
 *
 * Imports nothing from `node_modules`: the job holding the token runs no
 * third-party package code. Exits 2 on a wrong argument, 1 on any failure.
 */
import { die, messageOf } from './errors.mjs';
import { endpoint, setting, timeoutSetting } from './settings.mjs';
import { answerOf, githubJson, statusOnMain } from './json-answer.mjs';
import {
  ASSIGNEE,
  FAILURE_TITLE,
  REQUEST_TIMEOUT_MS,
  SHARED_NOTICE_WORKFLOW,
  WARN_DAYS,
  WORKFLOW_FILE,
  assigned,
  bodyFor,
  dueSoon,
  failureBodyFor,
  missingTitles,
  openFailureIssue,
  titleFor,
  tokensFrom,
} from '../src/lib/access-expiry.ts';

/** GitHub's largest page of issues. */
const PAGE = 100;
/** Pages read before giving up: ten thousand issues. */
const MOST_PAGES = 100;

const timeoutMs = () =>
  timeoutSetting('ACCESS_EXPIRY_TIMEOUT_MS', REQUEST_TIMEOUT_MS);

/** The repository's issues: every one read, and new ones opened. */
const repositoryIssues = () => {
  const api = endpoint('GITHUB_API_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const github = githubJson(
    setting('GITHUB_TOKEN', /^\S+$/),
    'shyden-access-expiry',
    timeoutMs,
  );
  const root = `${api}/repos/${repository}`;
  const issues = `${root}/issues`;
  return {
    root,
    github,
    /** Every issue, open and closed, from every page. */
    async all() {
      /** @type {unknown[]} */
      const every = [];
      for (let page = 1; page <= MOST_PAGES; page += 1) {
        const batch = await github.get(
          `${issues}?state=all&per_page=${PAGE}&page=${page}`,
        );
        if (!Array.isArray(batch))
          throw new Error(`GitHub's page ${page} of issues is not a list`);
        every.push(...batch);
        if (batch.length < PAGE) return every;
      }
      throw new Error(
        `the repository holds more than ${PAGE * MOST_PAGES} issues`,
      );
    },
    /**
     * @param {string} title
     * @param {string} body
     */
    async open(title, body) {
      const issue = await github.post(issues, {
        title,
        body,
        assignees: [ASSIGNEE],
      });
      if (!assigned(issue))
        throw new Error(
          `issue "${title}" was opened without ${ASSIGNEE} assigned`,
        );
    },
    /**
     * @param {number} number
     * @param {string} body
     */
    comment: (number, body) =>
      github.post(`${issues}/${number}/comments`, { body }),
  };
};

/** Every service token's name and expiry, read from Cloudflare. */
const readTokens = async () => {
  const base = endpoint(
    'CLOUDFLARE_API_BASE',
    'https://api.cloudflare.com/client/v4',
  );
  const account = setting('CLOUDFLARE_ACCOUNT_ID', /^[0-9a-f]{32}$/);
  const token = setting('CLOUDFLARE_ACCESS_READ_TOKEN', /^\S+$/);
  return tokensFrom(
    await answerOf(
      'Cloudflare',
      `${base}/accounts/${account}/access/service_tokens?per_page=1000`,
      { headers: { authorization: `Bearer ${token}` } },
      timeoutMs(),
    ),
  );
};

const check = async () => {
  const repository = repositoryIssues();
  const tokens = await readTokens();
  for (const { name, expiresAt } of tokens)
    console.log(`${name} expires ${expiresAt.toISOString()}`);
  const now = new Date();
  const due = dueSoon(tokens, now);
  if (due.length === 0) {
    console.log(
      `${tokens.length} watched; none expires within ${WARN_DAYS} days.`,
    );
    return;
  }
  const missing = new Set(
    missingTitles(due.map(titleFor), await repository.all()),
  );
  for (const token of due) {
    const title = titleFor(token);
    if (!missing.delete(title)) continue;
    await repository.open(title, bodyFor(token, now));
    console.log(`Opened: ${title}`);
  }
};

const reportFailure = async () => {
  const server = endpoint('GITHUB_SERVER_URL');
  const repo = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const run = setting('GITHUB_RUN_ID', /^\d+$/);
  const repository = repositoryIssues();
  const { github, root } = repository;
  const status = await statusOnMain(github, root, WORKFLOW_FILE);
  const shared =
    status === 404
      ? await statusOnMain(github, root, SHARED_NOTICE_WORKFLOW)
      : undefined;
  const body = failureBodyFor(
    status,
    shared,
    `${server}/${repo}/actions/runs/${run}`,
  );
  if (body === null) {
    console.log(
      `main lacks ${SHARED_NOTICE_WORKFLOW} too, whose daily notice says so; nothing posted.`,
    );
    return;
  }
  const open = openFailureIssue(await repository.all());
  if (open === undefined) await repository.open(FAILURE_TITLE, body);
  else await repository.comment(open, body);
  console.log('Reported the failure.');
};

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || (mode !== undefined && mode !== 'report-failure')) {
    console.error('usage: node scripts/access-expiry.mjs [report-failure]');
    process.exit(2);
  }
  await (mode === 'report-failure' ? reportFailure() : check()).catch((error) =>
    die(messageOf(error)),
  );
}
