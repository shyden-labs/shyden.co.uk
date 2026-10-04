import { isLabel, type BackTranslationUnit } from './back-translate.ts';
import { escapeForRegExp } from './translate.ts';
import { LOCALES, type Locale } from './locales.ts';
import type { SiteStrings } from './site.ts';

/**
 * Short labels, checked against how their own locale renders the same English
 * elsewhere (#161).
 *
 * A label of a word or two carries no context, so a translation engine can
 * resolve it to the wrong sense: `vi.rosterColSex` held `Tình dục` -- sexual
 * intercourse -- as a column heading for a month. The locale's SENTENCES had
 * the context and got the same word right: four of them said `giới tính`. So
 * the question asked here is whether a label's rendering appears anywhere the
 * locale uses the label's English, and a label that appears nowhere it could
 * is flagged for a human.
 *
 * Reading the label back into English cannot ask that question. A wrong sense
 * reads back as the same ambiguous word, and #95 measured it: `Tình dục` scored
 * 100 read back as "Sex", and the `Giới tính` that replaced it scored 9.
 *
 * A witness is copy that says MORE than the label: a sentence, or a longer
 * label ("Exit full screen" judges "Full screen"). Copy with exactly the
 * label's English is no witness, because one engine call rendered both from
 * the same bare source and they agree by construction -- before #252 the CSV
 * header repeated `Tình dục`. Such namesakes are compared with each other
 * instead, and one rendered in other words is a variant: the roster and the
 * CSV naming one column two ways.
 *
 * What it cannot see: a label no other copy in its locale uses (`unchecked`),
 * and a wrong rendering that happens to appear inside a longer word of a
 * witness. Chinese and Thai do not separate words with spaces, so a part of a
 * label is looked for anywhere in a witness rather than word by word.
 *
 * CLI-only, like the `back-translate.ts` it reads its units from.
 */

/** How a label compares with the copy that says more than it does. */
export type LabelStatus = 'agrees' | 'disagrees' | 'unchecked';

export interface CheckedLabel extends BackTranslationUnit {
  /**
   * `agrees` when a witness carries every part of the label's rendering,
   * `disagrees` when there are witnesses and none does, and `unchecked` when
   * there is no witness to compare with.
   */
  readonly status: LabelStatus;
  /**
   * Every other piece of the locale's copy whose English uses the label's
   * English and says more, in the order given.
   */
  readonly witnesses: readonly BackTranslationUnit[];
  /**
   * Every other piece of copy with exactly the label's English whose
   * rendering neither holds the label's nor is held by it, in the order given.
   */
  readonly variants: readonly BackTranslationUnit[];
}

/** A message slot, or a run of punctuation and symbols: never a word. */
const NOT_WORDS = /\{[^{}]*\}|[\p{P}\p{S}]+/gu;

/**
 * The parts of a piece of copy that are words: composed, in lower case, split
 * wherever a slot or punctuation stood. `按……划分` is two parts, `按` and
 * `划分`; a witness must carry both.
 */
export const partsOf = (text: string, locale: Locale): string[] =>
  text
    .normalize('NFC')
    .toLocaleLowerCase(locale)
    .split(NOT_WORDS)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '');

/** The parts of a piece of copy that are words, as one space-joined string. */
export const wordsOf = (text: string, locale: Locale): string =>
  partsOf(text, locale).join(' ');

/**
 * Whether English copy uses a label's English: as whole words, allowing a
 * plural on the last one. `sex` is in "both sexes" and not in "Essex". The
 * English needs no escaping, because `partsOf` removed every character a
 * regular expression treats specially.
 */
const uses = (english: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${english}(?:e?s)?(?![\\p{L}\\p{N}])`, 'u');

/**
 * Whether `outer`'s rendering carries every part of `inner`'s. `[].every` is
 * true, so a rendering left with no words holds nothing and is held by
 * nothing, rather than agreeing with everything.
 */
const holds = (
  outer: BackTranslationUnit,
  inner: BackTranslationUnit,
  locale: Locale,
): boolean => {
  const parts = partsOf(inner.translation, locale);
  const text = wordsOf(outer.translation, locale);
  return parts.length > 0 && parts.every((part) => text.includes(part));
};

/**
 * Every label in `units`, checked against every other unit in `units`. Pass
 * one locale's units, from `backTranslationUnits`: a witness is only evidence
 * about the locale it was written in.
 */
export function checkLabels(
  units: readonly BackTranslationUnit[],
  locale: Locale,
): CheckedLabel[] {
  const copy = units.map((one) => ({
    one,
    english: wordsOf(one.english, 'en'),
  }));
  return copy
    .filter(({ one }) => isLabel(one.english))
    .map(({ one: label, english }) => {
      const others = copy.filter(({ one }) => one !== label);
      const pattern = uses(english);
      // An empty English would find the lone `s` of a possessive everywhere.
      const witnesses =
        english === ''
          ? []
          : others
              .filter((other) => other.english !== english)
              .filter((other) => pattern.test(other.english))
              .map(({ one }) => one);
      const variants = others
        .filter((other) => other.english === english)
        .map(({ one }) => one)
        .filter(
          (other) =>
            !holds(label, other, locale) && !holds(other, label, locale),
        );
      const status: LabelStatus =
        witnesses.length === 0
          ? 'unchecked'
          : witnesses.some((witness) => holds(witness, label, locale))
            ? 'agrees'
            : 'disagrees';
      return { ...label, status, witnesses, variants };
    });
}

/** A sentence that names one or more labels, and whether it carries them. */
export interface LabelReference {
  readonly sentence: BackTranslationUnit;
  /** The labels it names: every label sharing that English, in the order given. */
  readonly labels: readonly BackTranslationUnit[];
  /** Whether its rendering carries every part of one of their renderings. */
  readonly carried: boolean;
}

/** A regular expression matching `text` exactly, as whole words. */
const asWholeWords = (text: string): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeForRegExp(text)}(?![\\p{L}\\p{N}])`,
    'gu',
  );

