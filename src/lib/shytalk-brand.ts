/**
 * ShyTalk's brand mark, in ONE place.
 *
 * The two-tone wordmark is matched to the real product at
 * shytalk.shyden.co.uk, so it is a dependency on a brand this repo does not
 * own. Operator, 2026-09-11: *"This will need to be updated when we update
 * the ShyTalk branding in the future."*
 *
 * That coupling is real and cannot be removed while the mark is shown at all.
 * What it can be is CHEAP: before this module the three values were spelled
 * out in three files — `WorkCard.astro`, `HomePage.astro` and
 * `homepage.spec.ts` — six occurrences with nothing linking them, so a
 * rebrand meant finding all of them and the test agreeing was a coincidence
 * rather than a consequence.
 *
 * `tests/guards/shytalk-brand.test.ts` asserts nothing else in the repo spells
 * these values out, so the single home cannot quietly become four again.
 */
export const SHYTALK_MARK = {
  /** The light half of the wordmark — "Shy". */
  shy: '#e8e0f0',
  /** The purple half — "Talk". Also the wordmark's glow, through `asRgba`. */
  talk: '#d0bcff',
  /** The near-black tile the mark sits on, from the product's own site. */
  tile: '#0f0d15',
} as const;

/**
 * A hex as the `rgb(r, g, b)` string a browser reports from `getComputedStyle`.
 *
 * Exists so an assertion can name the brand value rather than a triple nobody
 * can trace back to it: `rgb(232, 224, 240)` in a spec is unsearchable, and
 * survives a rebrand as a silently wrong expectation.
 */
export const asComputedRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

/**
 * A brand hex at a given alpha, for glows and washes.
 *
 * Exists so `rgba(208, 188, 255, 0.3)` never has to be written by hand. That
 * exact string was how the first version of the one-home guard was defeated:
 * it searched for `rgb(...)` and the glow was `rgba(...)`, two lines away.
 */
export const asRgba = (hex: string, alpha: number): string =>
  asComputedRgb(hex).replace(')', `, ${alpha})`).replace('rgb(', 'rgba(');
