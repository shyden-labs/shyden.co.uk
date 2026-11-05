import { describe, expect, it } from 'vitest';
import {
  chooseImage,
  digestFrom,
  installedPlaywright,
  pinnedImage,
} from '../../scripts/playwright-image.mjs';

/**
 * Which Playwright image a CI run uses (#454). Always the image for the
 * INSTALLED Playwright: the Dockerfile's digest when it names that version,
 * otherwise that version's digest resolved at run time, so a Playwright
 * update is never red while the image catches up.
 */
const DIGEST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const lock = (version: string) =>
  JSON.stringify({
    packages: {
      '': { name: 'shyden.co.uk' },
      'node_modules/@playwright/test': { version },
      'node_modules/playwright': { version },
    },
  });
const dockerfile = (version: string, digest = DIGEST) =>
  [
    '# The image CI runs; Dependabot keeps it current.',
    `FROM mcr.microsoft.com/playwright:v${version}-noble@sha256:${digest}`,
    '',
  ].join('\n');

describe('the installed Playwright version', () => {
  it('reads @playwright/test from the lockfile', () => {
    expect(installedPlaywright(lock('1.63.0'))).toBe('1.63.0');
  });

  it('refuses a lockfile without @playwright/test, by name', () => {
    expect(() =>
      installedPlaywright(JSON.stringify({ packages: { '': {} } })),
    ).toThrow('package-lock.json has no node_modules/@playwright/test version');
  });
});

describe('the pinned image', () => {
  it('reads the version and digest the Dockerfile names', () => {
    expect(pinnedImage(dockerfile('1.63.0'))).toEqual({
      version: '1.63.0',
      digest: DIGEST,
    });
  });

  it('refuses a FROM without a digest, rather than trusting a tag', () => {
    expect(() =>
      pinnedImage('FROM mcr.microsoft.com/playwright:v1.63.0-noble\n'),
    ).toThrow(
      'docker/playwright/Dockerfile must hold one FROM mcr.microsoft.com/playwright:vX.Y.Z-noble@sha256:<64 hex>',
    );
  });

  it('refuses a commented-out FROM, which pins nothing', () => {
    expect(() =>
      pinnedImage(
        `# FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${DIGEST}\n`,
      ),
    ).toThrow(/must hold one FROM/);
  });

  it('refuses two FROM lines, which would leave the choice to order', () => {
    expect(() =>
      pinnedImage(dockerfile('1.63.0') + dockerfile('1.64.0', OTHER)),
    ).toThrow(/must hold one FROM/);
  });
});

describe('the choice', () => {
  it('uses the pinned digest when it names the installed version', () => {
    expect(
      chooseImage({
        installed: '1.63.0',
        pinned: { version: '1.63.0', digest: DIGEST },
      }),
    ).toEqual({
      source: 'pinned',
      ref: `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${DIGEST}`,
    });
  });

  it('resolves the installed version when Playwright is ahead of the pin', () => {
    expect(
      chooseImage({
        installed: '1.64.0',
        pinned: { version: '1.63.0', digest: DIGEST },
      }),
    ).toEqual({ source: 'resolve', tag: 'v1.64.0-noble' });
  });

  it('resolves the installed version when the pin is ahead of Playwright', () => {
    expect(
      chooseImage({
        installed: '1.63.0',
        pinned: { version: '1.64.0', digest: OTHER },
      }),
    ).toEqual({ source: 'resolve', tag: 'v1.63.0-noble' });
  });
});

describe("the registry's answer", () => {
  it('takes the digest the registry names', () => {
    expect(
      digestFrom(
        200,
        new Headers({ 'docker-content-digest': `sha256:${DIGEST}` }),
      ),
    ).toBe(`sha256:${DIGEST}`);
  });

  it('refuses a missing tag, by status', () => {
    expect(() => digestFrom(404, new Headers())).toThrow(
      'mcr.microsoft.com answered 404 for the installed Playwright image',
    );
  });

  it('refuses an answer that names no digest', () => {
    expect(() => digestFrom(200, new Headers())).toThrow(
      'mcr.microsoft.com named no sha256 digest for the installed Playwright image',
    );
  });
});
