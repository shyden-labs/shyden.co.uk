import { describe, expect, it } from 'vitest';
import { directPresses } from '../direct-presses';

const scan = (...lines: string[]) => directPresses(lines.join('\n'));

describe('directPresses: a press or focus a spec makes without the real-input helpers (#1034)', () => {
  it('finds a locator focus(), hover(), click() and dblclick()', () => {
    expect(
      scan(
        'await page.locator("summary").focus();',
        'await count.hover();',
        'await page.getByRole("button").click();',
        'await send.dblclick();',
      ),
    ).toEqual([
      { line: 1, call: 'focus' },
      { line: 2, call: 'hover' },
      { line: 3, call: 'click' },
      { line: 4, call: 'dblclick' },
    ]);
  });

  it("finds the page's own selector forms", () => {
    expect(
      scan(
        "await page.focus('#cg-size');",
        "await page.click('#glory-submit');",
        "await page.hover('#cg-count');",
      ),
    ).toEqual([
      { line: 1, call: 'focus' },
      { line: 2, call: 'click' },
      { line: 3, call: 'hover' },
    ]);
  });

  it('finds one inside a function the page runs too', () => {
    expect(
      scan('await field.evaluate((el) => (el as HTMLElement).focus());'),
    ).toEqual([{ line: 1, call: 'focus' }]);
  });

  it('is not tripped by a comment, a string or a name that only contains the word', () => {
    expect(
      scan(
        '// await toggle.focus();',
        '/* page.click("#go") */',
        "const note = 'call .focus() here';",
        'await tapOn(button);',
        'await tabTo(page, toggle, browserName);',
        'await expect(link).toBeFocused();',
        'const focusRing = await refocus(page);',
        'await page.mouse.click(10, 20);',
      ),
    ).toEqual([]);
  });

  it('leaves the real mouse alone: page.mouse.click and page.mouse.dblclick are real input', () => {
    expect(
      scan(
        'await page.mouse.click(1, 2);',
        'await page.mouse.dblclick(1, 2);',
        'await page.mouse.move(1, 2);',
      ),
    ).toEqual([]);
  });
});
