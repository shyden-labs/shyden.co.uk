/**
 * How much to shrink the projected sheet so it fits the board — and whether
 * it still will not, so the caller knows it must offer a way to reach what
 * did not.
 *
 * PURE, and that is the whole point. The projector's own sizing is a
 * measure-adjust-remeasure cycle against a real box: none of the decisions
 * inside it are observable from outside, so the one decision that matters --
 * the FLOOR, below which text stops being readable from the back of a
 * room -- would be untestable if it lived in there with them.
 *
 * Returns an object rather than a number because `scrolls` is a separate
 * fact the caller has to act on: a sheet that has been shrunk to the floor
 * and STILL does not fit needs a scrollbar, and one that fits does not.
 *
 * Every input can arrive NaN or zero. Both sizes come from measured DOM
 * boxes, and an element measured before layout, or while its ancestor is
 * hidden, reads 0 — which is exactly the state a board mounted off-screen
 * is in. A scale of 0 makes the whole projection vanish with nothing on
 * screen to explain it, so the guards below are the difference between a
 * readable fallback and a blank wall in front of a class.
 */
export function fitScale(
  available: number,
  needed: number,
  floor: number,
  base: number,
): { scale: number; scrolls: boolean } {
  // The smallest scale that still leaves text at the readable floor. Capped
  // at 1 because a floor ABOVE the base means "never shrink at all" -- a
  // legitimate setting for a board where nothing may be smaller than it is
  // drawn, and one that must not invert into ENLARGING the sheet.
  const minScale = Math.min(1, usable(floor) / usable(base));

  // An unmeasurable content size is treated as already fitting rather than
  // divided by: `needed = 0` gives Infinity, which would then land on 1 by
  // luck rather than by rule, and a rule nobody wrote is a rule nobody can
  // rely on.
  if (!Number.isFinite(needed) || needed <= 0) {
    return { scale: 1, scrolls: false };
  }
  if (!Number.isFinite(available) || available <= 0) {
    return { scale: minScale, scrolls: true };
  }

  const wanted = available / needed;
  if (wanted >= 1) return { scale: 1, scrolls: false };
  // Below the floor, the sheet stays AT the floor and scrolls. Readable and
  // reachable beats fitted and illegible: a class cannot read what does not
  // fit on the board either way, but they can read what scrolls.
  if (wanted < minScale) return { scale: minScale, scrolls: true };
  return { scale: wanted, scrolls: false };
}

/**
 * The largest font that still fits, SOLVED from two real readings rather than
 * approached by a ratio (#189).
 *
 * The projector measures, scales, and measures again -- and the second reading
 * routinely disagrees with the first, because the board's grid tracks are `em`:
 * shrinking the type narrows the columns and changes how many cards sit on a
 * row. Within one column regime the sheet is `a * font + C`, where `C` is every
 * `rem` and `px` part -- padding, gaps, borders -- that does not shrink with the
 * type at all. Correcting by the measured ratio `available / height` therefore
 * moves TOWARDS the answer without reaching it: measured on the real page, a
 * class of eight in pairs wanted 0.955, was nudged from 38.2px to 37.8px, and
 * still did not fit, so the board scrolled at almost full size.
 *
 * Two points define that line, and the caller is already holding both by the
 * time it needs to correct. So this is solved for no extra measuring and no
 * extra reflow.
 *
 * Pure, for the same reason `fitScale` is: the readings come from a real box,
 * and arithmetic that lives inside a measure-adjust-remeasure cycle cannot be
 * tested from outside it.
 *
 * A line that cannot be solved -- two readings at the same font, a sheet that
 * did not move, or one that GREW as the font shrank because a column boundary
 * added a row -- falls back to the ratio correction. Never to a NaN, an
 * Infinity, or a font of zero in front of a class.
 */
export function fontThatFits(
  available: number,
  atBase: { font: number; height: number },
  atApplied: { font: number; height: number },
  floor: number,
): number {
  const low = usable(floor);
  const applied = usable(atApplied.font);
  const room = Number.isFinite(available) && available > 0 ? available : 0;
  // No measurable box to fit into: the readable floor is the only answer that
  // leaves something on the wall, exactly as `fitScale` treats the same case.
  if (room <= 0) return low;

  const rise = atBase.height - atApplied.height;
  const run = atBase.font - atApplied.font;
  const slope = run === 0 ? NaN : rise / run;
  const solved =
    Number.isFinite(slope) && slope > 0
      ? (room - (atBase.height - slope * atBase.font)) / slope
      : applied * (room / usable(atApplied.height));

  // Clamped at BOTH ends: never below the readable floor, and never above the
  // font already applied -- solving upwards would undo the shrink the first
  // pass decided on, on the strength of a line fitted to two points.
  return Math.min(
    applied,
    Math.max(low, Number.isFinite(solved) ? solved : low),
  );
}

/**
 * Settle on a font that FITS, reading the sheet at each answer (#743).
 *
 * `fontThatFits` is exact only within one column regime; where the layout
 * rewraps between the readings, its answer can land a few px over, and the
 * board then scrolled above the floor. Here every answer is measured, and an
 * overflowing one is solved again from the two most recent readings. It stops
 * when a reading fits, or at the floor; after `cap` readings that still do not
 * fit it ends AT the floor, the one size that is always allowed to scroll.
 *
 * `measure` sets the font and returns the sheet's height there. Pure otherwise.
 */
export function settleFont(
  available: number,
  atBase: { font: number; height: number },
  atApplied: { font: number; height: number },
  floor: number,
  measure: (font: number) => number,
  cap: number,
): number {
  const low = usable(floor);
  let previous = atBase;
  let current = atApplied;
  for (let reading = 0; reading < cap; reading += 1) {
    if (current.height <= available) return current.font;
    if (current.font <= low) return low;
    let next = fontThatFits(available, previous, current, low);
    // No progress (an unsolvable line): fall back to the ratio, which is
    // strictly smaller for any sheet that overflows.
    if (next >= current.font) {
      next = Math.max(low, current.font * (available / usable(current.height)));
    }
    previous = current;
    current = { font: next, height: measure(next) };
  }
  return current.height <= available ? current.font : low;
}

/** A size that can actually be divided by. Anything else is 1. */
const usable = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 1;
