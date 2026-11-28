import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADB,
  ASTRO_CLI,
  DOCKER,
  dockerFor,
  GIT,
  LSOF,
  NODE,
  NPM_CLI,
  PGREP,
  PLAYWRIGHT_CLI,
  PS,
  VITEST_CLI,
  XCODEBUILD,
  XCRUN,
  lsofFor,
} from '../../scripts/programs.mjs';

/**
 * #1275, SonarCloud's S4036: a script that runs a program by its bare name
 * runs whichever one comes first on PATH, and any folder on PATH a user can
 * write to can put a different program there. Each program is named by its
 * absolute path instead.
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('the programs the scripts run, each by its absolute path', () => {
  it('runs git, ps and pgrep from the system folders every machine has', () => {
    expect([GIT, PS, PGREP]).toEqual([
      '/usr/bin/git',
      '/bin/ps',
      '/usr/bin/pgrep',
    ]);
  });

  // The device tools run only on the Mac (#1294). Measured there with
  // `which -a` on 2026-11-28: one of each, adb from Homebrew's
  // android-platform-tools cask, xcrun and xcodebuild from the system.
  it('runs the device tools from where the Mac keeps them', () => {
    expect([ADB, XCRUN, XCODEBUILD]).toEqual([
      '/opt/homebrew/bin/adb',
      '/usr/bin/xcrun',
      '/usr/bin/xcodebuild',
    ]);
  });

  it('runs node as the one running this script', () => {
    expect(NODE).toBe(process.execPath);
  });

  it('runs npm from the npm installed beside this node', () => {
    expect(NPM_CLI).toBe(
      path.join(
        path.dirname(process.execPath),
        '..',
        'lib',
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
      ),
    );
  });

  it("runs Playwright and Astro from this checkout's own node_modules", () => {
    expect(PLAYWRIGHT_CLI).toBe(
      path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
    );
    expect(ASTRO_CLI).toBe(
      path.join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs'),
    );
    // Vitest's own `bin` entry, which `npx vitest` runs (#1295).
    expect(VITEST_CLI).toBe(
      path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
    );
  });

  it('finds docker where each system keeps it: Homebrew on the Mac', () => {
    expect(dockerFor('darwin')).toBe('/opt/homebrew/bin/docker');
    expect(dockerFor('linux')).toBe('/usr/bin/docker');
    expect(DOCKER).toBe(dockerFor(process.platform));
  });

  it('finds lsof where each system keeps it', () => {
    expect(lsofFor('darwin')).toBe('/usr/sbin/lsof');
    expect(lsofFor('linux')).toBe('/usr/bin/lsof');
    expect(LSOF).toBe(lsofFor(process.platform));
  });
});
