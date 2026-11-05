/**
 * One JSON request for the daily jobs that hold a production read token
 * (#349, #796): `scripts/waiting-reports.mjs` and `scripts/access-expiry.mjs`.
 * Imports nothing from `node_modules`, so neither job runs third-party code.
 */
import { errorsIn } from '../src/lib/cloudflare-envelope.ts';
import { messageOf } from './errors.mjs';

/**
 * The parsed JSON a request answers with. Any failure to get a 2xx JSON
 * answer throws, naming the side, the status, and each entry of any `errors`
 * list the answer holds, and nothing else from the body.
 *
 * @param {string} what
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
export const answerOf = async (what, url, init, timeoutMs) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  /** @type {unknown} */
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    throw new Error(`${what} answered HTTP ${response.status}, not JSON`);
  }
  if (!response.ok)
    throw new Error(
      `${what} answered HTTP ${response.status}${errorsIn(answer)}`,
    );
  return answer;
};

/**
 * GitHub's REST API for one token: `get` and `post` each answer with the
 * parsed JSON, through `answerOf`, so both daily jobs send the same headers;
 * `status` answers with the HTTP status alone, whatever it is (#882), and
 * throws only when no answer comes.
 *
 * @param {string} token
 * @param {string} userAgent
 * @param {() => number} timeoutMs
 */
export const githubJson = (token, userAgent, timeoutMs) => {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': userAgent,
  };
  return {
    /** @param {string} url */
    get: (url) => answerOf('GitHub', url, { headers }, timeoutMs()),
    /** @param {string} url */
    status: async (url) => {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs()),
      });
      await response.body?.cancel();
      return response.status;
    },
    /**
     * @param {string} url
     * @param {unknown} body
     */
    post: (url, body) =>
      answerOf(
        'GitHub',
        url,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        timeoutMs(),
      ),
  };
};

/**
 * The HTTP status GitHub answers for `file` on `main` (#882), or `undefined`
 * when the question itself fails: a scheduled run's failure is reported
 * either way, naming the missing file only on a 404.
 *
 * @param {ReturnType<typeof githubJson>} github
 * @param {string} root the repository's API root, `<api>/repos/<owner>/<name>`
 * @param {string} file
 * @returns {Promise<number | undefined>}
 */
export const statusOnMain = async (github, root, file) => {
  try {
    const status = await github.status(`${root}/contents/${file}?ref=main`);
    console.log(`GitHub answered HTTP ${status} for the workflow on main.`);
    return status;
  } catch (error) {
    console.log(
      `Could not ask GitHub for the workflow on main: ${messageOf(error)}`,
    );
    return undefined;
  }
};
