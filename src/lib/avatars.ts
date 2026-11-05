/**
 * Student avatars (design spec section 5, "Avatars").
 *
 * Direction C — friendly faces, Bold strength. Three fixed faces, chosen by
 * `sex` ('M' | 'F' | null — neutral, the roster's own default), never by the
 * student's number: identity is carried by the name text next to the
 * avatar (classroom-groups.ts's own `who.textContent = label(student)`),
 * not by the avatar's appearance, so the same sex always draws the same
 * face — deterministic across every shuffle, because `Student.sex` does not
 * change when a roster is reshuffled and this module never reads anything
 * else.
 *
 * TWO signals, not one: colour AND hair length (short / medium / long)
 * both differ, so the distinction survives a greyscale printout and the
 * roughly 1 in 12 males with red-green colour blindness, for whom this
 * palette puts pink beside green (design spec's own wording). Neither is
 * "simplified" away.
 *
 * `avatarSvg` returns ONE `<symbol>` — hand-authored, once per sex — meant
 * to be referenced by `<use>` wherever it is rendered:
 * `ClassroomGroupsPage.astro` builds the three, once, statically, at build
 * time (`AVATAR_SEXES.map(avatarSvg).join('')`, injected via `set:html`
 * into a visually-hidden sprite `<svg>`); `classroom-groups.ts`'s own
 * `render()` then instantiates one small `<svg><use href="#…"></use></svg>`
 * per student. However many students appear — up to `MAX_STUDENTS` — the
 * page never carries more than three real avatar DEFINITIONS.
 *
 * SECURITY: exactly like the `AVATAR_SVG` constant this replaces, nothing a
 * teacher types is ever able to reach this template. `sex` is normalised to
 * one of three fixed keys (`normalise`, below) before anything is read from
 * a lookup table, so even a caller that ignores the TypeScript type — a
 * value read from the page or from storage, which `astro check` never sees —
 * cannot make this function emit anything other than one of the three fixed
 * strings below.
 * See `avatars.test.ts`'s own "cannot be hijacked" test, which calls this
 * with a value the type forbids and checks the result is unchanged.
 */
import type { Student } from './grouping';

export type Sex = Student['sex'];

type Key = 'M' | 'F' | 'N';

/**
 * Every value `avatarSvg`/`avatarSymbolId` actually branch on — the SAME
 * array `ClassroomGroupsPage.astro` maps over to build the three symbol
 * definitions once, so the sprite it builds and the keys this module
 * branches on can never fall out of step (a hand-copied `['M', 'F', null]`
 * written a second time in the page would be exactly the "declared list
 * can lie" gap this avoids).
 */
export const AVATAR_SEXES: readonly Sex[] = ['M', 'F', null];

/** Anything that is not exactly 'M' or 'F' is neutral — the roster's own
 *  default for a student with no sex set, and the safe fallback for a
 *  value the type forbids (see this module's own "SECURITY" note above). */
const normalise = (sex: Sex): Key => (sex === 'M' || sex === 'F' ? sex : 'N');

/** design spec section 5's own table, verbatim. */
const PALETTE: Record<Key, { readonly bg: string; readonly body: string }> = {
  M: { bg: 'hsl(214 92% 88%)', body: 'hsl(218 85% 46%)' },
  F: { bg: 'hsl(334 95% 92%)', body: 'hsl(332 85% 60%)' },
  N: { bg: 'hsl(150 40% 86%)', body: 'hsl(150 42% 42%)' },
};

/** Shared across all three faces (design spec section 5). */
const FACE = 'hsl(32 55% 78%)';
const HAIR = 'hsl(24 40% 24%)';
const FEATURES = 'hsl(215 30% 20%)';

/**
 * Short / medium / long — the SECOND signal design spec section 5 asks for,
 * so the three faces still read apart in greyscale, or to the red-green
 * colour blindness the palette above otherwise trips over. Each is one
 * `<path>`'s own `d`; F's is three sub-paths (one dome, two side "drops"
 * flowing past the shoulders) joined in the same `d` string — a path may
 * hold more than one subpath, and this is still ONE hair layer, drawn with
 * ONE `fill`.
 */
