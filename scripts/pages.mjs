#!/usr/bin/env node
/**
 * Cloudflare Pages, for the automatic rollback (#748) and `rollback.yml`'s
 * promote.
 *
 *   node scripts/pages.mjs live <project>
 *     prints the project's live (canonical) deployment id: one GET.
 *   node scripts/pages.mjs rollback <project> <deployment-id>
 *     promotes that deployment with one POST and no list read, then reads
 *     the project once to confirm it is live.
 *
 * Reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and
 * `CLOUDFLARE_API_URL` (Cloudflare's v4 API by default), so the tests can
 * point it at a local stand-in; `PAGES_TIMEOUT_MS` shortens the request time
 * limit for them. One request per action, with a time limit and no retry
 * (operator rule, 2026-10-02): a promote that fails is reported, not tried
 * again. It prints no token and no answer body. Imports nothing from
 * `node_modules`. Exits 2 on a usage error, 1 on any failure.
 */
import { die, messageOf } from './errors.mjs';
import { endpoint, setting, timeoutMs } from './settings.mjs';
import {
  DEPLOYMENT_ID,
  confirmLive,
  liveDeploymentOf,
  rollbackAccepted,
} from '../src/lib/pages.ts';

/** Each Cloudflare request gives up after this long. */
const REQUEST_TIMEOUT_MS = 30_000;

/** A Pages project name: lower-case letters, digits and dashes. */
const PROJECT = /^[a-z0-9][a-z0-9-]*$/;

const USAGE =
  'usage: node scripts/pages.mjs live <project> | rollback <project> <deployment-id>';

/**
 * A client for one Pages project. Settings are read here, before any
 * request, so a missing one stops the script naming it.
 *
 * @param {string} project
 */
const pages = (project) => {
  const api = endpoint(
    'CLOUDFLARE_API_URL',
    'https://api.cloudflare.com/client/v4',
  );
  const token = setting('CLOUDFLARE_API_TOKEN', /^\S+$/);
  const account = setting('CLOUDFLARE_ACCOUNT_ID', /^\w+$/);
  const base = `${api}/accounts/${account}/pages/projects/${project}`;
  /**
   * The parsed answer, once Cloudflare answered 2xx.
   *
   * @param {'GET' | 'POST'} method
   * @param {string} path
   * @returns {Promise<unknown>}
   */
  return async (method, path) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(
        timeoutMs('PAGES_TIMEOUT_MS', REQUEST_TIMEOUT_MS),
      ),
    });
    const text = await response.text();
    // The status alone: an error body could echo what was sent.
    if (!response.ok)
      throw new Error(`Cloudflare answered HTTP ${response.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Cloudflare answered with what is not JSON');
    }
  };
};

/** @param {string[]} args */
const main = async (args) => {
  const [command, project, id, ...rest] = args;
  const shaped = project !== undefined && PROJECT.test(project);
  const usage =
    rest.length > 0 ||
    !shaped ||
    !(
      (command === 'live' && id === undefined) ||
      (command === 'rollback' && id !== undefined)
    );
  if (usage) {
    console.error(USAGE);
    process.exit(2);
  }
  if (command === 'rollback' && !DEPLOYMENT_ID.test(id))
    die(`${id} is not a Pages deployment id`);
  const call = pages(project);
  if (command === 'live') {
    console.log(liveDeploymentOf(await call('GET', '')));
    return;
  }
  rollbackAccepted(await call('POST', `/deployments/${id}/rollback`));
  confirmLive(await call('GET', ''), id);
  console.log(`Rolled ${project} back: the live deployment is ${id}.`);
};

if (import.meta.main)
  await main(process.argv.slice(2)).catch((error) => die(messageOf(error)));
