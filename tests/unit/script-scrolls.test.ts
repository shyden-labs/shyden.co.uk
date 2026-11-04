import { describe, expect, it } from 'vitest';
import { scriptScrolls } from '../script-scrolls';

const scan = (...lines: string[]) => scriptScrolls(lines.join('\n'));

describe('scriptScrolls: a scroll made by script or protocol, not by a wheel or a finger (#1004)', () => {
  it("finds Playwright's scrollIntoViewIfNeeded()", () => {
    expect(scan('await row.scrollIntoViewIfNeeded();')).toEqual([
      { line: 1, how: 'scrollIntoViewIfNeeded' },
    ]);
  });

  it('finds scrollIntoView, scrollTo, scrollBy and scroll run in the page', () => {
    expect(
      scan(
        "await control.evaluate((el) => el.scrollIntoView({ block: 'center' }));",
        'await page.evaluate(() => window.scrollTo(0, 900));',
        'await page.evaluate(() => window.scrollBy(0, 40));',
        'await page.evaluate(() => document.body.scroll(0, 10));',
      ),
    ).toEqual([
      { line: 1, how: 'scrollIntoView' },
      { line: 2, how: 'scrollTo' },
      { line: 3, how: 'scrollBy' },
      { line: 4, how: 'scroll' },
    ]);
  });

  it('finds a scroll position written by assignment, plain or compound', () => {
    expect(
      scan(
        'await page.evaluate(() => { document.scrollingElement!.scrollTop = 500; });',
        'await list.evaluate((el) => { el.scrollLeft += 20; });',
      ),
    ).toEqual([
      { line: 1, how: 'scrollTop =' },
      { line: 2, how: 'scrollLeft +=' },
    ]);
  });

  it('ignores a comment, a string, a read of the position and a real wheel', () => {
    expect(
      scan(
        '// el.scrollIntoView() would be a script scroll',
        "const banned = ['scrollIntoViewIfNeeded', 'scrollTo('];",
        'const y = await page.evaluate(() => window.scrollY + document.body.scrollTop);',
        'if (el.scrollTop === 0) await page.mouse.wheel(0, 240);',
      ),
    ).toEqual([]);
  });
});
