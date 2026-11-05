import { describe, it, expect } from 'vitest';
import { accessSync, constants, readFileSync } from 'node:fs';
import { withoutCommentLines } from './source-text';

/**
 * The pre-push hook exists, is wired, and still runs what it was built to run.
 *
 * PR #34 failed CI on `npm run format` — one line over Prettier's print width
 * in a new test file. `format` was then the FIRST step of `build-and-test`, so
 * `build`, the unit suite and the whole e2e corpus were skipped: a ~15 minute
 * run that verified nothing and reported a two-second problem. Since #163 the
 * e2e shards run beside ci.yml's `checks` job, but a format slip still turns
 * `build-and-test` red after a whole run. That is CI used as a debugging loop,
 * and a hook is the cheap end of it.
 *
 * NO HOOK RUNNER. husky is the conventional answer and it is a new dependency,
 * against this repo's stated rule (a new npm package is an operator decision;
 * see CLAUDE.md) and its deliberately small tree. `core.hooksPath` is built
 * into git and does the same job with nothing added.
 *
 * That also settles the open question on #35 — whether a `prepare`-installed
 * hook is acceptable given this repo's supply-chain posture. It is, because
 * `prepare` here runs OUR OWN installer, three lines long and visible in the
 * diff, rather than a third party's postinstall. #39 drew exactly that line:
 * the allowlist governs code we did not write and cannot review.
 *
 * THE MECHANISM, NOT THE SOURCE TEXT. Asserting the hook file merely contains
 * "npm run test:unit" would pass on a hook git never invokes — a file in a
 * directory nothing points at. `core.hooksPath` is what makes it run, so that
 * is what is asserted; `npm ci` runs `prepare` before `test:unit` in CI, so
 * this is a live check there rather than a claim about a config file.
 *
 * PRE-PUSH, NOT PRE-COMMIT, deliberately. Committing a broken intermediate
 * state is normal and useful while working; pushing is the moment the work
 * becomes shared and the moment a CI run would otherwise be burned. A gate at
 * the commit boundary charges for every step of the work and buys nothing that
 * the push gate does not already buy.
 *
 * E2E IS NOT IN THE HOOK. ~7.3 minutes locally would make pushing unusable, so
 * CI remains its gate. Asserted, not merely intended: a well-meaning addition
 * of `test:e2e` here fails this suite.
 *
 * NOR IS ANY OTHER SUITE, unit included (#713, operator 2026-10-12): the hook
 * runs format and typecheck, and nothing else.
 */

const HOOK = '.githooks/pre-push';
const hookSource = () => readFileSync(HOOK, 'utf8');

/**
 * The npm scripts the hook RUNS, sorted.
 *
 * Comment lines are dropped and only a command at the start of a line counts,
 * so neither the hook's header nor the `npm run ...` hints inside its failure
 * messages can satisfy an assertion about what it executes.
 */
