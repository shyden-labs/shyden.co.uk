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
