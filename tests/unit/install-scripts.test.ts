import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * Which dependencies are allowed to EXECUTE CODE when they install.
 *
 * npm runs `preinstall`/`install`/`postinstall` from a dependency's own
 * package.json on `npm ci`, as the installing user, with that shell's
 * environment — which in CI means with our secrets in reach. `allowScripts`
 * is npm's mechanism for making that permission explicit rather than
 * ambient, and until #39 this repo had no such field: every dependency, and
 * every transitive dependency a future Dependabot bump drags in, could run
 * arbitrary code at install time with no signal beyond a warning printed
 * into the middle of a 16-minute log.
 *
 * DERIVED FROM THE LOCKFILE, NOT A SECOND HAND-WRITTEN LIST. The obvious
 * version of this test — assert `allowScripts` contains esbuild and fsevents
 * — checks the file against a copy of itself and would stay green while the
 * dependency tree moved underneath it. `package-lock.json` already records
 * `hasInstallScript: true` against every package that has one, so that is the
 * real inventory and this suite compares the allowlist against it. One
 * equality then fails in five distinct, useful ways: the field deleted, a new
 * dependency arriving with a postinstall, a bump making a pinned entry stale,
 * an entry unpinned to a bare name, or a stale grant left behind after a
 * dependency was dropped.
 *
 * THE LOCKFILE, NOT `npm install-scripts ls`, for a second reason: `ls`
 * reports only what is installed for the current platform and only direct
 * dependencies. On macOS it names esbuild alone; on Linux CI `fsevents` is
 * not installed at all. The lockfile is platform-independent and complete, so
 * this assertion means the same thing on every machine.
 *
 * PINNED (`esbuild@0.28.1`, not `esbuild`) is deliberate, and it is the same
 * reasoning `supply-chain.test.ts` applies to SHA-pinned actions: a grant to
 * a NAME is a grant to every future version of that package, made before
 * anyone has seen the code. A bump therefore breaks this test on purpose —
 * re-approving is the review moment, which is the whole point of an
 * allowlist. `npm install-scripts approve <pkg>` is the ten-second fix, and
 * the failure message says so.
 *
 * JSON, so — unlike the workflow guards in `supply-chain.test.ts` and
 * `pipeline-wiring.test.ts` — there is no comment-stripping step here and no
 * way for a file's own documentation to satisfy its guard (#24). Both inputs
 * are parsed, not grepped.
 */

const json = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8'));

interface LockEntry {
  version?: string;
  hasInstallScript?: boolean;
}

/**
 * Every package the lockfile says runs a script at install time, in npm's own
 * `name@version` key form.
 *
 * Lockfile keys are paths (`node_modules/esbuild`,
 * `node_modules/a/node_modules/esbuild`); the allowlist keys the package
 * name, so take everything after the last `node_modules/`. That keeps scoped
 * names (`@scope/pkg`) whole.
 */
function packagesWithInstallScripts(): string[] {
  const packages = json('package-lock.json').packages as Record<
    string,
    LockEntry
  >;
  return Object.entries(packages)
    .filter(([, meta]) => meta.hasInstallScript)
    .map(
      ([path, meta]) =>
        `${path.replace(/^.*node_modules\//, '')}@${meta.version}`,
    )
    .sort();
}

const allowScripts = (): Record<string, boolean> =>
  (json('package.json').allowScripts as Record<string, boolean>) ?? {};

describe('the install-script allowlist', () => {
  it('has something to protect', () => {
    // Without this, the equality below is VACUOUS in the one case that matters:
    // if the lockfile stopped reporting install scripts, the derived set and an
    // empty `allowScripts` would agree, and a suite asserting nothing would go
    // green. This repo has shipped two guards that passed because both sides
    // were empty or both were satisfied by prose.
    //
    // If a dependency change genuinely leaves NO package running install
    // scripts, this failure is the prompt to confirm that and delete the
    // suite deliberately — not to weaken the assertion.
    expect(
      floorBreach(
        'install-scripts/packages',
        packagesWithInstallScripts().length,
      ),
      'packages with an install script moved: fewer can mean a lockfile that ' +
        'is not v3, or a control no longer needed; more, a new one to approve',
    ).toBeUndefined();
  });

  it('approves exactly the packages that run install scripts, and no others', () => {
    expect(
      Object.keys(allowScripts()).sort(),
      'the allowlist and the lockfile disagree. A package listed here but ' +
        'not in the lockfile is a stale grant (`npm install-scripts prune`); ' +
        'one in the lockfile but not here is code that would execute at ' +
        'install time unreviewed (`npm install-scripts approve <pkg>`, then ' +
        'READ THE DIFF — `--dry-run` writes to package.json anyway on npm 11)',
    ).toEqual(packagesWithInstallScripts());
  });

  it('pins every approval to a version', () => {
    const approved = Object.keys(allowScripts());
    const unpinned = approved.filter((key) => !/.@\d/.test(key));
    expect(
      // If this repo ever legitimately approves NOTHING, the refusal here is
      // the right outcome: the guard has become decorative and someone
      // should decide whether to keep it, rather than have it pass forever
      // over an empty table.
      searched(unpinned, { of: approved, what: 'approved packages' }),
      'a bare package name grants install-time code execution to every ' +
        'FUTURE version of that package, reviewed by nobody. Pin it, the ' +
        'same way this repo pins actions to a SHA rather than a tag',
    ).toEqual([]);
    expect(
      floorBreach('install-scripts/pinned-approvals', approved.length),
    ).toBeUndefined();
  });

  it('approves rather than denies — a false value blocks the install', () => {
    // `npm install-scripts deny` writes the same field with `false`, which
    // would leave esbuild without its platform binary and the build broken in
    // a way that looks like a download failure.
    const approvals = Object.entries(allowScripts());
    const denied = approvals
      .filter(([, allowed]) => allowed !== true)
      .map(([key]) => key);
    expect(
      searched(denied, { of: approvals, what: 'approval entries' }),
    ).toEqual([]);
    expect(
      floorBreach('install-scripts/approval-entries', approvals.length),
    ).toBeUndefined();
  });
});
