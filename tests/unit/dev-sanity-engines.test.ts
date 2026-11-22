import { describe, expect, it } from 'vitest';
import devConfig from '../../playwright.dev.config';
import { supportTestAddress } from '../dev/support-address';

// Shyden's ruling on #1032 AC5 (2026-11-22): the dev check runs on all three
// engines on every dev deploy, and the support journey writes from its own
// address per engine and run, so ShyDesk's limit of 5 requests an hour per
// customer email is never reached.
describe('the dev sanity suite runs on every engine (#1032)', () => {
  it('declares Chromium, Firefox and WebKit, each on its own engine', () => {
    expect(
      (devConfig.projects ?? []).map((project) => [
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
});

describe('supportTestAddress (#1032)', () => {
  it('plus-addresses the support test mailbox with the engine and the run', () => {
    expect(supportTestAddress('firefox', 1_763_800_000_000)).toBe(
      'support-test+firefox-1763800000000@shyden.co.uk',
    );
  });

  it('gives each engine of one run its own address', () => {
    const at = 1_763_800_000_000;
    const addresses = ['chromium', 'firefox', 'webkit'].map((engine) =>
      supportTestAddress(engine, at),
    );
    expect(new Set(addresses).size).toBe(3);
  });

  it('gives each run of one engine its own address', () => {
    expect(supportTestAddress('webkit', 1)).not.toBe(
      supportTestAddress('webkit', 2),
    );
  });
});
