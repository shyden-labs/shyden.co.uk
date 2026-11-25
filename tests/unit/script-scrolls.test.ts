import { describe, expect, it } from 'vitest';
import { scriptScrolls } from '../script-scrolls';

const scan = (...lines: string[]) => scriptScrolls(lines.join('\n'));

describe('scriptScrolls: a scroll a browser test makes by protocol or page script (#1004)', () => {
  it("finds Playwright's protocol scroll on a locator", () => {
    expect(scan('await row.scrollIntoViewIfNeeded();')).toEqual([
      { line: 1, call: 'scrollIntoViewIfNeeded' },
    ]);
  });

  it('finds an element scrolled into view inside the page', () => {
    expect(
      scan(
        'await control.evaluate((el) => el.scrollIntoView({ block: "center" }));',
      ),
    ).toEqual([{ line: 1, call: 'scrollIntoView' }]);
  });

  it('finds the window or an element scrolled to or by an offset', () => {
    expect(
      scan(
        'await page.evaluate(() => window.scrollTo(0, 400));',
        'await page.evaluate(() => scrollBy(0, 400));',
        'await list.evaluate((el) => el.scrollTo({ top: 0 }));',
      ),
    ).toEqual([
      { line: 1, call: 'scrollTo' },
      { line: 2, call: 'scrollBy' },
      { line: 3, call: 'scrollTo' },
    ]);
  });

  it('is not tripped by a comment or a string naming one', () => {
    expect(
      scan(
        '// never el.scrollIntoView() here',
        "const refused = ['scrollIntoViewIfNeeded', 'scrollTo'];",
        '/* window.scrollBy(0, 1) */',
      ),
    ).toEqual([]);
  });

  it('leaves the real wheel and real-input helpers alone', () => {
    expect(
      scan(
        'await page.mouse.wheel(0, 400);',
        'await scrollToOn(row);',
        'await scrollOver(row, 200);',
      ),
    ).toEqual([]);
  });
});
