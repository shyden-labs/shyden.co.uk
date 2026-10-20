import { describe, expect, it } from 'vitest';
import { errorsIn, resultOf } from '../../src/lib/cloudflare-envelope';

/**
 * A Cloudflare v4 answer's envelope (#796): one home for the waiting-reports
 * count and the Access token expiry check. An answer that does not say
 * `success: true` is never read for its `result`.
 */
describe('resultOf reads a Cloudflare envelope (#796)', () => {
  it('returns the result once the envelope says success: true', () => {
    expect(resultOf({ success: true, result: [1] }, 'the list')).toEqual([1]);
  });

  it.each([
    ['a string', 'x', 'the list is not a JSON object'],
    [
      'success: false',
      {
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      },
      'the list says success: false (10000 Authentication error)',
    ],
    ['no success field', { result: [] }, 'the list says success: undefined'],
  ])('throws on %s', (_, answer, message) => {
    expect(() => resultOf(answer, 'the list')).toThrow(message);
  });

  it('errorsIn lists each code and message', () => {
    expect(
      errorsIn({
        errors: [
          { code: 7500, message: 'not authorized' },
          { code: 7403, message: 'forbidden' },
        ],
      }),
    ).toBe(' (7500 not authorized; 7403 forbidden)');
  });

  it('errorsIn is empty for an answer with no errors', () => {
    expect(errorsIn({ errors: [] })).toBe('');
  });

  it('errorsIn is empty for an answer that is not an object', () => {
    expect(errorsIn('<html>')).toBe('');
  });
});
