import { CSV_LOCALES } from '../csv-locale.ts';
import { en } from './en.ts';
import { id } from './id.ts';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './locales.ts';
import { describeMessage, isMessageTemplate } from './message.ts';
import { siteEn, siteId, siteTh, siteVi, siteZh } from './site.ts';
import { th } from './th.ts';
import { messageUnits, needsTranslation } from './translate.ts';
import { vi } from './vi.ts';
import { zh } from './zh.ts';

/**
 * The decisions the back-translation gate makes, with no I/O in sight. #95.
 *
 * Every translated locale is read back into English by an engine that did
 * NOT write it, and each round trip is scored against the English it came
 * from. zh, vi and th -- and most of id -- were drafted by DeepL
 * (`.translations.json`), so DeepL cannot be the reader: a round trip through
 * the engine that produced the copy agrees with itself and proves nothing.
 *
 * The reader is LibreTranslate, self-hosted in the workflow. Chosen by
 * measurement on 2026-09-23, not by reputation: its Argos models read all four
 * locales into English (v1.9 pairs for id, zh, vi and th); a full run sends
 * about 47,000 characters (243 entries a locale), which no free public API's
 * daily allowance covers, and a CI runner's IP shares that allowance with
 * everyone else on it; and nothing leaves the runner. The numbers are on #95.
 *
 * Advisory by operator decision (2026-09-10): the review is surfaced and no
 * score fails anything. There is no calibration yet for what a normal round
 * trip scores, and a threshold picked now would be a guess with a number in it
 * (#44). What does fail is a run that compared nothing (`livenessProblems`),
 * because an advisory check reading nothing looks exactly like one that found
 * nothing wrong.
 *
 * `scripts/i18n-back-translate.mjs` is the wiring: read, fetch, write. Like
 * `translate.ts`, this module is for the CLI and must stay out of the browser
 * bundle.
 */

/** One piece of copy as the reader receives it. */
export interface BackTranslationUnit {
  /**
   * Where the copy lives, as the i18n guards spell a path (`rosterColSex`,
   * `howToSteps[1]`), with `site.` or `csv.` in front for those catalogues
   * and a message's branch after it: `warnings.SEX_SPILLOVER [sex=M]`.
   */
  readonly key: string;
  readonly english: string;
  readonly translation: string;
}

/** A unit after the round trip, with its score. */
export interface Comparison extends BackTranslationUnit {
  readonly locale: Locale;
  readonly backTranslation: string;
  /** `chrF` of the back-translation against the English, 0 to 100. */
  readonly score: number;
}

/** One entry of LibreTranslate's `GET /languages`, as far as the gate reads it. */
export interface EngineLanguage {
  readonly code: string;
  readonly targets: readonly string[];
}

/** What every locale is read back into. */
const ENGLISH = 'en';

/**
 * Every catalogue the site ships, per locale: the page copy and the chrome
 * around it. Keyed by every locale, English included, so a locale added
 * without its tables fails to compile rather than going unread.
 */
export const CATALOGUES: Record<Locale, { strings: unknown; site: unknown }> = {
  en: { strings: en, site: siteEn },
  id: { strings: id, site: siteId },
  zh: { strings: zh, site: siteZh },
  vi: { strings: vi, site: siteVi },
  th: { strings: th, site: siteTh },
};

/** Every locale that has a translation to read back. */
export const TRANSLATED_LOCALES: readonly Locale[] = LOCALES.filter(
  (locale) => locale !== DEFAULT_LOCALE,
);

/**
 * The third catalogue: the words a downloaded CSV carries, less its `sex`
 * letters. Those are the roster's own `rosterSexMale` and `rosterSexFemale`
 * (`tests/unit/csv.test.ts` holds them equal), which the roster rows already
 * read back, so reading them again here would only list them twice.
 */
const csvCopy = (locale: Locale): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(CSV_LOCALES[locale]).filter(([key]) => key !== 'sex'),
  );

