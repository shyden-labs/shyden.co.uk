import { describe, expect, it } from 'vitest';
import { stringLeaves } from '../../src/lib/catalogue-leaves';
import {
  LOCALES,
  getSiteStrings,
  getStrings,
  type Locale,
} from '../../src/lib/i18n';

/**
 * The site speaks in a neutral voice (#1017).
 *
 * Shyden, 2026-11-02: to the public he is one person, not a team, and the
 * wording must not say he works alone either. Neutral wording first, so no
 * first person at all: no "we", "us" or "our", and no "I", "me" or "my". That
 * covers a teacher's own "I" on a button too ("Keep what I have" became "Keep
 * the current list").
 *
 * Each language lists its own first-person words. Thai and Chinese write no
 * spaces between words, so theirs are matched as text, not as whole words.
 */
const FIRST_PERSON: Readonly<Record<Locale, RegExp>> = {
  en: /\b(I|I'm|I've|I'll|I'd|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself|[Ww]e|[Ww]e're|[Ww]e've|[Ww]e'll|[Uu]s|[Oo]ur|[Oo]urs|[Oo]urselves)\b|\b(the team|solo|just me|one-person|small team|on my own)\b/i,
  id: /\b(saya|aku|kami|kita)\b/i,
  zh: /我/,
  vi: /\b(tôi|chúng tôi|chúng ta|mình)\b/i,
  th: /ฉัน|ผม|ดิฉัน|ข้าพเจ้า|พวกเรา|เรา(?!ะ)/,
};

const leavesOf = (locale: Locale): Array<[string, string]> => [
  ...stringLeaves(getStrings(locale)),
  ...stringLeaves(getSiteStrings(locale)).map(
    ([path, text]): [string, string] => [`site.${path}`, text],
  ),
];

describe('the site copy speaks in a neutral voice (#1017)', () => {
  for (const locale of LOCALES) {
    it(`${locale}: no line speaks in the first person`, () => {
      const leaves = leavesOf(locale);
      expect(leaves.length, 'the catalogues were read').toBeGreaterThan(100);
      const firstPerson = leaves
        .filter(([, text]) => FIRST_PERSON[locale].test(text))
        .map(([path, text]) => `${path}: ${text}`);
      expect(firstPerson).toEqual([]);
    });
  }
});
