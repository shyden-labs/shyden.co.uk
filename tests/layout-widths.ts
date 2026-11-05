/**
 * The widths at which a page's layout can change, read from the media queries
 * its stylesheets declare (#329).
 *
 * Within one layout a row's items keep their size while the row widens, so a
 * row is tightest at the lower edge of each range. Measuring both sides of
 * every breakpoint is what lets a handful of widths stand for every width from
 * NARROWEST up, and it only works if both sides are really on different sides.
 *
 * Viewports are whole pixels, so the two widths are the last whole pixel on
 * which a condition has one answer and the first on which it has the other.
 * Which pixels those are depends on the comparison: `width >= 720px` first
 * holds at 720, `width > 720px` at 721. A condition and its complement change
 * at the same pixel (`>=` with `<`, `>` with `<=`), which is why two formulas
 * cover all four.
 *
 * Every spelling is read, because the served CSS is the minifier's rather than
 * ours: it writes `min-width: 720px` as `width>=720px`, and nothing stops a
 * stylesheet using the range syntax with a strict comparison, value first, or
 * as a two-sided range like `480px <= width < 720px`.
 */

/** The narrowest width the site supports, and the widest the guards measure. */
export const NARROWEST = 320;
export const WIDEST = 1280;

/** A media query resolves em and rem against the initial font size, not the page's. */
const PX_PER_EM = 16;

export interface LayoutWidths {
  /** Both sides of every breakpoint, strictly between NARROWEST and WIDEST. */
  readonly edges: number[];
  /** NARROWEST, every edge in ascending order, then WIDEST. */
  readonly widths: number[];
}

type Comparison = '>=' | '>' | '<=' | '<';

const comparison = (op: string): Comparison => {
  if (op === '>=' || op === '>' || op === '<=' || op === '<') return op;
  throw new Error(`not a width comparison: ${op}`);
};

/** `720px <= width` says `width >= 720px`: the operands swap, so the comparison mirrors. */
const MIRRORED: Readonly<Record<Comparison, Comparison>> = {
  '>=': '<=',
  '>': '<',
  '<=': '>=',
  '<': '>',
};

// Any case, because `720PX` is valid CSS. The range syntax's `width` stands on
// its own, never as the end of `device-width`, which is the screen and not the
// viewport. The other two patterns cannot match `min-device-width` or
// `600px <= device-width` at all, so they need no such guard.
const FEATURE = /(min|max)-width\s*:\s*(\d*\.?\d+)(px|r?em)/gi;
const WIDTH_FIRST = /(?<![\w-])width\s*(>=|<=|>|<)\s*(\d*\.?\d+)(px|r?em)/gi;
const VALUE_FIRST = /(\d*\.?\d+)(px|r?em)\s*(>=|<=|>|<)\s*width/gi;
/** A viewport-width feature named at all, read or not: never `device-width`. */
const MENTION = /(?<![\w-])(?:min-|max-)?width(?![\w-])/i;

/**
 * Every width condition in one media query list, as `width <op> px`.
 *
 * A condition none of the three patterns reads (`min-width: 45ch`, `30vw <
 * width`) is refused rather than skipped: read as nothing, it would drop both
 * widths beside its breakpoint, and every guard measuring each layout would
 * pass over that one (#390 F154).
 */
const conditions = (mediaText: string) => {
  const unread = mediaText
    .replace(FEATURE, '')
    .replace(WIDTH_FIRST, '')
    .replace(VALUE_FIRST, '');
  if (MENTION.test(unread))
    throw new Error(
      `cannot read a width condition in "${mediaText}": write it in px, em or rem`,
    );
  const px = (value: string, unit: string) =>
    Number(value) * (unit.toLowerCase() === 'px' ? 1 : PX_PER_EM);
  return [
    ...[...mediaText.matchAll(FEATURE)].map(([, side, value, unit]) => ({
      op: comparison(side.toLowerCase() === 'min' ? '>=' : '<='),
      px: px(value, unit),
    })),
    ...[...mediaText.matchAll(WIDTH_FIRST)].map(([, op, value, unit]) => ({
      op: comparison(op),
      px: px(value, unit),
    })),
    ...[...mediaText.matchAll(VALUE_FIRST)].map(([, value, unit, op]) => ({
      op: MIRRORED[comparison(op)],
      px: px(value, unit),
    })),
  ];
};

export const layoutWidthsFrom = (
  mediaTexts: readonly string[],
): LayoutWidths => {
  const edges = new Set<number>();
  for (const { op, px } of mediaTexts.flatMap(conditions)) {
    // The first whole pixel on which `width >= px` (or `width > px`) holds;
    // the pixel before it is the last on which it does not.
    const first =
      op === '>=' || op === '<' ? Math.ceil(px) : Math.floor(px) + 1;
    edges.add(first - 1).add(first);
  }
  const inside = [...edges]
    .filter((width) => width > NARROWEST && width < WIDEST)
    .sort((a, b) => a - b);
  return { edges: inside, widths: [NARROWEST, ...inside, WIDEST] };
};
