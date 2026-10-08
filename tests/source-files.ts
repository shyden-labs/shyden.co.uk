import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nonEmpty } from '../scripts/errors.mjs';
import { treeReading } from './tree-reading';

/**
 * The one directory walk in the suite.
 *
 * Nine private copies had grown before #80 — four byte-identical
 * `listSourceFiles`, plus `specFiles`, `sourceFiles`, `collect`, `walk` and
 * `listM4aFiles` — in three implementations that disagreed about what to
 * skip. A guard can only see what its walker hands it, so whichever copy the
 * next guard reached for silently decided its blind spots: exactly how #67's
 * four hand-written `[tests/e2e, tests/device]` lists left the deploy gates
 * unscanned.
 *
 * `tests/unit/one-home.test.ts` fails if a tenth appears.
 */

/**
 * Never descended into. Dotfiles are tooling (`.git`, `.astro`) and
 * `node_modules` is somebody else's source — a guard that reads either is
 * asserting against files nobody in this repo wrote. Four of the nine copies
 * skipped both, one skipped neither; this is the majority behaviour made
 * uniform rather than left to whichever copy a caller inherited.
 */
const isSkipped = (name: string): boolean =>
  name.startsWith('.') || name === 'node_modules';

/**
 * Every file at or below `dir` that `keep` accepts, sorted.
 *
 * `keep` receives the FULL path, not the basename, so a caller can filter on
 * directory as well as extension — `translate.test.ts` needs to exempt one
 * specific file, and a basename would have made that a substring match.
 *
 * Sorted because `readdirSync` order is filesystem-dependent: a guard whose
 * findings are asserted as a list would otherwise pass on Linux and fail on
 * macOS for reasons that have nothing to do with what it guards.
 */
export function filesUnder(
  dir: string,
  keep: (path: string) => boolean,
): string[] {
  return nonEmpty(walk(dir, keep).sort(), `files under ${dir}`);
}

/**
 * The recursion, kept private so an empty result stays ordinary HERE.
 *
 * `tests/` holds directories with no `.spec.ts` in them, so a walk that
 * refused an empty sub-result could never complete. The refusal belongs to
 * the exported, top-level form and nowhere else.
 */
