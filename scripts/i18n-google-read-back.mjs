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
 *   GOOGLE_DAILY_CHARACTERS   a raised daily limit, for a run the operator
 *                             has approved; printed, and written into the
 *                             ledger beside the day's total (#841).
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
 * One read-back runs at a time on the machine (#841): a run holds
 * ~/.config/shyden/google-translate.lock, and a second waits for it, naming
 * the holder, for up to ten minutes. The ledger is read again before every
 * request, and every write to it is whole. The rules live in
 * `src/lib/i18n/google-ledger.ts`.
 *
 * The order: the lines the operator approved (`verified.ts`) first, so Google
 * is proved on known-good copy before it is trusted, then zh, th, id and vi,
 * smallest first. The decisions live in `src/lib/i18n/read-back.ts`; this
 * file is wiring: read, fetch, write.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import * as prettier from 'prettier';
import { chrF } from '../src/lib/i18n/back-translate.ts';
import {
  dailyLimit,
  readLedger,
  spendWithin,
  takeLock,
} from '../src/lib/i18n/google-ledger.ts';
import {
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
  parseStore,
  quotaDay,
  readBackReview,
  readingPlan,
  unitsByLocale,
  writerOf,
} from '../src/lib/i18n/read-back.ts';
import { withGoogleWriters, writersOf } from '../src/lib/i18n/readers.ts';
import { VERIFIED } from '../src/lib/i18n/verified.ts';
import { messageOf } from './errors.mjs';

const STORE = new URL('../src/lib/i18n/.read-back.json', import.meta.url);
const DRAFTS = new URL('../src/lib/i18n/.translations.json', import.meta.url);
const KEY_FILE = `${homedir()}/.config/shyden/google-translate.env`;
const LEDGER = `${homedir()}/.config/shyden/google-translate-ledger.json`;
const LOCK = `${homedir()}/.config/shyden/google-translate.lock`;
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

/** @param {unknown} error */
const codeOf = (error) =>
  error && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined;

/** @type {import('../src/lib/i18n/google-ledger.ts').LedgerFiles} */
const files = {
  read: readIfThere,
  create: (path, text) => {
    try {
      writeFileSync(path, text, { flag: 'wx' });
      return true;
    } catch (error) {
      if (codeOf(error) === 'EEXIST') return false;
      throw error;
    }
  },
  write: (path, text) => writeFileSync(path, text),
  rename: renameSync,
  remove: (path) => rmSync(path, { force: true }),
};

/** @type {import('../src/lib/i18n/google-ledger.ts').LockClock} */
const clock = {
  now: () => Date.now(),
  wait: (ms) => delay(ms),
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM: the process runs, as someone this one cannot signal.
      return codeOf(error) === 'EPERM';
    }
  },
  say: (line) => console.log(line),
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

/** @param {string} key */
async function readBack(key) {
  /** @type {Record<string, Record<string, string>>} */
  const drafts = JSON.parse(readFileSync(DRAFTS, 'utf8'));
  const units = unitsByLocale();
  // Every reading names the writers of its lines as the cache says now
  // (#754 AC10), so a re-drafted line is never filed under its old writer.
  const store = withGoogleWriters(
    parseStore(JSON.parse(readFileSync(STORE, 'utf8'))),
    units,
    drafts,
  );
  // A reading of a text no line says any more is dropped first.
  for (const locale of READ_ORDER)
    for (const text of coverage(locale, units[locale], store).stale)
      delete store.readings[locale][text];

  const plan = readingPlan(units, store, approvedFirst(VERIFIED, units));
  const total = plan.reduce((sum, { chars }) => sum + chars, 0);
  const day = quotaDay(new Date());
  const { limit, raised } = dailyLimit(process.env);
  if (raised)
    console.log(
      `GOOGLE_DAILY_CHARACTERS raises the limit to ${limit} characters; the ledger records it beside ${day}`,
    );
  const left = charactersLeft(readLedger(files, LEDGER), day, limit);
  console.log(
    `${plan.length} texts to read, ${total} characters; ${left} of ${limit} left on Google's ${day}`,
  );

  /** @type {Set<string>} */
  const readNow = new Set();
  const { spent, stop: refused } = await spendWithin(
    batches(plan, MAX_TEXTS, MAX_CHARS, left),
    (batch) => batch.reduce((sum, { chars }) => sum + chars, 0),
    { files, path: LEDGER, day, limit, raised, pid: process.pid },
    async (batch) => {
      // The key travels in a header, never the URL, so no error can echo it.
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(
          googleBody(
            batch.map(({ text }) => googleHtml(text)),
            googleSource(batch[0].locale),
          ),
        ),
      });
      const raw = await response.text();
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      if (response.ok) return { ok: true, body };
      const { quota, message } = googleRefusal(response.status, body);
      return { ok: false, quota, message };
    },
    // Counted before it gets here: a reply that fails its checks was still
    // billed.
    async (batch, body) => {
      const { locale } = batch[0];
      googleTexts(body, batch.length).forEach((reading, at) => {
        // Saved unjudged: the coverage test fails until it has a verdict.
        store.readings[locale][batch[at].text] = {
          english: fromGoogleHtml(reading),
          writers: writersOf(locale, batch[at].text, units[locale], drafts),
        };
        readNow.add(`${locale}\n${batch[at].text}`);
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
    },
  );
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
  let stop = refused;
  if (!stop && readNow.size < plan.length)
    stop = `today's ${limit} characters are spent; ${plan.length - readNow.size} texts wait for Google's next day`;
  if (stop) {
    console.error(`✗ stopped: ${stop}`);
    console.error(
      'Nothing was retried. What was read is saved; run again tomorrow to go on.',
    );
    process.exitCode = 1;
  }
}

async function main() {
  // Everything it reads is an environment variable, so an argument is a
  // mistake (#227).
  if (process.argv.length > 2)
    throw new Error(
      `i18n-google-read-back.mjs takes no arguments (got ${process.argv.slice(2).join(' ')})`,
    );
  const key = googleKey(process.env, readIfThere(KEY_FILE), KEY_FILE);
  // Taken before the store is read, so a run that waited reads what the run
  // before it saved.
  const release = await takeLock(
    files,
    LOCK,
    {
      pid: process.pid,
      worktree: fileURLToPath(new URL('..', import.meta.url)),
      started: new Date().toISOString(),
    },
    clock,
  );
  try {
    await readBack(key);
  } finally {
    release();
  }
}

if (import.meta.main)
  await main().catch((error) => {
    console.error(`✗ ${messageOf(error)}`);
    process.exitCode = 1;
  });
