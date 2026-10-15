#!/usr/bin/env node
/**
 * Judge Google's readings, and show every verdict. #754.
 *
 *   npm run i18n:read-back-verdicts > sheet.tsv          # what is unjudged
 *   READ_BACK_VERDICTS=sheet.tsv npm run i18n:read-back-verdicts
 *   READ_BACK_REVIEW=review.md npm run i18n:read-back-verdicts
 *
 * A wrong reading blocks the change (operator 2026-10-15: "i do want wrong
 * readings to block a change"). Each reading Google saves is unjudged until
 * someone reads it beside its English and gives a verdict: `agrees`,
 * `ambiguous` (Google took another sense of the same word; the line stands)
 * or `wrong` (the line says something else). `tests/unit/read-back-coverage`
 * fails on an unjudged line and on a wrong one. The operator sees every
 * verdict: `READ_BACK_REVIEW` writes them all, wrong first, for a PR.
 *
 * With no variable set it prints a sheet of the unjudged lines: fill in the
 * verdict and note columns, then apply it with `READ_BACK_VERDICTS`. The
 * decisions live in `src/lib/i18n/read-back.ts`; this file is wiring.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { chrF } from '../src/lib/i18n/back-translate.ts';
import {
  READ_ORDER,
  SHEET_HEADER,
  applyVerdicts,
  parseStore,
  unitsByLocale,
  verdictReview,
  verdictRows,
} from '../src/lib/i18n/read-back.ts';
import { messageOf } from './errors.mjs';

const STORE = new URL('../src/lib/i18n/.read-back.json', import.meta.url);

/**
 * A sheet cell: a tab or a line break would split the row.
 *
 * @param {unknown} text
 */
const field = (text) => String(text).replace(/[\t\r\n]+/g, ' ');

async function main() {
  // Everything it reads is an environment variable, so an argument is a
  // mistake (#227).
  if (process.argv.length > 2)
    throw new Error(
      `i18n-read-back-verdicts.mjs takes no arguments (got ${process.argv.slice(2).join(' ')})`,
    );
  let store = parseStore(JSON.parse(readFileSync(STORE, 'utf8')));
  const units = unitsByLocale();

  if (process.env.READ_BACK_VERDICTS) {
    const rows = verdictRows(
      readFileSync(process.env.READ_BACK_VERDICTS, 'utf8'),
    );
    for (const locale of READ_ORDER)
      store = applyVerdicts(
        store,
        locale,
        units[locale],
        rows.filter((row) => row.locale === locale),
      );
    const options = (await prettier.resolveConfig(STORE.pathname)) ?? {};
    writeFileSync(
      STORE,
      await prettier.format(JSON.stringify(store), {
        ...options,
        parser: 'json',
      }),
    );
    console.log(`applied ${rows.length} verdicts`);
    return;
  }

  if (process.env.READ_BACK_REVIEW) {
    writeFileSync(
      process.env.READ_BACK_REVIEW,
      `${READ_ORDER.map((locale) => verdictReview(locale, units[locale], store)).join('\n\n')}\n`,
    );
    console.log(`wrote ${process.env.READ_BACK_REVIEW}`);
    return;
  }

  const sheet = [SHEET_HEADER.join('\t')];
  for (const locale of READ_ORDER)
    for (const unit of units[locale]) {
      const reading = store.readings[locale][unit.translation];
      if (!reading || reading.verdict) continue;
      sheet.push(
        [
          locale,
          unit.key,
          '',
          '',
          unit.english,
          unit.translation,
          reading.english,
          Math.round(chrF(unit.english, reading.english)),
        ]
          .map(field)
          .join('\t'),
      );
    }
  console.log(sheet.join('\n'));
}

if (import.meta.main)
  await main().catch((error) => {
    console.error(`✗ ${messageOf(error)}`);
    process.exitCode = 1;
  });
