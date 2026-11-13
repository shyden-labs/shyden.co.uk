#!/usr/bin/env node
/**
 * Post a `success` commit status for a verify job (#444), without the `gh` CLI
 * the pinned Playwright image does not carry.
 *
 *   node scripts/commit-status.mjs <context> <description>
 *
 * One POST to the run's commit, with the run's URL as the status's target.
 * Any answer that is not 2xx fails the job, naming the status. Reads
 * `GITHUB_API_URL`, `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_SHA`,
 * `GITHUB_RUN_ID` (all set by Actions) and `GITHUB_TOKEN`, which needs
 * `statuses: write`. Imports nothing from `node_modules`. Exits 2 on an
 * argument, 1 on any failure.
 */
import { argv } from 'node:process';
import { die, messageOf } from './errors.mjs';
import { githubJson } from './json-answer.mjs';
import { endpoint, setting } from './settings.mjs';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * @param {{ api: string, repository: string, sha: string, token: string,
 *   context: string, description: string, targetUrl: string,
 *   timeoutMs: number }} status
 */
export const postStatus = async ({
  api,
  repository,
  sha,
  token,
  context,
  description,
  targetUrl,
  timeoutMs,
}) => {
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error('the commit is not a full SHA');
  await githubJson(token, 'shyden.co.uk commit-status', () => timeoutMs).post(
    `${api}/repos/${repository}/statuses/${sha}`,
    { state: 'success', context, description, target_url: targetUrl },
  );
};

const main = async () => {
  const [context, description, ...rest] = argv.slice(2);
  if (context === undefined || description === undefined || rest.length > 0) {
    console.error(
      'usage: node scripts/commit-status.mjs <context> <description>',
    );
    process.exit(2);
  }
  const server = endpoint('GITHUB_SERVER_URL');
  const repository = setting('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
  const run = setting('GITHUB_RUN_ID', /^\d+$/);
  const sha = setting('GITHUB_SHA', /^[0-9a-f]{40}$/);
  try {
    await postStatus({
      api: endpoint('GITHUB_API_URL'),
      repository,
      sha,
      token: setting('GITHUB_TOKEN', /^\S+$/),
      context,
      description,
      targetUrl: `${server}/${repository}/actions/runs/${run}`,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    die(`${context}: ${messageOf(error)}`);
  }
  console.log(`Posted ${context}=success on ${sha}`);
};

if (import.meta.main) await main();
