import { localGitVars } from './git-env';

/**
 * Before any unit test file runs, forget the repository this run was handed
 * (#377). Every git process a test starts, and every script it spawns, then
 * finds its repository from its own working directory, the way it does when
 * the suite is run by hand. A pre-push hook in a linked worktree hands the run
 * an absolute GIT_DIR, and the scratch-repository tests wrote through it.
 */
for (const name of localGitVars()) delete process.env[name];
