import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { callsIn } from '../playwright-declarations';
import { parseSource } from './ast';
import { blankCommentLines } from './source-text';
import { expectNothingFound, type Analyze, type Liveness } from './spec-scan';

/**
 * An evidence capture belongs AFTER the assertion it documents (#261).
 *
 * `tests/e2e/evidence.ts` builds `shoot` on one property, and the evidence
 * page prints that property to the operator in words
 * (`scripts/build-evidence-page.mjs`): "Playwright stops a test at its first
 * failed expectation, so a present image IS the result."
 *
 * That sentence is only true while every capture sits below the assertion it
 * claims to document. A capture taken FIRST photographs the page whether the
 * assertion goes on to pass or fail, and the picture still reaches the page
 * under a caption telling the operator its presence is the proof. The run's
 * status dot marks the test failed, so it is not invisible -- but a picture
 * that looks like proof and is not is the exact failure `evidence.ts` opens
 * by warning about, and it is worse than no picture at all.
 *
 * Two captures shipped that way, both added by the ticket that asked for
 * them: `classroom-groups-print.spec.ts` shot the register above the only
 * `expect` in its test, in the two tests that decide which columns reach
 * paper. Nothing could see it -- the suite was green, because the ordering
 * changes no verdict.
 *
 * What counts as an assertion is a CONSTRUCT question, not a string one. A
 * first cut of this scan matched the literal `expect(` token and reported
 * `homepage.spec.ts`'s overflow capture, whose assertion is
 * `expectNoHorizontalScroll(page)` -- real, and behind a helper. Reporting a
 * correct site is not a harmless false alarm: it is how a guard gets widened
 * around the code it flagged until it stops meaning anything (#118). So an
 * assertion here is any call named `expect` or `expectSomething`, wherever it
 * is reached from, which covers `reported.expectNone(...)` as well.
 *
 * The boundary resets at each `test(`/`test.describe(` AND at each capture, so
 * the ordinary journey rhythm -- assert, shoot, assert, shoot -- passes, while
 * a second capture leaning on the first one's assertion does not.
 *
 * Comments are blanked rather than removed so a finding can name its line, and
 * so this file's own prose cannot satisfy the scan it describes.
 */

/** `test(`, `test.describe(`, `test.beforeEach(` -- a new scope begins. */
const SCOPE = /^\s*test(?:\.\w+)?\s*\(/;

/** `expect(`, `expectNoHorizontalScroll(`, `reported.expectNone(`. */
const ASSERTION = /\bexpect(?:[A-Z]\w*)?\s*\(|\btoHaveScreenshot\s*\(/;

/** The capture call itself, never its definition (`const shoot = async (`). */
const CAPTURE = /\bshoot\s*\(/;

const capturesBeforeAssertion: Analyze = (file, source) => {
  const judged: string[] = [];
  const findings: string[] = [];
  let asserted = false;

  blankCommentLines(source)
    .split('\n')
    .forEach((line, index) => {
      if (SCOPE.test(line)) asserted = false;
      if (ASSERTION.test(line)) asserted = true;
      if (CAPTURE.test(line)) {
        judged.push(`${file}:${index + 1}`);
        if (!asserted) {
          findings.push(
            `${file}:${index + 1} — shoot() runs before anything is asserted, ` +
              `so a present image is not the result`,
          );
        }
        asserted = false;
      }
    });

  return { judged, findings };
};

/**
 * How many times the file calls `shoot`, read from the parse tree:
 * independent of the line scan above, so a scan gone blind to a capture's
 * spelling is caught by the file it judged too few in (#446, per file #477).
 */
const shootCalls = (file: string, source: string): number =>
  callsIn(parseSource(source, file)).filter(({ expression }) =>
    ts.isIdentifier(expression)
      ? expression.text === 'shoot'
      : ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'shoot',
  ).length;

const captures: Liveness = {
  what: 'evidence captures',
  floor: 'capture-after-assertion/captures',
  carries: (file, source) => shootCalls(file, source) > 0,
  count: shootCalls,
};

describe('capturesBeforeAssertion -- the scan proven on synthetic input', () => {
  const scan = (...lines: string[]) =>
    capturesBeforeAssertion('synthetic.spec.ts', lines.join('\n'));

  it('judges every capture and passes one after an assertion', () => {
    expect(
      scan(
        "test('x', async () => {",
        '  await expect(page).toHaveTitle(/x/);',
        "  await shoot(page, 'x');",
        '});',
      ),
    ).toEqual({ judged: ['synthetic.spec.ts:3'], findings: [] });
  });

  it('names a capture taken before anything is asserted', () => {
    expect(
      scan("test('x', async () => {", "  await shoot(page, 'x');", '});')
        .findings,
    ).toEqual([
      'synthetic.spec.ts:2 — shoot() runs before anything is asserted, so a present image is not the result',
    ]);
  });

  it('counts a helper named expectSomething, and a method of that name', () => {
    expect(
      scan(
        "test('x', async () => {",
        '  await expectNoHorizontalScroll(page);',
        "  await shoot(page, 'a');",
        '  await reported.expectNone();',
        "  await evidence.shoot(page, 'b');",
        '});',
      ),
    ).toEqual({
      judged: ['synthetic.spec.ts:3', 'synthetic.spec.ts:5'],
      findings: [],
    });
  });

  it('does not let a second capture lean on the first one’s assertion', () => {
    expect(
      scan(
        "test('x', async () => {",
        '  await expect(page).toHaveTitle(/x/);',
        "  await shoot(page, 'a');",
        "  await shoot(page, 'b');",
        '});',
      ).findings,
    ).toHaveLength(1);
  });

  it('does not carry an assertion across into the next test', () => {
    expect(
      scan(
        "test('a', async () => {",
        '  await expect(page).toHaveTitle(/x/);',
        '});',
        "test('b', async () => {",
        "  await shoot(page, 'b');",
        '});',
      ).findings,
    ).toHaveLength(1);
  });

  it('is not satisfied by an assertion in a comment', () => {
    expect(
      scan(
        "test('x', async () => {",
        '  // expect(page).toHaveTitle(/x/);',
        "  await shoot(page, 'x');",
        '});',
      ).findings,
    ).toHaveLength(1);
  });
});

describe('an evidence capture documents an assertion that already passed', () => {
  it('never runs before the assertion it claims to document', () => {
    expectNothingFound(capturesBeforeAssertion, captures);
  });

  it('refuses a file where the scan and the tree count differently', () => {
    // The per-file count's own liveness (#477): one capture more than the
    // scan judged, in every file, as a scan blind to a spelling leaves it.
    expect(() =>
      expectNothingFound(capturesBeforeAssertion, {
        ...captures,
        count: (file, source) => shootCalls(file, source) + 1,
      }),
    ).toThrow(/\.spec\.ts: judged \d+, counted another way \d+/);
  });
});
