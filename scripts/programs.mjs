/**
 * The programs the scripts run, each by its absolute path (#1275).
 *
 * SonarCloud's S4036: a program run by its bare name is whichever one comes
 * first on PATH, and any folder on PATH a user can write to can put a
 * different program there. Each one here is named by where it is installed:
 * git, ps and pgrep in the system folders macOS, the CI runners and the
 * Playwright container all have; node as the one already running; npm,
 * Playwright and Astro as node running their own entry file, which is what
 * `npm` and `npx` do after searching PATH for them.
 *
 * `gh` is not here: on the operator's Mac the `gh` on PATH is the router that
 * makes an agent act as the project's GitHub App, and tests put a stand-in on
 * PATH in its place.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKOUT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const GIT = '/usr/bin/git';
export const PS = '/bin/ps';
export const PGREP = '/usr/bin/pgrep';

/** The node running this script. */
export const NODE = process.execPath;

/** npm's own entry file, in the npm installed beside this node. */
export const NPM_CLI = path.join(
  path.dirname(process.execPath),
  '..',
  'lib',
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
);

/** The entry files `npx playwright` and `npx astro` run from this checkout. */
export const PLAYWRIGHT_CLI = path.join(
  CHECKOUT,
  'node_modules',
  '@playwright',
  'test',
  'cli.js',
);
export const ASTRO_CLI = path.join(
  CHECKOUT,
  'node_modules',
  'astro',
  'bin',
  'astro.mjs',
);
/** The entry file `npx vitest` runs from this checkout (#1295). */
export const VITEST_CLI = path.join(
  CHECKOUT,
  'node_modules',
  'vitest',
  'vitest.mjs',
);

/**
 * Where `platform` keeps lsof: macOS in /usr/sbin, Linux in /usr/bin.
 *
 * @param {string} platform
 * @returns {string}
 */
export const lsofFor = (platform) =>
  platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof';
export const LSOF = lsofFor(process.platform);

/**
 * Where `platform` keeps docker: on the Mac, Homebrew's (Colima's client); on
 * Linux, the system's.
 *
 * @param {string} platform
 * @returns {string}
 */
export const dockerFor = (platform) =>
  platform === 'darwin' ? '/opt/homebrew/bin/docker' : '/usr/bin/docker';
export const DOCKER = dockerFor(process.platform);
