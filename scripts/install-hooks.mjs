#!/usr/bin/env node
/**
 * Points git at the version-controlled hooks in `.githooks/`.
 *
 * Run by `prepare`, so a fresh clone gets the pre-push hook from its first
 * `npm install` — a hook only one machine has is not a control.
 *
 * No hook runner. husky is the usual answer and it is a new dependency, which
 * this repo does not take (a new npm package is an operator decision; see CLAUDE.md);
 * `core.hooksPath` is built into git and needs nothing installed. That also
 * keeps `prepare` running only THIS file, which is three lines of our own code
 * visible in the diff, rather than a third party's postinstall — the line #39
 * drew when it made install-time code execution an explicit allowlist.
 *
 * EVERY EFFECT IS INSIDE `main()`, reached only under `import.meta.main`
 * (#276). Until then this file did its work at module scope, so importing it
 * — from a test, or from anything that wanted to read `HOOKS` — reconfigured
 * git and could exit the importing process.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { die } from './errors.mjs';

const HOOKS = '.githooks';

/**
 * Install the hooks, or explain why nothing was installed.
 *
 * TAKES NO ARGUMENTS, AND SAYS SO (#276). It had no refusal path at all,
 * because it is written never to fail an install; a script with no refusal
 * has no cheap proof that its entry point ran, since a skipped `main()` also
 * exits 0 in silence. `prepare` passes nothing, so the only way to reach this
 * refusal is to type something that was already a mistake.
 *
 * @returns {void}
 */
export function main() {
  const args = argv.slice(2);
  if (args.length > 0)
    die(`install-hooks.mjs takes no arguments (got ${args.join(' ')})`);

  // `.git` is a directory in a clone and a FILE in a linked worktree; both exist.
  // A source tarball or zip has neither, and `npm install` there must not fail
  // over a hook — but it must not pretend to have installed one either.
  if (!existsSync('.git')) {
    console.log(
      `install-hooks: no .git here, so no git hooks were installed. ` +
        `Run this again from a clone to install its hooks.`,
    );
    exit(0);
  }

  // `.git` existing is a PROXY for "git will work here", and it is weaker than
  // the thing it stands for: git refuses a repository whose files are owned by
  // another user unless it is named in `safe.directory`, and a container job
  // checks out as one uid and runs as another. The guard above passed, this
  // line then died with `fatal: not in a git directory`, and it failed
  // `npm ci` -- so a job that only wanted to run tests could not install at
  // all. Found by adding a containerised CI job (#33), never by reading.
  //
  // A hook installer must never fail an install. Not installing a convenience
  // is not an error; claiming to have installed one would be.
  try {
    execFileSync('git', ['config', 'core.hooksPath', HOOKS], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    const detail =
      String(
        /** @type {{ stderr?: unknown }} */ (error)?.stderr ?? '',
      ).trim() || 'git refused';
    console.log(
      `install-hooks: git would not accept a config here (${detail}), so no ` +
        `hooks were installed. That is expected inside a container or a CI ` +
        `checkout, and it is not a reason to fail the install.`,
    );
    exit(0);
  }
  // No list of hook names: one named only the pre-push hook for as long as
  // commit-msg (the closing-keyword refusal) was installed beside it.
  console.log(
    `install-hooks: git will run the hooks in ${HOOKS}/. ` +
      'Bypass one with --no-verify.',
  );
}

if (import.meta.main) main();
