/**
 * No limit message says when the limit resets (#872 AC6; Shyden 2026-10-19:
 * "just don't mention the length before reset, keep it generic"). English is
 * read as written; every other locale through Google's saved reading of its
 * exact current text, so a translation that adds "tomorrow" is caught.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  getSiteStrings,
  isBetaLocale,
} from '../../src/lib/i18n';

const BETA = LOCALES.filter(isBetaLocale);

const TIME =
  /\b(day|days|daily|today|tonight|tomorrow|hour|hours|minute|minutes|midnight|o'clock|morning|evening|week|reset|UTC|24)\b|\d{1,2}[:.]\d{2}/i;
const store = JSON.parse(
  readFileSync('src/lib/i18n/.read-back.json', 'utf8'),
) as {
  readings: Record<string, Record<string, { english: string }>>;
};
const KEYS = ['formFull', 'connectionFull'] as const;

describe('the English names no period', () => {
  it.each(KEYS)('%s', (key) => {
    expect(getSiteStrings(DEFAULT_LOCALE).report[key]).not.toMatch(TIME);
  });
});

describe("Google's reading names no period", () => {
  it.each(BETA.flatMap((locale) => KEYS.map((key) => [locale, key] as const)))(
    '%s %s',
    (locale, key) => {
      const reading =
        store.readings[locale]?.[getSiteStrings(locale).report[key]]?.english;
      expect(
        reading,
        'a saved Google reading of the current text',
      ).toBeDefined();
      expect(reading).not.toMatch(TIME);
    },
  );
});
