import { describe, it, expect } from 'vitest';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { stringLeaves } from '../../src/lib/catalogue-leaves';
import { MVP_LOCALES, type MvpLocale } from '../../src/lib/i18n/metadata';
import { en } from '../../src/lib/i18n/en';
import { id } from '../../src/lib/i18n/id';
import { zh } from '../../src/lib/i18n/zh';
import { vi } from '../../src/lib/i18n/vi';
import { th } from '../../src/lib/i18n/th';
import {
  siteEn,
  siteId,
  siteZh,
  siteVi,
  siteTh,
} from '../../src/lib/i18n/site';

/**
 * The site speaks as one person (#665). Shyden is a sole developer, and
 * operator 2026-10-10: "Don't act like a company with more than 1 employee,
 * at least not yet." So no copy, in any language, says "we", "us" or "our":
 * where a person speaks it is "I" and "me", and where the site reports
 * something it names no one ("Those words aren't on this page").
 *
 * Each language spells the first-person plural its own way, so each has its
 * own pattern, read over every string the site ships in that language: the
 * tool catalogue and the site-wide copy together.
 */

const COPY: Readonly<Record<MvpLocale, readonly unknown[]>> = {
  en: [en, siteEn],
  id: [id, siteId],
  zh: [zh, siteZh],
  vi: [vi, siteVi],
  th: [th, siteTh],
};

/** The first-person plural, as each language writes it. */
const WE: Readonly<Record<MvpLocale, RegExp>> = {
  en: /\b(?:we|us|our|ours|ourselves)\b|\bwe['’](?:re|ve|ll|d)\b/i,
  // Indonesian has two: `kami` leaves the reader out, `kita` takes them in.
  id: /\b(?:kami|kita)\b/i,
  zh: /我们|咱们/,
  vi: /chúng (?:tôi|ta|mình)/i,
  // `เรา` is "we/us"; `พวกเรา` contains it.
  th: /เรา/,
};

const FLOOR: Readonly<Record<MvpLocale, string>> = {
  en: 'one-person-voice/strings-en',
  id: 'one-person-voice/strings-id',
  zh: 'one-person-voice/strings-zh',
  vi: 'one-person-voice/strings-vi',
  th: 'one-person-voice/strings-th',
};

describe('the site speaks as one person', () => {
  it('reads every locale the site serves', () => {
    expect(Object.keys(COPY).sort()).toEqual([...MVP_LOCALES].sort());
  });

  for (const locale of MVP_LOCALES) {
    it(`${locale}: no copy speaks as "we"`, () => {
      const strings = COPY[locale].flatMap((table) => stringLeaves(table));
      const plural = strings
        .filter(([, text]) => WE[locale].test(text))
        .map(([path, text]) => `${path}: ${text}`);
      expect(
        searched(plural, { of: strings, what: `${locale} copy strings` }),
      ).toEqual([]);
      expect(floorBreach(FLOOR[locale], strings.length)).toBeUndefined();
    });
  }
});