/** Every unit of one locale, from all three catalogues. */
export function backTranslationUnits(locale: Locale): BackTranslationUnit[] {
  if (locale === DEFAULT_LOCALE) return [];
  const ours = CATALOGUES[DEFAULT_LOCALE];
  const theirs = CATALOGUES[locale];
  return [
    ...unitsBetween(ours.strings, theirs.strings),
    ...unitsBetween(ours.site, theirs.site, 'site'),
    ...unitsBetween(csvCopy(DEFAULT_LOCALE), csvCopy(locale), 'csv'),
  ];
}

/**
 * Walk the English table and pair each piece of copy with the translation at
 * the same path.
 *
 * Only what a translator took is sent: copy with a letter in it
 * (`needsTranslation`), whose translation is a string that differs from the
 * English. Copy left in English -- a brand name, "OK" -- would only be read
 * back as itself.
 */
export function unitsBetween(
  english: unknown,
  translated: unknown,
  prefix = '',
): BackTranslationUnit[] {
  if (Array.isArray(english))
    return english.flatMap((value, index) =>
      unitsBetween(
        value,
        Array.isArray(translated) ? translated[index] : undefined,
        `${prefix}[${index}]`,
      ),
    );
  if (english && typeof english === 'object') {
    const theirs: Record<string, unknown> =
      translated && typeof translated === 'object' ? { ...translated } : {};
    return Object.entries(english).flatMap(([key, value]) =>
      unitsBetween(value, theirs[key], prefix ? `${prefix}.${key}` : key),
    );
  }
  if (
    !needsTranslation(english) ||
    typeof translated !== 'string' ||
    translated === english
  )
    return [];
  if (!isMessageTemplate(english))
    return [{ key: prefix, english, translation: translated }];
  return messagePairs(prefix, english, translated);
}

/** A message's sentences, keyed by the branch of its choice that says each. */
function sentencesByBranch(template: string): {
  choice?: string;
  sentences: Map<string, string>;
} {
  const sentences = messageUnits(template);
  const select = describeMessage(template).selects[0];
  if (!select) return { sentences: new Map([['', sentences[0]]]) };
  if (select.keys.length !== sentences.length)
    throw new Error(
      `${JSON.stringify(template)} has ${select.keys.length} branches of {${select.name}} and ${sentences.length} sentences`,
    );
  return {
    choice: select.name,
    sentences: new Map(
      select.keys.map((branch, at) => [branch, sentences[at]]),
    ),
  };
}

/**
 * A message as the sentences it can say, each paired with the translation of
 * the SAME branch. A locale may write its branches in any order (`other`
 * before `M`), and pairing by position would score the sentence about girls
 * against the English about boys.
 */
function messagePairs(
  key: string,
  english: string,
  translated: string,
): BackTranslationUnit[] {
  const ours = sentencesByBranch(english);
  const theirs = sentencesByBranch(translated);
  const describe = (side: typeof ours) =>
    side.choice === undefined
      ? 'makes no choice'
      : `chooses by {${side.choice}} from ${[...side.sentences.keys()].join(', ')}`;
  const mismatch = () =>
    new Error(
      `${key}: the English ${describe(ours)}; the translation ${describe(theirs)}`,
    );
  if (
    ours.choice !== theirs.choice ||
    ours.sentences.size !== theirs.sentences.size
  )
    throw mismatch();
  const units: BackTranslationUnit[] = [];
  for (const [branch, sentence] of ours.sentences) {
    const translation = theirs.sentences.get(branch);
    if (translation === undefined) throw mismatch();
    units.push({
      key:
        ours.choice === undefined ? key : `${key} [${ours.choice}=${branch}]`,
      english: sentence,
      translation,
    });
  }
  return units;
}

/** A message slot (`{names}`), which is not copy on either side. */
const SLOT = /\{[^{}]*\}/g;

/**
 * A unit as the engine is sent it: without its slots.
 *
 * The score leaves slots out on both sides, and the engine mangles them: on
 * 24 historical corrections (2026-09-23) `{on}` came back as `MHon}` and `{n}`
 * as `(3nd)`, debris in 13 of the pairs, and in none once slots were left out.
 * A slot sent is noise and nothing else.
 */
export const sendable = (text: string): string =>
  text.replace(SLOT, ' ').replace(/\s+/g, ' ').trim();
