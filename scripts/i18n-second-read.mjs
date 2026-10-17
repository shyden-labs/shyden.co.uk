#!/usr/bin/env node
/**
 * Read translated lines back into English with an engine that is not
 * Google, and save every reading beside the line's writers. #754 AC10.
 *
 *   npm run i18n:second-read -- --reader azure [--locale th] [--keys-file f]
 *   npm run i18n:second-read -- --refresh-writers
 *
 * `--reader` is `azure` (Azure Translator), `deepl` or `libretranslate`.
 * `--keys-file` names a file of `locale<TAB>key` lines, to read only those
 * lines; without it, every line of the chosen locales is read.
 *
 * Nobody marks their own homework (operator 2026-10-16): a line the reader
 * wrote is never sent to it, and `addReadings` refuses to save one, so DeepL
 * never reads a line it drafted, word for word or edited after (operator
 * 2026-10-17). The readings go to `src/lib/i18n/.second-readings.json`;
 * `tests/unit/read-back-coverage.test.ts` refuses any reading whose reader
 * wrote the line, any whose writers have changed, and any of a text no line
 * says. `--refresh-writers` rewrites the writers from the DeepL cache and
 * drops what that makes a self-reading, printing each.
 *
 * Environment:
 *
 *   AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_REGION
 *                       Azure's key and region; unset, read from
 *                       ~/.config/shyden/azure-translator.env. Never printed.
 *   DEEPL_API_KEY       DeepL's key, as `i18n:translate` reads it (env, then
 *                       `.env.local`).
 *   LIBRETRANSLATE_URL  the LibreTranslate engine, as `i18n:back-translate`.
 *   SECOND_READ_REPORT  a path to write this run's review to; printed
 *                       otherwise.
 *
 * Never spends money: Azure's resource is the free F0 tier, which refuses a
 * request past its monthly characters rather than billing it, with a £1
 * budget alert; DeepL's key is the free plan, which refuses the same way;
 * LibreTranslate runs locally. The run stops at the first refusal, naming
 * it, and retries nothing. The store is written after every request, whole,
 * so a stopped run resumes where it stopped. The decisions live in
 * `src/lib/i18n/readers.ts`; this file is wiring: read, fetch, write.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import prettier from 'prettier';
import { call, readBack } from './back-translate-client.mjs';
import { die, messageOf } from './errors.mjs';
import {
  engineConfig,
  engineLanguages,
  engineSource,
} from '../src/lib/i18n/back-translate.ts';
import { READ_ORDER, unitsByLocale } from '../src/lib/i18n/read-back.ts';
import {
  addReadings,
  azureBody,
  azureCredentials,
  azureTexts,
  azureUrl,
  deeplReadBody,
  parseSecondStore,
  refreshWriters,
  secondReadingsReview,
  toRead,
} from '../src/lib/i18n/readers.ts';
import { deeplDrafts, deeplEndpoint } from '../src/lib/i18n/translate.ts';

const STORE = new URL('../src/lib/i18n/.second-readings.json', import.meta.url);
const DRAFTS = new URL('../src/lib/i18n/.translations.json', import.meta.url);
const AZURE_KEY_FILE = `${homedir()}/.config/shyden/azure-translator.env`;
/** Texts per request: small enough that one refusal costs little. */
const BATCH = 25;

/** @type {Record<'azure' | 'deepl' | 'libretranslate', import('../src/lib/i18n/readers.ts').SecondReader>} */
const READERS = {
  azure: 'Azure Translator',
  deepl: 'DeepL',
  libretranslate: 'LibreTranslate',
};

/** @param {string} path */
const readIfThere = (path) =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined;

/**
 * The store as prettier writes it, written whole: to a file beside it, then
 * renamed over it, so a stopped run never leaves half a store.
 *
 * @param {import('../src/lib/i18n/readers.ts').SecondStore} store
 */
async function save(store) {
  const options = (await prettier.resolveConfig(STORE.pathname)) ?? {};
  const text = await prettier.format(JSON.stringify(store), {
    ...options,
    parser: 'json',
  });
  const next = `${STORE.pathname}.next`;
  writeFileSync(next, text);
  renameSync(next, STORE.pathname);
}

/**
 * One request's answer as JSON, or a stop naming the engine's refusal. The
 * key travels in a header, never the URL, so no error can echo it.
 *
 * @param {string} name
 * @param {string} url
 * @param {RequestInit} init
 */
async function post(name, url, init) {
  const response = await fetch(url, { method: 'POST', ...init });
  const raw = await response.text();
  if (!response.ok)
    die(`${name} refused (${response.status}): ${raw.slice(0, 300)}`);
  return JSON.parse(raw);
}

/**
 * The engine as one function: a locale's texts in, its English out.
 *
 * @param {keyof typeof READERS} reader
 * @returns {Promise<(locale: import('../src/lib/i18n/read-back.ts').ReadLocale, texts: string[]) => Promise<string[]>>}
 */