function invokedNpmScripts(): string[] {
  return withoutCommentLines(hookSource(), '#')
    .split('\n')
    .map((line) => /^\s*npm run (\S+)/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

const packageJson = () =>
  JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };

describe('the pre-push hook', () => {
  it('is installed by `prepare`, so a fresh clone gets it', () => {
    // Without this, the check above passes forever on a machine where the
    // config was set once by hand, while a new contributor gets no hook at all.
    expect(packageJson().scripts.prepare).toBe(
      'node scripts/install-hooks.mjs',
    );
  });

  it('exists and is executable', () => {
    expect(() => accessSync(HOOK, constants.X_OK)).not.toThrow();
  });

  it('invokes exactly the checks the laptop may run', () => {
    // COMMANDS ACTUALLY INVOKED, not strings present in the file. Asserting
    // `toContain('npm run test:unit')` passed while the hook did NOT run it:
    // the string survived inside the failure hint the hook prints to tell you
    // how to re-run it by hand. That is #23's defect exactly -- a guard
    // satisfied by the file's own documentation -- and only mutation testing
    // showed it, because the assertion reads as obviously correct.
    //
    // An exact set also removes the need for a separate "does not run e2e"
    // check: ~7.3 minutes in a pre-push hook is a hook everyone bypasses, so
    // `test:e2e` appearing here must fail, and adding a third check of any
    // kind should be a deliberate edit to this list.
    //
    // `typecheck` was that edit (#390). vitest strips types without checking
    // them, so a test indexing a union as a record passed the hook, was
    // pushed, and only `astro check` in CI could have refused it.
    //
    // `test:guards` was the next (#638), and it left again (#653): only unit
    // tests, formatters and type checks run on the laptop; every other suite
    // is CI's (operator, 2026-10-09, a global rule).
    //
    // `lint:tests` (#662) left with the meta-guards it ran (#992).
    //
    // And `test:unit` left (#713): no test suite runs at push, not even unit
    // (operator, 2026-10-12, a global rule).
    expect(invokedNpmScripts()).toEqual(['format', 'typecheck']);
  });

  it('executes nothing but its checks, in order (#713)', () => {
    // The set above sees `npm run ...` lines only, so `npx vitest run` or
    // `npm test` would slip past it. This is every command the hook
    // executes, first word each (an `npm run` keeps its script), in order.
    const commands = withoutCommentLines(hookSource(), '#')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map(
        (line) =>
          /^npm run \S+/.exec(line)?.[0] ?? line.split(/\s+/, 1)[0] ?? '',
      );
    // #717 added the exit-127 branch in fail() and the dependency check
    // before the first check.
    expect(commands).toEqual([
      'set',
      'unset',
      'fail()',
      'code=$?',
      'if',
      'set',
      'fi',
      'printf',
      'printf',
      'printf',
      'exit',
      '}',
      '[',
      'npm run format',
      'npm run typecheck',
    ]);
  });

  it('refuses a checkout with no installed dependencies before any check (#717)', () => {
    // Every new worktree starts without node_modules, and a check whose tool
    // is missing reported "Prettier found files that are not formatted".
    const lines = withoutCommentLines(hookSource(), '#').split('\n');
    const refusal = lines.findIndex((line) =>
      /^\[ -d node_modules\/\.bin \] \|\| fail '[^']+' 'npm ci'$/.test(line),
    );
    const firstCheck = lines.findIndex((line) => /^npm run /.test(line));
    expect(firstCheck, 'the hook runs a check').toBeGreaterThanOrEqual(0);
    expect(
      refusal,
      'the hook checks for node_modules/.bin',
    ).toBeGreaterThanOrEqual(0);
    expect(refusal).toBeLessThan(firstCheck);
  });

  it('reports a check whose tool is missing as a missing tool, not as its failure (#717)', () => {
    // `npm run` passes a missing command's exit 127 through (measured
    // 2026-10-12), and fail() reads the status of the check it follows
    // before running anything else, so that status is still the check's.
    const lines = withoutCommentLines(hookSource(), '#')
      .split('\n')
      .map((line) => line.trim());
    const start = lines.indexOf('fail() {');
    expect(start, 'the hook defines fail()').toBeGreaterThanOrEqual(0);
    expect(lines.slice(start + 1, start + 5)).toEqual([
      'code=$?',
      'if [ "$code" -eq 127 ]; then',
      "set -- 'a check could not start its tool (exit 127, command not found), so it checked nothing' 'npm ci'",
      'fi',
    ]);
  });

  it('type-checks so that a hint fails, as an error does (#966)', () => {
    // astro check exits 0 on a hint, and a deprecated signature is a hint
    // (ts(6387)): `createVitest('test', …)` passed CI that way in PR #962.
    expect(packageJson().scripts.typecheck).toBe(
      'astro check --minimumFailingSeverity hint',
    );
  });

  it('clears the repository git hands it before any check runs (#377)', () => {
    // From a linked worktree git runs this hook with an absolute GIT_DIR, and
    // the unit suite's scratch-repository tests acted on the real repository
    // through it. Git's own idiom, from its submodule code, clears the list
    // git itself keeps.
    const lines = withoutCommentLines(hookSource(), '#').split('\n');
    const cleared = lines.findIndex((line) =>
      /^\s*unset \$\(git rev-parse --local-env-vars\)\s*$/.test(line),
    );
    const firstCheck = lines.findIndex((line) => /^\s*npm run /.test(line));
    expect(firstCheck, 'the hook runs a check').toBeGreaterThanOrEqual(0);
    expect(cleared, 'the hook clears the variables').toBeGreaterThanOrEqual(0);
    expect(cleared).toBeLessThan(firstCheck);
  });
});
