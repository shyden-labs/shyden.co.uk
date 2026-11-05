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

/** What `measureCover` reads off the page (#837). */
export interface Cover {
  board: { width: number; height: number; top: number; left: number };
  inner: { width: number; height: number };
  visual: { width: number; height: number } | null;
  ratio: number;
}

/**
 * Every way the board misses covering the window, judged in whole device
 * pixels, beside every check made, so an empty `gaps` is a verdict over a
 * named population rather than over nothing (#837, #118).
 *
 * `innerWidth`/`innerHeight` are the window's size FLOORED to a whole CSS
 * pixel: the real Android phone (ratio 3.5) is 2658 device pixels tall,
 * 759.43 CSS px, and reported 759; on the gauntlet, 309.714 reported 309. So
 * the board is compared with `visualViewport`, the fractional size, and
 * `visualViewport` is held to the window's own figure: N device pixels floor
 * to `inner` exactly when `inner * ratio <= N < (inner + 1) * ratio`. Both
 * bounds go on the viewport's own rounded grid, because an emulated window is
 * whole CSS pixels and its device size need not be: mobile Chrome's 727 at
 * 2.75 is 1999.25 device px, which rounds to 1999 (record run 39105622181).
 * The allowance is derived from the ratio, never a tolerance raised by hand.
 */
export const coverGaps = (m: Cover): { checked: string[]; gaps: string[] } => {
  if (!m.visual)
    return {
      checked: [],
      gaps: [
        "no visualViewport, so the viewport's fractional size cannot be read",
      ],
    };
  const device = (css: number) => Math.round(css * m.ratio);
  const checked: string[] = [];
  const gaps: string[] = [];
  for (const axis of ['width', 'height'] as const) {
    checked.push(`${axis}: visual viewport against the window`);
    checked.push(`${axis}: board against the visual viewport`);
    const inner = m.inner[axis];
    const viewport = device(m.visual[axis]);
    if (!(device(inner) <= viewport && viewport < device(inner + 1)))
      gaps.push(
        `${axis}: the visual viewport's ${viewport} device px is not the ` +
          `window's ${inner} floored (ratio ${m.ratio})`,
      );
    const board = device(m.board[axis]);
    if (board !== viewport)
      gaps.push(
        `${axis}: the board is ${board} device px, the viewport ${viewport} ` +
          `(ratio ${m.ratio})`,
      );
  }
  for (const edge of ['top', 'left'] as const) {
    checked.push(`${edge}: board edge against the viewport's`);
    const offset = device(m.board[edge]);
    if (offset !== 0)
      gaps.push(
        `${edge}: the board starts ${offset} device px from the viewport's ` +
          `edge (ratio ${m.ratio})`,
      );
  }
  return { checked, gaps };
};
