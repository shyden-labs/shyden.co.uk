import { describe, it, expect } from 'vitest';
import { unsettledExits } from '../board-settled-scan';

const scan = (...lines: string[]) => unsettledExits(lines.join('\n'));

describe('unsettledExits: an exit before the board has settled (#1007)', () => {
  it('names an Escape straight after a tap on Full screen', () => {
    expect(
      scan(
        "test('leaves', async ({ page }) => {",
        "  await tapOn(page.getByRole('button', { name: 'Full screen' }));",
        "  await page.keyboard.press('Escape');",
        '});',
      ),
    ).toEqual({
      opens: [2],
      findings: [{ line: 3, test: 'leaves', opened: 2 }],
    });
  });

  it('passes the same exit once openBoard has settled it', () => {
    expect(
      scan(
        "test('leaves', async ({ page }) => {",
        '  await openBoard(page);',
        "  await page.keyboard.press('Escape');",
        '});',
      ),
    ).toEqual({ opens: [2], findings: [] });
  });

  it('passes a raw tap followed by boardSettled', () => {
    expect(
      scan(
        "test('t', async ({ page }) => {",
        "  await tapOn(page.getByRole('button', { name: 'Full screen' }));",
        '  await boardSettled(page);',
        "  await page.keyboard.press('Escape');",
        '});',
      ).findings,
    ).toEqual([]);
  });

  it('names a press on Exit full screen, and an opener split over lines', () => {
    expect(
      scan(
        "test('split', async ({ page }) => {",
        '  await tapOn(',
        "    page.getByRole('button', { name: /Full screen|Layar penuh/ }).first(),",
        '  );',
        "  await tapOn(bar(page).getByRole('button', { name: 'Exit full screen' }));",
        '});',
      ).findings,
    ).toEqual([{ line: 5, test: 'split', opened: 2 }]);
  });

  it('follows a const that names the Full screen button', () => {
    expect(
      scan(
        "test('named', async ({ page }) => {",
        "  const open = page.getByRole('button', { name: 'Layar penuh' });",
        '  await tapOn(open);',
        "  await page.keyboard.press('Escape');",
        '});',
      ).findings,
    ).toEqual([{ line: 4, test: 'named', opened: 3 }]);
  });

  it('does not carry an opening into the next test', () => {
    expect(
      scan(
        "test('a', async ({ page }) => {",
        "  await tapOn(page.getByRole('button', { name: 'Full screen' }));",
        '});',
        'test(',
        "  'b',",
        '  async ({ page }) => {',
        "    await page.keyboard.press('Escape');",
        '  },',
        ');',
      ).findings,
    ).toEqual([]);
  });

  it('is neither tripped nor satisfied by a comment', () => {
    expect(
      scan(
        "test('c', async ({ page }) => {",
        "  await tapOn(page.getByRole('button', { name: 'Full screen' }));",
        '  // await openBoard(page);',
        "  await page.keyboard.press('Escape');",
        "  // await page.keyboard.press('Escape');",
        '});',
      ).findings,
    ).toEqual([{ line: 4, test: 'c', opened: 2 }]);
  });

  it('keeps the title when a runtime test.skip(condition) runs inside the test', () => {
    expect(
      scan(
        "test('race', async ({ page }) => {",
        '  test.skip(',
        '    !onRealDevice(),',
        "    'only the phone grants late',",
        '  );',
        "  await tapOn(page.getByRole('button', { name: 'Full screen' }));",
        "  await page.keyboard.press('Escape');",
        '});',
      ).findings,
    ).toEqual([{ line: 7, test: 'race', opened: 6 }]);
  });

  it('ignores a tap on any other button', () => {
    expect(
      scan(
        "test('d', async ({ page }) => {",
        "  await tapOn(page.getByRole('button', { name: 'Make Groups' }));",
        "  await page.keyboard.press('Escape');",
        '});',
      ),
    ).toEqual({ opens: [], findings: [] });
  });
});
