import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { trackedFiles } from '../source-files';
import {
  contrast,
  luminance,
  over,
  paintedGround,
  parseColour,
  type RGB,
} from '../wcag';
import { declaredName, parseSource } from '../unit/ast';
import { floorBreach } from '../floors';

/** The sRGB transfer curve's constants: the linear slope, then the curve's. */
const CURVE = [12.92, 1.055, 2.4];

/**
 * Every function in `source` whose own code spells the whole sRGB transfer
 * curve, as `file:name` (see 'the WCAG formula has one home' below).
 *
 * Numeric literals off the syntax tree, never text, so a comment or a string
 * that quotes the formula is not a copy. A nested function's literals are
 * its own and not its parent's, so the copy is named where it is written.
 */
const curvesIn = (source: string, file: string): string[] => {
  const found: string[] = [];
  const visit = (scope: ts.Node): void => {
    const literals = new Set<number>();
    const walk = (node: ts.Node): void => {
      // Every callback returns nothing: `forEachChild` stops at the first
      // child whose callback returns something truthy (#118).
      ts.forEachChild(node, (child) => {
        if (ts.isFunctionLike(child)) {
          visit(child);
          return;
        }
        if (ts.isNumericLiteral(child)) literals.add(Number(child.text));
        walk(child);
      });
    };
    walk(scope);
    if (
      ts.isFunctionLike(scope) &&
      CURVE.every((constant) => literals.has(constant))
    )
      found.push(`${file}:${declaredName(scope) ?? 'anonymous'}`);
  };
  visit(parseSource(source, file));
  return found;
};

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

describe('WCAG relative luminance and contrast', () => {
  it('spans 1:1 to 21:1, the two ends the standard fixes', () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBe(1);
    expect(luminance(WHITE)).toBeCloseTo(1, 10);
    expect(luminance(BLACK)).toBe(0);
  });

  it('does not care which colour is given first', () => {
    const accent: RGB = [10, 125, 102];
    expect(contrast(accent, WHITE)).toBe(contrast(WHITE, accent));
  });

  it('linearises at 0.04045, which no 8-bit channel can tell from 0.03928', () => {
    // The two copies this module replaced disagreed: WCAG 2.0's published
    // text says 0.03928 and sRGB / WCAG 2.1 say 0.04045 (#277). They cannot
    // ever disagree about a result. The thresholds straddle channel values
    // 10.0164 to 10.3148, and `v / 255` for an integer `v` never lands
    // there -- 10/255 is 0.0392 and 11/255 is 0.0431.
    //
    // Pinned so the claim is a measurement rather than a comment: this is
    // the arithmetic both constants agree on, either side of the gap.
    const under = (v: number) => v / 255 / 12.92;
    const overThreshold = (v: number) => ((v / 255 + 0.055) / 1.055) ** 2.4;
    expect(luminance([10, 10, 10])).toBeCloseTo(under(10), 12);
    expect(luminance([11, 11, 11])).toBeCloseTo(overThreshold(11), 12);
    // And nothing integral sits between them.
    expect(Math.ceil(0.03928 * 255)).toBe(Math.ceil(0.04045 * 255));
  });
});

/**
 * The formula has one home, found by its constants rather than by its shape
 * (#277, #371).
 *
 * `duplication.test.ts` compares whole function bodies of 120 printed
 * characters or more, and it caught the three copies #277 was filed against.
 * It could not catch the fourth: text-over-ribbon.spec.ts spelled `lin` and
 * `lum` inside a large `evaluate` callback, each too short to be compared,
 * in a body too big to resemble anything. This asks the question directly.
 */
describe('the WCAG formula has one home', () => {
  it('finds a function that spells the whole curve, and nothing else', () => {
    // The fourth copy, as it was written.
    const copy = [
      'export const score = () => page.evaluate(() => {',
      '  const lin = (v: number) => {',
      '    const c = v / 255;',
      '    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;',
      '  };',
      '  return lin(128);',
      '});',
    ].join('\n');
    expect(curvesIn(copy, 'copy.ts')).toEqual(['copy.ts:lin']);
    // Quoted in a comment or a string, as duplication.test.ts's fixtures
    // quote it, the formula is not a copy: beside a real one, only the real
    // one is found.
    const quoted = [
      '// return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;',
      "const fixture = () => 'c / 12.92 : ((c + 0.055) / 1.055) ** 2.4';",
    ].join('\n');
    expect(curvesIn(`${quoted}\n${copy}`, 'quoted.ts')).toEqual([
      'quoted.ts:lin',
    ]);
    // Split between two functions it is two halves, which is how the
    // measurement above pins the constant without being a formula itself.
    const halves = [
      'const under = (v: number) => v / 255 / 12.92;',
      'const over = (v: number) => ((v / 255 + 0.055) / 1.055) ** 2.4;',
    ].join('\n');
    expect(curvesIn(`${halves}\n${copy}`, 'halves.ts')).toEqual([
      'halves.ts:lin',
    ]);
  });

  it('lives in tests/wcag.ts alone, across the whole tracked tree', () => {
    const scanned = trackedFiles(
      (path) =>
        /^(src|tests|scripts)\//.test(path) && /\.(ts|mjs|js)$/.test(path),
    );
    expect(floorBreach('wcag/files', scanned.length)).toBeUndefined();
    // The home is in the result, so an empty scan cannot pass this.
    expect(
      scanned.flatMap((file) => curvesIn(readFileSync(file, 'utf8'), file)),
    ).toEqual(['tests/wcag.ts:channel']);
  });
});

