import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keysFrom } from '../../scripts/i18n-second-read.mjs';

/**
 * #1275: the keys file i18n-second-read takes with --keys-file is read only
 * from inside the checkout, as Shyden ruled 2026-11-25.
 */
describe('i18n-second-read --keys-file', () => {
  it('refuses a keys file outside this checkout, naming it', () => {
    const outside = join(sep, 'tmp', 'keys.tsv');
    expect(() => keysFrom(outside)).toThrow(
      `${outside} is outside this checkout`,
    );
  });

  it('reads no keys file when none is given', () => {
    expect(keysFrom(undefined)).toBeUndefined();
  });
});
