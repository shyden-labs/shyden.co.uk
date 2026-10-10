/**
 * The evidence contract, proved for the leg that cannot use `shoot`.
 *
 * `tests/e2e/evidence.ts` is Playwright-only: it reads `test.info()` for the
 * project name, so it cannot be called from the iOS journeys, which run under
 * Vitest and drive a real phone over WebDriver. AC11 of #189 wants the
 * reported case confirmed on that phone, and an operator can only judge it if
 * the capture reaches the same page as every other shot.
 *
 * So the device leg writes the SAME manifest, through the SAME `manifestRow`
 * and `slug` -- which is why those two moved to the contract module. A second
 * implementation of either would be a second naming scheme the day one of them
 * changed, and the page would show a picture nobody could trace to a run.
 */

/**
 * A real 1x1 PNG, base64, exactly as WebDriver's `GET /screenshot` returns it.
 *
 * Real bytes rather than a placeholder string on purpose: the seam this file
 * protects is that the page builder can still recognise what the device leg
 * writes. Every existing capture is a JPEG; this leg cannot encode one without
 * a new dependency, so it writes PNG -- and a fake payload would assert
 * nothing about whether that survives `mediaType`.
 */
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A driver that counts its own calls, so "did not capture" is provable. */
export const fakeDriver = (b64 = PNG_BASE64) => {
  let calls = 0;
  return {
    calls: () => calls,
    screenshot: async () => {
      calls += 1;
      return b64;
    },
  };
};