function walk(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isSkipped(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

/** One home in `scripts/errors.mjs`, where a script can reach it too (#475). */
export { nonEmpty };

/**
 * Every TypeScript source at or below `dir`.
 *
 * The filter four byte-identical copies each spelled out. Exported as its own
 * function so their call sites stay point-free — `SCAN_DIRS.flatMap(
 * tsFilesUnder)` — rather than each re-writing the same predicate, which is
 * how the four copies started.
 */
export const tsFilesUnder = (dir: string): string[] =>
  filesUnder(dir, (path) => /\.tsx?$/.test(path));

/**
 * Every Playwright spec at or below `dir`.
 *
 * `specDirs()` is built from this rather than from its own recursion: a
 * directory "holds specs" exactly when this returns a file in it, so the two
 * can no longer disagree about what a spec is.
 */
export const specFilesUnder = (dir: string): string[] =>
  filesUnder(dir, (path) => path.endsWith('.spec.ts'));

/**
 * Of `paths`, the ones git ignores, by git's own rules.
 *
 * The walk reads the filesystem, which also holds `dist/` and the test
 * reports: files nobody here wrote, on one machine and not the next. Asking
 * git keeps `.gitignore` the one statement of what is tracked, where a list
 * of directories copied into a guard would drift from it. A unit test starts
 * no process (#631), so git is asked once per run, in the global setup
 * (`tests/tree-reading-setup.ts`), about the paths in `ignoreQuestions()`
 * (`tests/git-questions.ts`); this answers from that reading, and refuses a
 * path nobody asked about rather than guess.
 *
 * Git does not report a TRACKED path as ignored, whatever the rules say. A
 * guard asking whether a rule would swallow a file must ask about a path git
 * does not track, or the answer is "no" for a reason unrelated to the rule.
 */
export function ignoredByGit(paths: readonly string[]): Set<string> {
  const { ignored } = treeReading();
  const unasked = paths.filter((path) => ignored[path] === undefined);
  if (unasked.length > 0)
    throw new Error(
      `git was never asked whether it ignores ${unasked.join(', ')}: a unit ` +
        'test starts no process, so the question belongs in ignoreQuestions() ' +
        'in tests/git-questions.ts, answered once by tests/tree-reading-setup.ts',
    );
  return new Set(paths.filter((path) => ignored[path]));
}

/**
 * True for a population member that carries something to find.
 *
 * #112's guard counted six entries and stayed green with all six Thai
 * headers blanked, because six empty strings are six entries. So a blank
 * string, an empty array, an empty object, a `null` -- none of them is a
 * subject a guard can search. `0` and `false` ARE: they are values, and a
 * guard hunting a zero width or an unset flag would be reading them.
 */
function isSubstantive(member: unknown): boolean {
  if (member === null || member === undefined) return false;
  if (typeof member === 'string') return member.trim() !== '';
  if (Array.isArray(member)) return member.length > 0;
  if (member instanceof Map || member instanceof Set) return member.size > 0;
  if (typeof member === 'object') return Object.keys(member).length > 0;
  return true;
}

/**
 * The population a finding list was drawn from, proved live (#118).
 *
 * `expect(findings).toEqual([])` is green in two different worlds: the guard
 * ran and found nothing, and the guard was handed nothing to run over. This
 * suite had 108 assertions that could not tell those apart, and the four
 * vacuities #84 found in the file walkers were all of this shape.
 *
 *     expect(searched(findings, { of: pages, what: 'built pages' })).toEqual([]);
 *
 * The population sits INSIDE the assertion's own expression, which is the
 * move #79 made for browser events and #84 made for the walk: a call site
 * cannot forget a control it has nowhere to omit. It returns the findings
 * untouched, so the verdict -- and the runner's diff of the offending
 * entries -- stays with the caller and its own `expect`.
 *
 * Prefer handing it the population ITSELF over a count. A count is taken on
 * trust; an array is content-checked by `isSubstantive` above, which is the
 * only form that closes #112.
 *
 * Every search also checks its population's recorded floor in the same test,
 * because one unit still read keeps this green (#515); there is no exemption
 * (#534). `floorless-searches.test.ts` holds that.
 */
export function searched<T>(
  findings: readonly T[],
  population: { of: number | readonly unknown[]; what: string },
): readonly T[] {
  const { of, what } = population;
  const live = typeof of === 'number' ? of : of.filter(isSubstantive).length;
  if (live <= 0)
    throw new Error(
      `searched no ${what} — an absence assertion over an empty population ` +
        'is green whatever the guard does. Counting entries is not counting ' +
        'content: six blank headers are six entries (#118, #112).',
    );
  return findings;
}

/**
 * Every path git tracks that the working tree still holds, filtered by `keep`.
 *
 * A control on the walk above, not a second source for it: `filesUnder` skips
 * dot-directories by design, so `.github/` — every workflow in the repository
 * — is invisible to it, and a guard reading the pipeline's own text has to
 * see those files. `git ls-files` is the only list that cannot disagree with
 * what is committed.
 *
 * The listing is the run's one reading of `git ls-files -z` (#631), taken once
 * in the global setup; `existsSync` stays here, per call, because a file
 * deleted in the working tree is tracked until the deletion is staged.
 */
export function trackedFiles(keep: (path: string) => boolean): string[] {
  return gitListed('tracked', keep, 'tracked files');
}

/**
 * Every path git tracks, or would track at the next `git add -A`: tracked,
 * plus untracked and not ignored. The list a walk is checked against (#477):
 * a test file written before its `git add` is in it, so a TDD cycle is not
 * red for the wrong reason, and `dist/` or a test report is not, so one
 * machine's build output is not a finding on another.
 */
export function committableFiles(keep: (path: string) => boolean): string[] {
  return gitListed('committable', keep, 'committable files');
}

function gitListed(
  list: 'tracked' | 'committable',
  keep: (path: string) => boolean,
  what: string,
): string[] {
  const paths = treeReading()
    [list].filter((path) => keep(path) && existsSync(path))
    .sort();
  return nonEmpty(paths, what);
}

/**
 * Where a walk and git's list of the same population disagree, one line per
 * file, both directions (#477). Compared as sets: the walk's order and
 * repeats are its own business.
 */
export function walkDisagreements(
  walked: readonly string[],
  known: readonly string[],
): string[] {
  const read = new Set(walked);
  const listed = new Set(known);
  return [
    ...[...listed]
      .filter((path) => !read.has(path))
      .map((path) => `${path}: git has it, the walk did not read it`),
    ...[...read]
      .filter((path) => !listed.has(path))
      .map((path) => `${path}: the walk read it, git does not have it`),
  ];
}

/** A TypeScript file under `tests/`, as git spells its path. */
export const isTsUnderTests = (path: string): boolean =>
  path.startsWith('tests/') && path.endsWith('.ts');
