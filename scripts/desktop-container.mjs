#!/usr/bin/env node
/**
 * The real-device gauntlet's desktop group runs in a Linux container on the
 * Mac (#1027; Shyden's ruling, 2026-11-16).
 *
 * On macOS, Chromium, Firefox and WebKit hand a `<select>` to a native menu
 * that real key presses never reach: 596 dropdown tests failed in the
 * desktop group on 2026-11-13 while the same tests passed on CI's Linux. So
 * the group runs in the Playwright image `docker/playwright/Dockerfile` pins,
 * the image family CI uses, and every test runs unchanged.
 *
 * Outside (`scripts/test-devices.mjs`): `pinnedImageRef`, `dockerAnswer` and
 * `desktopContainerArgv` choose the image, check the daemon (Colima) and
 * build the `docker run` call. The checkout is mounted at its own path, so
 * every absolute report path the runner hands over holds inside too; Linux
 * `node_modules` lives in a volume of its own, never in the checkout.
 *
 * Inside (`--inside`): install the Linux dependencies, carry the container's
 * `localhost:4321` to the Mac's one preview server (`forwardPort`), so the
 * suite keeps the origin it was written against, then run Playwright with the
 * arguments given and exit with its code.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { argv, exit } from 'node:process';
import {
  DOCKERFILE,
  chooseImage,
  installedPlaywright,
  pinnedImage,
} from './playwright-image.mjs';

/** Where the container's Linux `npm ci` lives, kept between runs. */
export const NODE_MODULES_VOLUME = 'shyden-site-desktop-node-modules';

/** The port the suite's `baseURL` names, and the Mac's preview serves. */
const PREVIEW_PORT = 4321;

/** The Mac, as a container in Colima reaches it (measured 2026-11-16). */
const MAC_HOST = 'host.docker.internal';

/**
 * The pinned image, or why the desktop group cannot run in it.
 * @param {string} lockText package-lock.json
 * @param {string} dockerfileText docker/playwright/Dockerfile
 * @returns {string}
 */
export function pinnedImageRef(lockText, dockerfileText) {
  const installed = installedPlaywright(lockText);
  const pinned = pinnedImage(dockerfileText);
  const choice = chooseImage({ installed, pinned });
  if (choice.source !== 'pinned')
    throw new Error(
      `${DOCKERFILE} pins Playwright ${pinned.version} but ${installed} is installed; ` +
        'the desktop group runs only in the pinned image, so bring the pin level first',
    );
  return choice.ref;
}

/**
 * Goes on when `docker version --format {{.Server.Version}}` answered;
 * otherwise names the Colima claim.
 * @param {{ status: number | null, stdout: string }} answer
 */
export function dockerAnswer({ status, stdout }) {
  if (status === 0 && stdout.trim() !== '') return;
  throw new Error(
    `Docker did not answer (docker version exited ${status}); the desktop group runs in a Linux container, ` +
      'so claim Colima first: ~/.claude/scripts/colima-use.zsh claim "<session>" shyden.co.uk',
  );
}

/**
 * The `docker` arguments that run the desktop group in `image`.
 * @param {{ root: string, image: string, env: Record<string, string>, playwrightArgs: string[] }} input
 * @returns {string[]}
 */
export function desktopContainerArgv({ root, image, env, playwrightArgs }) {
  const variables = Object.entries(env).flatMap(([name, value]) => {
    if (/[\r\n]/.test(value))
      throw new Error(
        `${name} holds a line break; docker run -e cannot carry it`,
      );
    return ['-e', `${name}=${value}`];
  });
  return [
    'run',
    '--rm',
    '--init',
    '--ipc=host',
    '-v',
    `${root}:${root}`,
    '-v',
    `${NODE_MODULES_VOLUME}:${root}/node_modules`,
    '-w',
    root,
    ...variables,
    image,
    'node',
    'scripts/desktop-container.mjs',
    '--inside',
    ...playwrightArgs,
  ];
}

/**
 * Listens on `listenPort` and carries every connection, both ways, to
 * `targetHost:targetPort`. A connection the target refuses is ended.
 * @param {{ listenPort: number, targetHost: string, targetPort: number }} input
 * @returns {Promise<import('node:net').Server>}
 */
export function forwardPort({ listenPort, targetHost, targetPort }) {
  const server = createServer((visitor) => {
    const target = connect(targetPort, targetHost);
    visitor.pipe(target).pipe(visitor);
    target.on('error', () => visitor.destroy());
    visitor.on('error', () => target.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Runs inside the container; exits with Playwright's own code.
 * @param {string[]} playwrightArgs
 */
async function inside(playwrightArgs) {
  const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
  });
  if (install.status !== 0) {
    console.error(`npm ci exited ${install.status} inside the container`);
    exit(1);
  }
  const forward = await forwardPort({
    listenPort: PREVIEW_PORT,
    targetHost: MAC_HOST,
    targetPort: PREVIEW_PORT,
  });
  const run = spawn('npx', ['playwright', 'test', ...playwrightArgs], {
    stdio: 'inherit',
  });
  run.on('close', (code, signal) => {
    forward.close();
    if (signal) console.error(`playwright ended by ${signal}`);
    exit(code ?? 1);
  });
}

/**
 * For `scripts/test-devices.mjs`: the image, after checking the daemon.
 * @param {string} root the checkout
 * @returns {string}
 */
export function desktopImage(root) {
  const answer = spawnSync(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  dockerAnswer({ status: answer.status, stdout: answer.stdout ?? '' });
  return pinnedImageRef(
    readFileSync(`${root}/package-lock.json`, 'utf8'),
    readFileSync(`${root}/${DOCKERFILE}`, 'utf8'),
  );
}

if (argv[2] === '--inside') await inside(argv.slice(3));
