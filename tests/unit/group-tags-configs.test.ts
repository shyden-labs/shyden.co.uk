import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENGINES } from '../engines';
import { DESKTOP_TAG, PHONE_TAG } from '../group-tags';

/**
 * Each config runs its own group and leaves the other out by tag (#1182), read
 * from the projects Playwright itself resolves, so a project's own `grep`
 * cannot quietly drop the config's rule.
 */
type Resolved = {
  name: string;
  grepInvert: RegExp | RegExp[] | null;
};
const requireCjs = createRequire(import.meta.url);
const { FullConfigInternal } = requireCjs('playwright/lib/common') as {
  FullConfigInternal: new (
    location: { resolvedConfigFile: string; configDir: string },
    userConfig: PlaywrightTestConfig,
    cliOverrides: Record<string, never>,
    metadata: undefined,
  ) => { projects: Array<{ project: Resolved }> };
};
const resolved = (config: PlaywrightTestConfig, file: string): Resolved[] => {
  const resolvedConfigFile = resolve(file);
  return new FullConfigInternal(
    { resolvedConfigFile, configDir: dirname(resolvedConfigFile) },
    config,
    {},
    undefined,
  ).projects.map(({ project }) => project);
};
const leavesOut = (project: Resolved, title: string): boolean =>
  [project.grepInvert ?? []].flat().some((pattern) => pattern.test(title));

let desktop: Resolved[];
let phone: Resolved[];

beforeAll(async () => {
  desktop = resolved(
    (await import('../../playwright.config')).default,
    'playwright.config.ts',
  );
  // The config sets PW_REAL_DEVICE as it loads; keep it out of the rest.
  const before = process.env.PW_REAL_DEVICE;
  try {
    phone = resolved(
      (await import('../../playwright.device.config')).default,
      'playwright.device.config.ts',
    ).filter((p) => p.name !== 'android-preflight');
  } finally {
    if (before === undefined) delete process.env.PW_REAL_DEVICE;
    else process.env.PW_REAL_DEVICE = before;
  }
});

describe('each config runs its own group (#1182)', () => {
  it('every desktop browser leaves out the @phone tests and keeps the rest', () => {
    expect(desktop.map((p) => p.name)).toEqual(ENGINES.map((e) => e.name));
    for (const project of desktop) {
      expect(leavesOut(project, `a test ${PHONE_TAG}`), project.name).toBe(
        true,
      );
      expect(leavesOut(project, `a test ${DESKTOP_TAG}`), project.name).toBe(
        false,
      );
      expect(leavesOut(project, 'a test'), project.name).toBe(false);
    }
  });

  it('every phone project leaves out the @desktop tests and keeps the rest', () => {
    expect(phone.map((p) => p.name)).toEqual([
      'android-chrome-clock',
      'android-chrome',
    ]);
    for (const project of phone) {
      expect(leavesOut(project, `a test ${DESKTOP_TAG}`), project.name).toBe(
        true,
      );
      expect(leavesOut(project, `a test ${PHONE_TAG}`), project.name).toBe(
        false,
      );
      expect(leavesOut(project, 'a test'), project.name).toBe(false);
    }
  });
});
