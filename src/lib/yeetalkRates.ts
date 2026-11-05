/**
 * The one home of the two YeeTalk conversion rates and of the whole-number
 * input check both calculators run (#636). The Glory Points calculator reads
 * a glory target into the gift needed; the Gift Value calculator reads a gift
 * into the beans and coins it gives. Both go through the same two rates, so
 * they cannot drift apart.
 *
 * Operator rulings, 2026-10-08: a gift yields 40% of its value in beans, and
 * one bean redeems for 0.9 coins.
 */

/** Beans a gift converts to, as a decimal: 40% of the gift's value. */
export const GIFT_BEAN_RATE = 0.4;
/** Coins one bean redeems for, as a decimal. */
export const COINS_PER_BEAN = 0.9;

/**
 * The same two rates as fractions of whole numbers. A floor taken over
 * `value * 0.4` is right for 0.4 and 0.9 only because the stored doubles for
 * those two constants sit a hair ABOVE their true values, so a product never
 * lands just under a whole number; a rate whose double sits below (0.7: the
 * first wrong floor is `90 * 0.7` = 62.99999999999999) breaks silently. The
 * numerators times any accepted amount are exact integers (2 x 1e9 = 2e9, and
 * 9 x 4e8 = 3.6e9, both far below 2^53), and an IEEE division of two exact
 * integers is correctly rounded, so `floor(amount * numerator / denominator)`
 * is exact for every amount up to MAX_AMOUNT. Raise the cap only after
 * re-checking that bound.
 */
export const GIFT_BEAN_RATIO = { numerator: 2, denominator: 5 } as const;
export const COINS_PER_BEAN_RATIO = { numerator: 9, denominator: 10 } as const;

/** The largest amount either calculator accepts. */
export const MAX_AMOUNT = 1_000_000_000;

/** Exact user-facing messages — copy is part of the contract (tests assert these). */
export const ERRORS = {
  empty: 'Please enter a number.',
  notWhole: 'Please enter a whole number.',
  zero: 'Enter a number greater than zero.',
  tooLarge: 'That number is too large.',
} as const;

export type WholeAmount =
  { ok: true; value: number } | { ok: false; error: string };

/** A blank, non-whole, zero or too-large entry is refused with one of ERRORS. */
export function parseWholeAmount(raw: string): WholeAmount {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: ERRORS.empty };
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: ERRORS.notWhole };
  const value = Number(trimmed);
  if (value === 0) return { ok: false, error: ERRORS.zero };
  if (value > MAX_AMOUNT) return { ok: false, error: ERRORS.tooLarge };
  return { ok: true, value };
}
