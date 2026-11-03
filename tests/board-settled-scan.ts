import { blankCommentLines } from './unit/source-text';

/**
 * Finds a test that leaves the projector board before it has settled (#1007).
 *
 * On the real Android phone an exit asked within about 100 ms of entering
 * fullscreen never resolves, and the board stays on screen. Shyden ruled
 * (2026-11-02) that tests act on the board only once it has finished opening,
 * as a person would, through `openBoard` / `boardSettled`
 * (`tests/board-settled.ts`). This scan reads a spec file and names every
 * Escape or Exit full screen that follows an opening of the board, inside the
 * same test, with no settle between.
 *
 * Comments are blanked first, so prose cannot satisfy or trip the scan.
 */

/**
 * A test starts: `test(` or `test.<modifier>(`, not `test.describe(`, with a
 * string title first, on its line or the next. A runtime `test.skip(cond, …)`
 * inside a test takes a condition first, so it starts nothing.
 */
const TEST_CALL = /\btest(?:\.(?:only|skip|fixme|fail))?\s*\(\s*(.*)$/;

/** A title: the string a test call opens with. */
const TITLE = /^['`]((?:[^'`\\]|\\.)*)['`]/;

const titleOf = (line: string, next: string): string | null => {
  const call = TEST_CALL.exec(line);
  if (call === null) return null;
  const title = TITLE.exec(call[1] === '' ? next.trim() : call[1]);
  return title ? title[1] : null;
};

/** The Full screen button, by name in English or Indonesian, or by id. */
const OPENER =
  /getByRole\(\s*'button',\s*\{\s*name:\s*(?:'Full screen'|'Layar penuh'|\/Full screen\|Layar penuh\/)|locator\(\s*'#cg-board-open'\s*\)/;

/** A settle: either helper, or the one that opens a waiting board through them. */
const SETTLE = /\b(?:openBoard|boardSettled|openWaitingBoard)\s*\(/;

/** Leaving the board: Escape, or a press on Exit full screen. */
const EXIT = /keyboard\.press\(\s*'Escape'\s*\)|name:\s*'Exit full screen'/;

export interface Finding {
  line: number;
  test: string;
  opened: number;
}

export interface Scan {
  /** Every board opening found, by line: the population the guard checks is not empty. */
  opens: number[];
  findings: Finding[];
}

/**
 * Scans one spec file. An opening is a `tapOn(...)` of the Full screen button
 * (directly, or through a `const` that names it), and an exit after it counts
 * only while no settle has come between.
 */
export function unsettledExits(source: string): Scan {
  const lines = blankCommentLines(source).split('\n');
  const openerNames = new Set<string>();
  for (const line of lines) {
    const named = /const\s+(\w+)\s*=\s*page\s*\.\s*(.*)$/.exec(line);
    if (named && OPENER.test(named[2])) openerNames.add(named[1]);
  }
  const opens: number[] = [];
  const findings: Finding[] = [];
  let test = '';
  let openedAt: number | null = null;
  // A `tapOn(` whose argument runs onto the next lines is joined with them.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const title = titleOf(line, lines[i + 1] ?? '');
    if (title !== null) {
      test = title;
      openedAt = null;
    }
    const tap = /\btapOn\(\s*(.*)$/.exec(line);
    if (tap) {
      const call = [tap[1], lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ');
      const variable = /^(\w+)\s*[,)]/.exec(tap[1]);
      if (
        OPENER.test(call.split(/\)\s*;/)[0]) ||
        (variable !== null && openerNames.has(variable[1]))
      ) {
        opens.push(i + 1);
        openedAt = i + 1;
        continue;
      }
    }
    if (SETTLE.test(line)) {
      if (/\b(?:openBoard|openWaitingBoard)\s*\(/.test(line)) opens.push(i + 1);
      openedAt = null;
    }
    if (EXIT.test(line) && openedAt !== null)
      findings.push({ line: i + 1, test, opened: openedAt });
  }
  return { opens, findings };
}
