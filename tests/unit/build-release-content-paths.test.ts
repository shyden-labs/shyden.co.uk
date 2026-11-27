import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/build-release-content.mjs';
import { CHECKOUT } from '../../scripts/checkout-path.mjs';
import { EVIDENCE_MANIFEST } from '../../scripts/evidence-files.mjs';

/**
 * #1275: every path build-release-content takes on its command line is
 * checked against the checkout before anything is read or written. Each
 * test names one path outside; the others sit inside but do not exist, so
 * the refusal is seen before any read could fail.
 */
const OUTSIDE = join(sep, 'tmp', 'release');
const INSIDE = join(CHECKOUT, '.superpowers', 'no-such-folder');

/** Run main() with these arguments; hand back what it printed as an error. */
const refusalOf = async (args: string[]): Promise<string> => {
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'brc', ...args]);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  await expect(async () => main()).rejects.toThrow('exit 1');
  return error.mock.calls.map((call) => String(call[0])).join('\n');
};

describe('build-release-content refuses a path outside the checkout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a release file outside it, naming it', async () => {
    const release = join(OUTSIDE, 'release.json');
    expect(
      await refusalOf([
        '--release',
        release,
        '--head',
        'abc',
        '--check',
        '--manifest',
        join(INSIDE, EVIDENCE_MANIFEST),
      ]),
    ).toContain(`${release} is outside this checkout`);
  });

  it('refuses a manifest outside it, naming it', async () => {
    const manifest = join(OUTSIDE, EVIDENCE_MANIFEST);
    expect(
      await refusalOf([
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

  it('refuses a listing outside it, naming it', async () => {
    const listing = join(OUTSIDE, 'listing.json');
    expect(
      await refusalOf([
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

  it('refuses an evidence folder outside it, naming it', async () => {
    expect(
      await refusalOf([
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

  it('refuses a content file to write outside it, naming it', async () => {
    const out = join(OUTSIDE, 'content.json');
    expect(
      await refusalOf([
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
