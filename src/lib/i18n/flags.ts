import { LOCALE_METADATA, MVP_LOCALES, type FlagCode } from './metadata';

/**
 * The flag shapes, drawn once, for every consumer.
 *
 * Stage 2 kept these inline in `Flag.astro`. Stage 3 added a second consumer
 * that cannot import an `.astro` file at all: `src/scripts/io-ui.ts` builds
 * the handover picker as DOM at runtime. Rather than a second copy of five
 * flags that would drift the first time one was corrected, the geometry lives
 * here and both consumers derive from it:
 *
 *   - `Flag.astro` renders `flagBody(code)` inside its own `<svg>`;
 *   - `ClassroomGroupsPage.astro` injects `FLAG_CODES.map(flagSymbol)` once as
 *     a hidden sprite, and `io-ui.ts` draws each entry as
 *     `<svg><use href="#flag-id"></use></svg>`.
 *
 * That second half is the pattern `avatars.ts` already established for the
 * student faces (`avatarSvg` / `avatarSymbolId` / `avatarHtml`), for exactly
 * the same reason: static developer-authored markup, built at build time,
 * referenced by id from script-built DOM.
 *
 * SECURITY: nothing below is built from anything a visitor supplies. Every
 * value is a literal in this file, selected by a `FlagCode` — a five-member
 * union, not free text — so the strings these functions return are safe to
 * inject with `set:html` / `innerHTML`, exactly as `avatarSvg`'s are. Keep it
 * that way: an interpolated argument here would reach both consumers unescaped.
 *
 * Flags are country symbols standing in for languages, which is imprecise but
 * is what a visitor scans for; the language's own name beside it carries the
 * actual meaning (see `LocaleMetadata.nativeName`). Emoji flags were rejected
 * in Stage 2 because Windows renders them as bare regional-indicator letters.
 */

/**
 * One box for all five, so the native names beside them line up.
 *
 * 3:2 throughout. The Union Flag is properly 2:1 and is drawn without its
 * counterchange offset; both are the usual compromises for an icon a few
 * millimetres wide, and neither changes which flag a reader sees.
 */
export const FLAG_VIEWBOX = '0 0 24 16';

/**
 * The flag codes actually in use, READ OFF the metadata table.
 *
 * Not a hand-written list beside it: this repo has twice had a declared list
 * drift from the thing it declared (`themes`/`THEME_KEYS`, and the avatar
 * sexes before `AVATAR_SEXES` became the single source). Deriving means a
 * sixth locale with a new flag cannot be half-added.
 */
export const FLAG_CODES: readonly FlagCode[] = [
  ...new Set(MVP_LOCALES.map((locale) => LOCALE_METADATA[locale].flag)),
];

/** A five-pointed star, point up, centred on the origin, outer radius 1. */
const STAR =
  '0,-1 0.224,-0.309 0.951,-0.309 0.363,0.118 0.588,0.809 ' +
  '0,0.382 -0.588,0.809 -0.363,0.118 -0.951,-0.309 -0.224,-0.309';

/** One yellow star of the PRC / Vietnamese flags, placed and sized. */
const star = (transform: string) =>
  `<polygon points="${STAR}" fill="#FF0" transform="${transform}"></polygon>`;

/**
 * The shapes for one flag, with no root element of its own.
 *
 * An `<svg>` here would nest inside `Flag.astro`'s own root and be invalid
 * inside a `<symbol>`, so the wrapper is each consumer's to supply.
 *
 * An SVG root clips to its viewBox, so the Union Flag's diagonals need no
 * `clipPath` — which also avoids a duplicate element id when the header
 * switcher and the handover picker both render on one page.
 */
const BODIES: Record<FlagCode, string> = {
  gb:
    '<rect width="24" height="16" fill="#012169"></rect>' +
    '<path d="M0 0 24 16M24 0 0 16" stroke="#fff" stroke-width="3.2"></path>' +
    '<path d="M0 0 24 16M24 0 0 16" stroke="#C8102E" stroke-width="1.9"></path>' +
    '<path d="M12 0V16M0 8H24" stroke="#fff" stroke-width="5.3"></path>' +
    '<path d="M12 0V16M0 8H24" stroke="#C8102E" stroke-width="3.2"></path>',
  id:
    '<rect width="24" height="8" fill="#CE1126"></rect>' +
    '<rect y="8" width="24" height="8" fill="#fff"></rect>',
  cn:
    '<rect width="24" height="16" fill="#EE1C25"></rect>' +
    star('translate(4 4) scale(2.4)') +
    star('translate(8.2 1.8) scale(0.8) rotate(23)') +
    star('translate(9.9 3.7) scale(0.8) rotate(46)') +
    star('translate(9.9 6.2) scale(0.8) rotate(70)') +
    star('translate(8.2 8) scale(0.8) rotate(23)'),
  vn:
    '<rect width="24" height="16" fill="#DA251D"></rect>' +
    star('translate(12 8) scale(4.4)'),
  th:
    '<rect width="24" height="16" fill="#A51931"></rect>' +
    '<rect y="2.67" width="24" height="10.66" fill="#F4F5F8"></rect>' +
    '<rect y="5.33" width="24" height="5.34" fill="#2D2A4A"></rect>',
};

/** The shapes for one flag, to be placed inside a caller's own root. */
export const flagBody = (code: FlagCode): string => BODIES[code];

/**
 * `flag-gb` / `flag-id` / … — the `<symbol id>` `flagSymbol` gives each flag,
 * and the id a `<use href="#…">` must reference to draw it.
 *
 * Exported so the sprite and the instance that references it can never
 * compute a different id for the same flag — one mapping, not two.
 */
export const flagSymbolId = (code: FlagCode): string => `flag-${code}`;

/** One `<symbol>` for the sprite, holding the same shapes `flagBody` returns. */
export const flagSymbol = (code: FlagCode): string =>
  `<symbol id="${flagSymbolId(code)}" viewBox="${FLAG_VIEWBOX}">` +
  `${flagBody(code)}</symbol>`;
