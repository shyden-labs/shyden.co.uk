import { describe, it, expect } from 'vitest';
import { isRecord } from '../../src/lib/is-record';

describe('isRecord', () => {
  it('accepts a plain object, empty or not', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ name: 'shyden-reports' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', '{}'],
    ['a number', 0],
    ['undefined', undefined],
  ])('refuses %s', (_, value) => {
    expect(isRecord(value)).toBe(false);
  });
});
