import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { callsIn } from '../playwright-declarations';
import { parseSource } from '../unit/ast';
import { blankCommentLines } from '../unit/source-text';
import {
  expectNothingFound,
  type Analyze,
  type Liveness,
} from '../unit/spec-scan';

/**
 * Every Playwright capture is taken after a painted frame (#676).
 *
 * `text-over-ribbon.spec.ts` captured the instant after it appended a
 * `<style>`, and twice in CI Chromium answered `Page.captureScreenshot` with
 * "Unable to capture screenshot", failing pull requests that changed nothing
 * on that path. `captureAfterPaint` (`tests/e2e/painted.ts`) awaits a painted
 * frame first and names the refusal if it still comes. This guard keeps a
 * capture written later from going round it: every `.screenshot(` call in a
 * Playwright file sits inside a `captureAfterPaint(` call.
 *
 * A Playwright file is one that imports `@playwright/test` or the e2e
 * `fixtures` module. `tests/device/ios` captures through WebDriver
 * (`driver.screenshot()`), which has no `Page.captureScreenshot` and no page
 * to wait on, so it is outside this rule rather than exempt from it.
 *
 * The unit is the call, read from the parse tree; the per-file count beside it
 * reads the same files as text with comments blanked, so a reader blind to a
 * spelling of the call is caught in the file where the two disagree (#477).
 */

/** An import of Playwright itself, or of the e2e fixtures built on it. */
const PLAYWRIGHT_IMPORT =
  /\bfrom\s+['"](?:@playwright\/test|(?:\.{1,2}\/)+(?:[\w-]+\/)*fixtures)['"]/;

const isPlaywrightFile = (source: string): boolean =>
  PLAYWRIGHT_IMPORT.test(blankCommentLines(source));

const isCapture = (call: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(call.expression) &&
  call.expression.name.text === 'screenshot';

const insideCaptureAfterPaint = (node: ts.Node): boolean => {
  for (let up = node.parent; up !== undefined; up = up.parent) {
    if (
      ts.isCallExpression(up) &&
      ts.isIdentifier(up.expression) &&
      up.expression.text === 'captureAfterPaint'
    ) {
      return true;
    }
  }
  return false;
};

const capturesBeforePaint: Analyze = (file, source) => {
  if (!isPlaywrightFile(source)) return { judged: [], findings: [] };
  const sf = parseSource(source, file);
  const judged: string[] = [];
  const findings: string[] = [];
  for (const call of callsIn(sf).filter(isCapture)) {
    const line = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
    judged.push(`${file}:${line}`);
    if (!insideCaptureAfterPaint(call)) {
      findings.push(
        `${file}:${line} — a capture taken without captureAfterPaint ` +
          '(tests/e2e/painted.ts), so Chromium may have no frame to give (#676)',
      );
    }
  }
  return { judged, findings };
};

/** The same file's captures counted as text, comments blanked: independent of the tree. */
const captureText = (_file: string, source: string): number =>
  isPlaywrightFile(source)
    ? (blankCommentLines(source).match(/\.screenshot\s*\(/g) ?? []).length
    : 0;

const captures: Liveness = {
  what: 'Playwright captures',
  carries: (file, source) => captureText(file, source) > 0,
  count: captureText,
};

describe('capturesBeforePaint -- the scan proven on synthetic input', () => {
  const scan = (...lines: string[]) =>
    capturesBeforePaint('synthetic.spec.ts', lines.join('\n'));

  it('judges a capture inside captureAfterPaint and passes it', () => {
    expect(
      scan(
        "import { test } from './fixtures';",
        "test('x', async ({ page }) => {",
        '  await captureAfterPaint(page, () => page.screenshot());',
        '});',
      ),
    ).toEqual({ judged: ['synthetic.spec.ts:3'], findings: [] });
  });

  it('names a capture taken outside it, page or locator alike', () => {
    expect(
      scan(
        "import { test } from '@playwright/test';",
        "test('x', async ({ page }) => {",
        '  await page.screenshot();',
        "  await page.locator('h1').screenshot();",
        '});',
      ).findings,
    ).toEqual([
      'synthetic.spec.ts:3 — a capture taken without captureAfterPaint (tests/e2e/painted.ts), so Chromium may have no frame to give (#676)',
      'synthetic.spec.ts:4 — a capture taken without captureAfterPaint (tests/e2e/painted.ts), so Chromium may have no frame to give (#676)',
    ]);
  });

  it('judges a WebDriver capture in a file that imports no Playwright as outside the rule', () => {
    expect(
      scan(
        "import { execFileSync } from 'node:child_process';",
        'const png = await driver.screenshot();',
      ),
    ).toEqual({ judged: [], findings: [] });
  });

  it('is not satisfied by a Playwright import in a comment', () => {
    expect(
      scan(
        "// import { test } from '@playwright/test';",
        'const png = await page.screenshot();',
      ),
    ).toEqual({ judged: [], findings: [] });
  });
});

describe('every Playwright capture is taken after a painted frame (#676)', () => {
  it('never captures outside captureAfterPaint', () => {
    expectNothingFound(capturesBeforePaint, captures);
  });

  it('refuses a file where the tree and the text count differently', () => {
    // The per-file count's own liveness (#477): one capture more than the
    // scan judged, in every file that holds one.
    expect(() =>
      expectNothingFound(capturesBeforePaint, {
        ...captures,
        count: (file, source) => {
          const n = captureText(file, source);
          return n > 0 ? n + 1 : 0;
        },
      }),
    ).toThrow(/judged \d+, counted another way \d+/);
  });
});
