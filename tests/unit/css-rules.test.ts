import { describe, expect, it } from 'vitest';
import {
  codeColourLiterals,
  colourLiterals,
  cssRules,
  NAMED_COLOURS,
  onPaper,
} from './css-rules';
import { floorBreach } from '../floors';
import { searched } from '../source-files';

describe('cssRules', () => {
  it('keeps every block header a rule sits under, outermost first', () => {
    const rules = cssRules(
      '.a { color: red; }\n@media print {\n  .a { color: black; }\n}\n',
    );
    expect(rules.map((rule) => rule.chain)).toEqual([
      ['.a'],
      ['@media print'],
      ['@media print', '.a'],
    ]);
  });

  it('reads nested blocks at any depth', () => {
    const rules = cssRules(
      '@media screen { @supports (display: grid) { .a { color: red; } } }',
    );
    expect(rules.at(-1)?.chain).toEqual([
      '@media screen',
      '@supports (display: grid)',
      '.a',
    ]);
  });

  it('reads each declaration whole, the last one without its semicolon', () => {
    const [rule] = cssRules(
      '.a {\n  color: red;\n  background:\n    #fff\n}\n',
    );
    expect(rule.declarations).toEqual([
      { property: 'color', value: 'red' },
      { property: 'background', value: '#fff' },
    ]);
  });

  it('collapses whitespace in a header, so a list reads the same however it wraps', () => {
    const [rule] = cssRules('.a,\n  .b   .c {\n  color: red;\n}');
    expect(rule.chain).toEqual(['.a, .b .c']);
  });

  it('opens nothing for a brace or a semicolon inside a quoted string', () => {
    const rules = cssRules(
      '.a::before { content: \'{;}\'; color: red; }\n.b { content: "}" }',
    );
    expect(
      rules.map((rule) => [
        rule.chain,
        rule.declarations.map((declaration) => declaration.property),
      ]),
    ).toEqual([
      [['.a::before'], ['content', 'color']],
      [['.b'], ['content']],
    ]);
  });

  it('keeps an escaped quote inside its string', () => {
    const [rule] = cssRules(".a { content: 'it\\'s {'; color: red; }");
    expect(
      rule.declarations.map((declaration) => declaration.property),
    ).toEqual(['content', 'color']);
  });

  it('drops a statement outside every block, such as an @import', () => {
    const rules = cssRules("@import 'x.css';\n.a { color: red; }");
    expect(rules.map((rule) => rule.chain)).toEqual([['.a']]);
  });

  it('reads a rule after a long blank prefix, the shape stylesheetCss hands over', () => {
    // An .astro <style> view is the whole file with everything outside the
    // style blanked, so its first rule can sit thousands of characters down.
    const rules = cssRules(`${' \n'.repeat(50_000)}.a { color: red; }`);
    expect(rules).toEqual([
      { chain: ['.a'], declarations: [{ property: 'color', value: 'red' }] },
    ]);
  });
});

