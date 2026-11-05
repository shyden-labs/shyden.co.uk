import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutTsComments } from './source-text';
import {
  LOCALES,
  DEFAULT_LOCALE,
  PREFIXED_LOCALES,
  isBetaLocale,
  BETA_BADGE,
  getSiteStrings,
} from '../../src/lib/i18n/index';

/**
 * Every locale except English is marked BETA, and which ones those are is
 * DERIVED.
 *
 * Operator decision, 2026-09-10: "we do not have native speakers. this isn't
 * an option" and "English is the only one we can confirm verified". That makes
 * the marker a statement about the whole non-English set, not about four
 * particular codes -- and a hand-written set of "the beta ones" would miss the
 * next locale added, which is the failure mode behind #24, #49 and #60.
 *
 * `id` is the one that matters today: zh/vi/th are not public, but Indonesian
 * IS, and it is unverified by exactly the same standard.
 *
 * The badge token itself is NOT translated (operator decision): it labels a
 * language the visitor may not read, so a universal token beats the current
 * page's word for it. The NOTICE and the accessible label are translated, and
 * the tests below fail if a locale ships the English sentence verbatim.
 */

const INDEX = 'src/lib/i18n/index.ts';

describe('which locales are BETA is derived, never enumerated', () => {
  it('marks every locale except the default', () => {
    expect(LOCALES.filter(isBetaLocale)).toEqual([...PREFIXED_LOCALES]);
  });

  it('never marks the default locale', () => {
    // Without this the guard above is satisfied by marking everything.
    expect(isBetaLocale(DEFAULT_LOCALE)).toBe(false);
  });

  it('is defined by exclusion from the default, not by a list of codes', () => {
    // Read over comment-stripped source: a NOTE spelling out the codes would
    // otherwise satisfy this guard with no derivation present at all (#23).
    const source = withoutTsComments(readFileSync(INDEX, 'utf8'));
    const definition = source.match(/export const isBetaLocale[^;]*;/)?.[0];
    expect(
      definition,
      `isBetaLocale must be exported from ${INDEX}`,
    ).toBeTruthy();
    expect(definition).toContain('DEFAULT_LOCALE');
    for (const code of PREFIXED_LOCALES) {
      expect(
        definition,
        `isBetaLocale names '${code}' literally — a hand-written set will ` +
          'miss the next locale added',
      ).not.toContain(`'${code}'`);
    }
  });
});

describe('the BETA copy', () => {
  it('ships one untranslated badge token', () => {
    expect(BETA_BADGE).toBe('BETA');
  });

  it('gives every locale a notice and an accessible label', () => {
    for (const locale of LOCALES) {
      const t = getSiteStrings(locale);
      expect(
        t.language.betaNotice.trim(),
        `${locale}: empty beta notice`,
      ).not.toBe('');
      expect(
        t.language.betaLabel.trim(),
        `${locale}: empty beta label`,
      ).not.toBe('');
    }
  });

  it('translates the notice — no locale ships the English sentence', () => {
    // Presence alone is satisfied by pasting English into every file and
    // calling it translated, which is precisely what the badge warns about.
    const english = getSiteStrings(DEFAULT_LOCALE).language.betaNotice;
    for (const locale of PREFIXED_LOCALES) {
      expect(
        getSiteStrings(locale).language.betaNotice,
        `${locale} ships the English beta notice verbatim`,
      ).not.toBe(english);
    }
  });

  it('translates the accessible label too', () => {
    const english = getSiteStrings(DEFAULT_LOCALE).language.betaLabel;
    for (const locale of PREFIXED_LOCALES) {
      expect(
        getSiteStrings(locale).language.betaLabel,
        `${locale} ships the English beta label verbatim`,
      ).not.toBe(english);
    }
  });
});
