import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import {
  ATMOSPHERE,
  atmosphereLayers,
  computedForm,
  darkBlocks,
  ribbonGeometry,
  rootTokens,
  subsets,
  themeTokens,
  worstContrast,
} from '../palette';

describe('rootTokens', () => {
  it('reads the bare :root block, never the print block or a theme block', () => {
    const css = [
      '@media print {\n  :root { --bg: #fff; }\n}',
      ':root {\n  --bg: #04070d;\n  --ink: #eaf2ff;\n}',
      ":root[data-theme='dark'] { --bg: #000; }",
    ].join('\n');
    expect([...rootTokens(css)]).toEqual([
      ['--bg', '#04070d'],
      ['--ink', '#eaf2ff'],
    ]);
  });

  it('refuses a stylesheet with no bare :root, or with two', () => {
    expect(() => rootTokens('@media print { :root { --a: #fff; } }')).toThrow(
      'found 0',
    );
    expect(() =>
      rootTokens(':root { --a: #fff; }\n:root { --b: #000; }'),
    ).toThrow('found 2');
  });
});

describe('atmosphereLayers', () => {
  // A body::after sits beside it, as the ribbon does in tokens.css (#371),
  // and is NOT read: the ribbon is scored on the rendered page instead.
  const RIBBON =
    'radial-gradient(40rem 10rem at 20% 5rem, var(--ribbon), transparent 72%)';
  const before = (background: string): string =>
    `body::before {\n  content: '';\n  background: ${background};\n}\n` +
    `body::after {\n  content: '';\n  background: ${RIBBON};\n}\n` +
    '@media print {\n  body::before { display: none; }\n}\n';

  it('lists the layers top-first, in declaration order, one token each', () => {
    expect(
      atmosphereLayers(
        before(
          'radial-gradient(60rem 40rem at 12% -8%, var(--a), transparent 70%), ' +
            'linear-gradient(100deg, transparent 30%, var(--b) 50%, transparent 70%)',
        ),
      ),
    ).toEqual(['--a', '--b']);
  });

  it('refuses a layer it could not score', () => {
    expect(() =>
      atmosphereLayers(
        before(
          'radial-gradient(#fff, transparent), linear-gradient(var(--a), transparent)',
        ),
      ),
    ).toThrow('layer 1 names 0 tokens');
    expect(() =>
      atmosphereLayers(before('linear-gradient(var(--a), var(--b))')),
    ).toThrow('layer 1 names 2 tokens');
  });

  it('refuses a stylesheet with no screen body::before', () => {
    expect(() =>
      atmosphereLayers(
        `body::after { background: ${RIBBON}; }\n` +
          '@media print { body::before { background: var(--a); } }',
      ),
    ).toThrow('one top-level body::before rule');
  });
});

describe('ribbonGeometry', () => {
  // The atmosphere beside it and a print rule with its own height, as in
  // tokens.css: neither is the ribbon's screen box.
  const after = (declarations: string): string =>
    'body::before {\n  background: radial-gradient(90rem 90rem at 0% 0%, var(--pool), transparent 70%);\n}\n' +
    `body::after {\n  content: '';\n${declarations}\n}\n` +
    '@media print {\n  body::after { display: none; height: 99rem; }\n}\n';
  const TEAL =
    'radial-gradient(50rem 10rem at 20% 3rem, var(--a), transparent 72%)';
  const VIOLET =
    'radial-gradient(46rem 9rem at 62% 5rem, var(--b), transparent 50%)';

  it("reads the screen body::after's height and each field's reach, top-first, in rem", () => {
    const { height, reaches } = ribbonGeometry(
      after(`  height: 12rem;\n  background: ${TEAL}, ${VIOLET};`),
    );
    expect(height).toBe(12);
    expect(reaches).toHaveLength(2);
    expect(reaches[0]).toBeCloseTo(3 + 10 * 0.72);
    expect(reaches[1]).toBeCloseTo(5 + 9 * 0.5);
  });

  it('refuses a field whose reach it cannot derive', () => {
    for (const field of [
      'radial-gradient(circle at 20% 3rem, var(--a), transparent 72%)',
      'radial-gradient(50rem 160px at 20% 3rem, var(--a), transparent 72%)',
      'radial-gradient(50rem 10rem at 20% 3rem, var(--a), transparent)',
    ])
      expect(() =>
        ribbonGeometry(
          after(`  height: 12rem;\n  background: ${TEAL}, ${field};`),
        ),
      ).toThrow('cannot derive how far field 2 reaches');
  });

  it('refuses a box height not written in rem', () => {
    expect(() =>
      ribbonGeometry(after(`  height: 44vh;\n  background: ${TEAL};`)),
    ).toThrow('height must be one length in rem');
  });
});

