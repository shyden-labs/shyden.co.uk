/**
 * A `fetch` that refuses, preloaded ahead of a script under test (#164).
 *
 *   node --import ./tests/fetch-trap.mjs scripts/i18n-translate.mjs zh --prune
 *
 * `FETCH_TRAP_RECORD` names a file. The trap writes `loaded` to it the moment
 * it loads, then a `request <url>` line for every request it refuses. The log
 * is the population a "made no request" assertion searched: a missing or
 * empty log means the trap never ran, and "no request" read from it would
 * mean nothing (#79's sentinel, for the same reason). Only the URL is written
 * -- a DeepL request carries its key in a header.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';

const record = env.FETCH_TRAP_RECORD;
if (!record) throw new Error('fetch-trap: FETCH_TRAP_RECORD is not set');
writeFileSync(record, 'loaded\n');

/** @param {RequestInfo | URL} input */
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  appendFileSync(record, `request ${url}\n`);
  throw new Error(`fetch-trap: refused a request to ${url}`);
};
