import { describe, expect, it } from 'vitest';
import prodConfig from '../../playwright.prod.config';

// #1250: production's browser check runs on the same three engines as the dev
// check (#1032 AC5), so a release that breaks one engine is caught on the live
// site. Global rule (2026-11-05): one suite, unchanged, on every browser.
describe('the prod sanity suite runs on every engine (#1250)', () => {
  it('declares Chromium, Firefox and WebKit, each on its own engine', () => {
    expect(
      (prodConfig.projects ?? []).map((project) => [
        project.name,
        // Playwright's device presets name their engine as defaultBrowserType.
        project.use?.browserName ?? project.use?.defaultBrowserType,
      ]),
    ).toEqual([
      ['chromium', 'chromium'],
      ['firefox', 'firefox'],
      ['webkit', 'webkit'],
    ]);
  });

  it('prints each result with the engine it ran on', () => {
    expect(prodConfig.reporter).toEqual([['list']]);
  });
});
