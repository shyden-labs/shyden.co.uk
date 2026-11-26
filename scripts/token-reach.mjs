#!/usr/bin/env node
/**
 * The dev deploy's Cloudflare token reaches the dev account and nothing else
 * (#415), and the account id stored beside it is the dev account's (#501).
 *
 * A Cloudflare Pages permission can be narrowed to an account but never to
 * one project, so dev and production live in separate accounts and the dev
 * token must be scoped to the dev account alone (operator, 2026-10-02: "dev
 * must never be able to deploy to production"). Every dev deploy re-proves it
 * before anything is deployed: the token lists the accounts it reaches, and
 * anything but exactly the dev account refuses the deploy.
 *
 * Which account is the dev one is read from `DEV_CLOUDFLARE_ACCOUNT_ID`, a
 * repository variable outside the `dev` environment (Shyden's ruling,
 * 2026-11-20), never from the secrets the token sits beside. So production's
 * token and account id pasted into `dev` together, one slip in the secrets
 * form, are refused too. Only the dev account's id is known here, so no
 * production identifier enters the dev workflow (#415). A variable of the
 * same name set inside the `dev` environment would win over the repository's;
 * none is set there (read 2026-11-20).
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… DEV_CLOUDFLARE_ACCOUNT_ID=… node scripts/token-reach.mjs
 *
 * One request, with a time limit and no retry (operator rule, 2026-10-02):
 * a listing that does not arrive is a failed proof, not a reason to ask again.
 */
import { env, exit } from 'node:process';

/** Cloudflare's v4 account listing; enough for a page of every account a token reaches. */
const ACCOUNTS = 'https://api.cloudflare.com/client/v4/accounts?per_page=50';

/** A listing that has not arrived in this long is not coming. */
const LIMIT_MS = 30_000;

/** An account id as a log line may show it: four characters, never the whole id. */
const abbreviated = (/** @type {unknown} */ id) => `${String(id).slice(0, 4)}…`;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null;

/**
 * What Cloudflare's listing for a token says about its reach.
 *
 * @param {unknown} body the parsed response
 * @param {string} devAccountId the dev account, known apart from the token's secrets
 * @param {string} storedAccountId the account id stored beside the token
 * @returns {{ ok: boolean, reason: string }}
 */
export function reachVerdict(body, devAccountId, storedAccountId) {
  if (storedAccountId !== devAccountId)
    return {
      ok: false,
      reason: `the account id stored beside the token (${abbreviated(storedAccountId)}) is not the dev account (${abbreviated(devAccountId)})`,
    };
  if (!isRecord(body) || typeof body.success !== 'boolean')
    return {
      ok: false,
      reason: 'the answer is not a Cloudflare account listing',
    };
  if (!body.success) {
    const errors = Array.isArray(body.errors) ? body.errors : [];
    const said = errors
      .filter(isRecord)
      .map(({ code, message }) => `${String(code)} ${String(message)}`)
      .join('; ');
    return {
      ok: false,
      reason: `Cloudflare refused the listing: ${said || 'no reason given'}`,
    };
  }
  if (!Array.isArray(body.result))
    return {
      ok: false,
      reason: 'the answer is not a Cloudflare account listing',
    };
  const ids = body.result.filter(isRecord).map(({ id }) => id);
  // The total, not the page: a token reaching more accounts than one page
  // holds must not pass on the page it happened to return.
  const info = isRecord(body.result_info) ? body.result_info : {};
  const total =
    typeof info.total_count === 'number' ? info.total_count : ids.length;
  const reached = Math.max(total, ids.length);
  if (reached === 0)
    return {
      ok: false,
      reason:
        'the token lists no account, so what it reaches is unproven; a dev token must list the dev account',
    };
  if (reached > 1)
    return {
      ok: false,
      reason: `the token reaches ${reached} accounts; it must reach the dev account alone`,
    };
  return ids[0] === devAccountId
    ? { ok: true, reason: 'the token reaches 1 account, the dev one' }
    : {
        ok: false,
        reason: `the token reaches 1 account (${abbreviated(ids[0])}), and it is not the dev account (${abbreviated(devAccountId)})`,
      };
}

/**
 * `text` on one line. Cloudflare's words and a fetch error reach the log, and
 * a line break in them would start a line GitHub reads as a workflow command
 * (SonarCloud's S5145, #1275).
 *
 * @param {string} text
 * @returns {string}
 */
const oneLine = (text) => text.replace(/[\r\n]+/g, ' ');

/**
 * Runs the check from the environment and answers the exit code: 0 when the
 * dev token's reach is proven, 1 for anything else.
 *
 * @returns {Promise<0 | 1>}
 */
export async function main() {
  const token = env.CLOUDFLARE_API_TOKEN;
  const stored = env.CLOUDFLARE_ACCOUNT_ID;
  const dev = env.DEV_CLOUDFLARE_ACCOUNT_ID;
  if (!token || !stored || !dev) {
    console.error(
      'usage: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… DEV_CLOUDFLARE_ACCOUNT_ID=… node scripts/token-reach.mjs',
    );
    return 1;
  }
  let body;
  try {
    const response = await fetch(ACCOUNTS, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LIMIT_MS),
    });
    body = await response.json();
  } catch (error) {
    console.error(
      `::error::the account listing did not arrive: ${oneLine(/** @type {Error} */ (error).message)}`,
    );
    return 1;
  }
  const { ok, reason } = reachVerdict(body, dev, stored);
  if (!ok) {
    console.error(
      `::error::the dev token's reach is not proven: ${oneLine(reason)}`,
    );
    return 1;
  }
  console.log(`dev token reach: ${oneLine(reason)}`);
  return 0;
}

if (import.meta.main) exit(await main());
