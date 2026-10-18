import { describe, expect, it } from 'vitest';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { backTranslationUnits } from '../../src/lib/i18n/back-translate';
import { READ_ORDER, type ReadLocale } from '../../src/lib/i18n/read-back';
import { armDrift, editDistance } from '../../src/lib/i18n/arm-drift';

/**
 * #754 AC1. A new arm of a message is the reviewed arm plus the smallest
 * change.
 *
 * No speaker of zh, vi or th is available (operator 2026-09-20), so an arm
 * written from scratch rests on nobody's reading. On #505 the hand-written
 * Thai two-name arms nearly merged that way, and what held was a character
 * diff proving each was the operator-read sentence with only the "all"
 * quantifier changed. This makes that diff a test: every arm of every
 * message is measured against the message's `other` arm, the one every
 * message has, and may drift no further than its recorded allowance.
 */

describe('editDistance: characters changed, by code point', () => {
  it.each([
    ['identical', 'กลุ่ม', 'กลุ่ม', 0],
    ['one inserted', 'abc', 'abxc', 1],
    ['one removed', 'abc', 'ac', 1],
    ['one replaced', 'abc', 'abd', 1],
    ['from nothing', '', 'abc', 3],
    // A Thai tone mark is its own code point: dropping it is one change.
    ['a Thai tone mark', 'กลุ่ม', 'กลุม', 1],
    // An astral character is one code point, not two UTF-16 units.
    ['an astral character', 'a😀b', 'ab', 1],
  ])('%s', (_name, a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance);
  });
});

describe('armDrift: each arm against its message`s other arm', () => {
  it('measures every arm but other, and nothing that is not a message arm', () => {
    expect(
      armDrift([
        { key: 'title', english: 'T', translation: 'x' },
        { key: 'w.A [n=two]', english: 'a', translation: 'abd' },
        { key: 'w.A [n=other]', english: 'b', translation: 'abc' },
        { key: 'w.B [s=M]', english: 'c', translation: 'xyz' },
        { key: 'w.B [s=F]', english: 'c', translation: 'xy' },
        { key: 'w.B [s=other]', english: 'd', translation: 'xy' },
      ]),
    ).toEqual([
      { message: 'w.A', arm: 'two', distance: 1 },
      { message: 'w.B', arm: 'M', distance: 1 },
      { message: 'w.B', arm: 'F', distance: 0 },
    ]);
  });

  it('refuses a message with no other arm', () => {
    expect(() =>
      armDrift([{ key: 'w.A [n=two]', english: 'a', translation: 'a' }]),
    ).toThrow('w.A has no other arm to measure its arms against');
  });
});

/**
 * Each arm's allowance per locale: the characters it was measured to drift
 * from its message's `other` arm when the guard landed (2026-10-15), and why
 * so far. A change that drifts further is either a fresh arm, which needs a
 * reading before its allowance moves, or a correction, listed in its PR.
 */
const ALLOWANCE: Readonly<
  Record<
    string,
    {
      readonly reason: string;
      readonly arms: Readonly<
        Record<string, Readonly<Record<ReadLocale, number>>>
      >;
    }
  >
> = {
  'errors.KEEP_APART_IMPOSSIBLE': {
    reason: 'the two arm says "both" where other says "all" (English 4 apart)',
    arms: { two: { zh: 0, th: 3, id: 2, vi: 4 } },
  },
  'errors.SEX_SEPARATE_SPLITS_UNIT': {
    reason:
      'the two arm drops "all" from "not all the same sex" (English 4 apart)',
    arms: { two: { zh: 2, th: 11, id: 9, vi: 16 } },
  },
  'warnings.PINNED_MIXED_SEX': {
    reason:
      'the two arm drops "all" from "not all the same sex" (English 4 apart)',
    arms: { two: { zh: 2, th: 19, id: 9, vi: 16 } },
  },
  'warnings.SEX_SPILLOVER': {
    reason:
      'boys and girls change places (English 8 apart); vi and th were rewritten as that swap alone (#754)',
    arms: { M: { zh: 9, th: 8, id: 18, vi: 4 } },
  },
  'errors.PINNED_TOO_MANY_GROUPS': {
    reason:
      'three situations, three sentences: the English arms are 76 and 48 characters apart',
    arms: {
      over: { zh: 92, th: 90, id: 95, vi: 98 },
      full: { zh: 60, th: 65, id: 59, vi: 80 },
    },
  },
};

const DRIFT_FLOOR: Readonly<Record<ReadLocale, string>> = {
  zh: 'arm-drift/arms-zh',
  th: 'arm-drift/arms-th',
  id: 'arm-drift/arms-id',
  vi: 'arm-drift/arms-vi',
};

describe('every arm stays within its allowance of the arm it was made from', () => {
  it.each(READ_ORDER)('%s', (locale) => {
    const arms = armDrift(backTranslationUnits(locale));
    const over = arms.filter(
      ({ message, arm, distance }) =>
        distance > (ALLOWANCE[message]?.arms[arm]?.[locale] ?? -1),
    );
    expect(
      searched(over, { of: arms, what: `${locale} message arms` }),
      `${locale}: arms further from their other arm than allowed; read the arm, then correct it or record its allowance with a reason`,
    ).toEqual([]);
    expect(floorBreach(DRIFT_FLOOR[locale], arms.length)).toBeUndefined();
  });

  it.each(READ_ORDER)(
    '%s: every allowance names an arm that exists',
    (locale) => {
      const arms = armDrift(backTranslationUnits(locale)).map(
        ({ message, arm }) => `${message} [${arm}]`,
      );
      const allowed = Object.entries(ALLOWANCE).flatMap(
        ([message, { arms: by }]) =>
          Object.keys(by).map((arm) => `${message} [${arm}]`),
      );
      expect(allowed.sort()).toEqual(arms.sort());
    },
  );

  it('every allowance gives its reason', () => {
    expect(
      Object.entries(ALLOWANCE).map(([message, { reason }]) => [
        message,
        reason.trim().length > 20,
      ]),
    ).toEqual(Object.keys(ALLOWANCE).map((message) => [message, true]));
  });
});
