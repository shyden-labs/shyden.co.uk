import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/build-release-content.mjs';
import { CHECKOUT } from '../../scripts/checkout-path.mjs';

/**
 * #1275: every path build-release-content takes on its command line is
 * checked against the checkout before anything is read or written. Each
 * test names one path outside; the others sit inside but do not exist, so
 * the refusal is seen before any read could fail.
 */
const OUTSIDE = join(sep, 'tmp', 'release');
const INSIDE = join(CHECKOUT, '.superpowers', 'no-such-folder');

/** Run main() with these arguments; hand back what it printed as an error. */
const refusalOf = (args: string[]): string => {
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'brc', ...args]);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  expect(() => main()).toThrow('exit 1');
  return error.mock.calls.map((call) => String(call[0])).join('\n');
};

describe('build-release-content refuses a path outside the checkout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a release file outside it, naming it', () => {
    const release = join(OUTSIDE, 'release.json');
    expect(
      refusalOf([
        '--release',
        release,
        '--head',
        'abc',
        '--check',
        '--manifest',
        join(INSIDE, 'manifest.jsonl'),
      ]),
    ).toContain(`${release} is outside this checkout`);
  });

  it('refuses a manifest outside it, naming it', () => {
    const manifest = join(OUTSIDE, 'manifest.jsonl');
    expect(
      refusalOf([
        '--release',
        join(INSIDE, 'release.json'),
        '--head',
        'abc',
        '--check',
        '--manifest',
        manifest,
      ]),
    ).toContain(`${manifest} is outside this checkout`);
  });

  it('refuses a listing outside it, naming it', () => {
    const listing = join(OUTSIDE, 'listing.json');
    expect(
      refusalOf([
        '--release',
        join(INSIDE, 'release.json'),
        '--head',
        'abc',
        '--check',
        '--listing',
        listing,
        '--listing-only',
      ]),
    ).toContain(`${listing} is outside this checkout`);
  });

  it('refuses an evidence folder outside it, naming it', () => {
    expect(
      refusalOf([
        '--release',
        join(INSIDE, 'release.json'),
        '--head',
        'abc',
        '--evidence',
        OUTSIDE,
        '--out',
        join(INSIDE, 'content.json'),
      ]),
    ).toContain(`${OUTSIDE} is outside this checkout`);
  });

  it('refuses a content file to write outside it, naming it', () => {
    const out = join(OUTSIDE, 'content.json');
    expect(
      refusalOf([
        '--release',
        join(INSIDE, 'release.json'),
        '--head',
        'abc',
        '--evidence',
        INSIDE,
        '--out',
        out,
      ]),
    ).toContain(`${out} is outside this checkout`);
  });
});
