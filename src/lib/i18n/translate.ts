import type { MvpLocale } from './metadata';
// With their extensions: the DeepL scripts load this module under plain Node,
// which resolves nothing without one.
import { catalogueLeaves } from '../catalogue-leaves.ts';
import { CSV_LOCALES } from '../csv-locale.ts';
import { en } from './en.ts';
import {
  MessageSyntaxError,
  describeMessage,
  isMessageTemplate,
  parseMessage,
  type MessagePart,
} from './message.ts';
import { siteEn } from './site.ts';

/**
 * The decisions the DeepL harness makes, with no I/O in sight.
 *
 * `scripts/i18n-translate.mjs` reads files, calls the API and writes the
 * result; everything it has to be RIGHT about is here, where it can be tested
 * without a key, without a network, and without spending a character of a
 * free-tier quota. Same split CLAUDE.md already requires of `gloryPoints.ts`
 * and `grouping.ts` against the page scripts.
 *
 * Built for #21 Stage 5 and run first by #22, which drafted zh, vi and th.
 *
 * This module is CLI-only and must stay out of the browser bundle, which
 * `tests/unit/translate.test.ts` asserts by scanning `src/` for importers.
 */

/**
 * DeepL's two hosts, and why the key decides.
 *
 * A Free-plan key ends `:fx` and is REJECTED by `api.deepl.com` — a 403, not
 * a redirect and not a failover. Getting this wrong is a whole run that
 * translates nothing and looks like an auth problem.
 */
const FREE_HOST = 'https://api-free.deepl.com';
const PRO_HOST = 'https://api.deepl.com';
const FREE_KEY_SUFFIX = ':fx';

/**
 * The endpoint for a given key. Never the key itself.
 *
 * DeepL authenticates with an `Authorization: DeepL-Auth-Key` header, so the
 * key has no business in a URL — a URL reaches logs, CI output and the text
 * of any error thrown around it, and this is the one place it could leak by
 * accident.
 *
 * Trimmed before the suffix test: `DEEPL_API_KEY=abc:fx` read from a real
 * `.env.local` carries a trailing newline, and `endsWith(':fx')` is false for
 * `'abc:fx\n'` — a Free key quietly sent to the paid host.
 */
export function deeplEndpoint(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) {
    // Deliberately says nothing about the value it was given.
    throw new Error(
      'DEEPL_API_KEY is empty — set it in .env.local (Free plan keys end :fx)',
    );
  }
  const host = key.endsWith(FREE_KEY_SUFFIX) ? FREE_HOST : PRO_HOST;
  return `${host}/v2/translate`;
}

/**
 * What DeepL calls each of our languages.
 *
 * Variants are named rather than left to a default. `EN` resolves to American
 * English at DeepL and this site is British throughout (CLAUDE.md; `en_GB` in
 * LOCALE_METADATA). `ZH` is Simplified today, and the ticket asks for
 * Simplified — `ZH-HANS` says so rather than relying on that staying true.
 */
const DEEPL_LANGUAGE: Record<MvpLocale, string> = {
  en: 'EN-GB',
  id: 'ID',
  zh: 'ZH-HANS',
  vi: 'VI',
  th: 'TH',
};

export const deeplLanguage = (locale: MvpLocale): string =>
  DEEPL_LANGUAGE[locale];

/**
 * The locales the harness will accept as a target, READ OFF the table above.
 *
 * Not a second copy of `MVP_LOCALES`. `DEEPL_LANGUAGE` is typed
 * `Record<MvpLocale, string>`, so a locale missing from it is a type error and
 * a locale added to it that is not an MvpLocale is too — the keys cannot drift
 * from the source list, and `tests/unit/translate.test.ts` checks the pair
 * anyway.
 *
 * It exists because `scripts/i18n-translate.mjs` runs under plain Node, which
 * will not resolve `metadata.ts`'s own extensionless `'./index'` import. This
 * module imports `MvpLocale` as a TYPE, which is stripped, so it loads on its
 * own — and the script gets the list without a build step.
 */
export const TRANSLATABLE_LOCALES = Object.keys(DEEPL_LANGUAGE) as MvpLocale[];

/**
 * Never sent to a translator, in any language.
 *
 * Two kinds of thing: names, which are the same word everywhere, and legal
 * facts, which are not copy at all. A translated company number is a wrong
 * company number, and "Glory Points" is the name of a feature a teacher will
 * look for in the interface — translating it in the docs and not in the UI is
 * how a term stops matching itself.
 *
 * DeepL honours these through its `ignore_tags` / glossary features; the
 * script wraps each occurrence before sending. The list is here so it is
 * reviewable in one place rather than spread through the caller.
 */
