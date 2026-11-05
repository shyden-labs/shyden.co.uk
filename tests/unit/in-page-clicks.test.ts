import { describe, expect, it } from 'vitest';
import { inPageClicks } from '../in-page-clicks';

const scan = (...lines: string[]) => inPageClicks(lines.join('\n'));

describe('inPageClicks: a press made by script inside the page (#1003)', () => {
  it('finds el.click() inside page.evaluate', () => {
    expect(
      scan(
        'await page.evaluate(() => {',
        "  document.querySelector<HTMLElement>('label')?.click();",
        '});',
      ),
    ).toEqual([{ line: 2, within: 'evaluate' }]);
  });

  it('finds it inside a locator evaluate, evaluateAll and waitForFunction', () => {
    expect(
      scan(
        'await button.evaluate((b) => (b as HTMLElement).click());',
        'await rows.evaluateAll((all) => all.forEach((r) => (r as HTMLElement).click()));',
        'await page.waitForFunction(() => { document.body.click(); return true; });',
      ),
    ).toEqual([
      { line: 1, within: 'evaluate' },
      { line: 2, within: 'evaluateAll' },
      { line: 3, within: 'waitForFunction' },
    ]);
  });

  it('finds it in a function expression and in an init script', () => {
    expect(
      scan(
        'await page.addInitScript(function () {',
        '  document.getElementById("go").click();',
        '});',
      ),
    ).toEqual([{ line: 2, within: 'addInitScript' }]);
  });

  it("leaves Playwright's own locator.click() alone, awaited or not", () => {
    expect(
      scan(
        "await page.locator('#go').click();",
        "await Promise.all([page.waitForEvent('download'), button.click()]);",
        "const go = () => page.getByRole('button').click();",
      ),
    ).toEqual([]);
  });

  it('leaves a click() in the arguments passed beside the function alone', () => {
    expect(
      scan('await page.evaluate((n) => n * 2, await count.click());'),
    ).toEqual([]);
  });

  it('is neither tripped by a comment nor by a string', () => {
    expect(
      scan(
        'await page.evaluate(() => {',
        '  // label.click();',
        "  return 'label.click()';",
        '});',
      ),
    ).toEqual([]);
  });
});
