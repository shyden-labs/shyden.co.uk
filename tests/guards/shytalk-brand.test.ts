import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { filesUnder, nonEmpty, searched } from '../source-files';
import { codeWithoutComments } from '../unit/source-text';
import {
  SHYTALK_MARK,
  asComputedRgb,
  asRgba,
} from '../../src/lib/shytalk-brand';
import { floorBreach } from '../floors';

/**
 * ShyTalk's brand mark has exactly one home (#17).
 *
 * The values belong to a product this repo does not own, so they WILL change.
 * The guard is not against them changing — it is against them being spelled
 * out in more than one place, which is what makes changing them expensive and
 * what makes a passing test a coincidence.
 */

/**
 * The only two places these values may be spelled out.
 *
 * `HOME` holds the value. `PIN` asserts the value is the RIGHT one, and must
 * write the literals to do it — a pin that reads them from `HOME` compares
 * the source against itself and passes at any colour (#117). Every other
 * spelling is a copy, and copies are what make a rebrand expensive.
 */
const HOME = 'src/lib/shytalk-brand.ts';
const PIN = 'tests/guards/shytalk-brand.test.ts';
const ALLOWED = new Set([HOME, PIN]);
const SCAN = ['src', 'tests'];

/**
 * One narrower exemption (#142 §3.4). The mark's tile is also a THEME token:
 * the theme, not the component, decides whether the mark sits on it, so
 * tokens.css declares `--wordmark-tile` with the tile's hex on bare `:root`.
 * That file may spell the tile and nothing else of the mark, and only once;
 * tests/unit/tokens.test.ts holds the value equal to SHYTALK_MARK.tile.
 */
const TOKEN_HOME = 'src/styles/tokens.css';
const TOKEN_FORM = SHYTALK_MARK.tile.toLowerCase();

/**
 * Every way a brand colour can be written: the hex, and the bare CHANNEL
 * TRIPLE.
 *
 * The triple rather than a wrapped `rgb(...)`, because the first version of
 * this guard searched for `rgb(208, 188, 255)` and missed
 * `rgba(208, 188, 255, 0.3)` sitting in a text-shadow two lines from a hit it
 * did find. A guard that knows one syntax is a guard against that syntax.
 */
const spellings = (): string[] =>
  Object.values(SHYTALK_MARK).flatMap((hex) => [
    hex.toLowerCase(),
    asComputedRgb(hex).replace(/^rgb\(|\)$/g, ''),
  ]);

const scannedFiles = (): string[] =>
  nonEmpty(
    SCAN.flatMap((dir) =>
      filesUnder(dir, (p) => /\.(ts|tsx|astro|css)$/.test(p)),
    ),
    `source files under ${SCAN.join(', ')}`,
  );

/**
 * Whether lower-cased `code` spells `form`. A hex is matched as written. A
 * channel triple is matched with either separator CSS accepts: commas, as
 * `rgb(208, 188, 255)` writes them, or spaces, as `rgb(208 188 255 / 0.3)`
 * does, the syntax `tokens.css` uses. The first version of this scan matched
 * the comma-and-space spelling alone, so both of those others passed it.
 */
const spells = (code: string, form: string): boolean => {
  if (form.startsWith('#')) return code.includes(form);
  const [red, green, blue] = form.split(', ');
  return new RegExp(
    `(?<![\\d.])${red}\\s*[,\\s]\\s*${green}\\s*[,\\s]\\s*${blue}(?![\\d.])`,
  ).test(code);
};

/**
 * `text` as the scan reads it: comments stripped, because a comment NAMING the
 * colour is documentation and a guard tripped by its own explanation is noise,
 * and lower-cased, because a hex is the same colour in either case.
 */
const codeOf = (file: string, text: string): string =>
  codeWithoutComments(file, text).toLowerCase();

/** A file on disk, read as `codeOf` reads it. */
const readCode = (file: string): string =>
  codeOf(file, readFileSync(file, 'utf8'));

/** Whether `text`, read as `file` is read, spells any form of the mark. */
const spellsTheMark = (file: string, text: string): boolean =>
  spellings().some((form) => spells(codeOf(file, text), form));