describe('colourLiterals', () => {
  it('finds hex in every length CSS accepts, in either case', () => {
    expect(colourLiterals('#fff #FFFF #a1b2c3 #A1B2C3D4')).toEqual([
      '#fff',
      '#FFFF',
      '#a1b2c3',
      '#A1B2C3D4',
    ]);
  });

  it('finds every colour function, legacy and modern', () => {
    const functions = [
      'rgb(0 0 0 / 0.18)',
      'rgba(0, 0, 0, 0.5)',
      'hsl(214 92% 88%)',
      'hsla(0 0% 0% / 1)',
      'hwb(0 0% 0%)',
      'lab(50% 0 0)',
      'lch(50% 0 0)',
      'oklab(0.5 0 0)',
      'oklch(70% 0.1 200)',
      'color(display-p3 1 0 0)',
    ];
    expect(colourLiterals(functions.join(' '))).toEqual(functions);
  });

  it('reads a function holding a nested call whole', () => {
    expect(colourLiterals('rgb(calc(10 + 5) 0 0)')).toEqual([
      'rgb(calc(10 + 5) 0 0)',
    ]);
  });

  it('finds a named colour in any case, including one inside color-mix()', () => {
    expect(colourLiterals('1px solid White')).toEqual(['White']);
    expect(
      colourLiterals('color-mix(in srgb, white 20%, var(--accent))'),
    ).toEqual(['white']);
  });

  it('finds several literals in the order they are written', () => {
    expect(
      colourLiterals('linear-gradient(red, #fff 50%, rgb(0 0 0))'),
    ).toEqual(['red', '#fff', 'rgb(0 0 0)']);
  });

  it('counts nothing that fixes no colour', () => {
    const none = [
      'transparent',
      'currentColor',
      'Canvas',
      'CanvasText',
      'var(--ink)',
      'inherit',
      'none',
      'nowrap',
      'pulse-red 1s',
      "'Red Hat Display'",
      'url(red.png)',
      'url(#fff)',
      '&#123;',
      'color-mix(in srgb, var(--a), var(--b))',
    ];
    expect(
      searched(
        none.filter((value) => colourLiterals(value).length > 0),
        { of: none, what: 'values that fix no colour' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('css-rules/no-colour-values', none.length),
    ).toBeUndefined();
  });

  it('knows every CSS named colour once', () => {
    expect(NAMED_COLOURS).toHaveLength(148);
    expect(new Set(NAMED_COLOURS).size).toBe(148);
    expect(NAMED_COLOURS).toContain('rebeccapurple');
    expect(NAMED_COLOURS).not.toContain('transparent');
  });
});

describe('onPaper', () => {
  it('holds for a rule inside a print-only media block', () => {
    const onPrint = [
      ['@media print', '.a'],
      ['@media only print', '.a'],
      ['@media print and (orientation: portrait)', '.a'],
      ['@media screen', '@media print', '.a'],
    ];
    expect(
      searched(
        onPrint.filter((chain) => !onPaper(chain)),
        { of: onPrint, what: 'rules inside a print-only media block' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('css-rules/print-only-chains', onPrint.length),
    ).toBeUndefined();
  });

  it('does not hold for a rule outside every print-only media block', () => {
    const offPrint = [
      ['.a'],
      ['@media screen', '.a'],
      ['@media screen, print', '.a'],
      ['@media not print', '.a'],
    ];
    expect(
      searched(
        offPrint.filter((chain) => onPaper(chain)),
        { of: offPrint, what: 'rules outside every print-only media block' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('css-rules/not-print-only-chains', offPrint.length),
    ).toBeUndefined();
  });
});

describe('codeColourLiterals', () => {
  it('finds hex and colour functions anywhere in code', () => {
    expect(
      codeColourLiterals(
        "const tile = '#1a2b3c';\nconst c = `rgb(${r}, ${g}, ${b})`;\nfill=\"#FF0\"\n'hsl(214 92% 88%)' 'oklch(70% 0.1 200)'",
      ),
    ).toEqual([
      '#1a2b3c',
      '#FF0',
      'rgb(${r}, ${g}, ${b})',
      'hsl(214 92% 88%)',
      'oklch(70% 0.1 200)',
    ]);
  });

  it('finds a named colour only as a whole string or in a style attribute', () => {
    expect(
      codeColourLiterals(
        "const a = 'white';\nconst b = 'white rabbit';\n<p style=\"color: Red; margin: 0\">x</p>",
      ),
    ).toEqual(['white', 'Red']);
  });

  it('never reads a character reference or a call named color() as a colour', () => {
    const lookalikes = ['&#123;', '&#x2014;', 'color(x)', 'theme.color(y)'];
    expect(
      searched(codeColourLiterals(lookalikes.join(' ')), {
        of: lookalikes,
        what: 'colour lookalikes',
      }),
    ).toEqual([]);
    expect(
      floorBreach('css-rules/colour-lookalikes', lookalikes.length),
    ).toBeUndefined();
  });

  it('finds a hex-shaped issue number too, which only an allowlist can excuse', () => {
    expect(codeColourLiterals("'see #161 for why'")).toEqual(['#161']);
  });
});
