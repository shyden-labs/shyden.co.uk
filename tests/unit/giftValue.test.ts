import { describe, it, expect } from 'vitest';
import { calculateGiftValue } from '../../src/lib/giftValue';
import { ERRORS } from '../../src/lib/yeetalkRates';

describe('calculateGiftValue — the approved cases (whole beans, then whole coins, rounded down)', () => {
  it.each([
    [1, 0, 0],
    [2, 0, 0],
    [3, 1, 0],
    [5, 2, 1],
    [999, 399, 359],
    [1000, 400, 360],
    [1000000000, 400000000, 360000000],
  ])('gift=%i -> beans=%i coins=%i', (g, beans, coins) => {
    expect(calculateGiftValue(String(g))).toEqual({
      ok: true,
      result: { giftValue: g, beans, coins },
    });
  });
});

describe('calculateGiftValue — validation', () => {
  it.each(['', '   '])('blank %j -> empty error', (v) => {
    expect(calculateGiftValue(v)).toEqual({ ok: false, error: ERRORS.empty });
  });
  it.each(['abc', '3.5', '1e3', '1,000', '+5', '-5', '5 5', '0x10'])(
    'non-digits %j -> notWhole error',
    (v) => {
      expect(calculateGiftValue(v)).toEqual({
        ok: false,
        error: ERRORS.notWhole,
      });
    },
  );
  it.each(['0', '00', '000'])('zero %j -> zero error', (v) => {
    expect(calculateGiftValue(v)).toEqual({ ok: false, error: ERRORS.zero });
  });
  it.each(['1000000001', '99999999999999999999'])(
    'above the cap %j -> tooLarge error, never a rounded answer',
    (v) => {
      const outcome = calculateGiftValue(v);
      expect(outcome.ok).toBe(false);
      expect(outcome).toEqual({ ok: false, error: ERRORS.tooLarge });
    },
  );
  it('trims surrounding whitespace around a valid value', () => {
    expect(calculateGiftValue('  1000  ')).toEqual({
      ok: true,
      result: { giftValue: 1000, beans: 400, coins: 360 },
    });
  });
});

// Each value is its own test (one test per case). The expectation is an
// independent BigInt computation of the same two floors, so a float slip in
// the implementation cannot also be in the check. The values are the
// boundaries of the accepted range and the multiples of 5 and 10 around the
// cap, where 2g/5 and 9b/10 are exact and a float form could land just below.
const boundary: number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 25, 45, 90, 99, 100, 101, 995, 1_000,
  99_999, 100_000, 999_999, 1_000_000, 999_999_990, 999_999_991, 999_999_995,
  999_999_996, 999_999_997, 999_999_998, 999_999_999, 1_000_000_000,
];
describe('calculateGiftValue — exact against a BigInt computation', () => {
  it.each(boundary)('gift=%i', (g) => {
    const beans = (2n * BigInt(g)) / 5n;
    const coins = (9n * beans) / 10n;
    expect(calculateGiftValue(String(g))).toEqual({
      ok: true,
      result: { giftValue: g, beans: Number(beans), coins: Number(coins) },
    });
  });
});
