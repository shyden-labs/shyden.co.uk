import { DEFAULT_LOCALE, LOCALES } from './locales';

/**
 * Everything that differs per language, in one table.
 *
 * Five separate places used to decide what a locale meant, each with its own
 * `lang === 'id' ? … : …`: the strings table, `og:locale`, the number
 * formatter, the switcher label and the handover. Every one of them was
 * correct for two locales and silently wrong for a third — `og:locale` would
 * have announced a Chinese page as `en_GB`, and `toLocaleString` would have
 * grouped Thai digits as British English. Neither is an error; both are
 * defaults that quietly stop matching reality, which is why no test caught
 * them and why they are gathered here instead.
 */

/**
 * The five MVP languages, deliberately WIDER than `LOCALES`.
 *
 * Metadata for a language ships before the language is served, so serving it
 * is a data change -- adding it to `LOCALES` -- never new metadata code. That
 * is how #22 served zh, vi and th. Today every MVP language is served.
 */
export const MVP_LOCALES = ['en', 'id', 'zh', 'vi', 'th'] as const;
export type MvpLocale = (typeof MVP_LOCALES)[number];

/** The country whose flag stands in for a language in the switcher. */
export type FlagCode = 'gb' | 'id' | 'cn' | 'vn' | 'th';

export interface LocaleMetadata {
  /**
   * The language's own name for itself.
   *
   * A picker listing "Chinese" in English is useless to the person who needs
   * it — they are looking for 中文. This is the label, and the flag beside it
   * is only a visual anchor, because a flag is a country and not a language.
   */
  readonly nativeName: string;
  /**
   * What the switcher shows in place of the native name below 720px, where
   * the menu button appears (#329). "Bahasa Indonesia" made the header row
   * 14px wider than a 320px screen. The codes are the operator's
   * (2026-09-23). 中文 and ไทย are already short, so they are their own codes.
   */
  readonly shortName: string;
  readonly flag: FlagCode;
  /** `<meta property="og:locale">`, in language_TERRITORY form. */
  readonly ogLocale: string;
  /** BCP-47 tag for `Intl` / `toLocaleString`. */
  readonly numberLocale: string;
  /**
   * What joins two sentences, and what ends one, where a page assembles a
   * sentence around markup instead of taking it whole from a catalogue (the
   * 404's back-home link, #390 F65). Chinese ends with a full-width 。 that
   * carries its own space, so it takes no gap; Thai separates phrases with a
   * space and ends none with a full stop.
   */
  readonly sentenceGap: string;
  readonly fullStop: string;
}

export const LOCALE_METADATA: Record<MvpLocale, LocaleMetadata> = {
  en: {
    nativeName: 'English',
    shortName: 'EN',
    // GB rather than US: the site is shyden.co.uk and the copy is British
    // English throughout.
    flag: 'gb',
    ogLocale: 'en_GB',
    numberLocale: 'en-GB',
    sentenceGap: ' ',
    fullStop: '.',
  },
  id: {
    nativeName: 'Bahasa Indonesia',
    shortName: 'ID',
    flag: 'id',
    ogLocale: 'id_ID',
    numberLocale: 'id-ID',
    sentenceGap: ' ',
    fullStop: '.',
  },
  zh: {
    nativeName: '中文',
    shortName: '中文',
    // Simplified Chinese, so the PRC flag. Operator decision, #21, 2026-09-09.
    flag: 'cn',
    ogLocale: 'zh_CN',
    numberLocale: 'zh-CN',
    sentenceGap: '',
    fullStop: '。',
  },
  vi: {
    nativeName: 'Tiếng Việt',
    shortName: 'VI',
    flag: 'vn',
    ogLocale: 'vi_VN',
    numberLocale: 'vi-VN',
    sentenceGap: ' ',
    fullStop: '.',
  },
  th: {
    nativeName: 'ไทย',
    shortName: 'ไทย',
    flag: 'th',
    ogLocale: 'th_TH',
    numberLocale: 'th-TH',
    sentenceGap: ' ',
    fullStop: '',
  },
};

/**
 * Every served locale's own name for itself, in `LOCALES` order.
 *
 * Derived rather than listed so the homepage marquee cannot name a language
 * the site does not serve, and cannot fall behind one that is added. The
 * approved Aurora artifact writes the list by hand (#17).
 */
export const localeNativeNames = (): string[] =>
  LOCALES.map((locale) => LOCALE_METADATA[locale].nativeName);

export const isMvpLocale = (value: unknown): value is MvpLocale =>
  typeof value === 'string' &&
  (MVP_LOCALES as readonly string[]).includes(value);

/**
 * Metadata for a locale, falling back to the default rather than throwing.
 *
 * Astro hands a component whatever the URL contained. A page that 500s because
 * someone typed `/xx/` is worse than one that renders in English.
 */
export const metadataFor = (locale: unknown): LocaleMetadata =>
  isMvpLocale(locale)
    ? LOCALE_METADATA[locale]
    : LOCALE_METADATA[DEFAULT_LOCALE];
