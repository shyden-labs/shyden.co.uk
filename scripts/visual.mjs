#!/usr/bin/env node
/**
 * Run the visual-regression suite in the pinned container (#33).
 *
 *   npm run test:visual                  # compare against the baselines
 *   npm run test:visual:update           # rewrite them
 *   npm run test:visual -- -g home       # anything after `--` is forwarded
 *   npm run test:visual -- -g "two words"  # ...each argument whole (#202)
 *
 * BOTH go through Docker, and that is the point. Playwright writes the
 * platform into every snapshot filename, so a run on a macOS laptop does not
 * read `-linux` baselines -- it finds none, writes `-darwin` ones, and
 * reports a confident pass over a comparison it never made. That failure is
 * silent, it looks like success, and it leaves files in the tree that CI will
 * never open. Pinning the image on both sides is what makes the comparison
 * mean anything, since a bare runner and this image rasterise text with
 * different font packages.
 *
 * `--update-snapshots` is reachable ONLY through `test:visual:update`, never
 * from CI. A run that can rewrite the baseline it is checking against asserts
 * nothing, and a changed baseline belongs in a pull request as a reviewable
 * diff like any other claim about what is correct.
 */
import { spawnSync } from 'node:child_process';
import { messageOf } from './errors.mjs';
import { containerArgs, localImage } from './playwright-image.mjs';

/**
 * The image CI's visual job compares in, picked by the same selector (#454):
 * the digest docker/playwright/Dockerfile pins when it names the installed
 * Playwright, otherwise that version's tag. A browser bundle from a different
 * release than the library driving it fails in ways neither reports clearly,
 * and a capture in another image than the comparison is not a baseline.
 */
export const image = localImage();

/**
 * The argument vector for `docker`, built without running anything so a test
 * can read it (`tests/unit/visual-runner.test.ts`, #202).
 *
 * @param {object} options
 * @param {string} options.image the pinned Playwright image
 * @param {string} options.cwd the repo root, mounted at /work
 * @param {boolean} options.update rewrite the baselines instead of comparing
 * @param {readonly string[]} options.forwarded Playwright's own arguments
 * @returns {string[]}
 */
export function dockerArgs({ image, cwd, update, forwarded }) {
  const playwright = [
    'npx playwright test --project=visual',
    // `=all`, never the bare flag: Playwright 1.63 documents `preset: "changed"`
    // for a bare `--update-snapshots`, which rewrites only baselines whose
    // comparison FAILED and leaves a stale-but-passing one in place -- the drift
    // #134 exists to stop. The zero-allowance evidence in
    // `tests/unit/browser-matrix.test.ts` was gathered with `all` by hand,
    // through a flag this script did not pass (#152).
    update ? '--update-snapshots=all' : '',
    // Chromium is memory-hungry and the host has under 4 GiB; the default
    // worker count is derived from CPUs and has killed a container run here
    // before. Two is what CI's e2e job was measured at.
    '--workers=2',
    // The forwarded arguments, which never appear in this text: they arrive
    // as `sh`'s own operands below, and `"$@"` hands each one to Playwright
    // as a single word, spaces, quotes and `$` included. Joined in here, the
    // container's shell split them again, and `--grep "student added"`
    // reached Playwright as `--grep student` plus a file filter `added`
    // (#202).
    '"$@"',
  ]
    .filter(Boolean)
    .join(' ');

  return containerArgs({
    image,
    cwd,
    env: { VISUAL: '1' },
    command: playwright,
    operands: forwarded,
  });
}

/** Playwright's update flag in each spelling: `-u`, bare, and `=<preset>`. */
const PLAYWRIGHT_UPDATE = /^(-u|--update-snapshots(=.*)?)$/;

/**
 * The runner's own `--update`, and every other argument, forwarded to
 * Playwright in order. Playwright's own update flag is refused: forwarded
 * bare it means `changed`, which rewrites only the baselines whose comparison
 * failed and keeps a stale-but-passing one (#134), and in any spelling it is
 * a way to rewrite baselines that is not `test:visual:update`.
 *
 * @param {readonly string[]} argv
 * @returns {{ update: boolean, forwarded: string[] }}
 */
export function splitArgs(argv) {
  const forwarded = argv.filter((arg) => arg !== '--update');
  const rewrite = forwarded.find((arg) => PLAYWRIGHT_UPDATE.test(arg));
  if (rewrite !== undefined)
    throw new Error(
      `visual: ${rewrite} is Playwright's own update flag. Baselines change one ` +
        'way: npm run test:visual:update, which passes --update-snapshots=all.',
    );
  return { update: forwarded.length !== argv.length, forwarded };
}

function main() {
  /** @type {{ update: boolean, forwarded: string[] }} */
  let split;
  try {
    split = splitArgs(process.argv.slice(2));
  } catch (error) {
    console.error(messageOf(error));
    process.exit(2);
  }
  const { update, forwarded } = split;

  if (spawnSync('docker', ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error(
      `docker is not available, and this suite does not fall back to running\n` +
        `here: a local run would compare nothing and pass. Start Docker, or\n` +
        `read the diff from the visual job in CI, which uses ${image}.`,
    );
    process.exit(1);
  }

  console.log(
    `${update ? 'Capturing baselines (--update-snapshots=all)' : 'Comparing'} in ${image}`,
  );
  // JSON, so an argument holding a space reads as one: the joined form
  // printed `--grep student added` for the very split it caused (#202).
  if (forwarded.length)
    console.log(`  forwarding: ${JSON.stringify(forwarded)}`);

  const run = spawnSync(
    'docker',
    dockerArgs({ image, cwd: process.cwd(), update, forwarded }),
    { stdio: 'inherit' },
  );

  if (run.status !== 0 && update)
    console.error(
      '\nCapture failed, so the committed baselines are unchanged. Read the\n' +
        'output above before retrying.',
    );
  process.exit(run.status ?? 1);
}

// Only when run, never when imported, so `tests/unit/visual-runner.test.ts`
// can read `dockerArgs` without starting a container. A check that stopped
// matching would make `npm run test:visual` exit 0 having compared nothing,
// and comparing `process.argv[1]` with this file's path did exactly that from
// a checkout reached through a symlink (#221). `tests/unit/script-entry.test.ts`
// runs this file as a script from such checkouts and watches it refuse
// without Docker.
if (import.meta.main) main();