/**
 * Whether English copy names a label: holds its English with the label's own
 * capitals, where a capital is not simply the start of a sentence. A label of
 * more than one word is a name wherever it stands; a one-word label only
 * after a lower-case word, as in "Select Calculate".
 */
const namesLabel = (sentence: string, label: string): boolean =>
  [...sentence.matchAll(asWholeWords(label))].some(
    ({ index }) =>
      label.includes(' ') || /[\p{Ll},]\s$/u.test(sentence.slice(0, index)),
  );

/**
 * Copy that ends as a sentence does, however short ("Press Make Groups."). A
 * heading of four words ("How to use it") is neither a sentence nor a label,
 * and is not held to a shorter heading inside it.
 */
const isSentence = (english: string): boolean => /[.!?]$/.test(english.trim());

/**
 * The English names of the site's languages, from the platform rather than a
 * list (#403). English capitalises a language's name wherever it stands, so
 * the capital that marks a label marks nothing there: "the Indonesian
 * archipelago" names a place, not the CSV option reading "Indonesian".
 */
const LANGUAGE_NAMES: ReadonlySet<string> = new Set(
  LOCALES.map(
    (locale) =>
      new Intl.DisplayNames('en', { type: 'language' }).of(locale) ?? locale,
  ),
);

/**
 * Every sentence in `units` that names a label, and whether its rendering
 * carries that label's (#390). Pass one locale's units, from
 * `backTranslationUnits`.
 *
 * `checkLabels` asks whether a label's rendering appears ANYWHERE its English
 * is used, so one sentence using a heading's word hides five naming the same
 * section another way: zh told teachers to open 学生详情 six times beside a
 * heading reading 学生信息, and vi and th did the same. A teacher sent to a
 * section or a button looks for the words the sentence gives, on a page
 * showing the label's, so each sentence is held to the label it names.
 *
 * A label names a thing on the page when it starts with a capital and has no
 * slot, and a sentence is copy ending as one does. A label inside a longer
 * label the same sentence names belongs to the longer one ("Groups" in "Make
 * Groups"), and labels sharing an English are one name, so carrying any of
 * their renderings is enough.
 *
 * What it cannot see: a label named in lower case, which reads as the common
 * words ("the class list"), a rendering that carries the label's words inside
 * a different phrase, and a label that is a language's English name, whose
 * capital is grammar (#403): a sentence telling a teacher to choose
 * "Indonesian" is not held to that option's words.
 */
export function checkNamedLabels(
  units: readonly BackTranslationUnit[],
  locale: Locale,
): LabelReference[] {
  const labels = new Map<string, BackTranslationUnit[]>();
  for (const one of units)
    if (
      isLabel(one.english) &&
      !isSentence(one.english) &&
      /^\p{Lu}/u.test(one.english) &&
      !/[{}]/.test(one.english) &&
      !LANGUAGE_NAMES.has(one.english)
    )
      labels.set(one.english, [...(labels.get(one.english) ?? []), one]);
  return units
    .filter(({ english }) => isSentence(english))
    .flatMap((sentence) => {
      const named = [...labels.keys()].filter((label) =>
        namesLabel(sentence.english, label),
      );
      return named
        .filter(
          (label) =>
            !named.some((longer) => longer !== label && longer.includes(label)),
        )
        .map((label) => {
          const sharing = labels.get(label) ?? [];
          return {
            sentence,
            labels: sharing,
            carried: sharing.some((one) => holds(sentence, one, locale)),
          };
        });
    });
}

const CHROME = 'the header or footer of every page';

/**
 * The page each section of `site.ts` renders on. Keyed by every section, so
 * a section added without a page here fails to compile.
 */
const SITE_PAGES: Record<keyof SiteStrings, string> = {
  nav: CHROME,
  menuLabel: CHROME,
  themeDarkMode: CHROME,
  skipToContent: CHROME,
  language: CHROME,
  report: CHROME,
  home: '/',
  glory: '/glory-points',
  notFound: 'the 404 page',
};

/**
 * Where a unit's copy is read, from its key. Unprefixed keys are the
 * classroom-groups catalogue, which only that page reads (`getStrings`).
 */
export function renderedOn(key: string): string {
  if (key.startsWith('csv.')) return 'the CSV file a teacher downloads';
  if (!key.startsWith('site.')) return '/classroom-groups';
  const section = key.slice('site.'.length).split(/[.[ ]/)[0];
  if (!Object.hasOwn(SITE_PAGES, section))
    throw new Error(
      `renderedOn: site.ts has no section "${section}" with a page (${key})`,
    );
  return SITE_PAGES[section as keyof SiteStrings];
}
