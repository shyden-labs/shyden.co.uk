import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stringLeaves } from '../../src/lib/catalogue-leaves';
import { filesUnder, searched } from '../source-files';
import { floorBreach } from '../floors';
import { withoutTsComments } from './source-text';

const RELEASES = filesUnder('docs/releases', (p) => p.endsWith('.json'));
const SCRIPTS = [
  'scripts/release-inventory.mjs',
  'scripts/release-map.mjs',
  'scripts/build-release-content.mjs',
  'scripts/build-evidence-page.mjs',
];

describe('no script carries a release’s prose (#362)', () => {
  it('finds none of any release file’s sentences in the scripts that render it', () => {
    const phrases = RELEASES.flatMap((file) =>
      stringLeaves(JSON.parse(readFileSync(file, 'utf8'))).map(
        ([, phrase]) => phrase,
      ),
    ).filter((p) => p.length >= 24 && !/^[0-9a-f]{40}$/.test(p));
    const code = SCRIPTS.map((file) =>
      withoutTsComments(readFileSync(file, 'utf8')),
    ).join('\n');
    expect(
      searched(
        phrases.filter((p) => code.includes(p)),
        { of: phrases, what: 'release phrases' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('release-prose/phrases', phrases.length),
    ).toBeUndefined();
  });
});
