import { describe, it, expect } from 'vitest';
import { LOCALES, type Locale, getSiteStrings } from '../../src/lib/i18n';
import { searched } from '../source-files';

/**
 * The homepage's English, as the operator approved it for #403 (2026-10-04,
 * asked interactively, tabled in the issue body). Literal pins, never read
 * back from the catalogue: a value compared with the file it came from moves
 * with that file and asserts nothing. zh, vi, th and id are drafted from
 * exactly these words, so a change here is a change to approved copy.
 */
const APPROVED_HOME = {
  description:
    'Small software, made with care. Coming soon: ShyTalk, live rooms for learning a language by speaking it, and Yawelo Idle, an idle game for learning one.',
  heroLead:
    "Coming soon: two new ways to learn a language. Talk it out in ShyTalk's live rooms, or play your way through Yawelo Idle, an idle game where every word you learn carries you further.",
  exploreShytalk: 'Explore ShyTalk',
  exploreYaweloIdle: 'Explore Yawelo Idle',
  comingSoon: 'Coming soon',
  shytalkKicker: 'Learn by talking',
  yaweloIdleKicker: 'Learn by playing',
  yaweloIdleBody:
    'An idle game for learning a real language. Journey across the Indonesian archipelago, or across the English-speaking world, and the words you pick up power the game.',
  yaweloIdleFeature1:
    'Learn Indonesian from English, or English from Indonesian',
  yaweloIdleFeature2: 'Review a word and it grows stronger',
  yaweloIdleFeature3: 'No ads, no energy timers, no paid progress',
  yaweloIdleFeature4: 'Miss a day and lose nothing. Nobody is forced to study.',
  visitYaweloIdle: 'Visit the Yawelo Idle site',
} as const;

describe('the homepage says what the operator approved (#403)', () => {
  for (const [key, english] of Object.entries(APPROVED_HOME))
    it(`en home.${key} is the approved copy`, () => {
      const home: Record<string, string> = getSiteStrings('en').home;
      expect(home[key]).toBe(english);
    });

  it('en nav.yaweloIdle is the product name', () => {
    expect(getSiteStrings('en').nav.yaweloIdle).toBe('Yawelo Idle');
  });
});

/**
 * "First out of the door", "first product" and "The flagship", in the words
 * each language used for them before #403. No product is called first now:
 * both are coming soon, with equal weight (operator, 2026-10-04).
 */
const RETIRED_CLAIMS: Record<Locale, readonly string[]> = {
  en: ['first', 'flagship'],
  id: ['pertama', 'unggulan'],
  zh: ['第一', '旗舰'],
  vi: ['đầu tiên', 'chủ lực'],
  th: ['แรก', 'ผลิตภัณฑ์หลัก'],
};

describe('no product is called first (#403 AC3)', () => {
  for (const locale of LOCALES)
    it(`${locale}: no homepage string calls a product first or the flagship`, () => {
      const values = Object.values(getSiteStrings(locale).home);
      const claims = values.filter((value) =>
        RETIRED_CLAIMS[locale].some((claim) =>
          value.toLowerCase().includes(claim),
        ),
      );
      expect(
        searched(claims, { of: values, what: `${locale} homepage strings` }),
      ).toEqual([]);
    });
});
