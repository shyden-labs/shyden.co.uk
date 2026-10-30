import { describe, it, expect } from 'vitest';
import { nonEmpty, searched } from '../source-files';
import { en, type Catalogue } from '../../src/lib/i18n/en';
import { id } from '../../src/lib/i18n/id';
import { zh } from '../../src/lib/i18n/zh';
import { vi } from '../../src/lib/i18n/vi';
import { th } from '../../src/lib/i18n/th';
import {
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
} from '../../src/lib/i18n/locales';
import { getSiteStrings } from '../../src/lib/i18n';
import { CSV_LOCALES } from '../../src/lib/csv-locale';
import { backTranslationUnits } from '../../src/lib/i18n/back-translate';
import { checkLabels } from '../../src/lib/i18n/label-check';
import { VERIFIED } from '../../src/lib/i18n/verified';

/**
 * The copy the operator read and approved lives in `src/lib/i18n/verified.ts`,
 * where Google's read-back puts it first (#754); its record of why is there.
 */

const CATALOGUES: Record<Locale, Catalogue> = { en, id, zh, vi, th };

/**
 * Only the top-level strings: the nested tables (`errors`, `warnings`) and
 * the lists (`howToSteps`) are not columns. A message is a string too (#136),
 * so a `rosterCol*` key that became one would stay in the derived set below.
 */
const stringsOf = (catalogue: Catalogue): Record<string, string> =>
  Object.fromEntries(
    Object.entries(catalogue).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;

/**
 * The copy at a pinned key, read from the catalogue the key names: `site.`
 * for the page chrome, `csv.` for the words a downloaded file carries, and
 * the page catalogue otherwise. A key that names nothing reads as
 * `undefined`, which no pinned value equals, so a pin that outlives its copy
 * goes red rather than silently asserting nothing.
 */
const copyAt = (locale: Locale, key: string): unknown => {
  const [root, path]: [unknown, string] = key.startsWith('site.')
    ? [getSiteStrings(locale), key.slice('site.'.length)]
    : key.startsWith('csv.')
      ? [CSV_LOCALES[locale], key.slice('csv.'.length)]
      : [CATALOGUES[locale], key];
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<unknown>(
      (table, step) =>
        table !== null && typeof table === 'object'
          ? (table as Record<string, unknown>)[step]
          : undefined,
      root,
    );
};

/**
 * Derived from the catalogue, never listed here. A seventh roster column
 * added next year is covered the day it appears -- it arrives unpinned, the
 * coverage test goes red, and someone has to get its five values read.
 */
const rosterColumnKeys = Object.keys(stringsOf(en))
  .filter((key) => key.startsWith('rosterCol'))
  .sort();

describe('the copy the operator read and approved', () => {
  it('every locale renders the value the operator approved', () => {
    const live = Object.fromEntries(
      LOCALES.map((locale) => [
        locale,
        Object.fromEntries(
          Object.keys(VERIFIED[locale]).map((key) => [
            key,
            copyAt(locale, key),
          ]),
        ),
      ]),
    );

    expect(live).toEqual(VERIFIED);
  });

  it('the pin covers every locale and every roster column, with nothing blank', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual([...LOCALES].sort());
    expect(Object.keys(VERIFIED).sort()).toEqual([...LOCALES].sort());

    // A literal count, against the six columns the design spec names. Counting
    // the array is not counting its content, so the values are checked below.
    expect(
      nonEmpty(rosterColumnKeys, 'rosterCol* keys in the English catalogue'),
    ).toHaveLength(6);

    const unpinned = LOCALES.flatMap((locale) =>
      rosterColumnKeys
        .filter((key) => !Object.hasOwn(VERIFIED[locale], key))
        .map((key) => `${locale} ${key}`),
    );
    expect(
      searched(unpinned, { of: rosterColumnKeys, what: 'roster columns' }),
    ).toEqual([]);

    const values = LOCALES.flatMap((locale) => Object.values(VERIFIED[locale]));
    expect(
      searched(
        values.filter((value) => value.trim() === ''),
        { of: values, what: 'pinned values' },
      ),
    ).toEqual([]);
  });
});

/**
 * Short labels that disagree with their own locale, awaiting the operator's
 * read (#161).
 *
 * `checkLabels` flags a label whose rendering appears in none of the copy that
 * uses its English and says more, and a label whose namesake renders the same
 * English in other words. Every flag is either pinned in `VERIFIED` above --
 * the operator has read that value -- or listed here until he has. A label
 * that starts to disagree, in a re-seeded locale or on the day it is added, is
 * in neither, and this goes red.
 *
 * Exact in both directions: a listed label that stops disagreeing goes red
 * too, so the list cannot outlive what it describes. It emptied when #161's
 * sheet was answered (2026-09-23), each entry moving to a pin or to a
 * corrected catalogue, and it stays as the place a new flag waits while the
 * operator reads it.
 */
