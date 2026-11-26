import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECKOUT, checkoutPath } from '../../scripts/checkout-path.mjs';

/**
 * #1275: SonarCloud's S8707 says a path a script takes on its command line
 * reaches the filesystem unchecked. Shyden ruled (2026-11-25) that a script
 * accepts a CLI path only inside this checkout, its git-ignored
 * `.superpowers/` included, and refuses any other, naming the path.
 */
const ROOT = path.join(path.sep, 'work', 'shyden.co.uk');

describe('checkoutPath', () => {
  it('is this checkout by default: the folder holding scripts/', () => {
    expect(CHECKOUT).toBe(path.resolve(import.meta.dirname, '..', '..'));
  });

  it('hands back a file inside the checkout as its absolute path', () => {
    expect(
      checkoutPath(path.join(ROOT, 'capture-evidence', 'a.json'), ROOT),
    ).toBe(path.join(ROOT, 'capture-evidence', 'a.json'));
  });

  it('accepts the git-ignored .superpowers folder', () => {
    expect(checkoutPath(path.join(ROOT, '.superpowers', 'x.json'), ROOT)).toBe(
      path.join(ROOT, '.superpowers', 'x.json'),
    );
  });

  it('reads a relative path against the working directory', () => {
    expect(checkoutPath(path.join('tests', 'a.json'), process.cwd())).toBe(
      path.join(process.cwd(), 'tests', 'a.json'),
    );
  });

  it('refuses a temp folder outside the checkout, naming the path', () => {
    const outside = path.join(path.sep, 'tmp', 'evidence', 'a.json');
    expect(() => checkoutPath(outside, ROOT)).toThrow(
      `${outside} is outside this checkout (${ROOT}), so it is refused`,
    );
  });

  it('refuses a climb out of the checkout', () => {
    const climb = path.join(ROOT, '..', 'other', 'a.json');
    expect(() => checkoutPath(climb, ROOT)).toThrow(
      `${climb} is outside this checkout`,
    );
  });

  it('refuses a sibling folder whose name starts with the checkout’s', () => {
    const sibling = `${ROOT}-1275${path.sep}a.json`;
    expect(() => checkoutPath(sibling, ROOT)).toThrow(
      `${sibling} is outside this checkout`,
    );
  });

  it('refuses the checkout folder itself, which is no file', () => {
    expect(() => checkoutPath(ROOT, ROOT)).toThrow(
      `${ROOT} is outside this checkout`,
    );
  });
});
