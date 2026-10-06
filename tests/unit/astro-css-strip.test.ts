import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { floorBreach } from '../floors';
import { filesUnder, nonEmpty, searched } from '../source-files';
import {
  astroStyleViews,
  codeWithoutComments,
  cssComments,
  stylesheetCss,
  withoutTsComments,
} from './source-text';

/**
 * A guard that reads an `.astro` file reads its CSS as CSS (#203).
 *
 * `withoutCssComments` tracks quotes, so over a WHOLE `.astro` file an
 * apostrophe in frontmatter or template text opens a string it never sees
 * closed, and from there every comment is copied out as if it were live CSS.
 * Two guards read `.astro` files that way: `contrast.test.ts`, whose
 * `borderUsages()` files every `var(--border)` site under the last line
 * ending in `{`, and `shytalk-brand.test.ts`, which asserts a brand colour is
 * spelled out nowhere else. 8 of the 141 comments in `src/` `<style>` bodies
 * survived the first read and 2 survived the second.
 *
 * Neither gave a wrong answer: none of the survivors names `var(--border)` or
 * a brand colour, and none has a line ending in `{`. That is a property of
 * today's comments, not of the guards. The first comment that names one trips
 * a guard whose own docblock says comments cannot; the first whose line ends
 * in `{` becomes the "selector" the next real usage is filed under, which
 * classifies it against the wrong background with nothing going red.
 *
 * The fix is not a careful call site, because a careful call site is a thing
 * the next author has to know about. `stylesheetCss(file, text)` asks which
 * file the CSS came out of and reads it accordingly, and the last test here
 * holds the raw stripper to its own home so that no caller can take the other
 * road.
 */

const SRC = 'src';

const astroFiles = (): string[] =>
  nonEmpty(
    filesUnder(SRC, (path) => path.endsWith('.astro')),
    `.astro files under ${SRC}/`,
  );

/**
 * What each guard scans from a source file. Named rather than derived, and
 * the caller assertion below is what keeps the naming honest: a guard cannot
 * reach the raw stripper, so these are the only two roads into a file's CSS.
 */
const SCANS: ReadonlyArray<{
  guard: string;
  scan: (file: string, raw: string) => string[];
}> = [
  { guard: 'contrast.test.ts', scan: stylesheetCss },
  {
    guard: 'shytalk-brand.test.ts',
    scan: (file, raw) => [codeWithoutComments(file, raw)],
  },
];

/** The first line of a comment, which is enough to find it in the file. */
const firstLine = (comment: string): string =>
  comment.split('\n')[0]?.trim() ?? '';

/** A call to the raw CSS stripper, as opposed to a mention of its name. */
const STRIPS_CSS_DIRECTLY = /\bwithoutCssComments\s*\(/;

describe('a guard reading an .astro file reads its CSS as CSS (#203)', () => {
  it('reads a style comment out of a file whose template text has an apostrophe', () => {
    // The known positive, and the defect in miniature: the apostrophe in
    // "don't" is what derails a whole-file read.
    const page = [
      '---',
      'const label = "x";',
      '---',
      "<p>don't</p>",
      '<style>',
      '  /* keep the ink above AA */',
      '  a { color: red; }',
      '</style>',
    ].join('\n');

    expect(astroStyleViews(page).flatMap(cssComments)).toEqual([
      '/* keep the ink above AA */',
    ]);
    expect(stylesheetCss('p.astro', page).join('\n')).not.toContain(
      'keep the ink above AA',
    );
  });

  it('reads no comment from a file that holds no style element', () => {
    const page = '---\nconst a = 1;\n---\n<p>b</p>';
    expect(astroStyleViews(page).flatMap(cssComments)).toEqual([]);
  });

  it('counts a frontmatter comment as none of its CSS', () => {
    const page = '---\n/* not css */\nconst a = 1;\n---\n<style>a{b:c}</style>';
    expect(astroStyleViews(page).flatMap(cssComments)).toEqual([]);
  });

  it('scans no comment that the per-style read removes', () => {
    const files = astroFiles();
    const comments = files.flatMap((file) =>
      astroStyleViews(readFileSync(file, 'utf8')).flatMap(cssComments),
    );

    const survivors = files.flatMap((file) => {
      const raw = readFileSync(file, 'utf8');
      const inStyles = astroStyleViews(raw).flatMap(cssComments);
      return SCANS.flatMap(({ guard, scan }) =>
        scan(file, raw).flatMap((scanned) =>
          inStyles
            .filter((comment) => scanned.includes(comment))
            .map((comment) => `${guard} scans ${file}: ${firstLine(comment)}`),
        ),
      );
    });

    expect(
      searched(survivors, {
        of: comments,
        what: 'CSS comments in <style> bodies under src/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('astro-css-strip/style-comments', comments.length),
    ).toBeUndefined();
  });

  it('leaves the raw CSS stripper with no caller outside its own home', () => {
    // Derived from disk, never a list: a guard written next year is scanned
    // the day it appears. #24's sweep used the file list in its own issue and
    // #60 and #65 found six survivors between them.
    const scanned = nonEmpty(
      ['tests', 'scripts'].flatMap((dir) =>
        filesUnder(dir, (path) => /\.(ts|mjs)$/.test(path)),
      ),
      'test and script sources',
    ).sort();

    const callers = scanned.filter((path) =>
      STRIPS_CSS_DIRECTLY.test(withoutTsComments(readFileSync(path, 'utf8'))),
    );

    expect(callers).toEqual([
      // The suite that proves the stripper works, which must call it to do so.
      'tests/unit/source-text.test.ts',
      // The home. Everything else asks for a FILE's CSS, not a string's.
      'tests/unit/source-text.ts',
    ]);
  });
});
