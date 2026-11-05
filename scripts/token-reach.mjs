#!/usr/bin/env node
/**
 * The dev Cloudflare token reaches the dev account and nothing else (#415).
 *
 * A Cloudflare Pages permission can be narrowed to an account but never to
 * one project, so dev and production live in separate accounts and the dev
 * token must be scoped to the dev account alone (operator, 2026-10-02: "dev
 * must never be able to deploy to production"). That was proved once, by
 * hand. This re-proves it on every dev deploy, before anything is deployed:
 * the token lists the accounts it can reach, and anything but exactly the dev
 * account, all of it, refuses the deploy. The operator chose this shape,
 * 2026-10-02, over probing the production project, so no production
 * identifier enters the dev workflow.
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/token-reach.mjs
 *
 * One request, with a time limit and no retry (operator rule, 2026-10-02):
 * a listing that does not arrive is a failed proof, not a reason to ask again.
 */
import { env, exit } from 'node:process';

/** Cloudflare's v4 account listing; enough for a page of every account a token reaches. */
const ACCOUNTS = 'https://api.cloudflare.com/client/v4/accounts?per_page=50';

/** A listing that has not arrived in this long is not coming. */
const LIMIT_MS = 30_000;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null;

/**
 * What Cloudflare's listing for a token says about its reach.
 *
 * @param {unknown} body the parsed response
 * @param {string} expectedAccountId the dev account
 * @returns {{ ok: boolean, reason: string }}
 */
export function reachVerdict(body, expectedAccountId) {
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
  return ids[0] === expectedAccountId
    ? { ok: true, reason: 'the token reaches 1 account, the dev one' }
    : {
        ok: false,
        reason: 'the token reaches 1 account, and it is not the dev one',
      };
}

export async function main() {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    console.error(
      'usage: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/token-reach.mjs',
    );
    exit(1);
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
      `::error::the account listing did not arrive: ${/** @type {Error} */ (error).message}`,
    );
    exit(1);
  }
  const { ok, reason } = reachVerdict(body, account);
  if (!ok) {
    console.error(`::error::the dev token's reach is not proven: ${reason}`);
    exit(1);
  }
  console.log(`dev token reach: ${reason}`);
}

if (import.meta.main) await main();
