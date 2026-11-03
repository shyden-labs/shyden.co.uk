import { describe, expect, it } from 'vitest';
import {
  SAFARI_UNKNOWN_VIEWPORT_KEY,
  isAllowedConsoleError,
} from '../console-allowance';

/**
 * The first console error the "loads without errors" checks let through (operator
 * decision 2026-10-18, issue 807). Every page's viewport tag carries
 * `interactive-widget=resizes-content` so Android Chrome's keyboard shrinks the
 * page instead of hiding Make Groups; Safari does not know the key and logs an
 * error for it on every page (measured in CI: 20 tests failed, 10 on each
 * WebKit engine). Exactly that message, and only on WebKit.
 */
describe('isAllowedConsoleError', () => {
  it("pins Safari's message, word for word", () => {
    expect(SAFARI_UNKNOWN_VIEWPORT_KEY).toBe(
      'Viewport argument key "interactive-widget" not recognized and ignored.',
    );
  });

  it("lets Safari's unknown-key message through on WebKit", () => {
    expect(isAllowedConsoleError(SAFARI_UNKNOWN_VIEWPORT_KEY, 'webkit')).toBe(
      true,
    );
  });

  it('refuses the same message on Chromium, which knows the key', () => {
    expect(isAllowedConsoleError(SAFARI_UNKNOWN_VIEWPORT_KEY, 'chromium')).toBe(
      false,
    );
  });

  it('refuses the same message on Firefox', () => {
    expect(isAllowedConsoleError(SAFARI_UNKNOWN_VIEWPORT_KEY, 'firefox')).toBe(
      false,
    );
  });

  it('refuses the message with anything before it', () => {
    expect(
      isAllowedConsoleError(`x ${SAFARI_UNKNOWN_VIEWPORT_KEY}`, 'webkit'),
    ).toBe(false);
  });

  it('refuses the message with anything after it', () => {
    expect(
      isAllowedConsoleError(`${SAFARI_UNKNOWN_VIEWPORT_KEY} x`, 'webkit'),
    ).toBe(false);
  });

  it('refuses the same complaint about another viewport key', () => {
    expect(
      isAllowedConsoleError(
        'Viewport argument key "minimal-ui" not recognized and ignored.',
        'webkit',
      ),
    ).toBe(false);
  });

  it('refuses any other console error on WebKit', () => {
    expect(isAllowedConsoleError('TypeError: x is undefined', 'webkit')).toBe(
      false,
    );
  });
});

/**
 * macOS WebKit's own video controls (#1008): on the iPhone-emulated project
 * the homepage video's controls log one line per placard icon they fail to
 * load, `src` a blob URL WebKit makes itself. Measured 2026-11-02, Playwright
 * 1.64.1's WebKit on the laptop: invalid-, pip- and airplay-placard.
 */
const placard = (icon: string, src = `blob:http://127.0.0.1:4321/${UUID}`) =>
  `Button failed to load, iconName = ${icon}-placard, layoutTraits = [MacOSLayoutTraits Inline], src = ${src}`;
const UUID = 'a185f9bb-2809-42dc-af6e-ad42c924a04a';

describe("WebKit's own media-control icons (#1008)", () => {
  for (const icon of ['invalid', 'pip', 'airplay'])
    it(`lets the ${icon}-placard line through on WebKit`, () => {
      expect(isAllowedConsoleError(placard(icon), 'webkit')).toBe(true);
    });

  it('lets it through from a host with no port', () => {
    expect(
      isAllowedConsoleError(
        placard('pip', `blob:https://dev.shyden.co.uk/${UUID}`),
        'webkit',
      ),
    ).toBe(true);
  });

  it('refuses it on Chromium', () => {
    expect(isAllowedConsoleError(placard('pip'), 'chromium')).toBe(false);
  });

  it('refuses it on Firefox', () => {
    expect(isAllowedConsoleError(placard('pip'), 'firefox')).toBe(false);
  });

  it('refuses an icon it was not measured with', () => {
    expect(isAllowedConsoleError(placard('fullscreen'), 'webkit')).toBe(false);
  });

  it('refuses another layout', () => {
    expect(
      isAllowedConsoleError(
        placard('pip').replace(
          'MacOSLayoutTraits Inline',
          'IOSLayoutTraits Inline',
        ),
        'webkit',
      ),
    ).toBe(false);
  });

  it('refuses a src that is not a blob URL WebKit made', () => {
    expect(
      isAllowedConsoleError(
        placard('pip', 'https://example.com/pip.png'),
        'webkit',
      ),
    ).toBe(false);
  });

  it('refuses a blob URL with anything after its id', () => {
    expect(
      isAllowedConsoleError(
        placard('pip', `blob:http://127.0.0.1:4321/${UUID} TypeError`),
        'webkit',
      ),
    ).toBe(false);
  });

  it('refuses the line with anything before it', () => {
    expect(isAllowedConsoleError(`x ${placard('pip')}`, 'webkit')).toBe(false);
  });
});
