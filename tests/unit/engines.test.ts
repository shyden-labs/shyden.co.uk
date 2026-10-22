import { describe, expect, it } from 'vitest';
import { engineUse } from '../engines';

// Stand-ins for Playwright's device descriptors: the real ones are read by
// the guards suite through every config (browser-matrix.test.ts), since
// loading Playwright here would cost this file its load limit.
const SAFARI = {
  viewport: { width: 1280, height: 720 },
  defaultBrowserType: 'webkit',
} as const;
const CHROME = {
  viewport: { width: 1280, height: 720 },
  defaultBrowserType: 'chromium',
} as const;
const FIREFOX = {
  viewport: { width: 1280, height: 720 },
  defaultBrowserType: 'firefox',
} as const;
const ENV = { PATH: '/bin', HOME: '/home/ci' };

describe('engineUse (#919)', () => {
  it('ranks the fake audio sink first for a WebKit device, beside the environment it inherits', () => {
    expect(engineUse(SAFARI, ENV)).toStrictEqual({
      ...SAFARI,
      launchOptions: {
        env: {
          PATH: '/bin',
          HOME: '/home/ci',
          GST_PLUGIN_FEATURE_RANK: 'fakeaudiosink:MAX',
        },
      },
    });
  });

  it('leaves a Chromium device as Playwright describes it', () => {
    expect(engineUse(CHROME, ENV)).toStrictEqual(CHROME);
  });

  it('leaves a Firefox device as Playwright describes it', () => {
    expect(engineUse(FIREFOX, ENV)).toStrictEqual(FIREFOX);
  });

  it('drops a variable the environment holds unset, which a launch cannot pass', () => {
    expect(
      engineUse(SAFARI, { PATH: '/bin', UNSET: undefined }).launchOptions,
    ).toStrictEqual({
      env: { PATH: '/bin', GST_PLUGIN_FEATURE_RANK: 'fakeaudiosink:MAX' },
    });
  });

  it('overrides a rank the environment already sets, so the sink is always first', () => {
    expect(
      engineUse(SAFARI, { GST_PLUGIN_FEATURE_RANK: 'pulsesink:MAX' })
        .launchOptions,
    ).toStrictEqual({
      env: { GST_PLUGIN_FEATURE_RANK: 'fakeaudiosink:MAX' },
    });
  });
});