async function engine(reader) {
  if (reader === 'azure') {
    const { key, region } = azureCredentials(
      process.env,
      readIfThere(AZURE_KEY_FILE),
      AZURE_KEY_FILE,
    );
    return async (locale, texts) =>
      azureTexts(
        await post('Azure Translator', azureUrl(locale), {
          headers: {
            'content-type': 'application/json',
            'Ocp-Apim-Subscription-Key': key,
            'Ocp-Apim-Subscription-Region': region,
          },
          body: JSON.stringify(azureBody(texts)),
        }),
        texts.length,
      );
  }
  if (reader === 'deepl') {
    const local = readIfThere('.env.local');
    const apiKey =
      process.env.DEEPL_API_KEY ??
      (local ? (/^DEEPL_API_KEY=(.*)$/m.exec(local)?.[1] ?? '') : '');
    if (!apiKey.trim()) die('DEEPL_API_KEY is not set (env or .env.local)');
    const url = deeplEndpoint(apiKey);
    return async (locale, texts) =>
      deeplDrafts(
        await post('DeepL', url, {
          headers: {
            'content-type': 'application/json',
            Authorization: `DeepL-Auth-Key ${apiKey.trim()}`,
          },
          body: JSON.stringify(deeplReadBody(texts, locale)),
        }),
        texts.length,
      );
  }
  const { url, apiKey } = engineConfig(process.env);
  const offered = engineLanguages(await call(`${url}/languages`));
  return async (locale, texts) =>
    readBack(url, apiKey, engineSource(locale, offered), texts);
}

/** @typedef {import('../src/lib/i18n/read-back.ts').ReadLocale} ReadLocale */

/**
 * @param {string} value
 * @returns {value is ReadLocale}
 */
const isLocale = (value) =>
  /** @type {readonly string[]} */ (READ_ORDER).includes(value);

/** @param {string | undefined} path */
function keysFrom(path) {
  if (!path) return undefined;
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [locale = '', key] = line.split('\t');
        if (!isLocale(locale) || !key)
          die(`${path}: "${line}" is not locale<TAB>key`);
        return `${locale}\t${key}`;
      }),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      reader: { type: 'string' },
      locale: { type: 'string' },
      'keys-file': { type: 'string' },
      'refresh-writers': { type: 'boolean' },
    },
  });
  /** @type {Record<string, Record<string, string>>} */
  const drafts = JSON.parse(readFileSync(DRAFTS, 'utf8'));
  const units = unitsByLocale();
  let store = parseSecondStore(JSON.parse(readFileSync(STORE, 'utf8')));

  // The writers as the cache says now, first, so nothing is sent or kept
  // under a writer that no longer wrote the line.
  for (const locale of READ_ORDER) {
    const refreshed = refreshWriters(store, locale, units[locale], drafts);
    for (const line of refreshed.dropped)
      console.log(`dropped ${locale} ${line}`);
    store = refreshed.store;
  }
  await save(store);
  if (values['refresh-writers']) return;

  const reader = /** @type {keyof typeof READERS} */ (values.reader);
  if (!(reader in READERS))
    die(`--reader is one of ${Object.keys(READERS).join(', ')}`);
  const chosen = values.locale ? [values.locale] : [...READ_ORDER];
  if (!chosen.every(isLocale))
    die(`--locale is one of ${READ_ORDER.join(', ')}`);
  const locales = /** @type {ReadLocale[]} */ (chosen);
  const only = keysFrom(values['keys-file']);
  const read = await engine(reader);

  let sent = 0;
  let characters = 0;
  const pages = [];
  for (const locale of locales) {
    const mine = units[locale].filter(
      (unit) => !only || only.has(`${locale}\t${unit.key}`),
    );
    const texts = toRead(locale, READERS[reader], mine, drafts, store);
    const skipped = mine.filter((unit) => !texts.includes(unit.translation));
    console.log(
      `${locale}: ${texts.length} texts to ${READERS[reader]}; ${skipped.length} lines skipped (already read by it, or it wrote them)`,
    );
    for (let at = 0; at < texts.length; at += BATCH) {
      const batch = texts.slice(at, at + BATCH);
      const english = await read(locale, batch);
      const out = addReadings(
        store,
        locale,
        READERS[reader],
        batch.map((text, i) => ({ text, english: english[i] })),
        units[locale],
        drafts,
      );
      // toRead never sends a line the reader wrote; a refusal here is a defect.
      if (out.refused.length > 0)
        die(
          `${locale}: refused readings by their writer: ${out.refused.join('; ')}`,
        );
      store = out.store;
      sent += batch.length;
      characters += batch.reduce((sum, text) => sum + text.length, 0);
      await save(store);
    }
    pages.push(
      secondReadingsReview(
        locale,
        mine.filter((unit) => texts.includes(unit.translation)),
        store,
      ),
    );
  }
  const page = pages.join('\n\n');
  if (process.env.SECOND_READ_REPORT)
    writeFileSync(process.env.SECOND_READ_REPORT, `${page}\n`);
  else console.log(page);
  console.log(
    `${READERS[reader]} read ${sent} texts, ${characters} characters`,
  );
}

main().catch((error) => die(messageOf(error)));
