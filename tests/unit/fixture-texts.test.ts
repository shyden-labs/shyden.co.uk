import { describe, it, expect } from 'vitest';
import { fixtureReader } from '../fixture-texts';

describe('a reader over fixture texts', () => {
  it('reads the text given for a path', () => {
    expect(fixtureReader({ 'a.ts': 'one', 'b.ts': 'two' })('b.ts')).toBe('two');
  });

  it('refuses a path it was not given, naming it', () => {
    expect(() => fixtureReader({ 'a.ts': 'one' })('c.ts')).toThrow(
      'no fixture text for c.ts',
    );
  });

  it('reads an empty text as given, not as missing', () => {
    expect(fixtureReader({ 'a.ts': '' })('a.ts')).toBe('');
  });
});
