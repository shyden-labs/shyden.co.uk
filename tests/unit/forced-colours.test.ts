import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './css-rules';
import { astroTemplate, stylesheetCss } from './source-text';

/**
 * Forced colours, read from the source (#1048; Shyden's rulings 2026-11-06).
 * Playwright emulates forced colours in Chromium alone, so these were browser
 * tests that skipped every other engine. What makes them hold is in the
 * markup and the stylesheets, which are the same on every target.
 */
const SWITCH = 'src/components/ThemeSwitch.astro';
const TOKENS = 'src/styles/tokens.css';

const rulesOf = (file: string) =>
  stylesheetCss(file, readFileSync(file, 'utf8')).flatMap(cssRules);

describe('under forced colours', () => {
  it("the theme switch's icon draws in the button's own colour, with no fixed colour (Review Focus 4)", () => {
    const shapes = [
      ...astroTemplate(readFileSync(SWITCH, 'utf8')).matchAll(
        /<(?:path|circle)\b[^>]*>/g,
      ),
    ].map(([shape]) => shape.replace(/\s+/g, ' '));
    expect(shapes.length, 'the icons draw shapes').toBeGreaterThan(1);
    for (const shape of shapes) {
      const paints = [...shape.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)]
        .map(([, paint]) => paint)
        .filter((paint) => paint !== 'none');
      expect(paints, `${shape} paints with currentColor alone`).toEqual(
        paints.length > 0 ? paints.map(() => 'currentColor') : ['a paint'],
      );
    }
    const fixed = rulesOf(SWITCH).flatMap((rule) =>
      rule.declarations
        .filter(
          ({ property, value }) =>
            (property === 'fill' || property === 'stroke') &&
            value !== 'currentColor' &&
            value !== 'none',
        )
        .map(
          ({ property, value }) =>
            `${rule.chain.join(' ')} { ${property}: ${value} }`,
        ),
    );
    expect(fixed, 'a stylesheet rule giving the icon a fixed paint').toEqual(
      [],
    );
  });

  it('the ribbon is not drawn', () => {
    const declarations = rulesOf(TOKENS)
      .filter(
        ({ chain }) =>
          chain.length === 2 &&
          chain[0] === '@media (forced-colors: active)' &&
          chain[1] === 'body::after',
      )
      .flatMap((rule) => rule.declarations);
    expect(declarations).toContainEqual({ property: 'display', value: 'none' });
  });
});
