#!/usr/bin/env node
/**
 * Read every translated line back into English with Google Cloud Translation,
 * and save the readings. #754.
 *
 *   npm run i18n:google-read-back
 *
 * Only the laptop runs this (operator decision 2026-10-15). The readings go
 * to `src/lib/i18n/.read-back.json`, and `tests/unit/read-back-coverage.test.ts`
 * fails, with no key and no network, when a line has no reading of its exact
 * current text and is not on the store's pending list.
 *
 * Environment:
 *
 *   GOOGLE_TRANSLATE_API_KEY  the key; unset, it is read from the one key file
 *                             every project shares,
 *                             ~/.config/shyden/google-translate.env. Never
 *                             printed, never copied into the repository.
 *   GOOGLE_READ_BACK_REPORT   a path to write this run's review to, as
 *                             Markdown; printed otherwise.
 *
 * Never spends money: 16,000 characters a day, 31 of which fit inside the
 * free 500,000 a month. The Google project carries that quota, but Google
 * refuses only the request AFTER the one that crosses it (measured
 * 2026-10-15: 16,991 accepted), so the client also counts every character it
 * sends in ~/.config/shyden/google-translate-ledger.json, shared by every
 * project that uses the key, and never sends a request that would cross. The
 * run stops at the first refusal too, naming it, and retries nothing. The
 * store is written after every request, so a stopped run resumes from where
 * it stopped the next day.
 *
 * The order: the lines the operator approved (`verified.ts`) first, so Google
 * is proved on known-good copy before it is trusted, then zh, th, id and vi,
 * smallest first. The decisions live in `src/lib/i18n/read-back.ts`; this
 * file is wiring: read, fetch, write.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import * as prettier from 'prettier';
import { chrF } from '../src/lib/i18n/back-translate.ts';
import {
  DAILY_CHARACTERS,
  READ_ORDER,
  approvedFirst,
  batches,
  blockingRead,
  charactersLeft,
  coverage,
  fromGoogleHtml,
  googleBody,
  googleHtml,
  googleKey,
  googleRefusal,
  googleSource,
  googleTexts,
  parseLedger,
  parseStore,
  quotaDay,
  readBackReview,
  readingPlan,
  spend,
  unitsByLocale,
  writerOf,
} from '../src/lib/i18n/read-back.ts';
import { VERIFIED } from '../src/lib/i18n/verified.ts';
import { messageOf } from './errors.mjs';

const STORE = new URL('../src/lib/i18n/.read-back.json', import.meta.url);
const DRAFTS = new URL('../src/lib/i18n/.translations.json', import.meta.url);
const KEY_FILE = `${homedir()}/.config/shyden/google-translate.env`;
const LEDGER = `${homedir()}/.config/shyden/google-translate-ledger.json`;
const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
/** Per request: Google's v2 takes up to 128 texts; 5,000 characters is its advice. */
const MAX_TEXTS = 25;
const MAX_CHARS = 5000;

/** @param {string} path */
const readIfThere = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * The store as prettier writes it, so a run never leaves the tree unformatted.
 *
 * @param {import('../src/lib/i18n/read-back.ts').ReadBackStore} store
 */
async function save(store) {
  const options = (await prettier.resolveConfig(STORE.pathname)) ?? {};
  writeFileSync(
    STORE,
    await prettier.format(JSON.stringify(store), {
      ...options,
      parser: 'json',
    }),
  );
}

