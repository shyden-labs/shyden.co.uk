/**
 * The width a browser paints for a border or outline declared `cssPx` wide,
 * at a device pixel ratio of `ratio`, in CSS pixels (#805). Lines are drawn in
 * whole device pixels: the declared width is snapped down to a whole number
 * of them, and never below one. At a ratio where the declared width is whole
 * (1, 2) this is the declared width; on the real Android phone (ratio 3.5)
 * the site's 3px ring is 10 device pixels, 2.857 CSS px. An assertion of
 * exactly 3 measured the emulated engines' ratio, not the ring.
 *
 * Free of Playwright, so the iPhone's journeys (Vitest) can use it too.
 */
export const paintedLineWidth = (cssPx: number, ratio: number): number =>
  Math.max(1, Math.floor(cssPx * ratio)) / ratio;

/**
 * Whether a computed border or outline width `reported` is a line declared
 * `cssPx` wide at a device pixel ratio of `ratio` (#805). An engine reports
 * either the declared width or the width it paints in whole device pixels,
 * and which one is the engine's business: the real Android phone (3.5)
 * reported the 3px ring as 2.857, emulated Chrome at 2.75 as 3. Either reads
 * as the line; a narrower one reads as neither at any ratio of 1 or more.
 */
export const readsAsLineWidth = (
  reported: number,
  cssPx: number,
  ratio: number,
): boolean =>
  [cssPx, paintedLineWidth(cssPx, ratio)].some(
    (width) => Math.abs(width - reported) < 1e-4,
  );
