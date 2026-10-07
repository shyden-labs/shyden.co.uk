import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';
import { stylesheetCss } from './source-text';
import { floorBreach } from '../floors';

/**
 * CSS Masking deprecates `clip` in favour of `clip-path`, and a deprecated
 * property can lose support (#200). This site hides text from sight, while
 * keeping it for screen readers, with `clip-path: inset(50%)`, as
 * `BetaBadge.astro` does. Two recipes for one job means the next hidden label
 * copies whichever it finds first, so the old one is kept out here.
 *
 * Reads CSS with its comments stripped, so a comment naming the old recipe
 * cannot trip the guard. Reads each `<style>` body, never the whole `.astro`
 * file: template text such as "don't" opens a quote the CSS stripper never
 * sees closed, and every comment below it would then be read as CSS.
 */

/**
 * A declaration: a property, a colon and a value, starting a block or
 * following a `;`, and ended by a `;` or a `}`. A selector such as `a:hover`
 * is ended by a `{`, so it is not one.
 */
const DECLARATION = /(?:^|[{;])\s*(-{0,2}[a-z][\w-]*\s*:[^;{}]*)(?=[;}])/gi;

/** Every declaration in `css`, which reaches here comment-free. */
const declarationsIn = (css: string): string[] =>
  [...css.matchAll(DECLARATION)].map(([, declaration]) => declaration.trim());

/**
 * A `clip` declaration: the property itself, in any case. `clip-path`, a
 * custom property such as `--clip`, and the `clip` keyword of `overflow` are
 * not one.
 */
const CLIP = /^clip\s*:/i;

/** Every `clip` declaration in `css`. */
const clipDeclarations = (css: string): string[] =>
  declarationsIn(css).filter((declaration) => CLIP.test(declaration));

/**
 * A name standing for the dialect a fixture is written in.
 *
 * `stylesheetCss` picks its reader by extension, and a fixture has no file of
 * its own — which is the point: there is no way to ask for a stylesheet's CSS
 * without saying what kind of file it came out of (#203).
 */
const CSS_FIXTURE = 'fixture.css';

/** Each stylesheet under `dir`, comment-free: a `.css` file whole, an `.astro` file's `<style>`s. */
const stylesheetsUnder = (dir: string): Array<{ file: string; css: string }> =>
  filesUnder(dir, (path) => /\.(astro|css)$/.test(path)).flatMap((file) =>
    stylesheetCss(file, readFileSync(file, 'utf8')).map((css) => ({
      file,
      css,
    })),
  );

/**
 * A file that plainly holds CSS, read as text: a stylesheet with a rule
 * holding a colon, or a component with a `<style` tag. Independent of both
 * readers, so one gone blind to a form is caught by the file it read no
 * declaration in (#446).
 */
const HOLDS_CSS = (file: string): RegExp =>
  file.endsWith('.css') ? /\{[^}]*:/ : /<style\b/;

describe('no stylesheet declares the deprecated clip property (#200)', () => {
  it('reads a clip declaration however it is spelled', () => {
    const css = [
      '.a { position: absolute; clip: rect(0 0 0 0); }',
      '.b{CLIP:auto}',
      '@media (min-width: 600px) { .c { clip :rect(1px, 2px, 3px, 4px) } }',
    ].join('\n');
    expect(
      clipDeclarations(stylesheetCss(CSS_FIXTURE, css).join('\n')),
    ).toEqual([
      'clip: rect(0 0 0 0)',
      'CLIP:auto',
      'clip :rect(1px, 2px, 3px, 4px)',
    ]);
  });

  it('is not tripped by clip-path, a custom property, the keyword or a comment', () => {
    const css = [
      '.a { clip-path: inset(50%); }',
      '.b { --clip: 1px; overflow: clip; }',
      '.c { /* was: position: absolute; clip: rect(0 0 0 0); */ }',
    ].join('\n');
    const sheet = stylesheetCss(CSS_FIXTURE, css).join('\n');
    const judged = declarationsIn(sheet);
    expect(
      searched(clipDeclarations(sheet), {
        of: judged,
        what: 'declarations in the fixture',
      }),
    ).toEqual([]);
    expect(
      floorBreach('deprecated-css/lookalike-declarations', judged.length),
    ).toBeUndefined();
  });

  it('finds none in any stylesheet under src/', () => {
    // The population is the declarations judged, not the sheets opened: a
    // reader blind to every declaration would open each sheet and pass (#446).
    const declarations = stylesheetsUnder('src').flatMap(({ file, css }) =>
      declarationsIn(css).map((declaration) => ({ file, declaration })),
    );
    const findings = declarations
      .filter(({ declaration }) => CLIP.test(declaration))
      .map(({ file, declaration }) => `${file}: ${declaration}`);
    const judged = declarations.map(({ declaration }) => declaration);
    expect(
      searched(findings, {
        of: judged,
        what: 'declarations under src/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('deprecated-css/judged-declarations', judged.length),
    ).toBeUndefined();
  });

  it('reads every declaration the stylesheets hold, and as many as there are', () => {
    const sheets = stylesheetsUnder('src');
    // Read as text, independently of either reader: a file holding a
    // `<style>` tag or a stylesheet's rule that yields no declaration is a
    // form one of them has gone blind to.
    const files = filesUnder('src', (path) => /\.(astro|css)$/.test(path));
    const unread = files.filter(
      (file) =>
        HOLDS_CSS(file).test(readFileSync(file, 'utf8')) &&
        !sheets.some(
          (sheet) =>
            sheet.file === file && declarationsIn(sheet.css).length > 0,
        ),
    );
    expect(
      searched(unread, {
        of: files,
        what: 'stylesheets and components under src/',
      }),
    ).toEqual([]);
    // After the verdict, so a population that grew never hides a finding.
    expect(
      floorBreach('deprecated-css/css-sources', files.length),
    ).toBeUndefined();
    expect(
      floorBreach(
        'deprecated-css/declarations',
        sheets.flatMap(({ css }) => declarationsIn(css)).length,
      ),
    ).toBeUndefined();
  });

  it.each([
    ['a stylesheet', 'case.css', '.a { clip: auto; }'],
    [
      'a component style',
      'case.astro',
      '<p>x</p>\n<style>\n  .a { clip: auto; }\n</style>',
    ],
    [
      'a global style',
      'case.astro',
      '<p>x</p>\n<style is:global>\n  .a { clip: auto; }\n</style>',
    ],
    [
      'an inline style',
      'case.astro',
      '<p>x</p>\n<style is:inline>\n  .a { clip: auto; }\n</style>',
    ],
    [
      'the last declaration of a block',
      'case.css',
      '.a { color: red; clip: auto }',
    ],
  ])('finds one in %s', (_where, file, text) => {
    expect(stylesheetCss(file, text).flatMap(clipDeclarations)).toEqual([
      'clip: auto',
    ]);
  });
});
