/**
 * The back-translation engine's client, in one home: `i18n-back-translate.mjs`
 * (#95) reads every catalogue through it, and `reports-review.mjs` (#348)
 * reads a visitor's suggestion through it. The request and answer shapes are
 * decided in `src/lib/i18n/back-translate.ts`; this file only talks HTTP.
 */
import {
  libreTranslateBody,
  translatedTexts,
} from '../src/lib/i18n/back-translate.ts';
import { messageOf } from './errors.mjs';

/** Texts per request: small enough that one slow batch is not the whole run. */
const BATCH = 25;

/**
 * One request, its JSON answer, and the engine's own words when it refuses.
 *
 * An engine that cannot be reached is named with the reason: `fetch` rejects
 * with "fetch failed" and keeps `ECONNREFUSED` on `cause`, so a run whose
 * container was not started printed `✗ fetch failed` and nothing else (#390).
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<unknown>}
 */
export async function call(url, init = {}) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    throw new Error(
      `${init.method ?? 'GET'} ${url} could not be reached: ${messageOf(cause)}`,
    );
  }
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const reason =
      body && typeof body.error === 'string' ? body.error : text.slice(0, 200);
    throw new Error(
      `${init.method ?? 'GET'} ${url} answered ${response.status}: ${reason}`,
    );
  }
  if (body === undefined)
    throw new Error(`${init.method ?? 'GET'} ${url} answered with no JSON`);
  return body;
}

/**
 * Read `texts` from `source` into English, in batches, answers in the order
 * the texts were given. Every answer is checked for count, so a short one is
 * a broken run rather than texts paired with the wrong translations.
 *
 * @param {string} url the engine's address, without a trailing slash
 * @param {string | undefined} apiKey
 * @param {string} source the engine's code for the language, from `engineSource`
 * @param {readonly string[]} texts
 * @returns {Promise<string[]>}
 */
export async function readBack(url, apiKey, source, texts) {
  /** @type {string[]} */
  const back = [];
  for (let at = 0; at < texts.length; at += BATCH) {
    const batch = texts.slice(at, at + BATCH);
    const answer = await call(`${url}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(libreTranslateBody(batch, source, apiKey)),
    });
    back.push(...translatedTexts(answer, batch.length));
  }
  return back;
}
