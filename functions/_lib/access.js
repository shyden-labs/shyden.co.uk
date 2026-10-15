/**
 * Cloudflare Access for production's private paths (#781).
 *
 * Operator decision 2026-10-15: a private path is opened per person by
 * Cloudflare Access, never by a shared password. Access sits in front of the
 * site and adds a signed token (`Cf-Access-Jwt-Assertion`) to every request
 * it lets through; the site checks that token itself, so a path the Access
 * application forgot to cover still refuses. Everything here fails closed: a
 * missing setting, an unreadable token or unreachable keys all answer "no".
 *
 * Pure logic, like `lockdown.js`, so Vitest can test it without workerd.
 */

const PRIVATE_PREFIX = '/api/docs/private';
const KEYS_KEPT_SECONDS = 600;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/**
 * Whether production keeps `pathname` for signed-in people: the private docs
 * page and anything under or beside it. Matched on the decoded, lower-cased
 * path with repeated slashes collapsed, so no spelling of the path slips
 * past; a path that cannot be decoded counts as private.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function privatePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const path = decoded.replace(/\/{2,}/g, '/').toLowerCase();
  return (
    path === PRIVATE_PREFIX ||
    path.startsWith(`${PRIVATE_PREFIX}/`) ||
    path.startsWith(`${PRIVATE_PREFIX}.`)
  );
}

/**
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
function base64urlBytes(text) {
  if (!BASE64URL.test(text)) throw new Error('not base64url');
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

/** @param {string} text */
const jsonPart = (text) =>
  JSON.parse(new TextDecoder().decode(base64urlBytes(text)));

/**
 * @typedef {{ keys?: (JsonWebKey & { kid?: string })[] }} KeySet
 * @typedef {{ teamDomain: string, aud: string, now: number, keys: KeySet }} AccessCheck
 */

/**
 * Whether `token` is an RS256 token Access signed with one of `keys`, issued
 * by `https://<teamDomain>` for `aud`, and valid at `now` (seconds).
 *
 * @param {string | null} token
 * @param {AccessCheck} check
 * @returns {Promise<boolean>}
 */
export async function verifyAccessJwt(token, { teamDomain, aud, now, keys }) {
  if (!token || !teamDomain || !aud || !Array.isArray(keys?.keys)) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = jsonPart(parts[0]);
    const claims = jsonPart(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const jwk = keys.keys.find((key) => key.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signed = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64urlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!signed) return false;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return (
      claims.iss === `https://${teamDomain}` &&
      audiences.includes(aud) &&
      typeof claims.exp === 'number' &&
      claims.exp > now &&
      (claims.nbf === undefined ||
        (typeof claims.nbf === 'number' && claims.nbf <= now))
    );
  } catch {
    return false;
  }
}

/** @type {{ teamDomain: string, keys: KeySet, until: number } | null} */
let kept = null;

/** Drops the kept keys, for tests. */
export function forgetAccessKeys() {
  kept = null;
}

/**
 * The team's signing keys, fetched from Access and kept for ten minutes per
 * isolate. Throws on an answer that is not 200 or not JSON, for the caller to
 * refuse on.
 *
 * @param {string} teamDomain
 * @param {(url: string) => Promise<Response>} fetchKeys
 * @param {number} now seconds
 * @returns {Promise<KeySet>}
 */
export async function accessKeys(teamDomain, fetchKeys, now) {
  if (kept && kept.teamDomain === teamDomain && now < kept.until)
    return kept.keys;
  const response = await fetchKeys(
    `https://${teamDomain}/cdn-cgi/access/certs`,
  );
  if (response.status !== 200)
    throw new Error(`Access keys answered ${response.status}`);
  const keys = /** @type {KeySet} */ (JSON.parse(await response.text()));
  kept = { teamDomain, keys, until: now + KEYS_KEPT_SECONDS };
  return keys;
}

/**
 * Whether `request` carries a valid Access token for this site, read with
 * the settings in `env` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`).
 *
 * @param {Request} request
 * @param {Record<string, string | undefined>} env
 * @param {{ fetchKeys?: (url: string) => Promise<Response>, now?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function accessOk(
  request,
  env,
  { fetchKeys = (url) => fetch(url), now = Math.floor(Date.now() / 1000) } = {},
) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain || !aud) return false;
  let keys;
  try {
    keys = await accessKeys(teamDomain, fetchKeys, now);
  } catch {
    return false;
  }
  return verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), {
    teamDomain,
    aud,
    now,
    keys,
  });
}
