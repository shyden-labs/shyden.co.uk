#!/usr/bin/env node
/**
 * Which Playwright image a CI run uses (#454).
 *
 * CI's browser jobs run in Microsoft's Playwright image (#431), and the image
 * must match the installed `@playwright/test`. The pin lives in
 * `docker/playwright/Dockerfile`, which Dependabot's docker ecosystem keeps
 * current, because Dependabot reads no image out of a workflow file. But the
 * npm bump and the image bump arrive as separate pull requests, so for a
 * while one always leads the other, and a run that demanded they match would
 * be red on every Playwright update (operator, 2026-10-03: "we need to be able
 * to update playwright without problems").
 *
 * So the run always uses the image for the INSTALLED version: the Dockerfile's
 * digest when it names that version, otherwise that version's digest asked of
 * mcr.microsoft.com, with a warning saying so. One request, a time limit, no
 * retry (operator rule, 2026-10-02): an answer that does not arrive fails the
 * run by name.
 *
 *   node scripts/playwright-image.mjs   # writes ref=<image> to $GITHUB_OUTPUT
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';

export const DOCKERFILE = 'docker/playwright/Dockerfile';
const REPOSITORY = 'mcr.microsoft.com/playwright';
const LIMIT_MS = 30_000;

/**
 * The installed `@playwright/test`, as the lockfile resolves it.
 * @param {string} lockText
 * @returns {string}
 */
export function installedPlaywright(lockText) {
  const lock = JSON.parse(lockText);
  const version = lock?.packages?.['node_modules/@playwright/test']?.version;
  if (typeof version !== 'string')
    throw new Error(
      'package-lock.json has no node_modules/@playwright/test version',
    );
  return version;
}

const PINNED =
  /^FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:([0-9a-f]{64})\s*$/;

/**
 * The version and digest the Dockerfile pins. Exactly one FROM, read from
 * lines that are not comments, so a commented pin pins nothing.
 * @param {string} dockerfileText
 * @returns {{ version: string, digest: string }}
 */
export function pinnedImage(dockerfileText) {
  const froms = dockerfileText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^FROM\s/i.test(line));
  const match = froms.length === 1 ? PINNED.exec(froms[0]) : null;
  if (!match)
    throw new Error(
      `${DOCKERFILE} must hold one FROM ${REPOSITORY}:vX.Y.Z-noble@sha256:<64 hex>`,
    );
  return { version: match[1], digest: match[2] };
}

/**
 * The pinned image when it is the installed version's; otherwise the tag to
 * resolve, whichever of the two leads.
 * @param {{ installed: string, pinned: { version: string, digest: string } }} input
 * @returns {{ source: 'pinned', ref: string } | { source: 'resolve', tag: string }}
 */
export function chooseImage({ installed, pinned }) {
  return pinned.version === installed
    ? {
        source: 'pinned',
        ref: `${REPOSITORY}:v${installed}-noble@sha256:${pinned.digest}`,
      }
    : { source: 'resolve', tag: `v${installed}-noble` };
}

/**
 * The digest a registry names for a manifest, or why it named none.
 * @param {number} status
 * @param {Headers} headers
 * @returns {string}
 */
export function digestFrom(status, headers) {
  if (status !== 200)
    throw new Error(
      `mcr.microsoft.com answered ${status} for the installed Playwright image`,
    );
  const digest = headers.get('docker-content-digest') ?? '';
  if (!/^sha256:[0-9a-f]{64}$/.test(digest))
    throw new Error(
      'mcr.microsoft.com named no sha256 digest for the installed Playwright image',
    );
  return digest;
}

/**
 * The image a LOCAL run uses, read from the same two files, with no network:
 * the pinned digest when it is the installed version's, otherwise that
 * version's tag. `scripts/visual.mjs` captures baselines in it, so a capture
 * and CI's comparison share the selector instead of each deriving its own.
 * @returns {string}
 */
export function localImage() {
  const choice = chooseImage({
    installed: installedPlaywright(readFileSync('package-lock.json', 'utf8')),
    pinned: pinnedImage(readFileSync(DOCKERFILE, 'utf8')),
  });
  return choice.source === 'pinned'
    ? choice.ref
    : `${REPOSITORY}:${choice.tag}`;
}