/** Punctuation, symbols and spacing: a full stop Thai does not write is not drift. */
const NOT_COMPARED = /[\p{P}\p{S}\s]/gu;
/** chrF's standard reach: character n-grams of one to six. */
const MAX_ORDER = 6;
/** chrF2: recall weighs four times precision, so dropped meaning costs most. */
const BETA_SQUARED = 4;

/** The characters compared, by code point, never by UTF-16 unit. */
const comparable = (text: string): string[] =>
  Array.from(
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(SLOT, '')
      .replace(NOT_COMPARED, ''),
  );

function nGrams(
  characters: readonly string[],
  order: number,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (let at = 0; at + order <= characters.length; at++) {
    const gram = characters.slice(at, at + order).join('');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * chrF (Popović 2015) of a back-translation against its English, 0 to 100.
 *
 * Character n-grams rather than words, because a back-translation rarely
 * finds the same word and often finds the same stem ("pupil"/"pupils"), and
 * because it needs no tokeniser for any language. Computed as sacreBLEU does
 * with its defaults: orders one to six, beta 2, averaged over the orders both
 * texts are long enough to have. Case, punctuation, spacing and message slots
 * are left out on both sides, since none of them is meaning.
 */
export function chrF(reference: string, hypothesis: string): number {
  const ours = comparable(reference);
  const theirs = comparable(hypothesis);
  let precision = 0;
  let recall = 0;
  let orders = 0;
  for (let order = 1; order <= MAX_ORDER; order++) {
    const oursTotal = ours.length - order + 1;
    const theirsTotal = theirs.length - order + 1;
    if (oursTotal <= 0 || theirsTotal <= 0) continue;
    const oursGrams = nGrams(ours, order);
    let matched = 0;
    for (const [gram, count] of nGrams(theirs, order))
      matched += Math.min(count, oursGrams.get(gram) ?? 0);
    precision += matched / theirsTotal;
    recall += matched / oursTotal;
    orders += 1;
  }
  if (orders === 0) return ours.join('') === theirs.join('') ? 100 : 0;
  precision /= orders;
  recall /= orders;
  if (precision === 0 && recall === 0) return 0;
  return (
    (100 * (1 + BETA_SQUARED) * precision * recall) /
    (BETA_SQUARED * precision + recall)
  );
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The review's order: lowest score first, then locale, then key. */
export const worstFirst = (comparisons: readonly Comparison[]): Comparison[] =>
  [...comparisons].sort(
    (a, b) =>
      a.score - b.score || byText(a.locale, b.locale) || byText(a.key, b.key),
  );

/**
 * Why a run cannot be believed, one line per locale, or none.
 *
 * A locale fails when it compared nothing, or when not one of its
 * back-translations came back with text in it -- counted by content, because
 * a list of empty strings is still a list (#112). A single empty answer among
 * real ones is not a failure: it scores 0 and heads the review.
 */
export function livenessProblems(
  locales: readonly Locale[],
  comparisons: readonly Comparison[],
): string[] {
  return locales.flatMap((locale) => {
    const mine = comparisons.filter((row) => row.locale === locale);
    if (mine.length === 0)
      return [
        `${locale}: nothing was compared -- no translated copy was read back`,
      ];
    const answered = mine.filter((row) => row.backTranslation.trim() !== '');
    return answered.length === 0
      ? [
          `${locale}: none of ${mine.length} back-translations came back with any text`,
        ]
      : [];
  });
}

/**
 * The languages an answer to `GET /languages` offers, checked rather than
 * trusted: an engine that answers with something else fails here, naming what
 * it said, instead of three calls later as a missing property.
 */
export function engineLanguages(response: unknown): EngineLanguage[] {
  const isLanguage = (entry: unknown): entry is EngineLanguage => {
    if (!entry || typeof entry !== 'object') return false;
    const { code, targets }: Record<string, unknown> = { ...entry };
    return (
      typeof code === 'string' &&
      Array.isArray(targets) &&
      targets.every((target) => typeof target === 'string')
    );
  };
  if (!Array.isArray(response) || !response.every(isLanguage))
    throw new Error(
      `expected GET /languages to answer a list of { code, targets }, got ${String(
        JSON.stringify(response),
      ).slice(0, 200)}`,
    );
  return response.map(({ code, targets }) => ({ code, targets: [...targets] }));
}

/** The script a language is written in, if `Intl` knows it. */
function scriptOf(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).maximize().script;
  } catch {
    return undefined;
  }
}

/**
 * The engine's code for a locale, among the languages it can read into
 * English: the locale's own code, or else the one code for that language in
 * the script the locale is written in. An engine that splits Chinese into
 * `zh-Hans` and `zh-Hant` must be asked for Simplified, which is what `zh`
 * maximises to and what the site ships. Two codes in that script (`zh-Hans`
 * and `zh-Hans-CN`) are refused as a question only a person can answer.
 */
export function engineSource(
  locale: Locale,
  offered: readonly EngineLanguage[],
): string {
  const readable = offered.filter(({ targets }) => targets.includes(ENGLISH));
  if (readable.some(({ code }) => code === locale)) return locale;
  const script = scriptOf(locale);
  const candidates = readable.filter(
    ({ code }) => code.split('-')[0] === locale && scriptOf(code) === script,
  );
  if (candidates.length > 1)
    throw new Error(
      `${locale}: the engine offers ${candidates
        .map(({ code }) => code)
        .join(
          ', ',
        )} for ${locale} in the ${script} script, and the gate will not guess which`,
    );
  if (candidates.length === 0)
    throw new Error(
      `${locale}: the engine cannot read ${locale} into English; it reads ${
        readable.map(({ code }) => code).join(', ') || 'nothing'
      }`,
    );
  return candidates[0].code;
}

/** The JSON body of one `POST /translate`: a batch, read back into English. */
export const libreTranslateBody = (
  texts: readonly string[],
  source: string,
  apiKey?: string,
): Record<string, unknown> => ({
  q: [...texts],
  source,
  target: ENGLISH,
  format: 'text',
  ...(apiKey ? { api_key: apiKey } : {}),
});

/**
 * The back-translations in an answer, checked rather than trusted: one string
 * per text sent, or an error naming what came back instead.
 */
export function translatedTexts(response: unknown, expected: number): string[] {
  const answer: Record<string, unknown> =
    response && typeof response === 'object' ? { ...response } : {};
  if (typeof answer.error === 'string')
    throw new Error(`the engine refused: ${answer.error}`);
  const texts = answer.translatedText;
  if (!Array.isArray(texts) || !texts.every((text) => typeof text === 'string'))
    throw new Error(
      `expected translatedText to be a list of ${expected} strings, got ${String(
        JSON.stringify(texts),
      ).slice(0, 200)}`,
    );
  if (texts.length !== expected)
    throw new Error(
      `expected ${expected} translatedText entries, got ${texts.length}`,
    );
  return texts;
}

/**
 * Where the engine is, from the environment. A missing or malformed address
 * throws: a gate with no engine must fail, not report zero comparisons.
 */
export function engineConfig(
  env: Readonly<Record<string, string | undefined>>,
): {
  url: string;
  apiKey?: string;
} {
  const raw = env.BACK_TRANSLATE_URL ?? '';
  let protocol = '';
  try {
    protocol = new URL(raw).protocol;
  } catch {
    protocol = '';
  }
  if (protocol !== 'http:' && protocol !== 'https:')
    throw new Error(
      `BACK_TRANSLATE_URL must be the engine's http(s) address, e.g. http://localhost:5000; got ${JSON.stringify(raw)}`,
    );
  const apiKey = env.BACK_TRANSLATE_API_KEY;
  return { url: raw.replace(/\/+$/, ''), ...(apiKey ? { apiKey } : {}) };
}

/**
 * The engine's name for the review: `BACK_TRANSLATE_ENGINE` when a run names
 * one, otherwise the LibreTranslate tag the repo's Dockerfile builds.
 *
 * Read from the Dockerfile rather than typed into the workflow (#390 F75):
 * `back-translation.yml` said `LibreTranslate v1.9.6` by hand, while
 * Dependabot bumps the image's tag in the Dockerfile, so the first bump would
 * have published reviews naming an engine that never ran. A Dockerfile that
 * names no libretranslate image throws: the label is then unknowable, and a
 * review that guessed it would be the same defect.
 */
export function engineName(
  env: Readonly<Record<string, string | undefined>>,
  dockerfile: string,
): string {
  const named = env.BACK_TRANSLATE_ENGINE;
  if (named) return named;
  // A FROM instruction opens its line; a commented-out one does not count.
  const tag = /^[ \t]*FROM[ \t]+libretranslate\/libretranslate:([^@\s]+)/m.exec(
    dockerfile,
  )?.[1];
  if (tag === undefined)
    throw new Error(
      'the Dockerfile names no libretranslate/libretranslate image, so the ' +
        'review cannot say which engine read it back; set BACK_TRANSLATE_ENGINE',
    );
  return `LibreTranslate ${tag}`;
}

/**
 * Labels are reviewed apart from sentences, at the house rule's boundary:
 * since #114 every label of three words or fewer is audited separately from
 * prose. Measured on #95, this is where the score misleads. Read back word
 * for word, a correct synonym scores near 0 and a homonym defect can score
 * 100 -- the vi and zh "Sex" fixes of 2026-09-20 both scored 100 before and
 * 9 after.
 */
const LABEL_WORDS = 3;
export const isLabel = (english: string): boolean =>
  english
    .replace(SLOT, ' ')
    .split(/\s+/)
    .filter((token) => /\p{L}/u.test(token)).length <= LABEL_WORDS;
const LABEL_CAVEAT =
  'Read back word for word, a correct label can score near 0 and a wrong one 100: `Giới tính` (gender) reads back as *Gender* for *Sex* and scores 9, where the `Tình dục` (sexual intercourse) it replaced read back as *Sex* and scored 100. Judge these by eye; the order is only a place to start (#95, #161).';

/** A value inside one Markdown table cell, whatever characters it carries. */
export const cell = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ');

/** Rows as a review table, in the order given. */
const table = (rows: readonly Comparison[]): string[] => [
  '| chrF | key | English | translation | back-translation |',
  '| ---: | --- | --- | --- | --- |',
  ...rows.map(
    (row) =>
      `| ${Math.round(row.score)} | \`${row.key}\` | ${cell(row.english)} | ${cell(row.translation)} | ${cell(row.backTranslation)} |`,
  ),
];

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The review: a section per locale with every comparison side by side, worst
 * first, collapsed so the job summary opens on the counts.
 */
export function reviewMarkdown(
  comparisons: readonly Comparison[],
  locales: readonly Locale[],
  engine: string,
): string {
  const sections = locales.map((locale) => {
    const rows = worstFirst(comparisons.filter((row) => row.locale === locale));
    if (rows.length === 0)
      return `<details><summary>${locale} — 0 compared</summary>\n\nNothing was read back.\n\n</details>`;
    const scores = rows.map(({ score }) => score);
    const heading = `${locale} — ${rows.length} compared, lowest ${Math.round(scores[0])}, median ${Math.round(median(scores))}`;
    const sentences = rows.filter((row) => !isLabel(row.english));
    const labels = rows.filter((row) => isLabel(row.english));
    return [
      `<details><summary>${heading}</summary>`,
      '',
      ...(sentences.length > 0
        ? ['#### Sentences, worst first', '', ...table(sentences), '']
        : []),
      ...(labels.length > 0
        ? [
            '#### Labels of three words or fewer',
            '',
            LABEL_CAVEAT,
            '',
            ...table(labels),
            '',
          ]
        : []),
      '</details>',
    ].join('\n');
  });
  return [
    '## Back-translation review',
    '',
    `Every translated locale, read back into English by **${engine}**, which did not write it. The score is chrF, 0 to 100: how much of the English's character sequences the round trip kept. Advisory: nothing fails on a score (#95). Sentences are listed worst first; labels are listed apart, because the score cannot judge them.`,
    '',
    ...sections.flatMap((section) => [section, '']),
  ].join('\n');
}
