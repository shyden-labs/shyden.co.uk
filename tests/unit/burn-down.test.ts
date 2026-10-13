import { describe, it, expect } from 'vitest';
import { burnDownBreaches } from '../burn-down';

describe('burnDownBreaches holds a reading equal to its list, both ways', () => {
  it('names a scope reading more than its list, and not one that agrees', () => {
    expect(
      burnDownBreaches(
        new Map([
          ['a.test.ts › grows', 3],
          ['a.test.ts › agrees', 2],
        ]),
        { 'a.test.ts › grows': 1, 'a.test.ts › agrees': 2 },
      ),
    ).toEqual([{ key: 'a.test.ts › grows', read: 3, listed: 1 }]);
  });

  it('names a scope reading fewer than its list, so the list is lowered', () => {
    expect(
      burnDownBreaches(new Map([['a.test.ts › agrees', 2]]), {
        'a.test.ts › agrees': 2,
        'b.test.ts › converted': 1,
      }),
    ).toEqual([{ key: 'b.test.ts › converted', read: 0, listed: 1 }]);
  });

  it('names a scope read but never listed', () => {
    expect(
      burnDownBreaches(
        new Map([
          ['c.test.ts › new', 1],
          ['a.test.ts › agrees', 2],
        ]),
        { 'a.test.ts › agrees': 2 },
      ),
    ).toEqual([{ key: 'c.test.ts › new', read: 1, listed: 0 }]);
  });
});