async function main() {
  // Everything it reads is an environment variable, so an argument is a
  // mistake (#227).
  if (process.argv.length > 2)
    throw new Error(
      `i18n-google-read-back.mjs takes no arguments (got ${process.argv.slice(2).join(' ')})`,
    );
  const key = googleKey(process.env, readIfThere(KEY_FILE), KEY_FILE);
  const store = parseStore(JSON.parse(readFileSync(STORE, 'utf8')));
  /** @type {Record<string, Record<string, string>>} */
  const drafts = JSON.parse(readFileSync(DRAFTS, 'utf8'));

  const units = unitsByLocale();
  // A reading of a text no line says any more is dropped first.
  for (const locale of READ_ORDER)
    for (const text of coverage(locale, units[locale], store).stale)
      delete store.readings[locale][text];

  const plan = readingPlan(units, store, approvedFirst(VERIFIED, units));
  const total = plan.reduce((sum, { chars }) => sum + chars, 0);
  const day = quotaDay(new Date());
  let ledger = parseLedger(JSON.parse(readIfThere(LEDGER) ?? '{}'));
  const left = charactersLeft(ledger, day);
  console.log(
    `${plan.length} texts to read, ${total} characters; ${left} of ${DAILY_CHARACTERS} left on Google's ${day}`,
  );

  /** @type {Set<string>} */
  const readNow = new Set();
  let spent = 0;
  let stop = '';
  for (const batch of batches(plan, MAX_TEXTS, MAX_CHARS, left)) {
    const { locale } = batch[0];
    const texts = batch.map(({ text }) => text);
    // The key travels in a header, never the URL, so no error can echo it.
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(
        googleBody(texts.map(googleHtml), googleSource(locale)),
      ),
    });
    const raw = await response.text();
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
    if (!response.ok) {
      const refusal = googleRefusal(response.status, body);
      // A spent quota closes the day in the ledger too, whatever it counted.
      if (refusal.quota)
        ledger = spend(ledger, day, charactersLeft(ledger, day));
      writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
      stop = refusal.message;
      break;
    }
    const chars = batch.reduce((sum, { chars: count }) => sum + count, 0);
    // Counted once Google has answered, before the answer is read: a reply
    // that fails its checks was still billed.
    ledger = spend(ledger, day, chars);
    writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
    spent += chars;
    googleTexts(body, texts.length).forEach((reading, at) => {
      // Saved unjudged: the coverage test fails until it has a verdict.
      store.readings[locale][texts[at]] = { english: fromGoogleHtml(reading) };
      readNow.add(`${locale}\n${texts[at]}`);
    });
    // The pending list only shrinks: a key leaves it once its text is read.
    store.pending[locale] = store.pending[locale].filter((pendingKey) =>
      units[locale].some(
        (unit) =>
          unit.key === pendingKey &&
          !(unit.translation in store.readings[locale]),
      ),
    );
    await save(store);
  }
  await save(store);

  const rows = READ_ORDER.flatMap((locale) =>
    units[locale]
      .filter((unit) => readNow.has(`${locale}\n${unit.translation}`))
      .map((unit) => {
        const reading = store.readings[locale][unit.translation].english;
        return {
          locale,
          key: unit.key,
          writer: writerOf(locale, unit.english, unit.translation, drafts),
          english: unit.english,
          translation: unit.translation,
          reading,
          score: chrF(unit.english, reading),
        };
      }),
  );
  const page = readBackReview(rows);
  if (process.env.GOOGLE_READ_BACK_REPORT)
    writeFileSync(process.env.GOOGLE_READ_BACK_REPORT, `${page}\n`);
  else console.log(page);

  console.log(
    `read ${readNow.size} of ${plan.length} texts, ${spent} of ${total} characters`,
  );
  // The lines a change waits on, read before the backlog (#784).
  const blocking = blockingRead(plan, readNow);
  console.log(
    `${blocking.read} of the ${blocking.inPlan} texts that block a change were read`,
  );
  if (!stop && readNow.size < plan.length)
    stop = `today's ${DAILY_CHARACTERS} characters are spent; ${plan.length - readNow.size} texts wait for Google's next day`;
  if (stop) {
    console.error(`✗ stopped: ${stop}`);
    console.error(
      'Nothing was retried. What was read is saved; run again tomorrow to go on.',
    );
    process.exitCode = 1;
  }
}

if (import.meta.main)
  await main().catch((error) => {
    console.error(`✗ ${messageOf(error)}`);
    process.exitCode = 1;
  });
