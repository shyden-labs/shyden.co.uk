/**
 * WCAG relative luminance and contrast, in one place.
 *
 * The formula had FIVE copies before #277: `contrast.test.ts` and
 * `print-legibility.spec.ts` at the top level, and three more inside
 * `page.evaluate()` callbacks where a top-level scan could not see them. The
 * two groups did not agree — the node copies linearised at `0.04045` and the
 * browser copies at `0.03928` — which is exactly the disagreement
 * `contrastRatio`'s own docblock predicted when it was written: "two contrast
 * computations that differ by one term would disagree about the same pixels,
 * and the suite that got the lenient one would pass while the page failed a
 * real audit."
 *
 * `0.04045` is the value kept: it is what sRGB and WCAG 2.1/2.2 state, where
 * `0.03928` is WCAG 2.0's published text. Measured rather than assumed, and
 * pinned in `wcag.test.ts`: for an 8-bit colour the two CANNOT disagree. The
 * thresholds straddle channel values 10.0164 to 10.3148, and `v / 255` for
 * an integer `v` never lands there — 10/255 is 0.0392, 11/255 is 0.0431. So
 * the five copies differed in text and could not have differed in result,
 * which is the kind of drift that survives review: nothing goes red, and the
 * next edit to one of them is the one that matters.
 *
 * A browser cannot import this: `page.evaluate` serialises its callback. The
 * answer is not a sixth copy — it is that a browser callback READS (computed
 * colour, background, opacity) and the arithmetic happens here. See
 * `contrastRatio` in `tests/e2e/helpers.ts`.
 */
export type RGB = readonly [number, number, number];
export type RGBA = { rgb: RGB; alpha: number };

/** One sRGB channel, linearised per WCAG 2.x relative luminance. */
const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]: RGB): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export const contrast = (a: RGB, b: RGB): number => {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * A CSS colour as this repo writes them: `#abc`, `#aabbcc`, or the space-
 * separated form `rgb(255 255 255 / 0.35)`.
 *
 * Aurora's borders and glass surfaces are ALPHAS, not hex (#17). A guard that
 * read only hex would silently classify every one of them as "not a colour"
 * and drop it from the pair check AND from the exhaustiveness check — green,
 * while blind to exactly the tokens that design leans on hardest.
 */
export const parseColour = (value: string): RGBA | null => {
  const text = value.trim();
  // CSS defines `transparent` as rgb(0 0 0 / 0), an exact value, not a guess.
  if (/^transparent$/i.test(text)) return { rgb: [0, 0, 0], alpha: 0 };

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex !== null) {
    const h = hex[1];
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    return { rgb: [r, g, b], alpha: 1 };
  }

  const fn = text.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+)(%?)\s*)?\)$/i,
  );
  if (fn === null) return null;

  const [r, g, b] = [fn[1], fn[2], fn[3]].map(Number);
  const alpha =
    fn[4] === undefined
      ? 1
      : fn[5] === '%'
        ? Number(fn[4]) / 100
        : Number(fn[4]);
  return { rgb: [r, g, b], alpha };
};

/** Source-over compositing, which is what a browser does with an alpha. */
export const over = (fg: RGBA, ground: RGB): RGB =>
  [0, 1, 2].map((i) =>
    Math.round(fg.alpha * fg.rgb[i] + (1 - fg.alpha) * ground[i]),
  ) as unknown as RGB;

/**
 * The ground text is actually painted on. `grounds` is every background from
 * the text's own element outward, nearest first, as the browser computes
 * them: each is composited over the layers behind it, and the deepest over
 * the white canvas, so an opaque layer hides whatever it covers. Stopping at
 * the first background and putting it over white scored a translucent layer
 * as if it sat on paper (#390 F127).
 */
export const paintedGround = (grounds: readonly RGBA[]): RGB =>
  grounds.reduceRight<RGB>(
    (behind, layer) => over(layer, behind),
    [255, 255, 255],
  );