describe('reading a CSS colour', () => {
  it('reads every form this repo writes', () => {
    expect(parseColour('#abc')).toEqual({ rgb: [170, 187, 204], alpha: 1 });
    expect(parseColour('#0A7D66')).toEqual({ rgb: [10, 125, 102], alpha: 1 });
    expect(parseColour('rgb(1, 2, 3)')).toEqual({ rgb: [1, 2, 3], alpha: 1 });
    // The space-separated form, which is how tokens.css writes a glass
    // surface, and the comma form, which is how a browser reports one.
    expect(parseColour('rgb(255 255 255 / 0.35)')).toEqual({
      rgb: [255, 255, 255],
      alpha: 0.35,
    });
    expect(parseColour('rgba(0, 0, 0, 0.5)')).toEqual({
      rgb: [0, 0, 0],
      alpha: 0.5,
    });
    expect(parseColour('rgb(0 0 0 / 50%)')).toEqual({
      rgb: [0, 0, 0],
      alpha: 0.5,
    });
  });

  it('says no rather than guessing', () => {
    // A guard that treats an unreadable colour as a readable one drops it
    // from the check silently, which is how #17's alpha tokens went unseen.
    for (const value of [
      '',
      'currentColor',
      '#ab',
      'rgb(1,2)',
      'transparentish',
    ])
      expect(parseColour(value), value).toBeNull();
  });

  it('reads transparent as CSS defines it: black at zero alpha', () => {
    // #142: Studio's band glow and Aurora's wordmark tile are `transparent`,
    // and a token this reader refused would drop out of every pair it sits in.
    expect(parseColour('transparent')).toEqual({ rgb: [0, 0, 0], alpha: 0 });
    expect(parseColour(' Transparent ')).toEqual({ rgb: [0, 0, 0], alpha: 0 });
  });
});

describe('putting a colour onto its ground', () => {
  it('is the ground at alpha 0 and the colour at alpha 1', () => {
    expect(over({ rgb: BLACK, alpha: 0 }, WHITE)).toEqual(WHITE);
    expect(over({ rgb: BLACK, alpha: 1 }, WHITE)).toEqual(BLACK);
  });

  it('changes the verdict, which is why it is done before judging', () => {
    // The case `print-legibility.spec.ts` read wrong before #277: it dropped
    // the alpha and measured this ink as pure black, 21:1 -- a colour it
    // would have passed as readable while the sheet shows barely a tint.
    const faint = parseColour('rgba(0, 0, 0, 0.1)');
    expect(contrast(faint!.rgb, WHITE)).toBeCloseTo(21, 5);
    const onPaper = over(faint!, WHITE);
    expect(onPaper).toEqual([230, 230, 230]);
    expect(contrast(onPaper, WHITE)).toBeLessThan(1.3);
  });
});

/**
 * Text sits on a stack: its nearest background is often translucent, over an
 * opaque card. `contrastRatio` stopped at the first background it found and
 * composited that over white, so dark Aurora's `--glass` (white at 5.5%) on
 * `--surface` scored as if it were on paper (#390 F127).
 */
describe('the ground text is painted on', () => {
  const glass = { rgb: [255, 255, 255] as RGB, alpha: 0.055 };
  const surface = { rgb: [7, 13, 22] as RGB, alpha: 1 };

  it('is the white canvas when nothing paints a background', () => {
    expect(paintedGround([])).toEqual([255, 255, 255]);
  });

  it('is an opaque background itself', () => {
    expect(paintedGround([surface])).toEqual([7, 13, 22]);
  });

  it('is a translucent layer over the opaque one behind it, not over white', () => {
    // 0.055 * 255 + 0.945 * (7, 13, 22), rounded: worked by hand.
    expect(paintedGround([glass, surface])).toEqual([21, 26, 35]);
  });

  it('ignores whatever an opaque layer covers', () => {
    const page = { rgb: [238, 241, 244] as RGB, alpha: 1 };
    expect(paintedGround([surface, page])).toEqual([7, 13, 22]);
  });

  it('stacks translucent layers nearest on top', () => {
    const red = { rgb: [255, 0, 0] as RGB, alpha: 0.5 };
    const blue = { rgb: [0, 0, 255] as RGB, alpha: 0.5 };
    const black = { rgb: [0, 0, 0] as RGB, alpha: 1 };
    // blue over black is (0, 0, 128); red over that is (128, 0, 64). The
    // other order would give (64, 0, 128).
    expect(paintedGround([red, blue, black])).toEqual([128, 0, 64]);
  });
});
