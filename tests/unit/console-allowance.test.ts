import { describe, expect, it } from 'vitest';
import {
  SAFARI_UNKNOWN_VIEWPORT_KEY,
  isAllowedConsoleError,
} from '../console-allowance';

/**
 * The one console error the "loads without errors" checks let through (operator
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
