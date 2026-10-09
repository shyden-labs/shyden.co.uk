import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutAstroComments } from './source-text';
import { join } from 'node:path';
import { en } from '../../src/lib/i18n/en';
import { siteEn } from '../../src/lib/i18n/site';
import { catalogueLeaves } from '../../src/lib/catalogue-leaves';
import { filesUnder, searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * A defined string that nothing renders.
 *
 * Both locale files carried translated copy that reached no page: a
 * "Making groups…" status, three locale-name labels, and a `switchLanguage`
 * that DUPLICATED site.ts's `language.switchTo` with a different value —
 * "Baca dalam Bahasa Indonesia" against the "Bahasa Indonesia" a visitor
 * actually sees. Two sources of truth for one label, and the one a maintainer
 * is most likely to edit was the inert one.
 *
 * `skipToContent` was the costly case: the copy for a skip link existed in
 * both languages while no skip link existed on any page, so the repo looked
 * like it had met WCAG 2.4.1 and had not.
 *
 * Nothing else notices this. Every other test in this suite reads the locale
 * files, so a key can be complete, translated, non-blank, and never once
 * shown to anybody.
 */

/**
 * Source with its comments removed, before anything is searched in it. #24.
 *
 * This suite asserts ABSENCE -- a key is dead if nothing references it -- so
 * the exposure runs the opposite way to the other source-text guards: a
 * comment naming a key makes a dead key look alive and SUPPRESSES a finding.
 * Nothing goes red, which is why it would never be noticed. `// heroSubheading
 * was removed in #17` is exactly the note someone writes while deleting the
 * last real use of a key.
 *
 * THREE PASSES, because this corpus is `.astro` as well as `.ts`, and an
 * HTML comment (`<!-- heroSubheading removed in #17 -->`) is invisible to a
 * TypeScript scanner. The scanner in
 * withoutTsComments tracks string literals so a URL or a quoted `//` survives,
 * but an apostrophe in `.astro` TEMPLATE TEXT ("don't") opens a quote that
 * never closes, and from there it stops stripping. It never deletes anything
 * -- quote mode copies verbatim -- so the failure is under-stripping, and the
 * line-based pass runs first to catch whole-line comments regardless of quote
 * state. A trailing comment after an unbalanced apostrophe in an .astro
 * template is the residual, and is narrow enough to name rather than chase.
 */

const sourceText = (() => {
  // Excludes the files that DEFINE the copy, and nothing else. i18n/index.ts
  // stays in: it is a renderer, and dropping the whole i18n directory made
  // `groupLabel` and `themes` look dead when index.ts composes both.
  const definitions = ['en.ts', 'id.ts', 'site.ts'].map((f) =>
    join('src', 'lib', 'i18n', f),
  );

  return filesUnder('src', (path) => /\.(astro|ts)$/.test(path))
    .filter((path) => !definitions.includes(path))
    .map((path) => withoutAstroComments(readFileSync(path, 'utf8')))
    .join('\n');
})();

/** `t.foo`, `strings.foo`, `siteEn.foo` — any property access by that name. */
const isReferenced = (key: string) =>
  new RegExp(`\\.${key}\\b`).test(sourceText);

describe('every translated string reaches a page', () => {
  it('the tool locale defines nothing that no page renders', () => {
    const defined = Object.keys(en);
    const unused = defined.filter((key) => !isReferenced(key));
    expect(searched(unused, { of: defined, what: 'tool copy keys' })).toEqual(
      [],
    );
    expect(
      floorBreach('dead-copy/tool-copy-keys', defined.length),
    ).toBeUndefined();
  });

  it('every error code the copy defines is rendered by renderError', () => {
    const renderer = withoutAstroComments(
      readFileSync('src/lib/i18n/index.ts', 'utf8'),
    );
    const defined = Object.keys(en.errors);
    const unused = defined.filter((code) => !renderer.includes(code));
    expect(searched(unused, { of: defined, what: 'error codes' })).toEqual([]);
    expect(
      floorBreach('dead-copy/error-codes', defined.length),
    ).toBeUndefined();
  });

  // Task 8a. Same check, same reasoning, for the warnings channel:
  // WARNING_CODES.sexSpillover was defined and translated in both locales
  // BEFORE anything in grouping.ts emitted one (Task 8b's separate-mode
  // placement, which landed later, is the first caller -- see
  // WARNING_CODES.sexSpillover's doc comment in grouping.ts). That gap is
  // exactly what would let warning copy rot unnoticed the way error copy
  // cannot: a translated key that renderWarning forgets to switch on would
  // still pass every other check in this file, same as an error code
  // would.
  it('every warning code the copy defines is rendered by renderWarning', () => {
    const renderer = withoutAstroComments(
      readFileSync('src/lib/i18n/index.ts', 'utf8'),
    );
    const defined = Object.keys(en.warnings);
    const unused = defined.filter((code) => !renderer.includes(code));
    expect(searched(unused, { of: defined, what: 'warning codes' })).toEqual(
      [],
    );
    expect(
      floorBreach('dead-copy/warning-codes', defined.length),
    ).toBeUndefined();
  });

  it('the site-wide copy defines nothing that no page renders', () => {
    // Nested to any depth: `footer.companyNo`, `calculators.glory.inputLabel`.
    // The population is every name judged, a group and each key inside it, not
    // the groups opened: a reader blind to the keys would open every group and
    // pass. It stopped at one level until #635 moved the Glory Points copy a
    // level down (`glory.x` to `calculators.glory.x`), which took seven keys out
    // of the population without a line of the guard changing.
    // The shared walk (`catalogueLeaves`) reads the shape; every group and key
    // on the way to a leaf is a name to judge, positions in a list excluded.
    const names = new Set<string>();
    for (const [leaf] of catalogueLeaves(siteEn)) {
      const parts = leaf.replace(/\[\d+\]/g, '').split('.');
      parts.forEach((_, i) => names.add(parts.slice(0, i + 1).join('.')));
    }
    const judged = [...names];
    const unused = judged.filter(
      (name) => !isReferenced(name.slice(name.lastIndexOf('.') + 1)),
    );
    expect(
      searched(unused, { of: judged, what: 'site copy groups and keys' }),
    ).toEqual([]);
    expect(
      floorBreach('dead-copy/site-copy-names', judged.length),
    ).toBeUndefined();
  });
});