/**
 * The argument vector for `docker` that runs a Playwright command in `image`
 * over this checkout, built without running anything so a test can read it
 * (`tests/unit/visual-runner.test.ts`, `tests/unit/floors.test.ts`). One home
 * for the container both local runs use: the visual suite (`visual.mjs`) and
 * the floor recorder (`record-floors.mjs`, #475).
 *
 * @param {object} options
 * @param {string} options.image the pinned Playwright image
 * @param {string} options.cwd the repo root, mounted at /work
 * @param {Readonly<Record<string, string>>} options.env set in the container
 * @param {string} options.command the Playwright command, which reads its
 *   operands as `"$@"`
 * @param {readonly string[]} options.operands handed to `command` as `"$@"`
 * @returns {string[]}
 */
export function containerArgs({ image, cwd, env, command, operands }) {
  return [
    'run',
    '--rm',
    // THE ARCHITECTURE CI COMPARES ON, not the host's (#224). The baselines
    // were captured on an arm64 Mac and are compared on CI's `x86_64` runner,
    // and every one of the ten differed on 25-48% of its pixels at zero
    // tolerance (measured, run 35657436585). `threshold: 0.1` hid all of it,
    // so the tolerance was really buying a whole architecture's worth of text
    // rasterisation and a smaller real regression would have shipped green.
    //
    // On Apple Silicon this is emulated and therefore slow; that cost was put
    // to the operator with the measurement and accepted. It sits before the
    // image deliberately: `docker run [OPTIONS] IMAGE [COMMAND]`, so the same
    // flag after the image is handed to the entrypoint and does nothing at
    // all, silently. Pinned by `tests/unit/visual-runner.test.ts`.
    '--platform',
    'linux/amd64',
    // Chromium exhausts the default 64MB /dev/shm and crashes mid-run.
    '--ipc=host',
    '-v',
    `${cwd}:/work`,
    // An ANONYMOUS volume over node_modules, so `npm ci` inside the container
    // installs Linux binaries into the container's own layer instead of
    // overwriting the macOS ones on the host. Without this the next local
    // `npm test` fails on a native module built for the wrong platform.
    '-v',
    '/work/node_modules',
    '-w',
    '/work',
    ...Object.entries(env).flatMap(([name, value]) => [
      '-e',
      `${name}=${value}`,
    ]),
    image,
    'sh',
    '-c',
    [
      // `astro preview` writes `.astro/preview.json` naming its PID, and that
      // file lives on the mounted repo -- so the NEXT container inherits a
      // lock held by a process that no longer exists anywhere, refuses to
      // start the server, and reports a stack trace about `astro preview
      // stop` instead of anything to do with the site. CI never sees this
      // (a fresh checkout each run); a second local run always would.
      'rm -f .astro/preview.json',
      'npm ci --no-audit --no-fund',
      command,
    ].join(' && '),
    // `sh -c SCRIPT NAME ARG...`: NAME becomes `$0`, and the ARGs become
    // `"$@"` exactly as Docker received them from this array.
    'sh',
    ...operands,
  ];
}

/** @param {string} tag @returns {Promise<string>} */
async function resolveDigest(tag) {
  const response = await fetch(
    `https://mcr.microsoft.com/v2/playwright/manifests/${tag}`,
    {
      method: 'HEAD',
      headers: {
        Accept: [
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
        ].join(', '),
      },
      signal: AbortSignal.timeout(LIMIT_MS),
    },
  );
  return digestFrom(response.status, response.headers);
}

export async function main() {
  if (argv.length > 2) {
    console.error(
      'usage: node scripts/playwright-image.mjs (takes no arguments)',
    );
    exit(1);
  }
  try {
    const installed = installedPlaywright(
      readFileSync('package-lock.json', 'utf8'),
    );
    const pinned = pinnedImage(readFileSync(DOCKERFILE, 'utf8'));
    const choice = chooseImage({ installed, pinned });
    let ref;
    if (choice.source === 'pinned') {
      ref = choice.ref;
    } else {
      ref = `${REPOSITORY}:${choice.tag}@${await resolveDigest(choice.tag)}`;
      console.log(
        `::warning::${DOCKERFILE} pins Playwright ${pinned.version} but ${installed} is installed; ` +
          "this run uses the installed version's image, resolved now. " +
          "Dependabot's image update brings the pin level again.",
      );
    }
    console.log(`Playwright image (${choice.source}): ${ref}`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `ref=${ref}\n`);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `### Playwright image\n\n| | |\n| --- | --- |\n| installed | \`${installed}\` |\n| pinned | \`${pinned.version}\` |\n| used (${choice.source}) | \`${ref}\` |\n`,
      );
  } catch (error) {
    console.error(`::error::${/** @type {Error} */ (error).message}`);
    exit(1);
  }
}

if (import.meta.main) await main();
