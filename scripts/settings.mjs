/**
 * Reading a script's settings from its environment, refused unless each is
 * in its expected shape, since each ends up in a URL, a header, a body or a
 * timeout.
 *
 * One home for the scripts a workflow runs with a token
 * (`waiting-reports.mjs`, `deploy-failure.mjs`, `pages.mjs`), so they cannot
 * drift.
 */
import { die } from './errors.mjs';

/**
 * An environment variable, refused unless it matches `shape`.
 *
 * @param {string} name
 * @param {RegExp} shape
 * @returns {string}
 */
export const setting = (name, shape) => {
  const value = process.env[name] ?? '';
  if (!shape.test(value))
    die(`${name} is not set, or not in its expected shape`);
  return value;
};

/**
 * An environment variable holding an http(s) URL, without a trailing slash.
 *
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
export const endpoint = (name, fallback) => {
  const value = process.env[name] ?? fallback ?? '';
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url?.protocol !== 'https:' && url?.protocol !== 'http:')
    die(`${name} is not set, or not an http(s) URL`);
  return value.replace(/\/+$/, '');
};

/**
 * A request time limit in milliseconds: `name` when it is set, as a whole
 * number above zero, else `fallback`.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export const timeoutMs = (name, fallback) =>
  process.env[name] === undefined
    ? fallback
    : Number(setting(name, /^[1-9]\d*$/));