export const DO_NOT_TRANSLATE: readonly string[] = [
  'Shyden',
  'ShyTalk',
  'Glory Points',
  // The game's name (#552). "Idle" is an English word DeepL would otherwise
  // translate.
  'Yawelo Idle',
  // 'Shyden Ltd', the company number and 'England & Wales' left with the
  // footer's disclosure (#370): the company is dissolved, and a term no
  // sentence carries protects nothing. translate.test.ts holds every term
  // here to a sentence the site still sends.
];

/**
 * The tag name DeepL is told to leave alone, in `ignore_tags`.
 *
 * One letter because it travels inside the copy and DeepL bills per
 * character. Defined once and used by both the wrapping and the request, so
 * the two cannot drift -- a request ignoring `<keep>` while the text carried
 * `<x>` would translate the term and look fine.
 */
const PROTECT_TAG = 'x';

/** `text` as a regular expression that matches it literally. */
export const escapeForRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * XML escaping, because the request asks for `tag_handling: 'xml'`.
 *
 * DeepL parses the text as XML when tag handling is on, so a bare `&` is a
 * malformed entity and the whole request comes back `400` -- which is exactly
 * what #22's first run of the widened catalogue did, on the footer's
 * "Registered in England & Wales." Escaping is the fix rather than banning
 * the character: an ampersand is correct English and copy should not bend to
 * a transport detail.
 *
 * `&` first on the way out and last on the way back, or the escaping eats its
 * own output (`&lt;` -> `&amp;lt;`) and the round trip stops being one.
 */
