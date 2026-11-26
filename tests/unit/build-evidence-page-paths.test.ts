import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from '../../scripts/build-evidence-page.mjs';
import { CHECKOUT } from '../../scripts/checkout-path.mjs';

/**
 * #1275: every path build-evidence-page takes on its command line is checked
 * against the checkout before anything is read or written. Each test names
 * one path outside; the others sit inside but do not exist, so the refusal is
 * seen before any read could fail.
 */
const OUTSIDE = join(sep, 'tmp', 'evidence');
const INSIDE = join(CHECKOUT, '.superpowers', 'no-such-folder');

const command = {
  dir: INSIDE,
  out: join(INSIDE, 'page.html'),
  contentPath: join(INSIDE, 'content.json'),
  publishedPath: join(INSIDE, 'published.json'),
  planning: false,
  assetsPath: join(INSIDE, 'assets.json'),
};

describe('build-evidence-page refuses a path outside the checkout', () => {
  it('refuses an evidence folder outside it, naming it', () => {
    expect(() => build({ ...command, dir: OUTSIDE })).toThrow(
      `${OUTSIDE} is outside this checkout`,
    );
  });

  it('refuses a page to write outside it, naming it', () => {
    const out = join(OUTSIDE, 'page.html');
    expect(() => build({ ...command, out })).toThrow(
      `${out} is outside this checkout`,
    );
  });

  it('refuses a content file outside it, naming it', () => {
    const contentPath = join(OUTSIDE, 'content.json');
    expect(() => build({ ...command, contentPath })).toThrow(
      `${contentPath} is outside this checkout`,
    );
  });

  it('refuses a published listing outside it, naming it', () => {
    const publishedPath = join(OUTSIDE, 'published.json');
    expect(() => build({ ...command, publishedPath })).toThrow(
      `${publishedPath} is outside this checkout`,
    );
  });

  it('refuses an asset map outside it, naming it', () => {
    const assetsPath = join(OUTSIDE, 'assets.json');
    expect(() => build({ ...command, assetsPath })).toThrow(
      `${assetsPath} is outside this checkout`,
    );
  });
});
