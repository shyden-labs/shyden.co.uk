import { describe, expect, it } from 'vitest';
import { searched, trackedFiles } from '../source-files';
import { floorBreach } from '../floors';

/**
 * Every tracked path is made of plain names.
 *
 * `a9e193e` (#78) committed an 80-byte file named
 * ``ithout)\[\[:space:\]\]|'(zznevermatch)[[:space:]]|`` — one line of the
 * commit-msg hook's regex, split off by a heredoc that went wrong. Nothing
 * referenced it, so no guard that follows references could see it, and it
 * sat at the top of the tree for twenty days on its way to a release (#390,
 * finding F1). A name like that is never chosen; it is what a shell leaves
 * behind when quoting fails. So the rule is on the NAME, derived from what
 * git tracks rather than a list of the files we expect.
 *
 * One exception, and only where it means something: Astro reads a
 * `[param]` segment under `src/pages/` as a route parameter.
 */
const PLAIN = /^[A-Za-z0-9._-]+$/;
const ROUTE_PARAM = /^\[[a-z]+\](\.astro)?$/;

function isPlainPath(path: string): boolean {
  const route = path.startsWith('src/pages/');
  return path
    .split('/')
    .every(
      (segment) => PLAIN.test(segment) || (route && ROUTE_PARAM.test(segment)),
    );
}

describe('tracked paths', () => {
  it('every tracked path is made of plain names', () => {
    const paths = trackedFiles(() => true);
    const strays = paths.filter((path) => !isPlainPath(path));
    expect(searched(strays, { of: paths, what: 'tracked paths' })).toEqual([]);
    expect(floorBreach('tracked-paths/paths', paths.length)).toBeUndefined();
  });

  it('refuses the name a failed heredoc left behind', () => {
    expect(
      isPlainPath("ithout)\\[\\[:space:\\]\\]|'(zznevermatch)[[:space:]]|"),
    ).toBe(false);
  });

  it.each([
    'a file.txt',
    'notes/draft (2).md',
    'x|y',
    '$HOME',
    'tests/[locale]/index.astro',
    '[locale]/index.astro',
    'src/pages/[Locale]/index.astro',
    'src/pages/[...slug].astro',
    'src/pages//index.astro',
    '',
  ])('refuses %j', (path) => {
    expect(isPlainPath(path)).toBe(false);
  });

  it.each([
    'package.json',
    '.github/workflows/ci.yml',
    'src/pages/[locale]/index.astro',
    'src/pages/[locale]/yeetalk-calculators.astro',
    'src/assets/sfx/land-1.m4a',
  ])('accepts %j', (path) => {
    expect(isPlainPath(path)).toBe(true);
  });
});
