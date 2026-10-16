#!/usr/bin/env node
/**
 * Mutation parity, per title (#821 AC4). A mutant is applied once and both
 * phones run against it: Android through Playwright (JSON reporter), the
 * iPhone through Vitest (JSON reporter). Each iPhone mirror must be RED
 * exactly where its Android twin is RED; a title GREEN on one phone and RED
 * on the other is a twin weaker (or stricter) than the test it claims to be
 * (mirror rule, Shyden 2026-10-16: "the same test, not the same title").
 *
 * Twins pair by describe path and title, each segment with the iPhone's
 * `iOS mirror: ` prefix dropped, so two tests of one title under different
 * describes stay apart. A title on one phone only is counted, never compared:
 * which titles exist on both phones is #812's guard.
 *
 *   node scripts/mutation-parity.mjs <android-report.json> <ios-report.json>
 *
 * prints every break and exits 1 when there is one.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PREFIX = 'iOS mirror: ';

/** @typedef {'RED' | 'GREEN'} Verdict */

/** @param {string} segment */
const bare = (segment) =>
  segment.startsWith(PREFIX) ? segment.slice(PREFIX.length) : segment;

/**
 * Every Playwright test's verdict, keyed `describe > … > title`. The report's
 * top-level suites are its files and add nothing to the key; a skipped test
 * has no verdict.
 * @param {{ suites: any[] }} report
 * @returns {Map<string, Verdict>}
 */
export function androidVerdicts(report) {
  /** @type {Map<string, Verdict>} */
  const verdicts = new Map();
  /** @param {any} suite @param {string[]} path */
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        if (test.status === 'skipped') continue;
        verdicts.set(
          [...path, spec.title].join(' > '),
          test.status === 'expected' ? 'GREEN' : 'RED',
        );
      }
    for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
  };
  for (const file of report.suites ?? []) walk(file, []);
  return verdicts;
}

/**
 * Every Vitest test's verdict, keyed as `androidVerdicts` keys them, with the
 * `iOS mirror: ` prefix dropped from every segment; a skipped or pending test
 * has no verdict.
 * @param {{ testResults: { assertionResults: any[] }[] }} report
 * @returns {Map<string, Verdict>}
 */
export function iosVerdicts(report) {
  /** @type {Map<string, Verdict>} */
  const verdicts = new Map();
  for (const file of report.testResults ?? [])
    for (const result of file.assertionResults ?? []) {
      if (result.status !== 'passed' && result.status !== 'failed') continue;
      verdicts.set(
        [...(result.ancestorTitles ?? []), result.title].map(bare).join(' > '),
        result.status === 'passed' ? 'GREEN' : 'RED',
      );
    }
  return verdicts;
}

/**
 * The titles both phones ran, compared; the ones whose verdicts differ are
 * the breaks.
 * @param {Map<string, Verdict>} android
 * @param {Map<string, Verdict>} ios
 */
export function parityBreaks(android, ios) {
  const compared = [...android.keys()].filter((title) => ios.has(title)).sort();
  const breaks = compared
    .filter((title) => android.get(title) !== ios.get(title))
    .map((title) => ({
      title,
      android: android.get(title),
      ios: ios.get(title),
    }));
  return {
    compared,
    breaks,
    unpaired: {
      android: [...android.keys()].filter((title) => !ios.has(title)).sort(),
      ios: [...ios.keys()].filter((title) => !android.has(title)).sort(),
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [androidPath, iosPath] = process.argv.slice(2);
  if (!androidPath || !iosPath) {
    console.error(
      'usage: node scripts/mutation-parity.mjs <android-report.json> <ios-report.json>',
    );
    process.exit(2);
  }
  const { compared, breaks, unpaired } = parityBreaks(
    androidVerdicts(JSON.parse(readFileSync(androidPath, 'utf8'))),
    iosVerdicts(JSON.parse(readFileSync(iosPath, 'utf8'))),
  );
  console.log(
    `mutation-parity: ${compared.length} twins compared, ${breaks.length} breaks; ${unpaired.android.length} Android-only and ${unpaired.ios.length} iPhone-only titles not compared (#812)`,
  );
  for (const { title, android, ios } of breaks)
    console.log(`BREAK ${title}: Android ${android}, iPhone ${ios}`);
  process.exit(breaks.length === 0 ? 0 : 1);
}
