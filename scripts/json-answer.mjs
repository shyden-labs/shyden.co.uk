/**
 * One JSON request for the daily jobs that hold a production read token
 * (#349, #796): `scripts/waiting-reports.mjs` and `scripts/access-expiry.mjs`.
 * Imports nothing from `node_modules`, so neither job runs third-party code.
 */
import { errorsIn } from '../src/lib/cloudflare-envelope.ts';

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