const HAIR_PATH: Record<Key, string> = {
  M: 'M14 16A7 5 0 0 1 26 16Z',
  N: 'M12.5 18A8.5 7 0 0 1 27.5 18Z',
  F: 'M11 19A10 9 0 0 1 29 19Z M12 18Q9 27 11 35L14 35Q12.5 27 14 18Z M28 18Q31 27 29 35L26 35Q27.5 27 26 18Z',
};

/**
 * Decorative on the page itself: `classroom-groups.ts`'s own rendered
 * `<use>` instance stays `aria-hidden`, matching the AVATAR_SVG constant
 * this replaces — "Decorative: hidden from assistive tech, which reads the
 * name instead." Present here only so a `<symbol>` read or used in
 * isolation (this file's own unit tests; a future consumer that renders it
 * directly) still identifies itself as an image rather than being silently
 * invisible to assistive tech — `<symbol>` content is never part of the
 * accessibility tree on its own regardless, so this costs nothing on the
 * page as shipped.
 *
 * Deliberately the SAME word in both languages ("avatar" is an ordinary
 * loanword in Bahasa Indonesia, same as "Normal" already is in
 * i18n.test.ts's own ALLOWED_IDENTICAL) rather than threaded through
 * `Strings` — `avatarSvg` takes only `sex`, so there is no locale to read,
 * and the rendered instance never surfaces it to a visitor either way (see
 * above). A considered decision, not an oversight -- kept a plain constant
 * rather than a locale key because it never reaches a visitor to translate.
 */
const LABEL = 'Avatar';

/**
 * `avatar-m` / `avatar-f` / `avatar-n` — the `<symbol id>` `avatarSvg` gives
 * each face, and the id `<use href="#…">` must reference to draw it.
 * Exported so `classroom-groups.ts`'s own per-student instance and this
 * file's own `avatarSvg` can never compute a different id for the same sex
 * — one mapping, not two hand-written copies that could drift apart.
 */
export const avatarSymbolId = (sex: Sex): string =>
  `avatar-${normalise(sex).toLowerCase()}`;

/**
 * One `<symbol>`, hand-authored, for the given sex — 'M' | 'F' | null
 * (neutral, the default for a student with no sex set).
 *
 * A CONSTANT shape for each of the three keys, exactly like the AVATAR_SVG
 * constant this replaces: nothing below is built from `sex` beyond a
 * three-way lookup, so there is no way for this to carry anything a
 * teacher typed, however it is later edited or however `sex` arrives at
 * runtime.
 */
export function avatarSvg(sex: Sex): string {
  const key = normalise(sex);
  const { bg, body } = PALETTE[key];
  const id = avatarSymbolId(sex);
  return (
    `<symbol id="${id}" viewBox="0 0 40 40" role="img" aria-label="${LABEL}">` +
    `<circle class="a-bg" cx="20" cy="20" r="20" fill="${bg}"></circle>` +
    `<path d="M6 40a14 14 0 0 1 28 0Z" fill="${body}"></path>` +
    `<circle cx="20" cy="18" r="7" fill="${FACE}"></circle>` +
    // `data-hair` makes the second signal ADDRESSABLE. Without it a test
    // asking "are the three faces still distinguishable in greyscale" has
    // to find this path by its fill COLOUR -- which is exactly the signal
    // the greyscale case exists to remove, so the query would depend on the
    // thing it is proving is not needed.
    `<path data-hair="${key.toLowerCase()}" fill="${HAIR}" d="${HAIR_PATH[key]}"></path>` +
    `<circle cx="17" cy="18" r="1.1" fill="${FEATURES}"></circle>` +
    `<circle cx="23" cy="18" r="1.1" fill="${FEATURES}"></circle>` +
    `<path d="M16.5 21.5q3.5 2.6 7 0" stroke="${FEATURES}" stroke-width="1.3" fill="none" stroke-linecap="round"></path>` +
    `</symbol>`
  );
}
