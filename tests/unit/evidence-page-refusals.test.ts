import { describe, expect, it } from 'vitest';
import { jsonFrom, listingShape } from '../../scripts/build-evidence-page.mjs';

/**
 * #1275, SonarCloud's S8689: a refusal is printed to the log, so it names the
 * file and what is wrong with it, never what the file holds. A file passed by
 * mistake (a key, a token store) would otherwise have its text printed.
 */
const SECRET = 'a-secret-token-value';

describe('a refusal never prints what the file holds', () => {
  it('names a file that is not JSON without repeating its text', () => {
    expect(() =>
      jsonFrom(`token=${SECRET}`, 'the asset map at a.json'),
    ).toThrow('build-evidence-page: the asset map at a.json is not JSON');
    try {
      jsonFrom(`token=${SECRET}`, 'the asset map at a.json');
    } catch (error) {
      expect(String(error)).not.toContain('token=');
    }
  });

  it('describes a listing that is an object by its shape alone', () => {
    expect(listingShape({ token: SECRET })).toBe('an object');
  });

  it('describes a listing holding a non-path by where it is', () => {
    expect(listingShape(['index.html', { token: SECRET }])).toBe(
      'a list whose item 2 is an object',
    );
  });

  it('names each kind a JSON value can be', () => {
    expect(
      [null, 3, true, SECRET, [1]].map((value) => listingShape(value)),
    ).toEqual([
      'null',
      'a number',
      'true or false',
      'a string',
      'a list whose item 1 is a number',
    ]);
  });
});
