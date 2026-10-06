import { describe, it, expect } from 'vitest';
import { nonEmpty, searched } from '../source-files';
import { floorBreach } from '../floors';
import { catalogueLeaves } from '../../src/lib/catalogue-leaves';
import { en } from '../../src/lib/i18n/en';
import { zh } from '../../src/lib/i18n/zh';
import { vi } from '../../src/lib/i18n/vi';
import { th } from '../../src/lib/i18n/th';
import { LOCALES } from '../../src/lib/i18n';
import { isMessageTemplate } from '../../src/lib/i18n/message';
import { needsTranslation } from '../../src/lib/i18n/translate';

/**
 * What is still English in a catalogue that claims to be another language.
 *
 * #22 seeded zh, vi and th from DeepL. Two kinds of key did not come back
 * translated, and both are invisible on the page — a Chinese error message in
 * English looks like a message, not like a gap:
 *
 * 1. THE 51 PARAMETERISED MESSAGES, until #136. Each was an arrow function a
 *    translator could not take, so the scaffold emitted `en.<key>` and the
 *    catalogue carried the English function BY REFERENCE. They are templates
 *    now, drafted by DeepL like the rest of the copy and waiting for a
 *    speaker's review (#161), and none of them may be English.
 *
 * 2. STRINGS DEEPL HANDED BACK UNCHANGED. Mostly legitimate — `M` and `F` are
 *    the roster's sex labels, single letters with nothing to translate — but
 *    `rosterColApart` came back as the English word "Apart" in Chinese, which
 *    is a miss, not a decision.
 *
 * This file is the difference between those being TRACKED and merely being
 * true. The sets are asserted exactly: a new gap fails, and a gap somebody
 * closes also fails until they take it off the list. That is the same
 * contract tests/unit/parked-tests.test.ts holds `test.fixme` to, for the
 * same reason — #32 shipped a real bug behind a comment claiming it was
 * tracked when no ticket existed.
 */

const MACHINE_SEEDED = { zh, vi, th } as const;

/**
 * Locales this file deliberately does not check, and who checks them instead.
 *
 * `en` is the source. `id` is hand-written, and `tests/unit/i18n.test.ts`
 * already asserts its identical-to-English strings against its own
 * `ALLOWED_IDENTICAL` list -- which is where `speedNormal` ("Normal" is the
 * Indonesian word too) is documented. A second list of the same thing here
 * would be a second thing to keep in step, and this repo has been bitten by
 * exactly that. The completeness check below is what stops a locale falling
 * between the two files.
 */
const CHECKED_ELSEWHERE = ['en', 'id'] as const;

/**
 * Every leaf in a catalogue with its value, PROVED non-empty before a guard
 * reads it.
 *
 * Same reasoning as `deepStrings` in i18n.test.ts and as `filesUnder` in
 * tests/source-files.ts: a walker that returns `[]` makes every absence
 * assertion downstream of it pass having read nothing (#84).
 */
const leavesOf = (table: unknown): Array<[string, unknown]> =>
  nonEmpty(catalogueLeaves(table), 'catalogue leaves');

/** The paths of the English leaves `predicate` selects that `table` left as English. */
const sameAsEnglish = (table: unknown, predicate: (v: unknown) => boolean) => {
  const theirs = new Map(catalogueLeaves(table));
  return leavesOf(en)
    .filter(([path, value]) => predicate(value) && theirs.get(path) === value)
    .map(([path]) => path);
};

/** A template string: a message with a slot a page fills (#136). */
const isMessage = (value: unknown): boolean =>
  typeof value === 'string' && isMessageTemplate(value);

/**
 * The English strings each locale still carries, by key.
 *
 * `M` and `F` are the roster's own sex labels. They are single letters with
 * no prose in them, they are what `CSV_LOCALES[locale].sex` must agree with,
 * and DeepL returns them unchanged in every language — so they are expected
 * here rather than a gap. `rosterColApart` in Chinese WAS a genuine miss,
 * left as the English word `Apart`; it was translated on #53 and is pinned
 * by value in `verified-labels.test.ts`, so it is no longer expected here.
 */
const ENGLISH_STRINGS: Record<string, readonly string[]> = {
  zh: ['rosterSexMale', 'rosterSexFemale'],
  vi: ['rosterSexMale', 'rosterSexFemale'],
  th: ['rosterSexMale', 'rosterSexFemale'],
};

describe('what is still English in each catalogue', () => {
  it('accounts for every locale the site serves', () => {
    // A locale in LOCALES that is neither checked here nor named above would
    // simply go unchecked -- the exclusion-list failure this repo has now paid
    // for twice. Adding a sixth language fails here until it is classified.
    expect([...LOCALES].sort()).toEqual(
      [...CHECKED_ELSEWHERE, ...Object.keys(MACHINE_SEEDED)].sort(),
    );
  });

  // One id per locale: each case runs the same line over its own catalogue.
  const ENGLISH_MESSAGES_FLOOR: Readonly<Record<string, string>> = {
    zh: 'locale-fallbacks/english-messages-zh',
    vi: 'locale-fallbacks/english-messages-vi',
    th: 'locale-fallbacks/english-messages-th',
  };
  // One id per locale, for the same reason.
  const LEAF_PATHS_FLOOR: Readonly<Record<string, string>> = {
    zh: 'locale-fallbacks/leaf-paths-zh',
    vi: 'locale-fallbacks/leaf-paths-vi',
    th: 'locale-fallbacks/leaf-paths-th',
  };
  for (const [locale, table] of Object.entries(MACHINE_SEEDED)) {
    it(`${locale}: no message is still English`, () => {
      // Until #136 this pinned all 51 messages as the English function by
      // reference. Messages are templates now, each drafted in the language,
      // so the list is empty and stays empty: a message is never an accepted
      // English leftover, whatever ENGLISH_STRINGS records for a label.
      const messages = leavesOf(en)
        .filter(([, value]) => isMessage(value))
        .map(([path]) => path);
      expect(
        searched(sameAsEnglish(table, isMessage), {
          of: messages,
          what: 'English messages',
        }),
      ).toEqual([]);
      expect(
        floorBreach(ENGLISH_MESSAGES_FLOOR[locale], messages.length),
      ).toBeUndefined();
    });

    it(`${locale}: carries exactly the documented English strings`, () => {
      const stillEnglish = sameAsEnglish(table, needsTranslation).sort();
      expect(
        stillEnglish,
        'an English string appeared in, or disappeared from, this catalogue -- ' +
          'update ENGLISH_STRINGS above so the gap stays tracked',
      ).toEqual([...ENGLISH_STRINGS[locale]].sort());
    });

    it(`${locale}: has no empty or whitespace-only copy`, () => {
      const theirs = new Map(catalogueLeaves(table));
      const paths = leavesOf(en).map(([path]) => path);
      const blank = paths.filter((path) => {
        const value = theirs.get(path);
        return typeof value === 'string' && value.trim() === '';
      });
      expect(
        searched(blank, { of: paths, what: 'catalogue leaf paths' }),
        'a blank string renders as nothing at all',
      ).toEqual([]);
      expect(
        floorBreach(LEAF_PATHS_FLOOR[locale], paths.length),
      ).toBeUndefined();
    });
  }
});
