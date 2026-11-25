import { describe, expect, it } from 'vitest';
import {
  NODE_MODULES_VOLUME,
  desktopContainerArgv,
  dockerAnswer,
  pinnedImageRef,
} from '../../scripts/desktop-container.mjs';

/**
 * On macOS the engines hand a `<select>` to a native menu that real key
 * presses never reach, so 596 dropdown tests failed in the gauntlet's
 * desktop group while passing on CI's Linux (#1027, measured 2026-11-13).
 * Shyden ruled 2026-11-16 that the desktop group runs in a Linux container
 * on the Mac, the same image family CI uses. Nothing here starts Docker.
 */

const DIGEST = 'a'.repeat(64);
const lock = (version: string) =>
  JSON.stringify({
    packages: { 'node_modules/@playwright/test': { version } },
  });
const dockerfile = `FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:${DIGEST}\n`;

describe('pinnedImageRef', () => {
  it("is the Dockerfile's pinned image when it is the installed Playwright's", () => {
    expect(pinnedImageRef(lock('1.65.0'), dockerfile)).toBe(
      `mcr.microsoft.com/playwright:v1.65.0-noble@sha256:${DIGEST}`,
    );
  });

  it('refuses, naming both versions, when the pin is not the installed version', () => {
    expect(() => pinnedImageRef(lock('1.66.0'), dockerfile)).toThrow(
      'docker/playwright/Dockerfile pins Playwright 1.65.0 but 1.66.0 is installed; the desktop group runs only in the pinned image, so bring the pin level first',
    );
  });
});

describe('desktopContainerArgv', () => {
  const argv = desktopContainerArgv({
    root: '/Users/x/site',
    image: 'img@sha256:1',
    env: { PW_REUSE_SERVER: '1', DASHBOARD_GROUP: 'desktop' },
    playwrightArgs: ['--config=playwright.config.ts', '--workers=2'],
  });

  it('mounts the checkout at its own path, so every absolute report path holds inside', () => {
    expect(argv.slice(0, 9)).toEqual([
      'run',
      '--rm',
      '--init',
      '--ipc=host',
      '-v',
      '/Users/x/site:/Users/x/site',
      '-v',
      `${NODE_MODULES_VOLUME}:/Users/x/site/node_modules`,
      '-w',
    ]);
    expect(argv[9]).toBe('/Users/x/site');
  });

  it('passes each variable by name and value, then runs the entry inside the image', () => {
    expect(argv.slice(10)).toEqual([
      '-e',
      'PW_REUSE_SERVER=1',
      '-e',
      'DASHBOARD_GROUP=desktop',
      'img@sha256:1',
      'node',
      'scripts/desktop-container.mjs',
      '--inside',
      '--config=playwright.config.ts',
      '--workers=2',
    ]);
  });

  it('refuses a value with a line break, which docker would split', () => {
    expect(() =>
      desktopContainerArgv({
        root: '/r',
        image: 'i',
        env: { A: 'x\ny' },
        playwrightArgs: [],
      }),
    ).toThrow('A holds a line break; docker run -e cannot carry it');
  });
});

describe('dockerAnswer', () => {
  it('goes on when the daemon answered with a server version', () => {
    expect(() => dockerAnswer({ status: 0, stdout: '29.1.2\n' })).not.toThrow();
  });

  it('names the Colima claim when the daemon did not answer', () => {
    expect(() => dockerAnswer({ status: 1, stdout: '' })).toThrow(
      'Docker did not answer (docker version exited 1); the desktop group runs in a Linux container, so claim Colima first: ~/.claude/scripts/colima-use.zsh claim "<session>" shyden.co.uk',
    );
  });

  it('names the Colima claim when docker answered with no server version', () => {
    expect(() => dockerAnswer({ status: 0, stdout: '\n' })).toThrow(
      'Docker did not answer (docker version exited 0)',
    );
  });
});
