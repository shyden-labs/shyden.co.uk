import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { retiredToolHits } from '../retired-tools';
import { filesUnder, searched } from '../source-files';

/** Safari's WebDriver server stays out of the iPhone run (#859). */
const files = [
  ...['tests', 'scripts'].flatMap((dir) =>
    filesUnder(dir, (path) => /\.(ts|mjs|js|json)$/.test(path)),
  ),
  'package.json',
].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('the iPhone run drives Safari through our own Web Inspector client', () => {
  it('no test, script or package file names the retired WebDriver server in code', () => {
    expect(
      retiredToolHits(
        searched(files, { of: files, what: 'test, script and package files' }),
      ),
    ).toEqual([]);
  });
});
