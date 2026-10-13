import { describe, it, expect } from 'vitest';
import { LOCALES, type Locale, getSiteStrings } from '../../src/lib/i18n';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  MVP_LOCALES,
  LOCALE_METADATA,
  metadataFor,
  type MvpLocale,
} from '../../src/lib/i18n/metadata';

/**
 * Everything that differs per language, in one table, so #22 is a data change.
 *
 * Before this file, five separate places each decided what a locale meant with
 * their own `lang === 'id' ? … : …`: the strings table, `og:locale`, the number
 * formatter, the switcher label, the handover. Each was correct for two
 * locales and silently wrong for three — `og:locale` would have emitted
 * `en_GB` for a Chinese page, and `toLocaleString` would have grouped Thai
 * digits as English.
 *
 * None of those would have failed a test. They are not errors; they are
 * defaults that stop matching reality. So the table below is the single place
 * a locale is described, and the assertions here are what stop it drifting
 * back out into ternaries.
 *
 * MVP_LOCALES is deliberately WIDER than LOCALES: the metadata for a language
 * ships before the language is served, so serving it means flipping which
 * locales are served, never writing new metadata code. #22 served zh, vi and
 * th that way, and today the two lists hold the same five.
 */

describe('the locale metadata table', () => {
  it('describes every one of the five MVP languages', () => {
    // Named in CLAUDE.md as the MVP set. If this shrinks, #22 stops being a
    // data change and becomes a code change again.
    expect([...MVP_LOCALES]).toEqual(['en', 'id', 'zh', 'vi', 'th']);
  });

  it('covers every locale that is actually routed', () => {
    // The seam: LOCALES is what ships, MVP_LOCALES is what is described. A
    // locale that is served but undescribed is exactly the silent-default bug
    // this table exists to remove.
    const undescribed = (LOCALES as readonly string[]).filter(
      (l) => !(l in LOCALE_METADATA),
    );
    expect(
      searched(undescribed, { of: LOCALES, what: 'routed locales' }),
      'a routed locale with no metadata falls back to English defaults ' +
        'without failing anything',
    ).toEqual([]);
    expect(
      floorBreach('locale-metadata/described-locales', LOCALES.length),
    ).toBeUndefined();
  });

  it('names each language in that language, never in English', () => {
    // A picker that lists "Chinese" in English is useless to the person who
    // needs it: they are looking for 中文.
    expect(LOCALE_METADATA.en.nativeName).toBe('English');
    expect(LOCALE_METADATA.id.nativeName).toBe('Bahasa Indonesia');
    expect(LOCALE_METADATA.zh.nativeName).toBe('中文');
    expect(LOCALE_METADATA.vi.nativeName).toBe('Tiếng Việt');
    expect(LOCALE_METADATA.th.nativeName).toBe('ไทย');
  });

  it('gives every language a distinct, non-blank native name', () => {
    const names = MVP_LOCALES.map((l) => LOCALE_METADATA[l].nativeName);
    // Length first: without it this test passes on an EMPTY table, because
    // "no blanks" and "no duplicates" are both true of nothing.
    expect(names).toHaveLength(5);
    expect(
      searched(
        names.filter((n) => n.trim() === ''),
        { of: names, what: 'native names' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('locale-metadata/native-names', names.length),
    ).toBeUndefined();
    expect(
      new Set(names).size,
      'two languages sharing a label is the binary-switcher bug in a new shape',
    ).toBe(names.length);
  });

  it('carries an og:locale for every language', () => {
    // `<meta property="og:locale">` took `lang === 'id' ? 'id_ID' : 'en_GB'`,
    // which silently labels every future locale as British English.
    for (const locale of MVP_LOCALES) {
      expect(
        LOCALE_METADATA[locale].ogLocale,
        `${locale} og:locale must be language_TERRITORY`,
      ).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
    }
    expect(LOCALE_METADATA.en.ogLocale).toBe('en_GB');
    expect(LOCALE_METADATA.id.ogLocale).toBe('id_ID');
  });

  it('pins every language its og:locale and number locale, as literals', () => {
    // All five (#390). Only en and id were pinned, so `zh_TW` announcing a
    // Simplified page as Taiwanese, or `th-TH-u-nu-thai` printing Thai digits,
    // left every test green.
    expect(
      Object.fromEntries(
        MVP_LOCALES.map((locale) => [
          locale,
          [
            LOCALE_METADATA[locale].ogLocale,
            LOCALE_METADATA[locale].numberLocale,
          ],
        ]),
      ),
    ).toEqual({
      en: ['en_GB', 'en-GB'],
      id: ['id_ID', 'id-ID'],
      zh: ['zh_CN', 'zh-CN'],
      vi: ['vi_VN', 'vi-VN'],
      th: ['th_TH', 'th-TH'],
    });
  });

  it('carries a number-formatting locale that Intl actually accepts', () => {
    // `toLocaleString(locale === 'id' ? 'id-ID' : 'en-GB')` groups Thai and
    // Vietnamese digits as British English. Proven against real Intl, not a
    // regex: a well-formed tag Intl does not support is still wrong.
    const checked: string[] = [];
    for (const locale of MVP_LOCALES) {
      const tag = LOCALE_METADATA[locale].numberLocale;
      expect(
        Intl.NumberFormat.supportedLocalesOf(tag),
        `${tag} is not a locale Intl can format with`,
      ).toContain(tag);
      checked.push(tag);
    }
    // An empty table would satisfy the loop above by never entering it.
    expect(checked, 'every MVP language must be checked').toHaveLength(5);
  });

  it('gives every language the short code its compact label shows', () => {
    // Below 720px the switcher shows a flag and this code instead of the full
    // name, which ran the Shyden wordmark under the menu button at 320px in
    // Indonesian (#329). The five values are the operator's, 2026-09-23, so
    // they are pinned as literals. 中文 and ไทย are already short, so their
    // codes are their names.
    expect(LOCALE_METADATA.en.shortName).toBe('EN');
    expect(LOCALE_METADATA.id.shortName).toBe('ID');
    expect(LOCALE_METADATA.zh.shortName).toBe('中文');
    expect(LOCALE_METADATA.vi.shortName).toBe('VI');
    expect(LOCALE_METADATA.th.shortName).toBe('ไทย');
  });

  it('gives every language a distinct, non-blank short code', () => {
    const codes = MVP_LOCALES.map((l) => LOCALE_METADATA[l].shortName);
    expect(codes.filter((code) => (code ?? '').trim() !== '')).toHaveLength(5);
    expect(new Set(codes).size, 'two languages sharing a code').toBe(5);
  });

  it('pairs every language with a flag, because a name alone is easy to miss', () => {
    // A flag is a country, not a language, which is exactly why the native
    // name carries the meaning and the flag is only a visual anchor.
    expect(LOCALE_METADATA.en.flag).toBe('gb');
    expect(LOCALE_METADATA.id.flag).toBe('id');
    expect(LOCALE_METADATA.zh.flag).toBe('cn');
    expect(LOCALE_METADATA.vi.flag).toBe('vn');
    expect(LOCALE_METADATA.th.flag).toBe('th');
  });
});

describe('looking a locale up', () => {
  it('returns the metadata for a routed locale', () => {
    expect(metadataFor('id' as Locale).nativeName).toBe('Bahasa Indonesia');
  });

  it('falls back to the default locale rather than throwing', () => {
    // Astro hands components whatever is in the URL. A page that 500s because
    // someone typed /xx/ is worse than one that renders in English.
    expect(metadataFor('xx' as unknown as MvpLocale).nativeName).toBe(
      'English',
    );
  });
});

describe('resolving a locale to its site copy', () => {
  it('returns each language its own strings', () => {
    expect(getSiteStrings('en').nav.tools).toBe('Tools');
    expect(getSiteStrings('id').nav.tools).toBe('Alat');
  });

  it('falls back to the default locale rather than throwing', () => {
    expect(getSiteStrings('xx').nav.tools).toBe('Tools');
  });

  it('covers every routed locale', () => {
    // `nav.tools` is the probe because its value differs in every locale.
    // `nav.shytalk` would NOT work here: a proper noun is identical in all
    // five, so the sameness filter below would match every locale and the
    // check would stop meaning anything.
    //
    // The seam. `lang === 'id' ? siteId : siteEn` served ENGLISH to every
    // locale that was not Indonesian — silently, and correctly for exactly as
    // long as there were two.
    for (const locale of LOCALES) {
      expect(
        getSiteStrings(locale),
        `${locale} has no site strings of its own`,
      ).toBeDefined();
    }
    const wrong = (LOCALES as readonly Locale[]).filter(
      (l) => l !== 'en' && getSiteStrings(l).nav.tools === 'Tools',
    );
    expect(
      searched(wrong, { of: LOCALES, what: 'routed locales' }),
      'a non-English locale receiving the English table is the ternary bug',
    ).toEqual([]);
    expect(
      floorBreach('locale-metadata/site-string-locales', LOCALES.length),
    ).toBeUndefined();
  });
});

describe('how each language joins and ends a sentence (#390 F65)', () => {
  it('pins each gap and full stop as a literal', () => {
    // Literals, not derived: the 404 assembles a sentence around its link from
    // these, and Chinese once read 该页面不存在。 返回首页. with English rules.
    expect(
      Object.fromEntries(
        Object.entries(LOCALE_METADATA).map(([locale, meta]) => [
          locale,
          [meta.sentenceGap, meta.fullStop],
        ]),
      ),
    ).toEqual({
      en: [' ', '.'],
      id: [' ', '.'],
      zh: ['', '。'],
      vi: [' ', '.'],
      th: [' ', ''],
    });
  });
});