describe("ShyTalk's brand mark has one home", () => {
  /**
   * The LEVEL, pinned literally and separately from everything derived.
   *
   * Every other assertion here compares the repo against `SHYTALK_MARK`, so
   * moving a value moves both sides together and proves only the
   * relationship (#117). These are the actual colours of the real product.
   */
  it('is the mark the real product uses', () => {
    expect(SHYTALK_MARK.shy).toBe('#e8e0f0');
    expect(SHYTALK_MARK.talk).toBe('#d0bcff');
    expect(SHYTALK_MARK.tile).toBe('#0f0d15');
  });

  it('converts a hex to the form a computed style reports', () => {
    expect(asComputedRgb('#e8e0f0')).toBe('rgb(232, 224, 240)');
    expect(asComputedRgb('#0f0d15')).toBe('rgb(15, 13, 21)');
    expect(asComputedRgb('#fff')).toBe('rgb(255, 255, 255)');
  });

  it('keeps the alpha it is given, for the glow behind the wordmark', () => {
    // #390: HomePage.astro's text-shadow is `asRgba(SHYTALK_MARK.talk, 0.3)`,
    // and dropping the alpha left the whole unit suite green -- a glow
    // painted at full strength, noticed only by a screenshot.
    expect(asRgba('#d0bcff', 0.3)).toBe('rgba(208, 188, 255, 0.3)');
    expect(asRgba('#fff', 0)).toBe('rgba(255, 255, 255, 0)');
  });

  it('searches the channel triple, so rgba() cannot hide a brand colour', () => {
    // The concrete miss this closes: `rgba(208, 188, 255, 0.3)` in a
    // text-shadow, two lines from a hex the guard DID catch.
    expect(spellings()).toContain('208, 188, 255');
    expect(spellings().some((s) => s.startsWith('rgb('))).toBe(false);
  });

  it('exempts exactly two files and one token, and each file exists', () => {
    // An exemption naming a path that does not exist exempts nothing and
    // reads identically to one that works.
    const files = scannedFiles();
    for (const allowed of [...ALLOWED, TOKEN_HOME]) {
      expect(files, `${allowed} is not in the scanned set`).toContain(allowed);
    }
    expect(ALLOWED.size).toBe(2);
  });

  it('is spelled out nowhere else in the repo', () => {
    const files = scannedFiles();
    const forms = spellings();

    const offenders = files.flatMap((file) => {
      if (ALLOWED.has(file)) return [];
      const lower = readCode(file);
      const exempt = file === TOKEN_HOME ? [TOKEN_FORM] : [];
      const repeated = exempt.filter((form) => lower.split(form).length > 2);
      return [
        ...forms
          .filter(
            (form) =>
              spells(lower, form.toLowerCase()) && !exempt.includes(form),
          )
          .map((form) => `${file} spells out ${form}`),
        ...repeated.map((form) => `${file} spells out ${form} more than once`),
      ];
    });

    expect(
      searched(offenders, { of: files, what: 'source files scanned' }),
    ).toEqual([]);
    expect(
      floorBreach('shytalk-brand/spelling-scanned-files', files.length),
    ).toBeUndefined();
  });

  it('reads every source file, and as many as there are', () => {
    const files = scannedFiles();
    // Cross-checked on the files that do spell the mark, by the same reading
    // the verdict makes: the home spells every hex, and the token home spells
    // its one token exactly once, so a reader gone blind to a script or to a
    // stylesheet is caught by the file it missed.
    const home = readCode(HOME);
    const hexes = Object.values(SHYTALK_MARK);
    const unread = hexes.filter((hex) => !spells(home, hex.toLowerCase()));
    expect(
      searched(unread, {
        of: hexes,
        what: 'brand hexes',
      }),
    ).toEqual([]);
    expect(readCode(TOKEN_HOME).split(TOKEN_FORM).length - 1).toBe(1);
    // After the verdict, so a population that grew never hides a finding.
    expect(
      floorBreach('shytalk-brand/home-checked-hexes', hexes.length),
    ).toBeUndefined();
    expect(floorBreach('shytalk-brand/files', files.length)).toBeUndefined();
  });

  it.each([
    ['a hex in a stylesheet', 'a.css', '.a { color: #D0BCFF; }'],
    [
      'a comma triple in a stylesheet',
      'a.css',
      '.a { color: rgba(208, 188, 255, 0.3); }',
    ],
    [
      'a space triple in a stylesheet',
      'a.css',
      '.a { color: rgb(208 188 255 / 0.3); }',
    ],
    ['a tight triple in a script', 'a.ts', "const c = 'rgb(208,188,255)';"],
    [
      'a hex in a component style',
      'a.astro',
      '---\n---\n<p class="a">x</p>\n<style>\n  .a { color: #d0bcff; }\n</style>\n',
    ],
    [
      'a hex in component frontmatter',
      'a.astro',
      "---\nconst c = '#d0bcff';\n---\n<p>{c}</p>\n",
    ],
    [
      'a hex in a style attribute',
      'a.astro',
      '---\n---\n<p style="color: #d0bcff">x</p>\n',
    ],
    [
      'a hex in a tsx file',
      'a.tsx',
      "export const C = () => <p style={{ color: '#d0bcff' }} />;",
    ],
  ])('reads the mark spelled as %s', (_form, file, text) => {
    expect(spellsTheMark(file, text)).toBe(true);
  });

  it('does not read a triple inside longer numbers', () => {
    expect(spellsTheMark('a.css', '.a { grid-area: 1208 188 255; }')).toBe(
      false,
    );
    expect(spellsTheMark('a.css', '.a { color: rgb(208 188 2550); }')).toBe(
      false,
    );
  });
});
