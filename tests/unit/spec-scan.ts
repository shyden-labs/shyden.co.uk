import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { specDirFilesGitHas, specDirs } from '../spec-dirs';
import { declaresTests } from '../playwright-declarations';
import { floorBreach } from '../floors';
import { searched, tsFilesUnder, walkDisagreements } from '../source-files';

/**
 * The body every source-scanning guard in this repo ends with, once (#277).
 *
 * `viewport-tagging`, `isolated-context-tagging`, `parked-tests` and
 * `download-tagging` each carried it: read every file, run this guard's own
 * `analyze` over each one's source, assert the findings are empty with the
 * population named inside the assertion so an empty scan cannot pass for a
 * clean one (#118). Four copies of three lines, which is not why they
 * matter -- they matter because the copies HAD ALREADY DRIFTED, and only in
 * the one place a reader never looks.
 *
 * Three of them scanned `specDirs()`, the derived set that exists because
 * four guards once hard-coded `[tests/e2e, tests/device]` and never
 * revisited it when `tests/dev` and `tests/prod` arrived -- a `test.fixme`
 * planted in `tests/dev` left `parked-tests.test.ts` green at 11/11.
 * `download-tagging` was the fifth guard with that exact bug still in it:
 * `specFilesUnder('tests/e2e')`, written narrow and never widened. Nothing
 * outside `tests/e2e` reads a download's bytes TODAY, measured, so the hole
 * was latent rather than open -- which is the only kind you get to close
 * cheaply.
 *
 * So the scope belongs here, not at the call site. A guard that genuinely
 * needs a narrower set is an exception that has to say so out loud, instead
 * of a default that drifts in silence.
 */

/**
 * A guard's own reading of one file: every unit it judged, named so a
 * failure can point at it, and the problems it found among them.
 *
 * `judged` is the liveness control at the level the guard judges (#446).
 * Proving FILES were opened says nothing about a reader that went blind to
 * every test, call or capture inside them: it opens every file, finds
 * nothing, and passes.
 */
export type Reading = {
  readonly judged: readonly string[];
  readonly findings: readonly string[];
};

/** A guard's reading of one file, as a pure function of its path and text. */
export type Analyze = (file: string, source: string) => Reading;

/** What the scan must see before its silence means anything. */
export type Liveness = {
  /** The unit `judged` lists, plural: `tests read`, `captures`. */
  readonly what: string;
  /**
   * The id of the floor in `tests/floors.json` (#468): `judged` is checked
   * against it for equality, so a reader that comes back one short fails, and
   * so does a population that grew, until it is recorded.
   */
  readonly floor: string;
  /**
   * An independent reading of the same file: true where its text plainly
   * holds the construct. A file it holds and `analyze` judged nothing in is
   * a form the reader is blind to.
   */
  readonly carries: (file: string, source: string) => boolean;
  /**
   * The same file's units counted another way, where they can be. Given,
   * every file's `judged` must number exactly this (#477): a reader blind to
   * one unit in a file that holds two others still judges something there,
   * which `carries` cannot see.
   */
  readonly count?: (file: string, source: string) => number;
};

/**
 * The liveness of a guard whose unit is a test or group the specs declare:
 * a file whose text declares a test, and in which the guard judged none, is
 * a form its reader is blind to. One home, since three guards read that way.
 */
export const declarationsRead = (what: string, floor: string): Liveness => ({
  what,
  floor,
  carries: (_file, source) => declaresTests(source),
});

/**
 * Run `analyze` over every file in the spec directories and assert it found
 * nothing, over a population of the units it judged; that no file which
 * plainly holds one was judged empty; that the walk read exactly the files
 * git has there; where the liveness gives a `count`, that every file was
 * judged exactly that many (#477); and that the total is the recorded
 * figure (#468). The failure message is every finding, one per line.
 */
export const expectNothingFound = (
  analyze: Analyze,
  liveness: Liveness,
): void => {
  const readings = specDirs()
    .flatMap(tsFilesUnder)
    .map((file) => {
      const source = readFileSync(file, 'utf8');
      return { file, source, ...analyze(file, source) };
    });
  const findings = readings.flatMap(({ findings }) => findings);
  const judged = readings.flatMap(({ judged }) => judged);
  expect(
    searched(findings, { of: judged, what: liveness.what }),
    findings.join('\n'),
  ).toEqual([]);
  const missed = readings
    .filter(
      ({ file, source, judged }) =>
        judged.length === 0 && liveness.carries(file, source),
    )
    .map(({ file }) => file);
  expect(
    searched(missed, {
      of: readings,
      what: 'files under the spec directories',
    }),
    `files holding ${liveness.what} where the reader judged none`,
  ).toEqual([]);
  // The walk against git's list (#477): the per-file checks above are
  // computed over the walk, so a walk that dropped a file drops it from
  // both sides of them.
  expect(
    searched(
      walkDisagreements(
        readings.map(({ file }) => file),
        specDirFilesGitHas(),
      ),
      { of: readings, what: 'files under the spec directories' },
    ),
  ).toEqual([]);
  const { count } = liveness;
  if (count) {
    const disagree = readings
      .map(({ file, source, judged }) => ({
        file,
        judged: judged.length,
        counted: count(file, source),
      }))
      .filter(({ judged, counted }) => judged !== counted)
      .map(
        ({ file, judged, counted }) =>
          `${file}: judged ${judged}, counted another way ${counted}`,
      );
    expect(
      searched(disagree, {
        of: readings,
        what: 'files under the spec directories',
      }),
      `${liveness.what}, judged and counted another way, per file:\n` +
        disagree.join('\n'),
    ).toEqual([]);
  }
  // After every verdict, so a population that grew never hides a finding.
  expect(
    floorBreach(liveness.floor, judged.length),
    `${liveness.what}: not the recorded figure`,
  ).toBeUndefined();
};