describe('subsets', () => {
  it('lists all 2^n subsets, each keeping the original order', () => {
    const all = subsets(['a', 'b', 'c']);
    expect(all).toHaveLength(8);
    expect(all).toContainEqual([]);
    expect(all).toContainEqual(['a', 'c']);
    expect(all).toContainEqual(['a', 'b', 'c']);
    expect(
      searched(
        all.filter((s) => s.join('') !== [...s].sort().join('')),
        { of: all, what: 'subsets' },
      ),
    ).toEqual([]);
    expect(floorBreach('palette/subsets-of-three', all.length)).toBeUndefined();
  });
});

describe('worstContrast', () => {
  // Studio's shape (#142 spec §6.1): dark ink on a white ground, one layer
  // that darkens it and one, on top, that lightens it again. Every layer at
  // once passes; the darkening layer alone does not.
  const from = new Map([
    ['--bg', '#ffffff'],
    ['--ink', '#6f6f6f'],
    ['--shaft', 'rgb(255 255 255 / 0.9)'],
    ['--pool', 'rgb(0 0 0 / 0.15)'],
  ]);
  const layers = ['--shaft', '--pool'];

  it('finds the worst subset where every layer at once passes', () => {
    const everyLayer = worstContrast(
      ['--ink'],
      ['--shaft', '--pool', '--bg'],
      [],
      from,
    );
    expect(
      typeof everyLayer === 'string' ? 0 : everyLayer.ratio,
    ).toBeGreaterThan(4.5);
    expect(
      worstContrast(['--ink'], [ATMOSPHERE, '--bg'], layers, from),
    ).toEqual({
      ratio: expect.closeTo(3.56, 1),
      subset: ['--pool'],
    });
  });

  it('scores a pair that names no atmosphere once, as written', () => {
    expect(worstContrast(['--ink'], ['--bg'], layers, from)).toEqual({
      ratio: expect.closeTo(5.03, 1),
      subset: [],
    });
  });

  it('puts the same subset under the foreground and its ground', () => {
    // A border drawn over the atmosphere sits on the same pixel as the ground
    // it is judged against. Scored with independent subsets, the border over
    // no layer against the ground under the pool would read 1.49:1.
    const withBorder = new Map([...from, ['--line', 'rgb(0 0 0 / 0.3)']]);
    expect(
      worstContrast(
        ['--line', ATMOSPHERE, '--bg'],
        [ATMOSPHERE, '--bg'],
        ['--pool'],
        withBorder,
      ),
    ).toEqual({ ratio: expect.closeTo(2.04, 1), subset: ['--pool'] });
  });

  it('reports a stack it cannot flatten, rather than a ratio', () => {
    expect(worstContrast(['--missing'], ['--bg'], [], from)).toBe(
      '--missing is not defined in src/styles/tokens.css',
    );
  });
});

describe('the themes', () => {
  const css = [
    ':root {\n  color-scheme: light;\n  --bg: #eef1f4;\n  --ink: #111821;\n  --font: serif;\n}',
    "@media screen and (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n    color-scheme: dark;\n    --bg: #04070d;\n    --ink: #eaf2ff;\n  }\n}",
    "@media screen {\n  :root[data-theme='dark'] {\n    color-scheme: dark;\n    --bg: #04070d;\n    --ink: #eaf2ff;\n  }\n  :root[data-theme-switch] {\n    --switch-display: inline-flex;\n  }\n}",
    '@media print {\n  :root {\n    --bg: #fff;\n  }\n}',
  ].join('\n');

  it('finds every dark block by its color-scheme, never by its selector', () => {
    expect(darkBlocks(css).map(({ chain }) => chain.join(' { '))).toEqual([
      "@media screen and (prefers-color-scheme: dark) { :root:not([data-theme='light'])",
      "@media screen { :root[data-theme='dark']",
    ]);
  });

  it('reads light from bare :root, and dark as bare :root with a dark block laid over it', () => {
    expect([...themeTokens(css, 'light')]).toEqual([
      ['--bg', '#eef1f4'],
      ['--ink', '#111821'],
      ['--font', 'serif'],
    ]);
    expect([...themeTokens(css, 'dark')]).toEqual([
      ['--bg', '#04070d'],
      ['--ink', '#eaf2ff'],
      ['--font', 'serif'],
    ]);
  });

  it('refuses a dark theme that no block declares', () => {
    expect(() => themeTokens(':root {\n  --bg: #fff;\n}', 'dark')).toThrow(
      'no block in src/styles/tokens.css declares color-scheme: dark',
    );
  });

  it('writes a colour the way getComputedStyle reports it', () => {
    expect(computedForm('#eef1f4')).toBe('rgb(238, 241, 244)');
    expect(computedForm('rgb(17 24 33 / 0.05)')).toBe('rgba(17, 24, 33, 0.05)');
    expect(computedForm('transparent')).toBe('rgba(0, 0, 0, 0)');
    expect(() => computedForm('currentColor')).toThrow('not a colour');
  });
});
