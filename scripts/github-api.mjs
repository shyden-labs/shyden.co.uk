/**
 * GitHub's REST API, called directly (#1295).
 *
 * SonarCloud's S4036 refuses a program found on PATH, and `gh` cannot be
 * named by its absolute path: on the operator's Mac the `gh` on PATH is the
 * router that makes an agent act as the project's GitHub App, and Homebrew's
 * own `gh` would act as the operator. So a script asks GitHub itself, with the
 * token it is handed: CI's `GITHUB_TOKEN`, or on the Mac the App's token in
 * `GH_TOKEN`. `fetch` is a parameter so a unit test can stand it in.
 */

const API_VERSION = '2022-11-28';

/**
 * @typedef {{
 *   env?: NodeJS.ProcessEnv,
 *   fetch?: typeof globalThis.fetch,
 * }} GitHubOptions
 */

/**
 * The next page's URL from a `Link` header, or null on the last page.
 *
 * @param {string | null} link
 * @returns {string | null}
 */
const nextPage = (link) => {
  if (!link) return null;
  for (const part of link.split(',')) {
    const [target, ...params] = part.split(';').map((piece) => piece.trim());
    if (
      params.includes('rel="next"') &&
      target.startsWith('<') &&
      target.endsWith('>')
    )
      return target.slice(1, -1);
  }
  return null;
};

/**
 * GETs `path` from GitHub's API and returns its JSON. A list is read to its
 * last page, so a repository with more than one page of anything is never
 * reported short.
 *
 * @param {string} path the API path, starting with `/`
 * @param {GitHubOptions} [options]
 * @returns {Promise<any>}
 */
export async function githubGet(path, options = {}) {
  const env = options.env ?? process.env;
  const fetchPage = options.fetch ?? globalThis.fetch;
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token)
    throw new Error(
      `GitHub's API needs a token: set GITHUB_TOKEN or GH_TOKEN (asked for ${path})`,
    );
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
  };

  /** @type {string | null} */
  let url = `${api}${path}?per_page=100`;
  /** @type {any[]} */
  const items = [];
  while (url) {
    const response = await fetchPage(url, { headers });
    if (!response.ok)
      throw new Error(
        `GitHub answered ${response.status} for ${path}: ${await response.text()}`,
      );
    const body = await response.json();
    if (!Array.isArray(body)) return body;
    items.push(...body);
    url = nextPage(response.headers.get('link'));
  }
  return items;
}

const GITHUB_REMOTE =
  /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/;

/**
 * The `owner/name` a script is about: the run's `GITHUB_REPOSITORY` in CI,
 * otherwise the checkout's origin remote, as `gh` resolved `{owner}/{repo}`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {() => string} readOrigin returns the origin remote's URL
 * @returns {string}
 */
export function repositoryOf(env, readOrigin) {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  const url = readOrigin().trim();
  const match = GITHUB_REMOTE.exec(url);
  if (!match)
    throw new Error(`the origin remote ${url} is not a GitHub repository`);
  return match[1];
}
