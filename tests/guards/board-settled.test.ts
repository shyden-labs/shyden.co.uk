import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { unsettledExits } from '../board-settled-scan';
import { searched, specFilesUnder } from '../source-files';

/**
 * No test leaves the projector board before it has settled (#1007).
 *
 * On the real Android phone an exit asked within about 100 ms of entering
 * fullscreen never resolves and leaves the board on screen. Shyden ruled
 * (2026-11-02) that the page stays as it is and tests act on the board only
 * once it has finished opening, through `openBoard` / `boardSettled`. The
 * scan itself is proven on synthetic input in
 * `tests/unit/board-settled-scan.test.ts`.
 */

/**
 * Tests whose subject IS an exit before the grant arrives: the page's own
 * race handling. Each is named exactly, with why it must act early.
 */
const RACES = new Map([
  [
    'a second showing survives the first one tidying up after itself',
    "leaving at once is the sequence under test: the first showing's late grant must not close the second",
  ],
  [
    'a grant that lands during the next showing leaves that showing open',
    'the exit has to beat the grant, so the grant lands during the next showing',
  ],
  [
    'a reopen cannot reach the page while the last showing is still being undone',
    'the reopen is tried while the last exit is still being undone',
  ],
]);

const SPECS = ['tests/e2e', 'tests/dev', 'tests/prod'].flatMap((dir) =>
  specFilesUnder(dir),
);

describe('the projector board is left only once it has settled', () => {
  const scans = SPECS.map((file) => ({
    file,
    ...unsettledExits(readFileSync(file, 'utf8')),
  }));

  it('every Escape or Exit after an opening comes after openBoard / boardSettled', () => {
    const opens = scans.flatMap(({ file, opens }) =>
      opens.map((line) => `${file}:${line}`),
    );
    const findings = scans.flatMap(({ file, findings }) =>
      findings
        .filter(({ test }) => !RACES.has(test))
        .map(
          ({ line, test, opened }) =>
            `${file}:${line} (${test}) leaves the board opened at line ${opened} before it has settled: open it with openBoard(page)`,
        ),
    );
    expect(
      searched(findings, {
        of: opens,
        what: 'openings of the projector board',
      }),
    ).toEqual([]);
  });

  it('each race exemption names a test that really leaves early', () => {
    const early = new Set(
      scans.flatMap(({ findings }) => findings.map(({ test }) => test)),
    );
    expect([...RACES.keys()].filter((title) => !early.has(title))).toEqual([]);
  });
});
