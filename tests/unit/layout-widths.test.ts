import { describe, expect, it } from 'vitest';
import { layoutWidthsFrom } from '../layout-widths';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * A breakpoint is measured on BOTH sides: the last width one layout holds and
 * the first width the next one does (#329). Viewports are whole pixels, so
 * which two integers those are depends on how the query compares, and every
 * spelling of a width condition is pinned here against the edge it creates.
 * 719 and 720 is the pair for a 720px breakpoint however it is written.
 */
describe('the widths a stylesheet can lay out', () => {
  const edgesOf = (...mediaTexts: string[]) =>
    layoutWidthsFrom(mediaTexts).edges;

  it('reads both sides of a min-width and a max-width breakpoint', () => {
    expect(edgesOf('(min-width: 720px)')).toEqual([719, 720]);
    expect(edgesOf('(max-width: 719px)')).toEqual([719, 720]);
    expect(edgesOf('(min-width:720px)')).toEqual([719, 720]);
  });

  it('reads the range syntax the minifier writes', () => {
    expect(edgesOf('(width>=720px)')).toEqual([719, 720]);
    expect(edgesOf('(width<=719px)')).toEqual([719, 720]);
  });

  it('puts a strict comparison on the side its edge is really on', () => {
    // `width > 719px` first holds at 720, and `width < 720px` last holds at
    // 719. Read as `>=` and `<=`, they measured 718 and 719, then 720 and
    // 721: both widths on one side, and the other layout never measured.
    expect(edgesOf('(width > 719px)')).toEqual([719, 720]);
    expect(edgesOf('(width < 720px)')).toEqual([719, 720]);
  });

  it('reads a comparison written value first', () => {
    expect(edgesOf('(720px <= width)')).toEqual([719, 720]);
    expect(edgesOf('(719px < width)')).toEqual([719, 720]);
    expect(edgesOf('(719px >= width)')).toEqual([719, 720]);
    expect(edgesOf('(720px > width)')).toEqual([719, 720]);
  });

  it('reads both ends of a two-sided range', () => {
    expect(edgesOf('(480px <= width < 720px)')).toEqual([479, 480, 719, 720]);
  });

  it('rounds a fractional breakpoint to the whole pixels either side of it', () => {
    expect(edgesOf('(min-width: 719.5px)')).toEqual([719, 720]);
    expect(edgesOf('(max-width: 719.5px)')).toEqual([719, 720]);
    expect(edgesOf('(width > 719.5px)')).toEqual([719, 720]);
    expect(edgesOf('(width < 719.5px)')).toEqual([719, 720]);
  });

  it('reads em and rem at the 16px a media query resolves them against', () => {
    expect(edgesOf('(min-width: 45em)')).toEqual([719, 720]);
    expect(edgesOf('(width >= 45rem)')).toEqual([719, 720]);
  });

  it('reads a condition written in capitals, as CSS allows', () => {
    expect(edgesOf('(MIN-WIDTH: 720PX)')).toEqual([719, 720]);
    expect(edgesOf('(WIDTH >= 45REM)')).toEqual([719, 720]);
    expect(edgesOf('(720PX <= WIDTH)')).toEqual([719, 720]);
  });

  it('reads every query in a list', () => {
    expect(
      edgesOf('screen and (min-width: 720px), print and (max-width: 479px)'),
    ).toEqual([479, 480, 719, 720]);
  });

  it('reads nothing from a condition on anything but the viewport width', () => {
    const others = [
      '(min-height: 500px)',
      '(prefers-color-scheme: dark)',
      'print',
      '(device-width >= 600px)',
      '(min-device-width: 600px)',
    ];
    expect(
      searched(edgesOf(...others), { of: others, what: 'media conditions' }),
    ).toEqual([]);
    expect(
      floorBreach('layout-widths/non-width-conditions', others.length),
    ).toBeUndefined();
    // The same list with one width condition added finds exactly that one,
    // so the empty answer above is the filter working, not the reader dead.
    expect(edgesOf(...others, '(min-width: 720px)')).toEqual([719, 720]);
  });

  it('refuses a width condition it cannot read, rather than measuring around it', () => {
    // A breakpoint read as nothing loses both widths beside it, and every
    // guard measuring "every layout" then passes over that one (#390 F154).
    expect(() => edgesOf('(min-width: 660pt)')).toThrow(
      'cannot read a width condition in "(min-width: 660pt)"',
    );
    expect(() => edgesOf('(width >= 45ch)')).toThrow(/45ch/);
    expect(() => edgesOf('(30vw < width)')).toThrow(/30vw/);
    expect(() =>
      edgesOf('(min-width: 720px)', 'screen and (max-width: 40ex)'),
    ).toThrow(/40ex/);
  });

  it('lists each edge once, in order, strictly inside 320px to 1280px', () => {
    expect(
      layoutWidthsFrom([
        '(min-width: 720px)',
        '(width>=720px)',
        '(max-width: 479px)',
        '(min-width: 320px)',
        '(min-width: 1280px)',
      ]),
    ).toEqual({
      edges: [479, 480, 719, 720, 1279],
      widths: [320, 479, 480, 719, 720, 1279, 1280],
    });
  });

  it('stands 320px and 1280px for every width when nothing is declared', () => {
    expect(layoutWidthsFrom([])).toEqual({ edges: [], widths: [320, 1280] });
  });
});
