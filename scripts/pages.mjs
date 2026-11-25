#!/usr/bin/env node
/**
 * Read the deployment a Cloudflare Pages project serves, or fall back to an
 * earlier one (#748).
 *
 *   node scripts/pages.mjs live <project>          # prints the live deployment id
 *   node scripts/pages.mjs restore <project> <id>  # serves <id> again, then confirms it
 *
 * `live` is one GET of the project. `restore` is one POST to the deployment's
 * rollback, then one GET confirming the project serves it: never a list read,
 * and no retry (a failure names its cause and exits 1).
 *
 * The deploy jobs run `live` before they deploy, so a release that fails its
 * live check knows what to fall back to; if it cannot be read, nothing is
 * deployed. The `fall-back` jobs run `restore`.
 *
 * Reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and
 * `CLOUDFLARE_API_BASE` (default Cloudflare's v4 API) and `PAGES_TIMEOUT_MS`
 * so the tests can point it at a stand-in. Imports nothing from
 * `node_modules`. Exits 2 on an argument, 1 on any failure.
 */
import { argv } from 'node:process';
import { die, messageOf } from './errors.mjs';
import { answerOf } from './json-answer.mjs';
import { endpoint, setting, timeoutSetting } from './settings.mjs';
import {
  DEPLOYMENT_ID,
  PROJECT_NAME,
  confirmServes,
  liveDeploymentOf,
} from '../src/lib/pages.ts';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

/**
 * The two Pages operations, for one account and token.
 *
 * @param {{ base: string, account: string, token: string, timeoutMs: number }} options
 */
export const pagesApi = ({ base, account, token, timeoutMs }) => {
  const headers = { authorization: `Bearer ${token}` };
  /** @param {string} project */
  const projectUrl = (project) => {
    if (!PROJECT_NAME.test(project))
      throw new Error(
        'the project name is not a Cloudflare Pages project name',
      );
    return `${base}/accounts/${account}/pages/projects/${project}`;
  };
  /** @param {string} project */
  const live = async (project) =>
    liveDeploymentOf(
      await answerOf('Cloudflare', projectUrl(project), { headers }, timeoutMs),
    );
  /**
   * @param {string} project
   * @param {string} id
   */
  const restore = async (project, id) => {
    if (!DEPLOYMENT_ID.test(id))
      throw new Error(
        'the deployment to restore is not a Cloudflare Pages deployment id',
      );
    const url = projectUrl(project);
    await answerOf(
      'Cloudflare',
      `${url}/deployments/${id}/rollback`,
      { method: 'POST', headers },
      timeoutMs,
    );
    confirmServes(
      await answerOf('Cloudflare', url, { headers }, timeoutMs),
      id,
    );
  };
  return { live, restore };
};

const main = async () => {
  const [command, project, id, ...rest] = argv.slice(2);
  const usage =
    'usage: node scripts/pages.mjs live <project> | restore <project> <id>';
  if (
    rest.length > 0 ||
    project === undefined ||
    (command === 'live' && id !== undefined) ||
    (command === 'restore' && id === undefined) ||
    (command !== 'live' && command !== 'restore')
  ) {
    console.error(usage);
    process.exit(2);
  }
  const api = pagesApi({
    base: endpoint('CLOUDFLARE_API_BASE', CLOUDFLARE_API),
    account: setting('CLOUDFLARE_ACCOUNT_ID', /^[0-9a-f]{32}$/),
    token: setting('CLOUDFLARE_API_TOKEN', /^\S+$/),
    timeoutMs: timeoutSetting('PAGES_TIMEOUT_MS', 30_000),
  });
  try {
    if (command === 'live') {
      console.log(await api.live(project));
    } else {
      await api.restore(project, /** @type {string} */ (id));
      console.log(`${project} serves ${id} again.`);
    }
  } catch (error) {
    die(`${project}: ${messageOf(error)}`);
  }
};

if (import.meta.main) await main();
