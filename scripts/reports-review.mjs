#!/usr/bin/env node
/**
 * Print every waiting translation report beside the English it was
 * translated from, and what its suggestion says in English. #348.
 *
 *   BACK_TRANSLATE_URL=http://localhost:5000 npm run reports:review shyden-reports
 *
 * The engine is the one `i18n-back-translate.mjs` reads the catalogues with
 * (its header has the `docker run` line), through the same client. Without
 * `BACK_TRANSLATE_URL` every other field still prints, and each report says
 * no back-translation was made.
 *
 * READ-ONLY. The one command it runs is `wrangler d1 execute <db> --remote
 * --json --command "SELECT …"`, built by `wranglerArgs`; dealing with a
 * report stays the runbook's `DELETE`, typed by the operator.
 *
 * Exits 2 on a wrong argument, 1 when the rows cannot be read or any
 * back-translation failed (the failure is printed in its report's block).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { messageOf } from './errors.mjs';
import { call, readBack } from './back-translate-client.mjs';
import {
  CATALOGUES,
  engineConfig,
  engineLanguages,
  engineSource,
} from '../src/lib/i18n/back-translate.ts';
import {
  databaseFrom,
  needsBackTranslation,
  reportRows,
  reviewBlock,
  wranglerArgs,
} from '../src/lib/report-review.ts';

/**
 * Each report's back-translation, in row order. A failure is kept with the
 * report it belongs to; it never stops the others from printing.
 *
 * @param {readonly import('../src/lib/report-review.ts').ReportRow[]} rows
 * @param {Readonly<Record<string, string | undefined>>} env where
 *   `BACK_TRANSLATE_URL` and `BACK_TRANSLATE_API_KEY` are read
 * @returns {Promise<import('../src/lib/report-review.ts').BackTranslation[]>}
 */
export async function backTranslations(rows, env) {
  const wanted = rows.some(needsBackTranslation);
  if (!wanted || (env.BACK_TRANSLATE_URL ?? '') === '')
    return rows.map((row) =>
      needsBackTranslation(row)
        ? { kind: 'no-engine' }
        : { kind: 'not-needed' },
    );
  /** @type {{ url: string, apiKey?: string, offered: import('../src/lib/i18n/back-translate.ts').EngineLanguage[] } | { reason: string }} */
  let engine;
  try {
    const { url, apiKey } = engineConfig(env);
    engine = {
      url,
      apiKey,
      offered: engineLanguages(await call(`${url}/languages`)),
    };
  } catch (error) {
    engine = { reason: messageOf(error) };
  }
  /** @type {import('../src/lib/report-review.ts').BackTranslation[]} */
  const results = [];
  for (const row of rows) {
    if (!needsBackTranslation(row)) results.push({ kind: 'not-needed' });
    else if ('reason' in engine)
      results.push({ kind: 'failed', reason: engine.reason });
    else
      try {
        const source = engineSource(row.locale, engine.offered);
        const [text] = await readBack(engine.url, engine.apiKey, source, [
          row.suggestion,
        ]);
        results.push({ kind: 'made', text });
      } catch (error) {
        results.push({ kind: 'failed', reason: messageOf(error) });
      }
  }
  return results;
}

async function main() {
  let database;
  try {
    database = databaseFrom(process.argv.slice(2));
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 2;
    return;
  }
  const WRANGLER = fileURLToPath(
    new URL('../node_modules/.bin/wrangler', import.meta.url),
  );
  // wrangler's own errors go straight to the terminal; only its JSON is read.
  const output = execFileSync(WRANGLER, wranglerArgs(database), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows = reportRows(JSON.parse(output));
  if (rows.length === 0) {
    console.log(`No reports are waiting in ${database}.`);
    return;
  }
  const translations = await backTranslations(rows, process.env);
  console.log(
    rows
      .map((row, index) => reviewBlock(row, CATALOGUES, translations[index]))
      .join('\n\n'),
  );
  const failed = translations.filter(({ kind }) => kind === 'failed').length;
  console.log(
    `\n${rows.length} report${rows.length === 1 ? '' : 's'} waiting in ${database}.`,
  );
  if (failed > 0) {
    console.error(
      `✗ ${failed} back-translation${failed === 1 ? '' : 's'} failed; see the reports above.`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.main)
  await main().catch((error) => {
    console.error(`✗ ${messageOf(error)}`);
    process.exitCode = 1;
  });
