import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';

/**
 * The phone runs every shared test (#1179; Shyden 2026-11-17: the same tests
 * on every device). Until then `android-chrome` left the tests tagged
 * `@emulated-viewport` out with a `grepInvert`, and the gauntlet listed them
 * separately to count them as skipped by design (#308). The last shared test
 * so tagged, the theme gallery's /classroom-groups check, now runs at the
 * phone's own width, so no project of the device config keeps a test off by
 * tag. A test that belongs to one device group says so with its group's tag
 * (#1182), never with a filter here.
 */
describe('the phone run keeps no test off by design (#1179)', () => {
  it('no project of the device config declares a grepInvert', async () => {
    // Importing the device config sets PW_REAL_DEVICE at module scope; put it back.
    const before = process.env.PW_REAL_DEVICE;
    try {
      const loaded = (await import(resolve('playwright.device.config.ts'))) as {
        default: { projects: Array<{ name?: string; grepInvert?: unknown }> };
      };
      const projects = loaded.default.projects;
      expect(
        projects.length,
        'the device config declares projects',
      ).toBeGreaterThan(0);
      expect(
        projects.filter((p) => p.grepInvert !== undefined).map((p) => p.name),
      ).toEqual([]);
    } finally {
      if (before === undefined) delete process.env.PW_REAL_DEVICE;
      else process.env.PW_REAL_DEVICE = before;
    }
  });
});
