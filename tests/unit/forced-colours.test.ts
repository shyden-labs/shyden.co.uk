import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './css-rules';

/**
 * Forced colours, read from the stylesheets (#1048, Shyden's ruling
 * 2026-11-05): Playwright emulates forced colours in Chromium alone, so these
 * were browser tests that skipped four engines. What makes them hold is in
 * the source, and the source is the same on every target.
 */
const read = (path: string) => readFileSync(path, 'utf8');

describe('under forced colours', () => {
  it("the theme switch's icon paints the button's own colour, with no fixed colour of its own (Review Focus 4)", () => {
    const source = read('src/components/ThemeSwitch.astro');
    const shapes = [...source.matchAll(/<(path|circle)\b[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(shapes.length, 'the icon draws something').toBeGreaterThan(1);
    for (const shape of shapes) {
      const paints = [...shape.matchAll(/\b(fill|stroke)="([^"]*)"/g)]
        .map((m) => m[2])
        .filter((paint) => paint !== 'none');
      expect(paints.length, `${shape} paints nothing`).toBeGreaterThan(0);
      for (const paint of paints) expect(paint, shape).toBe('currentColor');
    }
    const style = source.slice(source.indexOf('<style'));
    for (const rule of cssRules(style.replace(/<\/?style[^>]*>/g, '')))
      for (const d of rule.declarations)
        if (d.property === 'fill' || d.property === 'stroke')
          expect(d.value, `${rule.chain.join(' ')} sets ${d.property}`).toBe(
            'currentColor',
          );
  });

  it('the ribbon is not drawn', () => {
    const hidden = cssRules(read('src/styles/tokens.css')).filter(
      (rule) =>
        rule.chain.length === 2 &&
        rule.chain[0] === '@media (forced-colors: active)' &&
        rule.chain[1] === 'body::after',
    );
    expect(hidden.flatMap((rule) => rule.declarations)).toContainEqual({
      property: 'display',
      value: 'none',
    });
  });
});