const AWAITING_READ: Record<Locale, readonly string[]> = {
  en: [],
  id: [],
  // `site.nav.contact` waited here from #97 (联系我们, "contact us", against
  // the note hint's 联系方式) until #665 made the site speak as one person
  // and the link plain 联系, which agrees with its witness.
  // `groupLabel` 第 {n} 组 (#754): the old {n} 组 read back as "{n} groups"
  // in Google and DeepL; the ordinal 第 reads "Group {n}" in Google, but no
  // witness carries 第, so the check cannot agree with it on its own.
  zh: ['groupLabel'],
  vi: [],
  th: [],
};

// One id per locale: the search below runs once per locale over its own labels.
const WITNESSED_FLOOR: Readonly<Record<string, string>> = {
  id: 'verified-labels/witnessed-labels-id',
  zh: 'verified-labels/witnessed-labels-zh',
  vi: 'verified-labels/witnessed-labels-vi',
  th: 'verified-labels/witnessed-labels-th',
};

describe('short labels that disagree with their own locale', () => {
  // One test per locale (#714): the five in one test reached 71 ms of own CPU
  // on the runner, over the 70 ms cut line under the 0.1 s limit.
  for (const locale of LOCALES)
    it(`${locale}: every one is pinned or awaiting the operator's read`, () => {
      const labels = checkLabels(backTranslationUnits(locale), locale);
      const flagged = labels
        .filter(
          ({ status, variants }) =>
            status === 'disagrees' || variants.length > 0,
        )
        .map(({ key }) => key)
        .filter((key) => !Object.hasOwn(VERIFIED[locale], key));
      if (locale === DEFAULT_LOCALE) {
        expect(flagged).toEqual([...AWAITING_READ[locale]].sort());
        return;
      }
      // A check that stopped finding witnesses would flag nothing, and an
      // emptied list would then agree with it. Only English has no labels.
      const witnessed = labels
        .filter(({ status }) => status !== 'unchecked')
        .map(({ key }) => key);
      expect(
        [
          ...searched(flagged, {
            of: witnessed,
            what: `${locale} labels with a witness`,
          }),
        ].sort(),
      ).toEqual([...AWAITING_READ[locale]].sort());
    });
});

/**
 * Labels no check can judge (#602). `checkLabels` marks a label `unchecked`
 * when no longer copy in its locale uses its words, so it has no witness to
 * disagree with, and the test above never looks at it. That is the class that
 * shipped `Tinh duc`: a bare label with nothing to compare it to. Each
 * unchecked label must be pinned in `VERIFIED` (the operator has read it) or
 * listed here until he does. A NEW unchecked label is in neither and goes red
 * by locale and key. Exact in both directions, so the list only shrinks: a
 * label pinned while still listed goes red too.
 *
 * Derived from `checkLabels`, never typed. #603 read every label that stood on
 * this list with the operator (2026-10-07) and pinned them all, so it is empty
 * and stays as the place a new unchecked label waits while he reads it. English
 * has no labels to judge here.
 */
const UNWITNESSED: Record<'id' | 'zh' | 'vi' | 'th', readonly string[]> = {
  // #636: the Gift Value Calculator heading is new, drafted by DeepL and read
  // back by LibreTranslate, and awaits the operator's read in every locale.
  id: [
    'site.calculators.gift.heading',
    'site.calculators.glory.heading',
    'site.calculators.title',
    'site.home.openCalculators',
  ],
  zh: [
    'site.calculators.gift.heading',
    'site.calculators.glory.heading',
    'site.calculators.title',
    'site.home.openCalculators',
  ],
  // #635: YeeTalk Calculators and "Open the calculators" are new English the
  // operator has not read in these two locales. Awaiting his read, then pinned.
  vi: [
    'site.calculators.gift.heading',
    'site.calculators.title',
    'site.home.openCalculators',
  ],
  th: [
    'site.calculators.gift.heading',
    'site.calculators.title',
    'site.home.openCalculators',
  ],
};

// One id per locale: the search below runs once per locale over its own labels.
const UNWITNESSED_FLOOR: Readonly<Record<keyof typeof UNWITNESSED, string>> = {
  id: 'verified-labels/unwitnessed-labels-id',
  zh: 'verified-labels/unwitnessed-labels-zh',
  vi: 'verified-labels/unwitnessed-labels-vi',
  th: 'verified-labels/unwitnessed-labels-th',
};

describe('short labels no check can judge', () => {
  for (const locale of Object.keys(
    UNWITNESSED,
  ) as (keyof typeof UNWITNESSED)[]) {
    it(`${locale}: every unchecked label is pinned or on the burn-down list`, () => {
      const unwitnessed = checkLabels(backTranslationUnits(locale), locale)
        .filter(({ status }) => status === 'unchecked')
        .map(({ key }) => key);
      const unread = [
        ...searched(
          unwitnessed.filter((key) => !Object.hasOwn(VERIFIED[locale], key)),
          { of: unwitnessed, what: `${locale} unchecked labels` },
        ),
      ].sort();
      expect(unread).toEqual([...UNWITNESSED[locale]].sort());
    });
  }
});
