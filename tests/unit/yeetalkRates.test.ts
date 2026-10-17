import { describe, it, expect } from 'vitest';
import {
  COINS_PER_BEAN,
  GIFT_BEAN_RATE,
  GIFT_BEAN_RATIO,
  COINS_PER_BEAN_RATIO,
  MAX_AMOUNT,
  ERRORS,
  parseWholeAmount,
} from '../../src/lib/yeetalkRates';

// The rates are pinned as LITERALS, never against the constant they come
// from: a value asserted against its own source is tautological.
describe('the two YeeTalk rates (operator ruling 2026-10-08)', () => {
  it('a gift converts to beans at 40%', () => {
    expect(GIFT_BEAN_RATE).toBe(0.4);
  });
  it('one bean redeems for 0.9 coins', () => {
    expect(COINS_PER_BEAN).toBe(0.9);
  });
  it('the gift-to-bean ratio is written 2 over 5', () => {
    expect(GIFT_BEAN_RATIO).toEqual({ numerator: 2, denominator: 5 });
  });
  it('the bean-to-coin ratio is written 9 over 10', () => {
    expect(COINS_PER_BEAN_RATIO).toEqual({ numerator: 9, denominator: 10 });
  });
  it('the whole-number gift ratio equals the decimal rate', () => {
    expect(GIFT_BEAN_RATIO.numerator / GIFT_BEAN_RATIO.denominator).toBe(0.4);
  });
  it('the whole-number coin ratio equals the decimal rate', () => {
    expect(
      COINS_PER_BEAN_RATIO.numerator / COINS_PER_BEAN_RATIO.denominator,
    ).toBe(0.9);
  });
  it('the cap is one billion', () => {
    expect(MAX_AMOUNT).toBe(1_000_000_000);
  });
});

describe('the four messages are the calculators’ contract', () => {
  it('blank', () => expect(ERRORS.empty).toBe('Please enter a number.'));
  it('not whole', () =>
    expect(ERRORS.notWhole).toBe('Please enter a whole number.'));
  it('zero', () =>
    expect(ERRORS.zero).toBe('Enter a number greater than zero.'));
  it('too large', () =>
    expect(ERRORS.tooLarge).toBe('That number is too large.'));
});

describe('parseWholeAmount', () => {
  it.each(['', '   '])('blank %j -> empty error', (v) => {
    expect(parseWholeAmount(v)).toEqual({ ok: false, error: ERRORS.empty });
  });
  it.each(['abc', '3.5', '1e3', '1,000', '+5', '-5', '5 5', '0x10'])(
    'non-digits %j -> notWhole error',
    (v) => {
      expect(parseWholeAmount(v)).toEqual({
        ok: false,
        error: ERRORS.notWhole,
      });
    },
  );
  it.each(['0', '00', '000'])('zero %j -> zero error', (v) => {
    expect(parseWholeAmount(v)).toEqual({ ok: false, error: ERRORS.zero });
  });
  it('one above the cap -> tooLarge error', () => {
    expect(parseWholeAmount('1000000001')).toEqual({
      ok: false,
      error: ERRORS.tooLarge,
    });
  });
  it('the cap itself is accepted', () => {
    expect(parseWholeAmount('1000000000')).toEqual({
      ok: true,
      value: 1_000_000_000,
    });
  });
  it('trims surrounding whitespace', () => {
    expect(parseWholeAmount('  10  ')).toEqual({ ok: true, value: 10 });
  });
});
