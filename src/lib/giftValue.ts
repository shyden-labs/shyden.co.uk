import {
  COINS_PER_BEAN_RATIO,
  GIFT_BEAN_RATIO,
  parseWholeAmount,
} from './yeetalkRates';

export interface GiftValueResult {
  giftValue: number;
  beans: number;
  coins: number;
}

export type GiftValueOutcome =
  { ok: true; result: GiftValueResult } | { ok: false; error: string };

/**
 * A gift's value in, the whole beans it gives and the whole coins those beans
 * redeem for out, both rounded down (operator ruling 2026-10-08): 999 gives
 * 399 beans (399.6 floored), which give 359 coins (359.1 floored).
 *
 * Whole-number arithmetic (`2/5`, `9/10`), never `value * 0.4`: see the note
 * on the ratios in yeetalkRates.ts for why that is exact up to the cap.
 */
export function calculateGiftValue(rawInput: string): GiftValueOutcome {
  const parsed = parseWholeAmount(rawInput);
  if (!parsed.ok) return parsed;
  const giftValue = parsed.value;
  const beans = Math.floor(
    (giftValue * GIFT_BEAN_RATIO.numerator) / GIFT_BEAN_RATIO.denominator,
  );
  const coins = Math.floor(
    (beans * COINS_PER_BEAN_RATIO.numerator) / COINS_PER_BEAN_RATIO.denominator,
  );
  return { ok: true, result: { giftValue, beans, coins } };
}