export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const unescapeXml = (text: string): string =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Wrap every protected term so DeepL returns it untouched.
 *
 * #22 found this missing entirely: `DO_NOT_TRANSLATE` was imported by the
 * script, its LENGTH printed ("do-not-send 6 protected terms"), and the batch
 * sent raw. `ignore_tags: ['x']` rode on every request and no `<x>` was ever
 * emitted, so the list protected nothing. The zh/vi/th run returned "Shyden"
 * intact in all three languages by DeepL's own proper-noun handling -- luck,
 * not a control, and luck that runs out the first time someone writes "Glory
 * Points" into the catalogue. Only one protected term occurred in the copy of
 * the day, which is why nothing looked wrong.
 *
 * One pass over the text with every term in one alternation, longest first.
 * A regular expression tries its alternatives in order at each position, so
 * where one term starts another (`Shyden` of `Shyden Studio`) the longer
 * wins, and a matched span is consumed whole, so no term is ever wrapped
 * inside another. A loop over the terms, one replacement each, wrapped a
 * shorter term again wherever it sat in the middle of a longer one (#390).
 *
 * `terms` defaults to the shipped list. It is a parameter so longest-first
 * stays provable when the shipped list holds no pair that overlaps, as it has
 * not since #370. An empty term matches everywhere and protects nothing, so it
 * is dropped.
 */
export function protectTerms(
  text: string,
  terms: readonly string[] = DO_NOT_TRANSLATE,
): string {
  // Each term is escaped the same way the text was, or a name carrying an
  // ampersand ("Salt & Pepper") never matches the escaped copy it sits in.
  const alternatives = terms
    .filter((term) => term !== '')
    .sort((a, b) => b.length - a.length)
    .map((term) => escapeForRegExp(escapeXml(term)));
  if (alternatives.length === 0) return text;
  return text.replace(
    new RegExp(alternatives.join('|'), 'g'),
    (term) => `<${PROTECT_TAG}>${term}</${PROTECT_TAG}>`,
  );
}

/**
 * Take the tags back out of what DeepL returned.
 *
 * The prose around a protected term changes; the tag survives the round trip
 * verbatim, so stripping it recovers the string a catalogue should hold.
 */
export const unprotectTerms = (text: string): string =>
  text.replace(new RegExp(`</?${PROTECT_TAG}>`, 'g'), '');

/**
 * The drafts in a DeepL answer, checked rather than trusted, then unwrapped.
 *
 * The script pairs each draft with the sentence sent in the same position, so
 * an answer one short would put every later draft on the wrong English, and
 * each would still read as a good sentence. So the count must equal the texts
 * sent, and every entry must carry a string. The errors name the shape, never
 * the content: the script reports a failed request by its status alone,
 * because a DeepL answer can echo the request.
 */
export function deeplDrafts(response: unknown, expected: number): string[] {
  const translations =
    response && typeof response === 'object' && 'translations' in response
      ? response.translations
      : undefined;
  if (!Array.isArray(translations))
    throw new Error('DeepL answered without a list of translations');
  if (translations.length !== expected)
    throw new Error(
      `DeepL returned ${translations.length} translations for ${expected} texts`,
    );
  return translations.map((entry: unknown, index) => {
    const text =
      entry && typeof entry === 'object' && 'text' in entry
        ? entry.text
        : undefined;
    if (typeof text !== 'string')
      throw new Error(`translation ${index} has no text`);
    return unescapeXml(unprotectTerms(text));
  });
}

/** A slot in a sentence: `{names}`, `{n}`. */
const SLOT = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;

/** Every slot wrapped in the tag DeepL ignores, for a retry (`betterDraft`). */
const tagEverySlot = (text: string): string =>
  text.replace(SLOT, (slot) => `<${PROTECT_TAG}>${slot}</${PROTECT_TAG}>`);

/**
 * The exact JSON body of a translate request.
 *
 * Here rather than in the script for the reason every other decision is: this
 * is the thing that has to be RIGHT, and in the script it could only be
 * checked by making a network call. `tests/unit/translate.test.ts` asserts the
 * text it carries is protected -- the assertion that was missing while the
 * list sat unused.
 */
export function buildRequestBody(
  texts: readonly string[],
  target: MvpLocale,
  { tagSlots = false }: { readonly tagSlots?: boolean } = {},
): {
  text: string[];
  source_lang: string;
  target_lang: string;
  ignore_tags: string[];
  tag_handling: string;
} {
  return {
    text: texts.map((t) => {
      const text = protectTerms(escapeXml(t));
      return tagSlots ? tagEverySlot(text) : text;
    }),
    source_lang: 'EN',
    target_lang: deeplLanguage(target),
    ignore_tags: [PROTECT_TAG],
    tag_handling: 'xml',
  };
}

/** A letter in any script — Latin, Han, Thai. Not a digit and not punctuation. */
const HAS_A_LETTER = /\p{L}/u;

/**
 * Whether a catalogue entry is something a translator can take.
 *
 * Three things are excluded, each for its own reason:
 *
 * - **Anything that is not a string.** A function is code, and a translator
 *   returns prose, not a function body. No catalogue holds one since #136:
 *   every parameterised message is a template string, sent as the sentences
 *   it can say (`translationUnits`).
 * - **Empty strings**, which have nothing to translate.
 * - **Punctuation and symbols.** `rosterColNumber` is `#` and `—` is a dash;
 *   neither carries a language, and both are already accepted as legitimately
 *   identical in `tests/unit/i18n.test.ts`. Sending them wastes quota and
 *   invites a translator to "helpfully" change them.
 */
export const needsTranslation = (value: unknown): value is string =>
  typeof value === 'string' && HAS_A_LETTER.test(value);

/**
 * What the harness sends for one catalogue entry: copy as it is, a message as
 * the sentences it can say, and nothing for a symbol or a non-string.
 */
export function translationUnits(value: unknown): string[] {
  if (!needsTranslation(value)) return [];
  return isMessageTemplate(value) ? messageUnits(value) : [value];
}

/**
 * Every distinct sentence the harness sends, from every English catalogue the
 * site ships. One home since #164, for two readers that must agree:
 * `scripts/i18n-translate.mjs` sends from it and prunes the cache to it, and
 * `tests/unit/translate.test.ts` fails when the committed cache holds a draft
 * outside it.
 *
 * `en` alone was the whole collection until #22, which is how the header,
 * footer, homepage and 404 copy came to be invisible to the translator: they
 * live in `site.ts`. The CSV vocabulary is the third catalogue: every word a
 * downloaded file carries has to match the language of the page it came
 * from, which makes it copy. Its `sex` letters go too: `M` and `F` are also
 * `en.rosterSexMale` and `rosterSexFemale`, the letters the roster table
 * shows, and `tests/unit/csv.test.ts` holds each locale's pair equal. A
 * hold-back here (`CSV_KEYS_NOT_TRANSLATED`, until #390) kept nothing from
 * the translator, because the same two strings arrived from `en`.
 *
 * A Set: the same word appears under several keys, and DeepL charges per
 * character sent, not per distinct string.
 */
export function translatableSentences(): ReadonlySet<string> {
  return new Set(
    [en, siteEn, CSV_LOCALES.en].flatMap((table) =>
      catalogueLeaves(table).flatMap(([, value]) => translationUnits(value)),
    ),
  );
}

/**
 * A message as a translator can take it, and how it is put back. #136.
 *
 * Template syntax is not prose: sent whole, DeepL translates "other", moves
 * the braces and returns something no parser accepts. So a message is sent as
 * the whole sentences it can say, every slot a `{name}` placeholder, and
 * rebuilt around the translations that come back.
 *
 * - A plural is sent as its "other" sentence, with `#` written as the slot it
 *   counts. Every language drafted so far has "other" alone, and
 *   `assembleMessage` refuses one that has more.
 * - A choice (`select`) is sent as one whole sentence per branch, so each
 *   reaches the translator with its context rather than as a fragment.
 *
 * Slots travel as bare `{name}` text first. Measured on DeepL (2026-09-13)
 * over all 162 message sentences in zh, vi and th: inside the tag that
 * protects a name, a slot was glued to the word beside it in 44 and once cut
 * a letter from it; bare, 3 were glued but 7 lost a slot. So a bare draft that
 * changed a slot is sent again tagged and the better draft kept (`slotsKept`,
 * `betterDraft`), and anything still changed is refused by `assembleMessage`.
 *
 * A message making more than one choice, or a plural with an exact-match
 * branch (`=0`), is refused. Neither occurs in the catalogues, and a guess at
 * how to rebuild one would be a draft nobody could trust.
 */
export const messageUnits = (template: string): string[] => [
  ...draft(template).sentences,
];

/**
 * The message in the target language, rebuilt from its translated sentences.
 *
 * Checked, never trusted: a translation that drops `{names}` still reads as a
 * good sentence, just without the pupils in it. Throws when a sentence has no
 * translation, when a translation fills different slots from its sentence
 * (lost, invented or repeated), when it is not a template at all, and when the
 * language has plural forms beyond "other" that a draft cut from "other" would
 * get wrong. `pluralCategories` is the language's `Intl.PluralRules`
 * categories, passed in so this stays a function of its arguments.
 */
export function assembleMessage(
  template: string,
  translationOf: (sentence: string) => string | undefined,
  pluralCategories: readonly string[],
): string {
  if (
    describeMessage(template).plurals.length > 0 &&
    pluralCategories.join() !== 'other'
  )
    throw new Error(
      `${JSON.stringify(template)}: the language has the plural forms ${[...pluralCategories].sort().join(', ')}, and a draft cut from "other" alone would be wrong for the rest`,
    );
  const { choice, sentences } = draft(template);
  const translated = sentences.map((sentence) => {
    const translation = translationOf(sentence);
    if (translation === undefined)
      throw new Error(`no translation for ${JSON.stringify(sentence)}`);
    const expected = slotsFilled(sentence);
    const actual = slotsFilled(translation);
    if (actual !== expected)
      throw new Error(
        `${JSON.stringify(sentence)} came back as ${JSON.stringify(translation)}, which fills the slots {${actual}} instead of {${expected}}`,
      );
    return translation;
  });
  if (!choice) return translated[0];
  return `{${choice.name}, select, ${choice.keys
    .map((key, index) => `${key} {${translated[index]}}`)
    .join(' ')}}`;
}

interface Draft {
  /** The choice the sentences were cut from, when the message makes one. */
  readonly choice?: { readonly name: string; readonly keys: readonly string[] };
  readonly sentences: readonly string[];
}

function draft(template: string): Draft {
  const parts = collapsePlurals(parseMessage(template), template);
  const choices = countChoices(parts);
  if (choices > 1)
    throw new Error(
      `${JSON.stringify(template)} makes ${choices} choices of sentence, and a translation can be drafted for one select only`,
    );
  const at = parts.findIndex((part) => part.kind === 'select');
  const choice = parts[at];
  if (at === -1 || choice.kind !== 'select')
    return { sentences: [sentenceOf(parts, template)] };
  const before = parts.slice(0, at);
  const after = parts.slice(at + 1);
  return {
    choice: { name: choice.name, keys: [...choice.branches.keys()] },
    sentences: [...choice.branches.values()].map((branch) =>
      sentenceOf([...before, ...branch, ...after], template),
    ),
  };
}

/** The parts a translation needs: every plural cut to its "other" sentence. */
function collapsePlurals(
  parts: readonly MessagePart[],
  template: string,
  counting?: string,
): MessagePart[] {
  return parts.flatMap((part): MessagePart[] => {
    switch (part.kind) {
      case 'text':
      case 'value':
        return [part];
      case 'count':
        if (counting === undefined)
          throw new Error(`${JSON.stringify(template)}: "#" outside a plural`);
        return [{ kind: 'value', name: counting }];
      case 'plural': {
        const exact = [...part.branches.keys()].filter((key) =>
          key.startsWith('='),
        );
        const other = part.branches.get('other');
        if (exact.length > 0 || !other)
          throw new Error(
            `${JSON.stringify(template)}: {${part.name}} has the exact-match branch ${exact.join(', ')}, which a sentence drafted from "other" cannot carry`,
          );
        return collapsePlurals(other, template, part.name);
      }
      case 'select':
        return [
          {
            ...part,
            branches: new Map(
              [...part.branches].map(
                ([key, branch]): [string, MessagePart[]] => [
                  key,
                  collapsePlurals(branch, template, counting),
                ],
              ),
            ),
          },
        ];
    }
  });
}

/** How many choices of sentence a message makes, nested ones included. */
const countChoices = (parts: readonly MessagePart[]): number =>
  parts.reduce(
    (total, part) =>
      part.kind === 'select'
        ? total +
          1 +
          [...part.branches.values()].reduce(
            (sum, branch) => sum + countChoices(branch),
            0,
          )
        : total,
    0,
  );

/** A message with no plural and no choice left, as the sentence it says. */
function sentenceOf(parts: readonly MessagePart[], template: string): string {
  return parts
    .map((part) => {
      if (part.kind === 'text') return part.text;
      if (part.kind === 'value') return `{${part.name}}`;
      throw new Error(
        `${JSON.stringify(template)}: a ${part.kind} is left in a drafted sentence`,
      );
    })
    .join('');
}

/**
 * Whether a draft fills exactly the slots of the sentence it came from --
 * none lost, invented or repeated -- and parses at all.
 */
export function slotsKept(sentence: string, draft: string): boolean {
  try {
    return slotsFilled(draft) === slotsFilled(sentence);
  } catch (error) {
    if (error instanceof MessageSyntaxError) return false;
    throw error;
  }
}

/**
 * Whether a run must send a sentence: never drafted, or drafted with its
 * slots changed. A cached draft `assembleMessage` would refuse is not trusted.
 */
export const needsSending = (
  sentence: string,
  cached: string | undefined,
): boolean => cached === undefined || !slotsKept(sentence, cached);

/**
 * A locale's drafts, split by whether the harness still sends their English
 * (#164).
 *
 * The cache is keyed by English sentence, and the harness used to write back
 * every draft it had read, so a draft outlived the copy it translated: 18 in
 * each of zh, vi, th and id, all retired homepage copy, reading exactly like
 * live translations in a file no page is ever checked against.
 *
 * `kept` holds the rest in the order they were cached, so a pruned cache is a
 * diff of removed lines rather than a reshuffled file. A draft whose slots
 * changed is kept: its sentence is still sent, and `needsSending` replaces it.
 */
export function pruneDrafts(
  drafts: Readonly<Record<string, string>>,
  sentences: ReadonlySet<string>,
): { kept: Record<string, string>; stale: string[] } {
  const entries = Object.entries(drafts);
  return {
    kept: Object.fromEntries(
      entries.filter(([english]) => sentences.has(english)),
    ),
    stale: entries
      .filter(([english]) => !sentences.has(english))
      .map(([english]) => english),
  };
}

/**
 * The better of a sentence's two drafts. Bare keeps spaces and words whole, so
 * it wins whenever it kept its slots; the tagged retry wins only where bare
 * changed a slot and it did not.
 */
export const betterDraft = (
  sentence: string,
  bare: string,
  tagged: string,
): string =>
  !slotsKept(sentence, bare) && slotsKept(sentence, tagged) ? tagged : bare;

/** Every slot a sentence fills, repeats included, in a comparable order. */
const slotsFilled = (text: string): string =>
  parseMessage(text)
    .flatMap((part) =>
      part.kind === 'text'
        ? []
        : [part.kind === 'value' ? part.name : `(${part.kind})`],
    )
    .sort()
    .join(', ');
