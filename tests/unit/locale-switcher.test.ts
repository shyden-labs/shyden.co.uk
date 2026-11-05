import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutTsComments, withoutMarkupComments } from './source-text';
import {
  LOCALES,
  otherLocales,
  DEFAULT_LOCALE,
  getStrings,
} from '../../src/lib/i18n';
import { siteEn, siteId } from '../../src/lib/i18n/site';

// The catalogues as a page receives them: every message compiled into a
// function of its named slots (#136). A raw catalogue holds templates.
const en = getStrings('en');
const id = getStrings('id');

/**
 * Both tripwires retired.
 *
 * This file held two deliberate failures, each guarding a user-facing
 * behaviour that was still binary after #21 generalised the routing:
 *
 *   1. RETIRED by Stage 2. `strings.language.switchTo` was a single string
 *      meaning "the other language". Over two alternatives it labelled both
 *      identically — the visitor saw one word twice and could not tell which
 *      was which. The switcher is now a `<details>` dropdown that reads each
 *      language's own name from LOCALE_METADATA, so it labels N alternatives
 *      correctly. The guards below are what stop the single label returning.
 *
 *   2. RETIRED by Stage 3. The classroom-groups handover took
 *      `otherLocales(locale)[0]` — only ever right while there is exactly
 *      one alternative, and a silent choice on the teacher's behalf as soon
 *      as there are two. It is now a disclosure of one button per language,
 *      and the confirmation names the language it opened.
 *
 * Neither was retired by relaxing a number. Each was retired by building the
 * thing and replacing the tripwire with assertions about what was built —
 * which is the only way a tripwire may ever be removed from this file.
 */

/**
 * A component's source with its comments removed, BOTH syntaxes.
 *
 * An `.astro` file is TypeScript frontmatter plus markup, and either kind of
 * comment can name the very thing a guard below looks for — `otherLocales(`,
 * `<LanguageSwitcher`, `<details`. Unstripped, this file's own explanatory
 * prose satisfies the presence assertions after the code they describe has
 * gone, and falsely reddens the absence ones beside them (#98).
 *
 * Stripped HERE rather than at each call site: two of the six already wrote
 * `withoutTsComments(source(IO))` by hand and the other four did not, which
 * is how the gap opened. Measured before trusting it in this medium — all
 * six asserted tokens survive, and neither component contains a URL, so the
 * `https://`-as-line-comment hazard does not arise.
 */
const source = (path: string) =>
  withoutMarkupComments(withoutTsComments(readFileSync(path, 'utf8')));
const SWITCHER = 'src/components/LanguageSwitcher.astro';
const HEADER = 'src/components/Header.astro';
const IO = 'src/scripts/io-ui.ts';

/** A native name from a locale that is not routed, so nothing else can supply it. */
const NATIVE_NAME_PROBE = 'Tiếng Việt';

describe('the language switcher labels every alternative (tripwire 1, retired)', () => {
  it('no longer ships a single string meaning "the other language"', () => {
    // The exact shape of the retired bug. A reinstated `switchTo` would label
    // every alternative identically again, and nothing else here would notice.
    const tables = JSON.stringify({ siteEn, siteId });
    expect(
      tables.includes('switchTo'),
      'language.switchTo is the binary label #21 Stage 2 removed — the ' +
        'switcher reads native names from LOCALE_METADATA instead',
    ).toBe(false);
  });

  it('derives its entries from LOCALES, not from a fixed pair', () => {
    const src = source(SWITCHER);
    // Anchored to the CALL and to a property READ, not to the words: an
    // import left behind after the derivation was replaced would satisfy a
    // bare `toContain` even on stripped source (#98 AC 3). Every locale, in
    // LOCALES order, since #385: it was `otherLocales(lang)` after the current
    // one, which reordered the list on every language.
    // language-switcher.spec.ts pins the rendered order itself.
    expect(
      /\bLOCALES\s*\.\s*map\s*\(/.test(src),
      'the switcher names LOCALES but never maps over it',
    ).toBe(true);
    expect(
      /\.\s*nativeName\b/.test(src),
      'each entry must be labelled from its own metadata, or the dropdown is ' +
        'just the single-label bug with a caret on it',
    ).toBe(true);
  });

  it('gives every alternative its own hreflang and lang', () => {
    // Without `lang`, a screen reader announces 中文 in English phonetics.
    const src = source(SWITCHER);
    expect(/\shreflang=\{code\}/.test(src), 'no per-entry hreflang').toBe(true);
    expect(/\slang=\{code\}/.test(src), 'no per-entry lang').toBe(true);
  });

  it('is the only switcher the header renders', () => {
    const src = source(HEADER);
    expect(
      /<LanguageSwitcher[\s/>]/.test(src),
      'the header does not render the LanguageSwitcher element',
    ).toBe(true);
    expect(
      src.includes('otherLocales'),
      'the header must not hand-roll a second switcher beside the component',
    ).toBe(false);
  });

  it('ships no JavaScript of its own, so it works with scripting off', () => {
    const src = source(SWITCHER);
    expect(
      /<details[\s>]/.test(src),
      'the switcher is not a <details> element, so it needs JavaScript',
    ).toBe(true);
    expect(
      /<script/.test(src),
      'a language switcher is exactly the control someone needs when ' +
        'something else has already failed: it must work with no script, ' +
        'the theme script included (#142)',
    ).toBe(false);
  });
});

describe('the handover offers every language (tripwire 2, retired)', () => {
  it('no longer chooses a destination on the teacher behalf', () => {
    // The exact shape of the retired bug: the FIRST alternative, taken
    // without asking. Correct for one, a silent decision for two.
    const src = source(IO);
    expect(
      src.includes('otherLocales(locale)[0]'),
      'the handover took the first alternative — Stage 3 offers all of them',
    ).toBe(false);
  });

  it('builds one entry per alternative, labelled in that language own name', () => {
    const src = source(IO);
    expect(src).toContain('otherLocales(');
    expect(
      src,
      'a picker whose entries are not labelled from their own metadata is ' +
        'the single-label bug again, with a disclosure around it',
    ).toContain('nativeName');
  });

  it('names the language it opened, in the confirmation', () => {
    // Behaviour, not source text. A binary sentence cannot name a language,
    // so this is what makes "the other language" impossible to reinstate.
    for (const [label, t] of [
      ['en', en],
      ['id', id],
    ] as const) {
      expect(typeof t.ioHandoverSent, `${label}.ioHandoverSent`).toBe(
        'function',
      );
      expect(t.ioHandoverSent({ language: NATIVE_NAME_PROBE })).toContain(
        NATIVE_NAME_PROBE,
      );
    }
  });

  it('offers the export without saying how many languages there are', () => {
    // Site copy never states which languages anything is available in (#21).
    // "the other language" also counts the alternatives, out loud, at one.
    for (const [label, t] of [
      ['en', en],
      ['id', id],
    ] as const) {
      for (const binary of ['the other language', 'bahasa lainnya']) {
        expect(
          `${t.ioBothLanguages} ${t.ioBothLanguagesHint}`.toLowerCase(),
          `${label} still offers the handover in binary terms`,
        ).not.toContain(binary);
      }
    }
  });

  it('the default locale is the one served without a prefix', () => {
    expect(DEFAULT_LOCALE).toBe(LOCALES[0]);
    expect(otherLocales(DEFAULT_LOCALE)).not.toContain(DEFAULT_LOCALE);
  });
});
