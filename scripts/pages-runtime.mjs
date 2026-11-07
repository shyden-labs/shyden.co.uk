#!/usr/bin/env node
/**
 * Before a deploy: set the Pages project's production Workers runtime to the
 * compatibility date the functions suite tests, and read it back (#907;
 * Shyden's ruling 2026-11-07). The date's one home in git is
 * `tests/functions/wrangler.toml`. Fails, naming both runtimes, if the
 * project does not run that date afterwards, and naming the setting if the
 * update changed anything besides the runtime.
 *
 * usage: node scripts/pages-runtime.mjs <pages-project-name>
 * env:   CLOUDFLARE_API_TOKEN (Pages Write), CLOUDFLARE_ACCOUNT_ID
 *
 * The decisions live in `src/lib/pages-runtime.ts`, unit-tested; this file
 * only reads the date and makes the two calls.
 */
import { readFileSync } from 'node:fs';
import { die, messageOf } from './errors.mjs';
import { setting } from './settings.mjs';
import { compatibilityDateOf, syncRuntime } from '../src/lib/pages-runtime.ts';

/** The date's one home in git, which `tests/functions/serve.mjs` reads too. */
export const DATE_HOME = new URL(
  '../tests/functions/wrangler.toml',
  import.meta.url,
);

/** How long one Cloudflare call may take. */
const REQUEST_TIMEOUT_MS = 30_000;

/** The compatibility date the functions suite runs on. */
export const testedCompatibilityDate = () =>
  compatibilityDateOf(readFileSync(DATE_HOME, 'utf8'));

/**
 * @param {string} project
 */
const run = async (project) => {
  const token = setting('CLOUDFLARE_API_TOKEN', /^\S{20,}$/);
  const account = setting('CLOUDFLARE_ACCOUNT_ID', /^[0-9a-f]{32}$/);
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}`;

  /**
   * Cloudflare answers JSON on success and on refusal alike, with `success`
   * and `errors`, so a 4xx is handed on to be named rather than thrown here.
   *
   * @param {'GET' | 'PATCH'} method
   * @param {unknown} [body]
   * @returns {Promise<unknown>}
   */
  const call = async (method, body) => {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Cloudflare answered HTTP ${response.status} with what is not JSON`,
      );
    }
  };

  const said = await syncRuntime(testedCompatibilityDate(), {
    get: () => call('GET'),
    patch: (/** @type {unknown} */ body) => call('PATCH', body),
  });
  console.log(`${project}: ${said}.`);
};

if (import.meta.main) {
  const [project, ...rest] = process.argv.slice(2);
  if (
    project === undefined ||
    rest.length > 0 ||
    !/^[a-z0-9-]+$/.test(project)
  ) {
    console.error('usage: node scripts/pages-runtime.mjs <pages-project-name>');
    process.exit(2);
  }
  await run(project).catch((error) => die(`${project}: ${messageOf(error)}`));
}
