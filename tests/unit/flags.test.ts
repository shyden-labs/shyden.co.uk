import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutMarkupComments, withoutTsComments } from './source-text';
import { LOCALE_METADATA, MVP_LOCALES } from '../../src/lib/i18n/metadata';
import {
  FLAG_CODES,
  FLAG_VIEWBOX,
  flagBody,
  flagSymbol,
  flagSymbolId,
} from '../../src/lib/i18n/flags';

/**
 * The flags, once.
 *
 * Stage 2 drew them inline in `Flag.astro`, which was the whole story while
 * the only consumer was an Astro component. Stage 3's handover picker is
 * built by `src/scripts/io-ui.ts` — TypeScript assembling DOM at runtime,
 * which cannot import an `.astro` file. Copying the shapes into a second
 * file would have given the Indonesian flag in the header and the Indonesian
 * flag in the picker two independent definitions, and nothing would fail
 * when one of them was corrected.
 *
 * So the geometry moved to `src/lib/i18n/flags.ts` and both consumers derive
 * from it: `Flag.astro` renders the body directly, and the page injects the
 * same shapes once as `<symbol>`s that `io-ui.ts` references with `<use>` —
 * the sprite pattern `avatars.ts` / `ClassroomGroupsPage.astro` already use
 * for the student faces. These tests are what stop the duplicate coming back.
 */

const source = (path: string) => readFileSync(path, 'utf8');

/**
 * Comments stripped BEFORE any source-text assertion, both grammars.
 *
 * A guard matched against raw file text is satisfied by the file's own
 * documentation (#23). A comment in `Flag.astro` explaining which shapes used
 * to live there would pass a naive "no geometry here" check while the geometry
 * was still present.
 *
 * This was a private copy of the same helper until #60. It is shared now, per
 * #24 -- and sharing it is what revealed that the module every OTHER suite
 * uses had no HTML-comment case at all.
 */
const strippedMarkup = (src: string) =>
  withoutTsComments(withoutMarkupComments(src));

describe('the flag shapes have exactly one definition', () => {
  it('draws every flag the metadata table names', () => {
    for (const locale of MVP_LOCALES) {
      const { flag } = LOCALE_METADATA[locale];
      expect(
        flagBody(flag).length,
        `${locale} declares flag "${flag}" and nothing draws it`,
      ).toBeGreaterThan(0);
    }
  });

  it('lists the codes the metadata table actually uses, not a hand-written copy', () => {
    // The "declared list can lie" gap this repo has closed twice before
    // (`themes`/`THEME_KEYS`, `AVATAR_SEXES`): a second hand-maintained list
    // of the same thing drifts, and only one of the two is ever updated.
    const used = new Set(MVP_LOCALES.map((l) => LOCALE_METADATA[l].flag));
    expect(new Set(FLAG_CODES)).toEqual(used);
  });

  it('gives each code its own id', () => {
    const ids = FLAG_CODES.map(flagSymbolId);
    expect(new Set(ids).size, `duplicate symbol id in ${ids.join(', ')}`).toBe(
      FLAG_CODES.length,
    );
    for (const code of FLAG_CODES) expect(flagSymbolId(code)).toContain(code);
  });

  it('returns a body that nests inside a parent, not a whole document', () => {
    // `Flag.astro` puts this inside its own `<svg>` and `flagSymbol` puts it
    // inside a `<symbol>`. A body carrying its own root would nest an `<svg>`
    // in an `<svg>` in one consumer and be invalid in the other.
    for (const code of FLAG_CODES) {
      const body = flagBody(code);
      expect(body, `${code} body carries its own root`).not.toContain('<svg');
      expect(body, `${code} body carries its own symbol`).not.toContain(
        '<symbol',
      );
    }
  });

  it('wraps that same body under the id and viewBox a <use> needs', () => {
    for (const code of FLAG_CODES) {
      const symbol = flagSymbol(code);
      expect(symbol).toContain(`id="${flagSymbolId(code)}"`);
      expect(symbol).toContain(`viewBox="${FLAG_VIEWBOX}"`);
      // Verbatim: the sprite must be the SAME shapes the component draws,
      // not a second rendering that happens to look similar today.
      expect(symbol).toContain(flagBody(code));
    }
  });

  it('normalises every flag to one box, so the names beside them line up', () => {
    expect(FLAG_VIEWBOX).toBe('0 0 24 16');
  });

  it('leaves no geometry behind in Flag.astro', () => {
    const src = strippedMarkup(source('src/components/Flag.astro'));
    for (const shape of ['<rect', '<polygon', '<path', 'fill="#']) {
      expect(
        src.includes(shape),
        `Flag.astro still draws ${shape} itself — the shapes belong to ` +
          'src/lib/i18n/flags.ts, or the picker and the header can drift',
      ).toBe(false);
    }
    expect(src).toContain('flagBody');
  });
});
